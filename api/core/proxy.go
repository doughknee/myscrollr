package core

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

var proxyClient = &http.Client{
	Timeout: 70 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// SetupDynamicProxy registers a single catch-all route that dynamically resolves
// channel routes at request time using live discovery data.
// This MUST be called AFTER all core routes so core routes take priority
// (Fiber matches routes in registration order).
func SetupDynamicProxy(app *fiber.App) {
	app.Use(dynamicProxyHandler)
	log.Println("[Proxy] Dynamic catch-all proxy registered")
}

// dynamicProxyHandler resolves the incoming request against discovered channel
// routes and proxies matching requests to the appropriate channel service.
func dynamicProxyHandler(c *fiber.Ctx) error {
	requestPath := c.Path()
	requestMethod := c.Method()

	// Find a matching channel route
	routes := GetChannelRoutes()

	for _, entry := range routes {
		route := entry.Route
		intg := entry.Channel

		if route.Method != requestMethod {
			continue
		}

		// Try to match the route pattern against the request path
		params, ok := matchRoute(route.Path, requestPath)
		if !ok {
			continue
		}

		// If auth is required, validate the JWT inline (without c.Next())
		if route.Auth {
			if err := ValidateAuth(c); err != nil {
				log.Printf("[Proxy] Auth failed for %s %s: %v", requestMethod, requestPath, err)
				// ValidateAuth already wrote the 401 — returning nil keeps
				// it. Proxying anyway would let the upstream response
				// overwrite the 401 (the fail-open this fixes).
				return nil
			}
		}

		// Build the target URL with resolved params
		targetPath := route.Path
		for paramName, paramValue := range params {
			targetPath = strings.Replace(targetPath, ":"+paramName, paramValue, 1)
		}

		return proxyRequest(c, intg, route, targetPath)
	}

	// No matching route found — return 404
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
		"status": "error",
		"error":  "Not found",
	})
}

// stripAuthCookies removes the core's own auth cookies (access_token and
// refresh_token, case-insensitive) from a Cookie header value. Returns the
// filtered header (empty if no cookies remain) so callers can decide
// whether to set a Cookie header at all on the proxied request.
//
// Cookies in the header are separated by "; ". Each cookie is "name=value".
// We split on ";", trim whitespace, and drop entries whose name matches
// access_token or refresh_token.
func stripAuthCookies(cookieHeader string) string {
	parts := strings.Split(cookieHeader, ";")
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed == "" {
			continue
		}
		name := trimmed
		if eq := strings.IndexByte(trimmed, '='); eq >= 0 {
			name = trimmed[:eq]
		}
		switch strings.ToLower(name) {
		case "access_token", "refresh_token":
			continue
		}
		kept = append(kept, trimmed)
	}
	return strings.Join(kept, "; ")
}

// matchRoute matches a Fiber-style route pattern (e.g. "/yahoo/league/:league_key/standings")
// against an actual request path. Returns extracted params and whether it matched.
func matchRoute(pattern, path string) (map[string]string, bool) {
	patternParts := strings.Split(strings.Trim(pattern, "/"), "/")
	pathParts := strings.Split(strings.Trim(path, "/"), "/")

	if len(patternParts) != len(pathParts) {
		return nil, false
	}

	params := make(map[string]string)
	for i, pp := range patternParts {
		if strings.HasPrefix(pp, ":") {
			// Parameter segment — capture value
			params[pp[1:]] = pathParts[i]
		} else if pp != pathParts[i] {
			// Static segment — must match exactly
			return nil, false
		}
	}

	return params, true
}

// proxyRequest forwards the request to the channel service.
func proxyRequest(c *fiber.Ctx, intg *ChannelInfo, route ChannelRoute, targetPath string) error {
	targetURL := intg.InternalURL + targetPath

	// Forward query string
	if queryString := string(c.Request().URI().QueryString()); queryString != "" {
		targetURL += "?" + queryString
	}

	// Create the proxy request with an independent context (Fiber's c.Context()
	// is pooled and may be recycled before the proxy completes).
	// POST/PUT/DELETE routes (e.g. league import) may take 60s+; GET routes are fast.
	proxyTimeout := 25 * time.Second
	if c.Method() == "POST" || c.Method() == "PUT" || c.Method() == "DELETE" {
		proxyTimeout = 65 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), proxyTimeout)
	defer cancel()

	var bodyReader io.Reader
	if len(c.Body()) > 0 {
		bodyReader = bytes.NewReader(c.Body())
	}

	req, err := http.NewRequestWithContext(ctx, c.Method(), targetURL, bodyReader)
	if err != nil {
		log.Printf("[Proxy] Failed to create request for %s: %v", targetURL, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"status": "error",
			"error":  "Failed to proxy request",
		})
	}

	// Forward content type
	if ct := c.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	// Forward authorization headers (for Yahoo token etc.)
	if auth := c.Get("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}

	// Forward cookies — but strip the core's own auth cookies (access_token,
	// refresh_token) before sending to channel services. Channels have no
	// business seeing the user's JWT; they identify the user via the
	// X-User-Sub header set below.
	//
	// Exception: /yahoo/* routes handled by the Fantasy channel legitimately
	// need the user's session cookies for the Yahoo OAuth state handshake,
	// so we forward the full Cookie header there.
	if cookie := c.Get("Cookie"); cookie != "" {
		if strings.HasPrefix(c.Path(), "/yahoo/") {
			req.Header.Set("Cookie", cookie)
		} else if filtered := stripAuthCookies(cookie); filtered != "" {
			req.Header.Set("Cookie", filtered)
		}
	}

	// Add user identity and tier for authenticated routes
	if route.Auth {
		userID := GetUserID(c)
		if userID != "" {
			req.Header.Set("X-User-Sub", userID)
		}
		req.Header.Set("X-User-Tier", tierFromRoles(GetUserRoles(c)))
	}

	// Execute the proxy request
	resp, err := proxyClient.Do(req)
	if err != nil {
		log.Printf("[Proxy] Request to %s failed: %v", targetURL, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"status": "error",
			"error":  fmt.Sprintf("Channel %s is unavailable", intg.Name),
		})
	}
	defer resp.Body.Close()

	// Read the response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Proxy] Failed to read response from %s: %v", targetURL, err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"status": "error",
			"error":  "Failed to read channel response",
		})
	}

	// Forward response headers.
	// Set-Cookie needs Header.Add() because c.Set() overwrites previous values
	// and integrations (e.g. Yahoo OAuth) may send multiple Set-Cookie headers.
	for key, values := range resp.Header {
		for _, value := range values {
			if strings.EqualFold(key, "Set-Cookie") {
				c.Response().Header.Add(key, value)
			} else if strings.EqualFold(key, "Location") ||
				strings.EqualFold(key, "Content-Type") {
				c.Set(key, value)
			}
		}
	}

	// Return the response with the original status code
	return c.Status(resp.StatusCode).Send(body)
}
