package core

import (
	"context"
	"log"
	"os"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-migrate/migrate/v4"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// testMiniRedis is the package-wide miniredis instance in integration
// mode; setupIntegrationDB flushes it between tests. Nil in unit mode.
var testMiniRedis *miniredis.Miniredis

// integrationMigrateURL appends sslmode + a migrations-table override the
// same way ConnectDB does, tolerating URLs with or without existing params.
func integrationMigrateURL(dbURL, table string) string {
	u := dbURL
	if !strings.Contains(u, "sslmode=") {
		if strings.Contains(u, "?") {
			u += "&sslmode=disable"
		} else {
			u += "?sslmode=disable"
		}
	}
	return u + "&x-migrations-table=" + table
}

// TestMain switches the package into integration mode when
// TEST_DATABASE_URL is set: the repo's real migrations are applied (core
// plus the fantasy channel's — the GDPR purge cascade deletes from
// yahoo_* tables, which the fantasy service owns in the shared production
// database), DBPool points at the test database, and Rdb at an in-process
// miniredis. Tests that gate on DBPool/Rdb being non-nil (testDBAvailable,
// testRedisAvailable, setupIntegrationDB) then run instead of skipping.
// Without the variable both stay nil and unit tests behave as before.
//
// CI provides the database via a postgres service container
// (.github/workflows/backend-tests.yml). Locally:
//
//	TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5433/scrollr_test?sslmode=disable" go test ./core
func TestMain(m *testing.M) {
	os.Exit(testMainRun(m))
}

// testMainRun exists so deferred cleanup runs before os.Exit.
func testMainRun(m *testing.M) int {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		return m.Run()
	}

	for _, src := range []struct{ path, table string }{
		{"file://../migrations", "schema_migrations_core"},
		{"file://../../channels/fantasy/api/migrations", "schema_migrations_fantasy"},
	} {
		mig, err := migrate.New(src.path, integrationMigrateURL(dbURL, src.table))
		if err != nil {
			log.Fatalf("[TestMain] create migrator for %s: %v", src.path, err)
		}
		if err := mig.Up(); err != nil && err != migrate.ErrNoChange {
			mig.Close()
			log.Fatalf("[TestMain] migrate %s: %v", src.path, err)
		}
		mig.Close()
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("[TestMain] connect test database: %v", err)
	}
	defer pool.Close()
	DBPool = pool

	// The overview handler reads the curated-feeds catalog from the rss
	// service's tables (production shares one database across services).
	// The rss migration directory mixes a legacy timestamp prefix with
	// the newer 13* prefix, so a version-ordered migrator would run the
	// 13* backfill before the table it reads exists — apply the files in
	// historical order instead. All four are idempotent (IF NOT EXISTS /
	// ON CONFLICT DO NOTHING / re-runnable DELETE).
	for _, f := range []string{
		"../../channels/rss/service/migrations/20250601000001_initial.up.sql",
		"../../channels/rss/service/migrations/20250601000002_add_failure_tracking.up.sql",
		"../../channels/rss/service/migrations/130000000001_user_custom_feeds.up.sql",
		"../../channels/rss/service/migrations/130000000002_cleanup_dup_user_custom_feeds.up.sql",
	} {
		sqlBytes, err := os.ReadFile(f)
		if err != nil {
			log.Fatalf("[TestMain] read rss migration %s: %v", f, err)
		}
		if _, err := pool.Exec(context.Background(), string(sqlBytes)); err != nil {
			log.Fatalf("[TestMain] apply rss migration %s: %v", f, err)
		}
	}

	mr, err := miniredis.Run()
	if err != nil {
		log.Fatalf("[TestMain] start miniredis: %v", err)
	}
	defer mr.Close()
	testMiniRedis = mr
	Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	// The webhook prune path reaches UpdateUserTopicSubscriptions, which
	// dereferences the SSE hub. Production initializes it via InitHub in
	// main before the server listens; give tests the same minimal hub
	// (no dispatch workers or Redis listener — nothing dispatches here).
	// Mirrors the per-test hub in events_cache_test.go.
	globalHub = &Hub{
		registry:   &topicRegistry{},
		dispatchCh: make(chan dispatchJob, 1),
	}

	return m.Run()
}
