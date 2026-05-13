package main

import (
	"context"
	"encoding/json"
	"log"
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
	RegistrationKey = "channel:sports"

	// RegistrationTTL is how long the registration lives in Redis before expiring.
	RegistrationTTL = 30 * time.Second

	// RegistrationRefresh is how often we refresh the registration.
	RegistrationRefresh = 20 * time.Second

	// DefaultPort is the default HTTP listen port.
	DefaultPort = "8082"

	// DefaultChannelURL is the default internal URL for this service.
	DefaultChannelURL = "http://localhost:8082"
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
		log.Fatal("[Sports] DATABASE_URL is required")
	}

	// Bounded pool — default sizing varies with runtime.NumCPU and doesn't
	// set a connect timeout. Capping at 10 with a 5s connect deadline keeps
	// this channel from starving the shared Postgres.
	poolConfig, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("[DB] parse config: %v", err)
	}
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	poolConfig.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		log.Fatalf("[DB] new pool: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("[Sports] PostgreSQL ping failed: %v", err)
	}
	log.Println("[Sports] Connected to PostgreSQL")

	// -------------------------------------------------------------------------
	// Connect to Redis
	// -------------------------------------------------------------------------
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatal("[Sports] REDIS_URL is required")
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("[Sports] Invalid REDIS_URL: %v", err)
	}

	rdb := redis.NewClient(opts)
	defer rdb.Close()

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("[Sports] Redis ping failed: %v", err)
	}
	log.Println("[Sports] Connected to Redis")

	// -------------------------------------------------------------------------
	// Start Redis self-registration heartbeat
	// -------------------------------------------------------------------------
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go startRegistration(ctx, rdb)

	// -------------------------------------------------------------------------
	// Fiber HTTP Server
	// -------------------------------------------------------------------------
	app := &App{db: pool, rdb: rdb}

	fiberApp := fiber.New(fiber.Config{
		AppName:               "Scrollr Sports API",
		DisableStartupMessage: false,
	})

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
	fiberApp.Get("/sports", app.getSports)
	fiberApp.Get("/sports/public", app.getSports) // Unauthenticated: returns all games (same handler, public path)
	fiberApp.Get("/sports/leagues", app.getLeagueCatalog)
	fiberApp.Get("/sports/standings", app.getStandings)
	fiberApp.Get("/sports/teams", app.getTeams)
	fiberApp.Get("/sports/health", app.healthHandler)

	// -------------------------------------------------------------------------
	// Start server with graceful shutdown
	// -------------------------------------------------------------------------
	port := os.Getenv("PORT")
	if port == "" {
		port = DefaultPort
	}

	go func() {
		if err := fiberApp.Listen(":" + port); err != nil {
			log.Fatalf("[Sports] Server failed: %v", err)
		}
	}()

	log.Printf("[Sports] Sports API listening on port %s", port)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[Sports] Shutting down Sports API...")
	cancel()

	// Deregister from Redis on shutdown
	rdb.Del(context.Background(), RegistrationKey)
	log.Println("[Sports] Removed registration from Redis")

	if err := fiberApp.Shutdown(); err != nil {
		log.Printf("[Sports] Fiber shutdown error: %v", err)
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
		Name:         "sports",
		DisplayName:  "Sports",
		InternalURL:  channelURL,
		Capabilities: []string{"cdc_handler", "dashboard_provider", "health_checker", "channel_lifecycle"},
		CDCTables:    []string{"games"},
		Routes: []registrationRoute{
			{Method: "GET", Path: "/sports", Auth: true},
			{Method: "GET", Path: "/sports/public", Auth: false},
			{Method: "GET", Path: "/sports/leagues", Auth: false},
			{Method: "GET", Path: "/sports/standings", Auth: true},
			{Method: "GET", Path: "/sports/teams", Auth: true},
			{Method: "GET", Path: "/sports/health", Auth: false},
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Fatalf("[Sports] Failed to marshal registration payload: %v", err)
	}

	// Register immediately on startup
	if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
		log.Printf("[Sports] Initial registration failed: %v", err)
	} else {
		log.Printf("[Sports] Registered as %s (TTL %s)", RegistrationKey, RegistrationTTL)
	}

	ticker := time.NewTicker(RegistrationRefresh)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Sports] Stopping registration heartbeat")
			return
		case <-ticker.C:
			if err := rdb.Set(ctx, RegistrationKey, data, RegistrationTTL).Err(); err != nil {
				log.Printf("[Sports] Registration heartbeat failed: %v", err)
			}
		}
	}
}
