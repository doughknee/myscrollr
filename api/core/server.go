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

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/events"
	"github.com/brandon-relentnet/myscrollr/api/internal/ingestread"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/support"
	"github.com/brandon-relentnet/myscrollr/api/internal/widgets"
	sentryfiber "github.com/getsentry/sentry-go/fiber"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"golang.org/x/sync/singleflight"
)

// singleflight groups prevent thundering herd on cache misses.
// Multiple concurrent requests for the same key coalesce into one.
var (
	dashboardGroup   singleflight.Group
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
	billing.InitStripe()
	s.setupMiddleware()
	s.setupRoutes()

	// Setup dynamic catch-all proxy for channel routes.
	// MUST be last — Fiber matches in registration order, so core routes take priority.
	SetupDynamicProxy(s.App)
}

// setupMiddleware attaches security headers, CORS, and rate limiting.
func (s *Server) setupMiddleware() {
	// Sentry middleware MUST be first so panics from anything below it are
	// captured. WaitForDelivery=false keeps requests off the Sentry HTTP
	// path. Repanic=true lets Fiber's built-in recover see panics too, so
	// the error response still reaches the client.
	if os.Getenv("SENTRY_DSN") != "" {
		s.App.Use(sentryfiber.New(sentryfiber.Options{
			Repanic:         true,
			WaitForDelivery: false,
			Timeout:         2 * time.Second,
		}))
	}

	// Security Headers
	s.App.Use(func(c *fiber.Ctx) error {
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Download-Options", "noopen")
		c.Set("Strict-Transport-Security", fmt.Sprintf("max-age=%d; includeSubDomains", platform.HSTSMaxAge))
		c.Set("X-DNS-Prefetch-Control", "off")
		if c.Path() == "/yahoo/callback" {
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
		allowedOrigins = platform.DefaultAllowedOrigins
	} else {
		origins := strings.Split(allowedOrigins, ",")
		for i, o := range origins {
			origins[i] = platform.ValidateURL(o, "")
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
		"/health":                           true,
		"/events":                           true,
		"/webhooks/sequin":                  true,
		"/webhooks/stripe":                  true,
		"/webhooks/osticket/thread-message": true,
		"/webhooks/discord/interactions":    true, // Discord retries on rate-limit and we want them to succeed
		"/webhooks/github/pr-closed":        true, // GitHub Action calls this when a PR with [fixes #N] tags merges
		"/channels":                         true,
		"/catalog":                          true,
		"/tier-limits":                      true,
		"/extension/token":                  true,
		"/extension/token/refresh":          true,
		"/support/ticket":                   true,
	}

	// Counters live in Redis so all replicas share one per-IP budget
	// (ADR-0001); the limiters' KeyGenerators keep their keys disjoint
	// ("oauth:"-prefixed vs bare IP) within the shared prefix.
	limiterStorage := platform.NewRedisLimiterStorage("ratelimit:")

	// Stricter rate limiter for OAuth initiation endpoints (e.g. /yahoo/start).
	// Applied BEFORE the general rate limiter so it runs first.
	oauthRateLimitPaths := map[string]bool{
		"/yahoo/start": true,
	}
	s.App.Use(limiter.New(limiter.Config{
		Max:        platform.OAuthRateLimitMax,
		Expiration: platform.OAuthRateLimitExpiration,
		Storage:    limiterStorage,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "oauth:" + c.IP()
		},
		Next: func(c *fiber.Ctx) bool {
			return !oauthRateLimitPaths[c.Path()]
		},
	}))

	s.App.Use(limiter.New(limiter.Config{
		Max:        platform.RateLimitMax,
		Expiration: platform.RateLimitExpiration,
		Storage:    limiterStorage,
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
			for _, entry := range platform.GetChannelRoutes() {
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
	// Local widget sources (ADR-0002) — served in-process, registered
	// ahead of the dynamic proxy so they win over any still-registered
	// legacy channel service during cutover.
	ingestread.RegisterFinanceRoutes(s.App)
	ingestread.RegisterSportsRoutes(s.App)
	ingestread.RegisterPredictionsRoutes(s.App)
	ingestread.RegisterRSSRoutes(s.App)

	// --- Public Routes ---
	s.App.Get("/health", s.healthCheck)
	s.App.Get("/public/feed", ingestread.HandlePublicFeed)
	s.App.Get("/events", events.StreamEvents)
	s.App.Get("/events/count", events.GetActiveViewers)
	s.App.Post("/webhooks/sequin", events.HandleSequinWebhook)
	s.App.Post("/webhooks/stripe", billing.HandleStripeWebhook)
	s.App.Post("/webhooks/osticket/thread-message", support.HandleOSTicketThreadMessage)
	s.App.Post("/webhooks/discord/interactions", support.HandleDiscordInteractions)
	s.App.Post("/webhooks/github/pr-closed", HandleGitHubPRClosed)

	// Extension auth proxy
	s.App.Options("/extension/token", accounts.HandleExtensionAuthPreflight)
	s.App.Post("/extension/token", accounts.HandleExtensionTokenExchange)
	s.App.Options("/extension/token/refresh", accounts.HandleExtensionAuthPreflight)
	s.App.Post("/extension/token/refresh", accounts.HandleExtensionTokenRefresh)

	s.App.Get("/channels", s.listChannels)
	// The widget catalog — the single authority clients render from.
	s.App.Get("/catalog", widgets.HandleGetCatalog)
	s.App.Get("/tier-limits", widgets.HandleGetTierLimits)
	s.App.Get("/app/min-version", HandleGetMinDesktopVersion)
	s.App.Get("/", s.landingPage)

	// --- Protected Routes ---
	s.App.Get("/dashboard", platform.LogtoAuth, s.getDashboard)

	// Support
	s.App.Post("/support/ticket", platform.LogtoAuth, support.HandleSubmitSupportTicket)
	// Anonymous support endpoint for the marketing /support page. NOT
	// added to coreExemptPaths — the IP rate limiter + the per-IP
	// hourly Redis counter inside the handler both protect this route.
	s.App.Post("/support/ticket/public", support.HandleSubmitPublicSupportTicket)

	// B2B lead capture from the marketing /business page. Same
	// abuse-protection model as /support/ticket/public: Fiber IP
	// limiter on the outside, per-IP hourly Redis counter inside
	// the handler.
	s.App.Post("/business-leads", support.HandleSubmitBusinessLead)

	// Partner-approval URLs for AI-drafted replies. No auth — these are
	// HMAC-signed single-use tokens that the partner clicks from email.
	s.App.Get("/support/send", support.HandleSupportSend)
	s.App.Get("/support/edit", support.HandleSupportEdit)
	s.App.Get("/support/skip", support.HandleSupportSkip)
	s.App.Post("/support/edit/submit", support.HandleSupportEditSubmit)

	// Invite (no auth — user isn't logged in yet, token-verified server-side)
	s.App.Post("/invite/complete", accounts.HandleCompleteInvite)
	s.App.Get("/invite/username-available", accounts.HandleCheckUsernameAvailable)

	// Billing Routes
	s.App.Post("/checkout/session", platform.LogtoAuth, billing.HandleCreateCheckoutSession)
	s.App.Post("/checkout/lifetime", platform.LogtoAuth, billing.HandleCreateLifetimeCheckout)
	s.App.Post("/checkout/setup-intent", platform.LogtoAuth, billing.HandleCreateSetupIntent)
	s.App.Post("/checkout/subscribe", platform.LogtoAuth, billing.HandleConfirmSubscription)
	s.App.Post("/checkout/payment-intent", platform.LogtoAuth, billing.HandleCreatePaymentIntent)
	s.App.Get("/checkout/return", platform.LogtoAuth, billing.HandleCheckoutReturn)
	s.App.Get("/users/me/subscription", platform.LogtoAuth, billing.HandleGetSubscription)
	s.App.Get("/users/me/overview", platform.LogtoAuth, accounts.HandleGetOverview)
	s.App.Get("/users/me/subscription/preview", platform.LogtoAuth, billing.HandlePreviewPlanChange)
	s.App.Put("/users/me/subscription/plan", platform.LogtoAuth, billing.HandleChangePlan)
	s.App.Post("/users/me/subscription/cancel", platform.LogtoAuth, billing.HandleCancelSubscription)
	s.App.Post("/users/me/subscription/portal", platform.LogtoAuth, billing.HandleCreatePortalSession)

	// Account self-service: profile (name/email) + password reset email
	s.App.Put("/users/me/profile", platform.LogtoAuth, accounts.HandleUpdateProfile)
	s.App.Post("/users/me/password/reset", platform.LogtoAuth, accounts.HandleRequestPasswordReset)

	// User Routes — specific /users/me/* paths BEFORE parameterized /users/:username
	s.App.Get("/users/me/preferences", platform.LogtoAuth, accounts.HandleGetPreferences)
	s.App.Put("/users/me/preferences", platform.LogtoAuth, accounts.HandleUpdatePreferences)
	// Widget CRUD. The /users/me/channels paths are the legacy wire routes
	// that shipped v1.1.x clients depend on; /users/me/widgets are aliases
	// added by REL-40 (same handlers, same middleware). Keep both.
	s.App.Get("/users/me/channels", platform.LogtoAuth, widgets.GetWidgets)
	s.App.Post("/users/me/channels", platform.LogtoAuth, widgets.CreateWidget)
	s.App.Put("/users/me/channels/:type", platform.LogtoAuth, widgets.UpdateWidget)
	s.App.Delete("/users/me/channels/:type", platform.LogtoAuth, widgets.DeleteWidget)
	s.App.Get("/users/me/widgets", platform.LogtoAuth, widgets.GetWidgets)
	s.App.Post("/users/me/widgets", platform.LogtoAuth, widgets.CreateWidget)
	s.App.Put("/users/me/widgets/:type", platform.LogtoAuth, widgets.UpdateWidget)
	s.App.Delete("/users/me/widgets/:type", platform.LogtoAuth, widgets.DeleteWidget)

	// GDPR: data export + 30-day soft-delete lifecycle
	s.App.Get("/users/me/export", platform.LogtoAuth, accounts.HandleExportUserData)
	s.App.Post("/users/me/delete", platform.LogtoAuth, accounts.HandleRequestAccountDeletion)
	s.App.Post("/users/me/delete/cancel", platform.LogtoAuth, accounts.HandleCancelAccountDeletion)
	s.App.Get("/users/me/delete/status", platform.LogtoAuth, accounts.HandleAccountDeletionStatus)

	s.App.Get("/users/:username", platform.GetProfileByUsername)
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
	if val, err := platform.Rdb.Get(context.Background(), platform.HealthCacheKey).Result(); err == nil {
		return sendHealthCached(c, []byte(val), "HIT")
	}

	// Singleflight: only one goroutine computes; others wait and share the result
	result, err, _ := healthCheckGroup.Do("health", func() (interface{}, error) {
		// Double-check cache (another goroutine may have populated it)
		if val, err := platform.Rdb.Get(context.Background(), platform.HealthCacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := platform.HealthResponse{Status: "healthy", Services: make(map[string]string)}

		if err := platform.DBPool.Ping(context.Background()); err != nil {
			res.Database = "unhealthy"
			res.Status = "degraded"
		} else {
			res.Database = "healthy"
		}
		if err := platform.Rdb.Ping(context.Background()).Err(); err != nil {
			res.Redis = "unhealthy"
			res.Status = "degraded"
		} else {
			res.Redis = "healthy"
		}

		httpClient := &http.Client{Timeout: platform.HealthCheckTimeout}
		var healthTargets []*platform.ChannelInfo
		for _, intg := range platform.GetAllChannels() {
			if ingestread.IsLocalSource(intg.Name) {
				continue
			}
			if intg.HasCapability("health_checker") {
				healthTargets = append(healthTargets, intg)
			}
		}

		var mu sync.Mutex
		var wg sync.WaitGroup
		wg.Add(len(healthTargets))
		for _, intg := range healthTargets {
			go func(ch *platform.ChannelInfo) {
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

		// Local widget sources (ADR-0002) report in-process.
		for name, h := range ingestread.LocalHealth(context.Background()) {
			res.Services[name] = h.Status
			if !h.Healthy {
				res.Status = "degraded"
			}
		}

		cacheData, _ := json.Marshal(res)
		// Only cache fully-healthy results. When degraded, we want every
		// subsequent probe to re-check so k8s readiness flips NotReady
		// immediately instead of waiting up to HealthCacheTTL for a stale
		// "healthy" cache entry to expire.
		if res.Status == "healthy" {
			platform.Rdb.Set(context.Background(), platform.HealthCacheKey, cacheData, platform.HealthCacheTTL)
		}
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "health check failed"})
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
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	// Check per-user Redis cache first
	cacheKey := platform.RedisDashboardCachePrefix + userID
	if val, err := platform.Rdb.Get(context.Background(), cacheKey).Result(); err == nil {
		var cached platform.DashboardResponse
		if json.Unmarshal([]byte(val), &cached) == nil {
			c.Set("X-Cache", "HIT")
			return c.JSON(cached)
		}
	}

	// Singleflight: coalesce concurrent cache misses for the same user
	userRoles := platform.GetUserRoles(c)
	result, err, _ := dashboardGroup.Do(userID, func() (interface{}, error) {
		// Double-check cache
		if val, err := platform.Rdb.Get(context.Background(), cacheKey).Result(); err == nil {
			return []byte(val), nil
		}

		res := platform.DashboardResponse{
			Data: make(map[string]interface{}),
		}

		// 1. User preferences (sync tier from JWT roles)
		prefs, err := accounts.GetOrCreatePreferences(userID, userRoles)
		if err == nil {
			res.Preferences = prefs
		}

		// 2. User widgets + enabled types
		widgets, err := platform.GetUserWidgets(userID)
		if err == nil {
			res.Widgets = widgets
		}

		// Key by data SOURCE, not the exact widget type, so split widgets
		// (sports_nfl, finance_stocks, …) still select their backing service's
		// dashboard provider below (matched on intg.Name).
		enabledSources := make(map[string]bool)
		for _, ch := range widgets {
			if ch.Enabled {
				enabledSources[platform.DataSourceForWidget(ch.WidgetType)] = true
			}
		}

		// 3. Fetch dashboard data from each enabled channel via HTTP (parallel)
		dashboardClient := &http.Client{Timeout: platform.HealthCheckTimeout}
		var targets []*platform.ChannelInfo
		for _, intg := range platform.GetAllChannels() {
			if ingestread.IsLocalSource(intg.Name) {
				continue
			}
			if enabledSources[intg.Name] && intg.HasCapability("dashboard_provider") {
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
			go func(idx int, ch *platform.ChannelInfo) {
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

		// Local widget sources (ADR-0002) contribute in-process.
		for k, v := range ingestread.LocalDashboard(context.Background(), userID, enabledSources) {
			res.Data[k] = v
		}

		cacheData, _ := json.Marshal(res)
		platform.Rdb.Set(context.Background(), cacheKey, cacheData, platform.DashboardCacheTTL)
		return cacheData, nil
	})

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "dashboard fetch failed"})
	}

	c.Set("Content-Type", "application/json")
	c.Set("X-Cache", "MISS")
	return c.Send(result.([]byte))
}

// listChannels returns all discovered channels and their capabilities.
func (s *Server) listChannels(c *fiber.Ctx) error {
	channels := platform.GetAllChannels()
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
		frontendURL = platform.DefaultFrontendURL
	}

	return c.JSON(fiber.Map{
		"name":    "Scrollr API",
		"version": "1.0",
		"status":  "operational",
		"links": fiber.Map{
			"health":   "/health",
			"channels": "/channels",
			"frontend": frontendURL,
			"status":   frontendURL + "/status",
		},
	})
}

// Listen starts the HTTP server on the configured port.
func (s *Server) Listen() error {
	port := os.Getenv("PORT")
	if port == "" {
		port = platform.DefaultPort
	}

	log.Printf("Starting server on port %s", port)
	return s.App.Listen(":" + port)
}
