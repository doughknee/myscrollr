package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/joho/godotenv"

	"github.com/brandon-relentnet/myscrollr/api/core"
)

// envOr returns the env value or fallback when unset.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// @title Scrollr API
// @version 2.0
// @description Gateway API for Scrollr — routes requests to self-registered channel services.
// @host api.myscrollr.relentnet.dev
// @BasePath /
// @securityDefinitions.apikey LogtoAuth
// @in header
// @name Authorization
// @description Type 'Bearer ' followed by your Logto JWT.
func main() {
	_ = godotenv.Load()

	// Sentry init — must happen before any infrastructure that might panic.
	// When SENTRY_DSN is empty, Sentry is a no-op (no events sent, no
	// background goroutines started).
	if dsn := os.Getenv("SENTRY_DSN"); dsn != "" {
		err := sentry.Init(sentry.ClientOptions{
			Dsn:              dsn,
			Environment:      envOr("ENVIRONMENT", "development"),
			Release:          envOr("GIT_SHA", "unknown"),
			EnableTracing:    true,
			TracesSampleRate: 0.1,
			AttachStacktrace: true,
			SendDefaultPII:   false,
			BeforeSend: func(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
				core.ScrubSentryEvent(event)
				return event
			},
		})
		if err != nil {
			log.Printf("[Sentry] init failed: %v", err)
		} else {
			log.Printf("[Sentry] initialized for environment=%s", envOr("ENVIRONMENT", "development"))
			sentry.ConfigureScope(func(scope *sentry.Scope) {
				scope.SetTag("service", "scrollr-core-api")
			})
			defer sentry.Flush(2 * time.Second)
		}
	}

	// Root context — cancelled on shutdown signal
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Infrastructure
	core.ConnectDB()
	defer core.DBPool.Close()

	core.ConnectRedis()
	defer core.Rdb.Close()

	core.InitHub(ctx)
	core.InitAuth()

	// Start Redis-based channel discovery (ctx-aware)
	core.StartDiscovery(ctx)

	// Start GDPR purge worker — scans user_deletion_requests hourly for
	// rows that have aged past their purge_at and cascades the permanent
	// delete across local DB + Logto.
	core.StartGDPRPurgeWorker(ctx)

	// Periodic prune of the Stripe webhook idempotency table. Long-lived
	// pods otherwise grow this table unboundedly between restarts.
	core.StartWebhookEventsPruner(ctx)

	// Register Discord slash commands (idempotent on every boot when
	// configured). No-op if Discord env vars aren't set.
	core.RegisterDiscordSlashCommandsAtBoot(ctx)

	// Build and start the gateway server
	srv := core.NewServer()
	srv.Setup()

	// Start Fiber in a goroutine so we can listen for shutdown signals
	go func() {
		if err := srv.Listen(); err != nil {
			log.Printf("Server error: %v", err)
		}
	}()

	// Wait for termination signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	sig := <-quit
	log.Printf("Received signal %v, shutting down...", sig)

	// Cancel discovery goroutine
	cancel()

	// Gracefully shut down Fiber
	if err := srv.App.Shutdown(); err != nil {
		log.Printf("Error during server shutdown: %v", err)
	}

	log.Println("Scrollr API shut down gracefully")
}
