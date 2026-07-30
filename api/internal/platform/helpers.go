package platform

import (
	"os"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

// schemePrefix matches any RFC 3986 scheme, not just http(s). ALLOWED_ORIGINS
// carries the desktop app's `tauri://localhost`, and blindly prepending
// https:// to it produced `https://tauri://localhost`, which panics Fiber's
// CORS middleware at boot.
var schemePrefix = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*://`)

// ValidateURL cleans a URL string, ensuring it has a scheme prefix.
// Returns the fallback if the input is empty.
func ValidateURL(urlStr, fallback string) string {
	if urlStr == "" {
		return fallback
	}
	urlStr = strings.TrimSpace(urlStr)
	if !schemePrefix.MatchString(urlStr) {
		urlStr = "https://" + urlStr
	}
	return strings.TrimSuffix(urlStr, "/")
}

// extractStringArray reads a string array under `key` from a widget's
// config JSONB (e.g. {"symbols": ["AAPL", ...]} or {"leagues": ["NFL", ...]}).
// Empty strings and non-string entries are dropped.
func ExtractStringArray(config map[string]interface{}, key string) []string {
	raw, ok := config[key]
	if !ok {
		return nil
	}
	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// extractFeedURLsFromConfig reads feed URLs from a widget's config JSONB.
// Config shape: {"feeds": [{"url": "https://...", "name": "..."}, ...]}
func ExtractFeedURLsFromConfig(config map[string]interface{}) []string {
	raw, ok := config["feeds"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	urls := make([]string, 0, len(arr))
	for _, v := range arr {
		feed, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		if u, ok := feed["url"].(string); ok && u != "" {
			urls = append(urls, u)
		}
	}
	return urls
}

// defaultExtensionOrigins includes the website and the Chrome extension.
// Firefox moz-extension:// UUIDs are per-install; operators needing Firefox
// support should set EXTENSION_CORS_ORIGINS explicitly.
const defaultExtensionOrigins = "https://myscrollr.com,chrome-extension://pjeafpgbpfbcaddipkcbacohhbfakclb"

// setCORSHeaders sets CORS headers for extension auth endpoints.
// Reads allowed origins from EXTENSION_CORS_ORIGINS env var, falling
// back to ALLOWED_ORIGINS, then defaultExtensionOrigins. Only responds
// with the requesting origin if it appears in the allow-list.
func SetCORSHeaders(c *fiber.Ctx) {
	origin := c.Get("Origin")
	if origin == "" {
		return
	}

	allowed := os.Getenv("EXTENSION_CORS_ORIGINS")
	if allowed == "" {
		allowed = os.Getenv("ALLOWED_ORIGINS")
	}
	if allowed == "" {
		allowed = defaultExtensionOrigins
	}

	c.Set("Vary", "Origin")
	for _, o := range strings.Split(allowed, ",") {
		if strings.TrimSpace(o) == origin {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
			c.Set("Access-Control-Allow-Headers", "Content-Type")
			break
		}
	}
}
