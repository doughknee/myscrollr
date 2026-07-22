package platform

import (
	"context"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBPool is the global PostgreSQL connection pool.
var DBPool *pgxpool.Pool

// ConnectDB initialises the PostgreSQL connection pool and runs migrations.
func ConnectDB() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL must be set")
	}

	databaseURL = strings.TrimSpace(databaseURL)
	databaseURL = strings.Trim(databaseURL, "\"")
	databaseURL = strings.Trim(databaseURL, "'")

	if strings.HasPrefix(databaseURL, "postgres:") && !strings.HasPrefix(databaseURL, "postgres://") {
		databaseURL = strings.Replace(databaseURL, "postgres:", "postgres://", 1)
	} else if strings.HasPrefix(databaseURL, "postgresql:") && !strings.HasPrefix(databaseURL, "postgresql://") {
		databaseURL = strings.Replace(databaseURL, "postgresql:", "postgresql://", 1)
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("Unable to parse DATABASE_URL (redacted)")
	}

	config.MaxConns = DBMaxConns
	config.MinConns = DBMinConns
	config.MaxConnIdleTime = DBMaxConnIdleTime
	// Cap individual connection attempts at 5 seconds. Without this, a
	// transient Postgres blip lets requests pile up behind indefinitely
	// pending connection dials — the default is effectively unbounded.
	config.ConnConfig.ConnectTimeout = 5 * time.Second

	var pool *pgxpool.Pool
	retries := DBMaxRetries
	for i := 0; i < retries; i++ {
		pool, err = pgxpool.NewWithConfig(context.Background(), config)
		if err == nil {
			err = pool.Ping(context.Background())
			if err == nil {
				break
			}
		}

		log.Printf("[Database] Failed to connect, retrying in 2 seconds... (%d attempts left)", retries-i-1)
		time.Sleep(DBRetryDelay)
	}

	if err != nil {
		log.Fatalf("Unable to connect to database after retries")
	}

	DBPool = pool
	log.Println("[Database] Connected to PostgreSQL")

	// core is the single owner of the shared schema (VISION 4.3): this is
	// the only migration chain that runs anywhere. The ingesters are pure
	// writers. golang-migrate uses the pq driver, which requires sslmode to
	// be explicit; the table name is kept from before the consolidation so
	// existing databases don't re-run the chain.
	//
	// sslmode has to be inferred when the URL omits it, and the safe answer
	// differs by host. This used to append `disable` unconditionally, which
	// would run the whole DDL chain in the clear against a remote database.
	// Appending `require` unconditionally is the opposite mistake: a local
	// Postgres has no TLS, so `go run .` against localhost fails outright with
	// nothing in the docs to explain it.
	//
	// So: remote defaults to require, loopback defaults to disable. An explicit
	// sslmode in DATABASE_URL always wins (docker-compose.dev.yml sets one).
	migrateURL := databaseURL
	if !strings.Contains(migrateURL, "sslmode=") {
		mode := "require"
		if isLoopbackDB(migrateURL) {
			mode = "disable"
		}
		sep := "?"
		if strings.Contains(migrateURL, "?") {
			sep = "&"
		}
		migrateURL += sep + "sslmode=" + mode
	}
	if strings.Contains(migrateURL, "?") {
		migrateURL += "&x-migrations-table=schema_migrations_core"
	} else {
		migrateURL += "?x-migrations-table=schema_migrations_core"
	}

	m, err := migrate.New(
		"file://migrations",
		migrateURL,
	)
	if err != nil {
		log.Fatalf("Failed to create migrator: %v", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		m.Close()
		log.Fatalf("Migration failed: %v", err)
	}
	m.Close()
	log.Println("[Database] Migrations applied")

	// Best-effort initial prune so the table doesn't sit with stale rows
	// until the first periodic tick fires. Errors are logged inside.
	pruneWebhookEvents(context.Background())
}

// isLoopbackDB reports whether a Postgres URL points at this machine, where
// TLS is not expected. Parsed rather than substring-matched so a remote host
// that merely contains "localhost" in a database name or password cannot be
// mistaken for local — that would silently downgrade a production connection.
func isLoopbackDB(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false // unparseable: assume remote, keep the secure default
	}
	switch h := u.Hostname(); h {
	case "localhost", "127.0.0.1", "::1", "0.0.0.0":
		return true
	default:
		// Docker's host aliases resolve to the developer's own machine.
		return h == "host.docker.internal" || h == "postgres"
	}
}

// pruneWebhookEvents deletes Stripe webhook event rows older than 7 days.
// Stripe re-delivers events for up to ~3 days on failure, so 7 days is
// a generous idempotency window that still keeps the table bounded.
func pruneWebhookEvents(ctx context.Context) {
	_, err := DBPool.Exec(ctx, `
		DELETE FROM stripe_webhook_events WHERE created_at < now() - interval '7 days';
	`)
	if err != nil {
		log.Printf("[Database] Failed to prune old webhook events: %v", err)
	}
}

// StartWebhookEventsPruner runs pruneWebhookEvents every 6 hours for the
// lifetime of ctx. Long-lived pods need this — otherwise the events table
// grows for 7 days (idempotency window) between restarts on a healthy
// deployment. The ticker drains on ctx.Done().
func StartWebhookEventsPruner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pruneWebhookEvents(ctx)
			}
		}
	}()
	log.Println("[Database] Webhook events pruner started (6h interval)")
}
