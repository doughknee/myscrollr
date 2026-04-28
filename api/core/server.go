package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/swagger"
	"golang.org/x/sync/singleflight"
)

// singleflight groups prevent thundering herd on cache misses.
// Multiple concurrent requests for the same key coalesce into one.
var (
	dashboardGroup   singleflight.Group
	publicFeedGroup  singleflight.Group
	healthCheckGroup singleflight.Group
)

// Server holds the Fiber app and shared dependencies.
type Server struct {
	App *fiber.App
}

// NewServer creates a new Server with a configured Fiber app.
func NewServer() *Server {
	app := fiber.New(fiber.Config{
		AppName:                 "Scrollr API",
		EnableTrustedProxyCheck: true,
		TrustedProxies:          []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"},
		ProxyHeader:             "X-Forwarded-For",
		ReadTimeout:             30 * time.Second,
		IdleTimeout:             120 * time.Second,
	})

	return &Server{
		App: app,
	}
}

// Setup configures middleware, registers all routes, and sets up channel
// proxying based on Redis discovery.
func (s *Server) Setup() {
	initStripe()
	s.setupMiddleware()
	s.setupRoutes()

	// Setup dynamic catch-all proxy for channel routes.
	// MUST be last — Fiber matches in registration order, so core routes take priority.
	SetupDynamicProxy(s.App)
}

// setupMiddleware attaches security headers, CORS, and rate limiting.
func (s *Server) setupMiddleware() {
	// Security Headers
	s.App.Use(func(c *fiber.Ctx) error {
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Download-Options", "noopen")
		c.Set("Strict-Transport-Security", fmt.Sprintf("max-age=%d; includeSubDomains", HSTSMaxAge))
		c.Set("X-DNS-Prefetch-Control", "off")
		if strings.HasPrefix(c.Path(), "/swagger") {
			c.Set("Content-Security-Policy", "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'self' https://relentnet.com")
		} else if c.Path() == "/yahoo/callback" {
			// Yahoo OAuth callback returns HTML with inline <script> (postMessage + window.close)
			// and inline style attributes. Allow those while keeping everything else locked down.
			c.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'self' https://relentnet.com")
		} else {
			c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self' https://relentnet.com")
		}
		return c.Next()
	})

	// CORS
	allowedOrigins := os.Getenv("ALLOWED_ORIGINS")
	if allowedOrigins == "" {
		allowedOrigins = DefaultAllowedOrigins
	} else {
		origins := strings.Split(allowedOrigins, ",")
		for i, o := range origins {
			origins[i] = ValidateURL(o, "")
		}
		allowedOrigins = strings.Join(origins, ",")
	}

	s.App.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowCredentials: true,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
	}))

	// Core paths always exempt from rate limiting
	coreExemptPaths := map[string]bool{
		"/health":                  true,
		"/events":                  true,
		"/webhooks/sequin":         true,
		"/webhooks/stripe":         true,
		"/channels":                true,
		"/tier-limits":             true,
		"/extension/token":         true,
		"/extension/token/refresh": true,
		"/support/ticket":          true,
	}

	// Stricter rate limiter for OAuth initiation endpoints (e.g. /yahoo/start).
	// Applied BEFORE the general rate limiter so it runs first.
	oauthRateLimitPaths := map[string]bool{
		"/yahoo/start": true,
	}
	s.App.Use(limiter.New(limiter.Config{
		Max:        OAuthRateLimitMax,
		Expiration: OAuthRateLimitExpiration,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "oauth:" + c.IP()
		},
		Next: func(c *fiber.Ctx) bool {
			return !oauthRateLimitPaths[c.Path()]
		},
	}))

	s.App.Use(limiter.New(limiter.Config{
		Max:        RateLimitMax,
		Expiration: RateLimitExpiration,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		Next: func(c *fiber.Ctx) bool {
			path := c.Path()
			// Always exempt core paths
			if coreExemptPaths[path] {
				return true
			}
			// Dynamically check channel routes (handles late-discovered channels)
			for _, entry := range GetChannelRoutes() {
				if !entry.Route.Auth {
					if _, ok := matchRoute(entry.Route.Path, path); ok {
						return true
					}
				}
			}
			return false
		},
	}))
}

// setupRoutes mounts core public and protected routes.
// Channel-specific routes are handled by SetupDynamicProxy.
func (s *Server) setupRoutes() {
	s.App.Get("/swagger/*", swagger.HandlerDefault)

	// --- Public Routes ---
	s.App.Get("/health", s.healthCheck)
	s.App.Get("/public/feed", HandlePublicFeed)
	s.App.Get("/events", StreamEvents)
	s.App.Get("/events/count", GetActiveViewers)
	s.App.Post("/webhooks/sequin", HandleSequinWebhook)
	s.App.Post("/webhooks/stripe", HandleStripeWebhook)

	// Extension auth proxy
	s.App.Options("/extension/token", HandleExtensionAuthPreflight)
	s.App.Post("/extension/token", HandleExtensionTokenExchange)
	s.App.Options("/extension/token/refresh", HandleExtensionAuthPreflight)
	s.App.Post("/extension/token/refresh", HandleExtensionTokenRefresh)

	s.App.Get("/channels", s.listChannels)
	s.App.Get("/tier-limits", HandleGetTierLimits)
	s.App.Get("/", s.landingPage)

	// --- Protected Routes ---
	s.App.Get("/dashboard", LogtoAuth, s.getDashboard)

	// Support
	s.App.Post("/support/ticket", LogtoAuth, HandleSubmitSupportTicket)

	// Invite (no auth — user isn't logged in yet, token-verified server-side)
	s.App.Post("/invite/complete", HandleCompleteInvite)
	s.App.Get("/invite/username-available", HandleCheckUsernameAvailable)

	// Billing Routes
	s.App.Post("/checkout/session", LogtoAuth, HandleCreateCheckoutSession)
	s.App.Post("/checkout/lifetime", LogtoAuth, HandleCreateLifetimeCheckout)
	s.App.Post("/checkout/setup-intent", LogtoAuth, HandleCreateSetupIntent)
	s.App.Post("/checkout/subscribe", LogtoAuth, HandleConfirmSubscription)
	s.App.Post("/checkout/payment-intent", LogtoAuth, HandleCreatePaymentIntent)
	s.App.Get("/checkout/return", LogtoAuth, HandleCheckoutReturn)
	s.App.Get("/users/me/subscription", LogtoAuth, HandleGetSubscription)
	s.App.Get("/users/me/overview", LogtoAuth, HandleGetOverview)
	s.App.Get("/users/me/subscription/preview", LogtoAuth, HandlePreviewPlanChange)
	s.App.Put("/users/me/subscription/plan", LogtoAuth, HandleChangePlan)
	s.App.Post("/users/me/subscription/cancel", LogtoAuth, HandleCancelSubscription)
	s.App.Post("/users/me/subscription/portal", LogtoAuth, HandleCreatePortalSession)

	// User Routes — specific /users/me/* paths BEFORE parameterized /users/:username
	s.App.Get("/users/me/preferences", LogtoAuth, HandleGetPreferences)
	s.App.Put("/users/me/preferences", LogtoAuth, HandleUpdatePreferences)
	s.App.Get("/users/me/channels", LogtoAuth, GetChannels)
	s.App.Post("/users/me/channels", LogtoAuth, CreateChannel)
	s.App.Put("/users/me/channels/:type", LogtoAuth, UpdateChannel)
	s.App.Delete("/users/me/channels/:type", LogtoAuth, DeleteChannel)

	// GDPR: data export + 30-day soft-delete lifecycle
	s.App.Get("/users/me/export", LogtoAuth, HandleExportUserData)
	s.App.Post("/users/me/delete", LogtoAuth, HandleRequestAccountDeletion)
	s.App.Post("/users/me/delete/cancel", LogtoAuth, HandleCancelAccountDeletion)
	s.App.Get("/users/me/delete/status", LogtoAuth, HandleAccountDeletionStatus)

	s.App.Get("/users/:username", GetProfileByUsername)
}

// healthCheck returns the aggregated health status.
// Results are cached in Redis for 10s. Singleflight prevents thundering herd.
//
// Returns HTTP 503 when `status == "degraded"` so Kubernetes readiness
// probes can actually see degradation. Previously returned 200 with
// `{"status":"degraded",…}` in the body, which k8s never inspected —
// making partial outages of the core API invisible to the orchestrator.
// The body shape is unchanged; only the status code in the degraded case
// differs.
func (s *Server) healthCheck(c *fiber.Ctx) error {
	// Check Redis cache first
	if val, err := Rdb.Get(context.Background(), HealthCacheKey).Result(); err == nil {
		return sendHealthCached(c, []byte(val), "HIT")
	}

	// Singleflight: only one goroutine computes; others wait and share the result
	result, err, _ := healthCheckGroup.Do("health", func() (interface{}, error) {
		// Double-check cache (another goroutine may have populated it)
		if val, err := Rdb.Get(context.Background(), HealthCacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := HealthResponse{Status: "healthy", Services: make(map[string]string)}

		if err := DBPool.Ping(context.Background()); err != nil {
			res.Database = "unhealthy"
			res.Status = "degraded"
		} else {
			res.Database = "healthy"
		}
		if err := Rdb.Ping(context.Background()).Err(); err != nil {
			res.Redis = "unhealthy"
			res.Status = "degraded"
		} else {
			res.Redis = "healthy"
		}

		httpClient := &http.Client{Timeout: HealthCheckTimeout}
		var healthTargets []*ChannelInfo
		for _, intg := range GetAllChannels() {
			if intg.HasCapability("health_checker") {
				healthTargets = append(healthTargets, intg)
			}
		}

		var mu sync.Mutex
		var wg sync.WaitGroup
		wg.Add(len(healthTargets))
		for _, intg := range healthTargets {
			go func(ch *ChannelInfo) {
				defer wg.Done()
				targetURL := ch.InternalURL + "/internal/health"
				resp, err := httpClient.Get(targetURL)
				mu.Lock()
				defer mu.Unlock()
				if err != nil || resp.StatusCode != http.StatusOK {
					res.Services[ch.Name] = "down"
					res.Status = "degraded"
				} else {
					res.Services[ch.Name] = "healthy"
					resp.Body.Close()
				}
			}(intg)
		}
		wg.Wait()

		cacheData, _ := json.Marshal(res)
		// Only cache fully-healthy results. When degraded, we want every
		// subsequent probe to re-check so k8s readiness flips NotReady
		// immediately instead of waiting up to HealthCacheTTL for a stale
		// "healthy" cache entry to expire.
		if res.Status == "healthy" {
			Rdb.Set(context.Background(), HealthCacheKey, cacheData, HealthCacheTTL)
		}
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "health check failed"})
	}

	return sendHealthCached(c, result.([]byte), "MISS")
}

// sendHealthCached writes a cached HealthResponse body, inferring the HTTP
// status code from the status field inside the JSON. "healthy" → 200,
// anything else → 503. Extracted so the cache hit and cache miss paths
// return consistent status codes.
func sendHealthCached(c *fiber.Ctx, body []byte, cacheHeader string) error {
	c.Set("Content-Type", "application/json")
	c.Set("X-Cache", cacheHeader)
	status := fiber.StatusOK
	var probe struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &probe); err == nil && probe.Status != "healthy" {
		status = fiber.StatusServiceUnavailable
	}
	return c.Status(status).Send(body)
}

// getDashboard retrieves aggregated data for the user dashboard.
// Results are cached per-user in Redis for 30s to support efficient polling.
func (s *Server) getDashboard(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	// Check per-user Redis cache first
	cacheKey := RedisDashboardCachePrefix + userID
	if val, err := Rdb.Get(context.Background(), cacheKey).Result(); err == nil {
		var cached DashboardResponse
		if json.Unmarshal([]byte(val), &cached) == nil {
			c.Set("X-Cache", "HIT")
			return c.JSON(cached)
		}
	}

	// Singleflight: coalesce concurrent cache misses for the same user
	userRoles := GetUserRoles(c)
	result, err, _ := dashboardGroup.Do(userID, func() (interface{}, error) {
		// Double-check cache
		if val, err := Rdb.Get(context.Background(), cacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := DashboardResponse{
			Data: make(map[string]interface{}),
		}

		// 1. User preferences (sync tier from JWT roles)
		prefs, err := GetOrCreatePreferences(userID, userRoles)
		if err == nil {
			res.Preferences = prefs
		}

		// 2. User channels + enabled types
		channels, err := GetUserChannels(userID)
		if err == nil {
			res.Channels = channels
		}

		enabledChannels := make(map[string]bool)
		for _, ch := range channels {
			if ch.Enabled {
				enabledChannels[ch.ChannelType] = true
			}
		}

		// Warm Redis subscription sets from current DB state
		go SyncChannelSubscriptions(userID)

		// 3. Fetch dashboard data from each enabled channel via HTTP (parallel)
		dashboardClient := &http.Client{Timeout: HealthCheckTimeout}
		var targets []*ChannelInfo
		for _, intg := range GetAllChannels() {
			if enabledChannels[intg.Name] && intg.HasCapability("dashboard_provider") {
				targets = append(targets, intg)
			}
		}

		type channelResult struct {
			data map[string]interface{}
		}
		results := make([]channelResult, len(targets))
		var wg sync.WaitGroup
		wg.Add(len(targets))
		for i, intg := range targets {
			go func(idx int, ch *ChannelInfo) {
				defer wg.Done()
				url := fmt.Sprintf("%s/internal/dashboard?user=%s", ch.InternalURL, userID)
				resp, err := dashboardClient.Get(url)
				if err != nil {
					log.Printf("[Dashboard] %s fetch error: %v", ch.Name, err)
					return
				}
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil || resp.StatusCode != 200 {
					log.Printf("[Dashboard] %s returned status %d", ch.Name, resp.StatusCode)
					return
				}
				var data map[string]interface{}
				if err := json.Unmarshal(body, &data); err != nil {
					log.Printf("[Dashboard] %s unmarshal error: %v", ch.Name, err)
					return
				}
				results[idx] = channelResult{data: data}
			}(i, intg)
		}
		wg.Wait()

		for _, r := range results {
			for k, v := range r.data {
				res.Data[k] = v
			}
		}

		cacheData, _ := json.Marshal(res)
		Rdb.Set(context.Background(), cacheKey, cacheData, DashboardCacheTTL)
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "dashboard fetch failed"})
	}

	c.Set("Content-Type", "application/json")
	c.Set("X-Cache", "MISS")
	return c.Send(result.([]byte))
}

// listChannels returns all discovered channels and their capabilities.
func (s *Server) listChannels(c *fiber.Ctx) error {
	channels := GetAllChannels()
	infos := make([]fiber.Map, 0, len(channels))
	for _, ch := range channels {
		infos = append(infos, fiber.Map{
			"name":         ch.Name,
			"display_name": ch.DisplayName,
			"capabilities": ch.Capabilities,
		})
	}
	return c.JSON(infos)
}

// landingPage returns basic API info.
func (s *Server) landingPage(c *fiber.Ctx) error {
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = DefaultFrontendURL
	}

	return c.JSON(fiber.Map{
		"name":    "Scrollr API",
		"version": "1.0",
		"status":  "operational",
		"links": fiber.Map{
			"health":   "/health",
			"channels": "/channels",
			"docs":     "/swagger/index.html",
			"frontend": frontendURL,
			"status":   frontendURL + "/status",
		},
	})
}

// Listen starts the HTTP server on the configured port.
func (s *Server) Listen() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = DefaultPort
	}

	log.Printf("Starting server on port %s", port)
	return s.App.Listen(":" + port)
}
