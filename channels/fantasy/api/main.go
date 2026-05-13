package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/yahoo"
)

// =============================================================================
// Registration Constants
// =============================================================================

const (
	// RegistrationKey is the Redis key where this channel registers itself.
	RegistrationKey = "channel:fantasy"

	// RegistrationTTL is how long the registration lives in Redis before expiring.
	RegistrationTTL = 30 * time.Second

	// RegistrationRefresh is how often we refresh the registration.
	RegistrationRefresh = 20 * time.Second

	// DefaultPort is the default HTTP listen port.
	DefaultPort = "8084"

	// DefaultChannelURL is the default internal URL for this service.
	DefaultChannelURL = "http://localhost:8084"
)

// registrationPayload is the JSON structure stored in Redis for service discovery.
type registrationPayload struct {
	Name         string              `json:"name"`
	DisplayName  string              `json:"display_name"`
	InternalURL  string              `json:"internal_url"`
	Capabilities []string            `json:"capabilities"`
	CDCTables    []string            `json:"cdc_tables"`
	Routes       []registrationRoute `json:"routes"`
}

type registrationRoute struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Auth   bool   `json:"auth"`
}

// =============================================================================
// Main
// =============================================================================

func main() {
	// Load .env (optional — don't fatal if missing)
	_ = godotenv.Load()

	// Sentry init — before any other infrastructure. No-op when
	// SENTRY_DSN is unset.
	if initSentry() {
		defer sentry.Flush(2 * time.Second)
	}

	// -------------------------------------------------------------------------
	// Connect to PostgreSQL
	// -------------------------------------------------------------------------
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("[Fantasy] DATABASE_URL is required")
	}

	// Clean up DATABASE_URL
	dbURL = strings.TrimSpace(dbURL)
	dbURL = strings.Trim(dbURL, "\"")
	dbURL = strings.Trim(dbURL, "'")
	if strings.HasPrefix(dbURL, "postgres:") && !strings.HasPrefix(dbURL, "postgres://") {
		dbURL = strings.Replace(dbURL, "postgres:", "postgres://", 1)
	} else if strings.HasPrefix(dbURL, "postgresql:") && !strings.HasPrefix(dbURL, "postgresql://") {
		dbURL = strings.Replace(dbURL, "postgresql:", "postgresql://", 1)
	}

	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("[Fantasy] Failed to parse DATABASE_URL: %v", err)
	}
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		log.Fatalf("[Fantasy] Failed to connect to PostgreSQL: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("[Fantasy] PostgreSQL ping failed: %v", err)
	}
	log.Printf("[Fantasy] Connected to PostgreSQL (pool: max=%d, min=%d)",
		poolConfig.MaxConns, poolConfig.MinConns)

	// -------------------------------------------------------------------------
	// Connect to Redis
	// -------------------------------------------------------------------------
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatal("[Fantasy] REDIS_URL is required")
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("[Fantasy] Invalid REDIS_URL: %v", err)
	}

	rdb := redis.NewClient(opts)
	defer rdb.Close()

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("[Fantasy] Redis ping failed: %v", err)
	}
	log.Println("[Fantasy] Connected to Redis")

	// -------------------------------------------------------------------------
	// Yahoo OAuth2 Config
	// -------------------------------------------------------------------------
	clientID := os.Getenv("YAHOO_CLIENT_ID")
	clientSecret := os.Getenv("YAHOO_CLIENT_SECRET")

	// Derive callback URL from env
	redirectURL := os.Getenv("YAHOO_CALLBACK_URL")
	if redirectURL == "" {
		if fqdn := CleanFQDN(); fqdn != "" {
			redirectURL = fmt.Sprintf("https://%s/yahoo/callback", fqdn)
		}
	}

	// YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET are both required — the entire
	// purpose of this service is Yahoo OAuth2 + sync. Booting without them
	// leaves the sync goroutine in a permanent failure loop (`runSyncLoop`
	// returns an error immediately if they're empty, crash-restart hits
	// `maxSyncRestarts`, then sync gives up silently). Fail fast instead.
	if clientID == "" {
		log.Fatal("[Fantasy] YAHOO_CLIENT_ID is required")
	}
	if clientSecret == "" {
		log.Fatal("[Fantasy] YAHOO_CLIENT_SECRET is required")
	}
	log.Printf("[Fantasy] Yahoo Client ID: %s... Redirect URI: %s", clientID[:min(5, len(clientID))], redirectURL)

	// Use env-var-overridable token URL so tests can redirect to a mock server.
	// The auth URL is only used for browser redirects (user-facing), so it
	// follows the same override pattern for consistency.
	yahooAuthURL := yahoo.Endpoint.AuthURL
	yahooTokenEndpoint := yahoo.Endpoint.TokenURL
	if v := os.Getenv("YAHOO_AUTH_URL"); v != "" {
		yahooAuthURL = v
	}
	if v := os.Getenv("YAHOO_TOKEN_URL"); v != "" {
		yahooTokenEndpoint = v
	}

	yahooConfig := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint: oauth2.Endpoint{
			AuthURL:   yahooAuthURL,
			TokenURL:  yahooTokenEndpoint,
			AuthStyle: oauth2.AuthStyleInHeader,
		},
		RedirectURL: redirectURL,
	}

	// -------------------------------------------------------------------------
	// Run database migrations
	// -------------------------------------------------------------------------
	// golang-migrate uses lib/pq which requires explicit sslmode parameter
	// Append sslmode=disable if not already specified (internal Docker network)
	migrateURL := dbURL
	if !strings.Contains(migrateURL, "sslmode=") {
		if strings.Contains(migrateURL, "?") {
			migrateURL += "&sslmode=disable"
		} else {
			migrateURL += "?sslmode=disable"
		}
	}
	if strings.Contains(migrateURL, "?") {
		migrateURL += "&x-migrations-table=schema_migrations_fantasy"
	} else {
		migrateURL += "?x-migrations-table=schema_migrations_fantasy"
	}

	m, err := migrate.New(
		"file://migrations",
		migrateURL,
	)
	if err != nil {
		log.Fatalf("[Fantasy] Failed to create migrator: %v", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		m.Close()
		log.Fatalf("[Fantasy] Migration failed: %v", err)
	}
	m.Close()
	log.Println("[Fantasy] Database migrations applied")

	// -------------------------------------------------------------------------
	// Start Redis self-registration heartbeat
	// -------------------------------------------------------------------------
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go startRegistration(ctx, rdb)

	// -------------------------------------------------------------------------
	// Fiber HTTP Server
	// -------------------------------------------------------------------------
	app := &App{
		db:          pool,
		rdb:         rdb,
		yahooConfig: yahooConfig,
		syncState:   &syncHealth{status: "starting"},
	}

	// -------------------------------------------------------------------------
	// Start background Yahoo sync loop (feature-flagged via SYNC_ENABLED)
	// -------------------------------------------------------------------------
	syncEnabled := os.Getenv("SYNC_ENABLED")
	if syncEnabled == "" || syncEnabled == "true" || syncEnabled == "1" {
		go app.startSyncWithRestart(ctx)
		log.Println("[Fantasy] Background sync loop started")
	} else {
		log.Println("[Fantasy] Background sync loop DISABLED (SYNC_ENABLED != true)")
	}

	fiberApp := fiber.New(fiber.Config{
		AppName:               "Scrollr Fantasy API",
		DisableStartupMessage: false,
	})

	// Sentry middleware MUST be first so panics from anything below are
	// captured. Followed by the user-hook for anonymous user ID tagging.
	if os.Getenv("SENTRY_DSN") != "" {
		fiberApp.Use(sentryMiddleware())
		fiberApp.Use(sentryUserHook())
	}

	// Yahoo OAuth routes.
	//   /yahoo/start    — Auth REQUIRED. Core gateway verifies the Scrollr
	//                     session and sets X-User-Sub before proxying.
	//                     Dropping this requirement previously allowed an
	//                     attacker to bind their Yahoo credentials to any
	//                     Logto sub via `?logto_sub=victim`.
	//   /yahoo/callback — Public. Called by Yahoo's servers; identity is
	//                     established via the CSRF state cookie which was
	//                     issued during /yahoo/start.
	//   /yahoo/health   — Public health probe.
	fiberApp.Get("/yahoo/start", app.YahooStart)
	fiberApp.Get("/yahoo/callback", app.YahooCallback)
	fiberApp.Get("/yahoo/health", app.healthHandler)

	// Protected routes (core gateway sets X-User-Sub header)
	fiberApp.Get("/users/me/yahoo-status", app.GetYahooStatus)
	fiberApp.Get("/users/me/yahoo-summary", app.GetYahooSummary)
	fiberApp.Get("/users/me/yahoo-leagues", app.GetMyYahooLeagues)
	fiberApp.Post("/users/me/yahoo-leagues/discover", app.DiscoverYahooLeagues)
	fiberApp.Post("/users/me/yahoo-leagues/import", app.ImportYahooLeague)
	fiberApp.Delete("/users/me/yahoo", app.DisconnectYahoo)

	// Internal routes (called by core gateway directly, not proxied)
	fiberApp.Post("/internal/cdc", app.handleInternalCDC)
	fiberApp.Get("/internal/dashboard", app.handleInternalDashboard)
	fiberApp.Get("/internal/health", app.handleInternalHealth)

	// -------------------------------------------------------------------------
	// Start server with graceful shutdown
	// -------------------------------------------------------------------------
	port := os.Getenv("PORT")
	if port == "" {
		port = DefaultPort
	}

	go func() {
		if err := fiberApp.Listen(":" + port); err != nil {
			log.Fatalf("[Fantasy] Server failed: %v", err)
		}
	}()

	log.Printf("[Fantasy] Fantasy API listening on port %s", port)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[Fantasy] Shutting down Fantasy API...")
	cancel()

	// Deregister from Redis on shutdown
	rdb.Del(context.Background(), RegistrationKey)
	log.Println("[Fantasy] Removed registration from Redis")

	if err := fiberApp.Shutdown(); err != nil {
		log.Printf("[Fantasy] Fiber shutdown error: %v", err)
	}
}

// startRegistration registers this service in Redis with a TTL and refreshes
// the registration on a ticker. This allows the core gateway to discover
// available channel services.
func startRegistration(ctx context.Context, rdb *redis.Client) {
	channelURL := os.Getenv("CHANNEL_URL")
	if channelURL == "" {
		channelURL = DefaultChannelURL
	}

	payload := registrationPayload{
		Name:         "fantasy",
		DisplayName:  "Fantasy Sports",
		InternalURL:  channelURL,
		Capabilities: []string{"cdc_handler", "dashboard_provider", "health_checker"},
		CDCTables:    []string{"yahoo_leagues", "yahoo_standings", "yahoo_matchups", "yahoo_rosters"},
		Routes: []registrationRoute{
			// Auth required: initiating Yahoo OAuth binds the Yahoo
			// identity to the authenticated Scrollr user. Must be a
			// verified session, never an arbitrary query param.
			{Method: "GET", Path: "/yahoo/start", Auth: true},
			// Public: Yahoo's servers call the callback; the state
			// cookie issued during /yahoo/start is the identity proof.
			{Method: "GET", Path: "/yahoo/callback", Auth: false},
			{Method: "GET", Path: "/yahoo/health", Auth: false},
			// Protected (auth required)
			{Method: "GET", Path: "/users/me/yahoo-status", Auth: true},
			{Method: "GET", Path: "/users/me/yahoo-summary", Auth: true},
			{Method: "GET", Path: "/users/me/yahoo-leagues", Auth: true},
			{Method: "POST", Path: "/users/me/yahoo-leagues/discover", Auth: true},
			{Method: "POST", Path: "/users/me/yahoo-leagues/import", Auth: true},
			{Method: "DELETE", Path: "/users/me/yahoo", Auth: true},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Fatalf("[Fantasy] Failed to marshal registration payload: %v", err)
	}

	// Register immediately on startup
	if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
		log.Printf("[Fantasy] Initial registration failed: %v", err)
	} else {
		log.Printf("[Fantasy] Registered as %s (TTL %s)", RegistrationKey, RegistrationTTL)
	}

	ticker := time.NewTicker(RegistrationRefresh)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Fantasy] Stopping registration heartbeat")
			return
		case <-ticker.C:
			if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
				log.Printf("[Fantasy] Registration heartbeat failed: %v", err)
			}
		}
	}
}
