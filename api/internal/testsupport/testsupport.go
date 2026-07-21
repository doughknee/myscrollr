// Package testsupport holds test scaffolding shared by several internal
// packages' tests. It exists because _test.go files are not importable
// across packages: once the flat core package was split, helpers like the
// integration-mode TestMain had to live somewhere every package's tests
// could reach.
//
// It may only import platform. Importing anything higher would create an
// import cycle in the tests of whatever package it imported.
package testsupport

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v82/webhook"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// SharedMiniRedis is the package-wide miniredis instance in integration
// mode; integration tests flush it between cases. Nil in unit mode.
var SharedMiniRedis *miniredis.Miniredis

// MiniRedis replaces platform.Rdb with an in-memory miniredis instance for
// the duration of a test. Returns a cleanup function to call with defer.
func MiniRedis(t *testing.T) (*miniredis.Miniredis, func()) {
	t.Helper()

	mr := miniredis.RunT(t)
	previousRdb := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	return mr, func() {
		_ = platform.Rdb.Close()
		platform.Rdb = previousRdb
	}
}

// DBAvailable skips the calling test when the DB pool isn't initialised.
// Most unit-test runs bring up a package without a real database, so any
// test that touches DBPool must guard itself.
func DBAvailable(t *testing.T) bool {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("DBPool not initialised; skipping integration test")
		return false
	}
	return true
}

// RedisAvailable skips when Rdb is nil — same reason as DBAvailable.
func RedisAvailable(t *testing.T) bool {
	t.Helper()
	if platform.Rdb == nil {
		t.Skip("Rdb not initialised; skipping integration test")
		return false
	}
	return true
}

// MustExec runs an INSERT/UPDATE in the test DB or fails the test.
func MustExec(t *testing.T, query string, args ...interface{}) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("DBPool not initialised")
		return
	}
	if _, err := platform.DBPool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("MustExec failed: %v", err)
	}
}

// apiRoot walks up from the working directory to the api/ module root, so
// migration paths resolve the same from every package's test directory.
func apiRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		log.Fatalf("[TestMain] getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			log.Fatalf("[TestMain] no go.mod above %s", dir)
		}
		dir = parent
	}
}

// migrateURL appends sslmode + a migrations-table override the same way
// ConnectDB does, tolerating URLs with or without existing params.
func migrateURL(dbURL, table string) string {
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

// Main is the shared TestMain body. It switches a package into integration
// mode when TEST_DATABASE_URL is set: the repo's real migrations are
// applied (core plus the fantasy channel's — the GDPR purge cascade
// deletes from yahoo_* tables, which the fantasy service owns in the
// shared production database), platform.DBPool points at the test
// database, and platform.Rdb at an in-process miniredis. Tests that gate
// on DBPool/Rdb being non-nil then run instead of skipping. Without the
// variable both stay nil and unit tests behave as before.
//
// CI provides the database via a postgres service container
// (.github/workflows/backend-tests.yml). Locally:
//
//	TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5433/scrollr_test?sslmode=disable" go test ./...
//
// Callers must os.Exit the result so deferred cleanup here runs first:
//
//	func TestMain(m *testing.M) { os.Exit(testsupport.Main(m)) }
func Main(m *testing.M) int {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		return m.Run()
	}

	// One chain, one authority (VISION 4.3): core's migrations create every
	// table the tests touch, including the content tables the ingesters
	// write and the yahoo_* tables the GDPR purge cascade deletes from.
	src := "file://" + filepath.ToSlash(filepath.Join(apiRoot(), "migrations"))
	mig, err := migrate.New(src, migrateURL(dbURL, "schema_migrations_core"))
	if err != nil {
		log.Fatalf("[TestMain] create migrator for %s: %v", src, err)
	}
	if err := mig.Up(); err != nil && err != migrate.ErrNoChange {
		mig.Close()
		log.Fatalf("[TestMain] migrate %s: %v", src, err)
	}
	mig.Close()

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("[TestMain] connect test database: %v", err)
	}
	defer pool.Close()
	platform.DBPool = pool

	mr, err := miniredis.Run()
	if err != nil {
		log.Fatalf("[TestMain] start miniredis: %v", err)
	}
	defer mr.Close()
	SharedMiniRedis = mr
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	return m.Run()
}

// --- Stripe webhook helpers ---

// NewWebhookTestApp returns a Fiber app with only the Stripe webhook
// route, mirroring how server.go registers it. The handler is passed in
// so this package need not import billing (which would cycle).
func NewWebhookTestApp(h fiber.Handler) *fiber.App {
	app := fiber.New()
	app.Post("/webhooks/stripe", h)
	return app
}

// SignStripePayload produces a valid Stripe-Signature header for the
// payload, using the same scheme Stripe uses (t=<unix>,v1=<hex HMAC>).
func SignStripePayload(t *testing.T, payload []byte, secret string, at time.Time) string {
	t.Helper()
	sig := webhook.ComputeSignature(at, payload, secret)
	return fmt.Sprintf("t=%d,v1=%s", at.Unix(), hex.EncodeToString(sig))
}

// PostWebhook delivers a signed payload to the webhook app and returns the
// response status code.
func PostWebhook(t *testing.T, app *fiber.App, payload []byte, sigHeader string) int {
	t.Helper()
	req := httptest.NewRequest("POST", "/webhooks/stripe", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if sigHeader != "" {
		req.Header.Set("Stripe-Signature", sigHeader)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}
