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
	RegistrationKey = "channel:finance"

	// RegistrationTTL is how long the registration lives in Redis before expiring.
	RegistrationTTL = 30 * time.Second

	// RegistrationRefresh is how often we refresh the registration.
	RegistrationRefresh = 20 * time.Second

	// DefaultPort is the default HTTP listen port.
	DefaultPort = "8081"

	// DefaultChannelURL is the default internal URL for this service.
	DefaultChannelURL = "http://localhost:8081"
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

	// Bounded pool — the default pgxpool.New sizing (max=4 from runtime.NumCPU)
	// is too variable across environments and doesn't expose a connect
	// timeout. A 10-conn ceiling with fast-fail on connect prevents this
	// service from running the shared Postgres dry when Coolify schedules
	// multiple channel APIs on the same node.
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
		AppName:               "Scrollr Finance API",
		DisableStartupMessage: false,
	})

	// Sentry middleware MUST be the first middleware so panics from
	// anything below are captured. Followed immediately by the user-hook
	// which attaches a hashed anonymous user ID to every request scope.
	// Both gated on SENTRY_DSN — when unset, neither is registered.
	if os.Getenv("SENTRY_DSN") != "" {
		fiberApp.Use(sentryMiddleware())
		fiberApp.Use(sentryUserHook())
	}

	app := &App{db: dbPool, rdb: rdb}

	// Internal routes (called by core gateway only)
	fiberApp.Post("/internal/cdc", app.handleInternalCDC)
	fiberApp.Get("/internal/dashboard", app.handleInternalDashboard)
	fiberApp.Get("/internal/health", app.handleInternalHealth)
	fiberApp.Post("/internal/channel-lifecycle", app.handleChannelLifecycle)

	// Public routes (proxied by core gateway)
	fiberApp.Get("/finance", app.getFinance)
	fiberApp.Get("/finance/public", app.getFinance) // Unauthenticated: returns all trades (same handler, same cache)
	fiberApp.Get("/finance/health", app.healthHandler)
	fiberApp.Get("/finance/symbols", app.getSymbolCatalog)

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

	log.Printf("Finance API listening on port %s", port)

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down Finance API...")
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
		Name:         "finance",
		DisplayName:  "Finance",
		InternalURL:  channelURL,
		Capabilities: []string{"cdc_handler", "dashboard_provider", "health_checker", "channel_lifecycle"},
		CDCTables:    []string{"trades"},
		Routes: []registrationRoute{
			{Method: "GET", Path: "/finance", Auth: true},
			{Method: "GET", Path: "/finance/public", Auth: false},
			{Method: "GET", Path: "/finance/health", Auth: false},
			{Method: "GET", Path: "/finance/symbols", Auth: false},
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
