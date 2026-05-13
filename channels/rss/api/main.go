package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Registration Constants
// =============================================================================

const (
	// RegistrationKey is the Redis key where this channel registers itself.
	RegistrationKey = "channel:rss"

	// RegistrationTTL is how long the registration lives in Redis before expiring.
	RegistrationTTL = 30 * time.Second

	// RegistrationRefresh is how often we refresh the registration.
	RegistrationRefresh = 20 * time.Second

	// DefaultPort is the default HTTP listen port.
	DefaultPort = "8083"

	// DefaultChannelURL is the default internal URL for this service.
	DefaultChannelURL = "http://localhost:8083"
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
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL must be set")
	}

	// Bounded pool — see finance/sports for rationale. Defaults vary
	// across boxes and don't set a connect deadline, which allows a
	// stalled Postgres to block startup indefinitely.
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("[DB] parse config: %v", err)
	}
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	poolConfig.ConnConfig.ConnectTimeout = 5 * time.Second
	dbPool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		log.Fatalf("[DB] new pool: %v", err)
	}
	defer dbPool.Close()

	if err := dbPool.Ping(context.Background()); err != nil {
		log.Fatalf("PostgreSQL ping failed: %v", err)
	}
	log.Println("Connected to PostgreSQL")

	// -------------------------------------------------------------------------
	// Connect to Redis
	// -------------------------------------------------------------------------
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatal("REDIS_URL must be set")
	}

	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Unable to parse REDIS_URL: %v", err)
	}

	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("Unable to connect to Redis: %v", err)
	}
	log.Println("Connected to Redis")

	// -------------------------------------------------------------------------
	// Start Redis self-registration heartbeat
	// -------------------------------------------------------------------------
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go startRegistration(ctx, rdb)

	// -------------------------------------------------------------------------
	// Setup Fiber HTTP server
	// -------------------------------------------------------------------------
	fiberApp := fiber.New(fiber.Config{
		AppName:               "Scrollr RSS API",
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           30 * time.Second,
		DisableStartupMessage: false,
	})

	app := &App{
		db:         dbPool,
		rdb:        rdb,
		httpClient: &http.Client{Timeout: HealthProxyTimeout},
	}

	// Sentry middleware MUST be first so panics from anything below are
	// captured. Followed by the user-hook for anonymous user ID tagging.
	if os.Getenv("SENTRY_DSN") != "" {
		fiberApp.Use(sentryMiddleware())
		fiberApp.Use(sentryUserHook())
	}

	// Internal routes (called by core gateway only)
	fiberApp.Post("/internal/cdc", app.handleInternalCDC)
	fiberApp.Get("/internal/dashboard", app.handleInternalDashboard)
	fiberApp.Get("/internal/health", app.handleInternalHealth)
	fiberApp.Post("/internal/channel-lifecycle", app.handleChannelLifecycle)

	// Public routes (proxied by core gateway)
	fiberApp.Get("/rss/feeds", app.getRSSFeedCatalog)
	fiberApp.Delete("/rss/feeds", app.deleteCustomFeed)
	fiberApp.Get("/rss/health", app.healthHandler)

	// -------------------------------------------------------------------------
	// Start the auto-cleanup janitor (background goroutine)
	// -------------------------------------------------------------------------
	// Removes definitively-broken custom feeds (and prunes them from
	// each subscriber's user_channels.config), and disables broken
	// curated feeds for operator follow-up. See janitor.go.
	app.startJanitor(ctx)

	// -------------------------------------------------------------------------
	// Start server with graceful shutdown
	// -------------------------------------------------------------------------
	port := os.Getenv("PORT")
	if port == "" {
		port = DefaultPort
	}

	go func() {
		if err := fiberApp.Listen(":" + port); err != nil {
			log.Fatalf("Fiber server error: %v", err)
		}
	}()

	log.Printf("RSS API listening on port %s", port)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down RSS API...")
	cancel()

	// Deregister from Redis on shutdown
	rdb.Del(context.Background(), RegistrationKey)
	log.Println("Removed registration from Redis")

	if err := fiberApp.Shutdown(); err != nil {
		log.Printf("Fiber shutdown error: %v", err)
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
		Name:         "rss",
		DisplayName:  "RSS",
		InternalURL:  channelURL,
		Capabilities: []string{"cdc_handler", "dashboard_provider", "channel_lifecycle", "health_checker"},
		CDCTables:    []string{"rss_items"},
		Routes: []registrationRoute{
			// /rss/feeds is now Auth: true — the catalog is per-user
			// (curated defaults + the requesting user's own custom feeds
			// only). The pre-isolation public endpoint leaked custom
			// feeds across users.
			{Method: "GET", Path: "/rss/feeds", Auth: true},
			{Method: "DELETE", Path: "/rss/feeds", Auth: true},
			{Method: "GET", Path: "/rss/health", Auth: false},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Fatalf("Failed to marshal registration payload: %v", err)
	}

	// Register immediately on startup
	if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
		log.Printf("[Registration] Initial registration failed: %v", err)
	} else {
		log.Printf("[Registration] Registered as %s (TTL %s)", RegistrationKey, RegistrationTTL)
	}

	ticker := time.NewTicker(RegistrationRefresh)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Registration] Stopping heartbeat")
			return
		case <-ticker.C:
			if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
				log.Printf("[Registration] Heartbeat refresh failed: %v", err)
			}
		}
	}
}
