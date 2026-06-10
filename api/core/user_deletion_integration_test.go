package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/jackc/pgx/v5/pgxpool"
)

// =============================================================================
// GDPR purge cascade — integration tests
// =============================================================================
//
// These tests exercise the real SQL against a real PostgreSQL database and
// are skipped when TEST_DATABASE_URL is unset. CI provides a postgres
// service container (.github/workflows/backend-tests.yml). Locally:
//
//   TEST_DATABASE_URL="postgres://postgres@127.0.0.1:5433/scrollr_test?sslmode=disable" go test ./core
//
// The database is prepared with the repo's actual migrations — core plus
// the fantasy channel's (the purge cascade deletes from yahoo_* tables,
// which the fantasy service owns in the shared production database).
// Logto is stubbed with a local HTTP server via LOGTO_ENDPOINT.

var integrationMigrateOnce sync.Once

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

// setupIntegrationDB connects DBPool to the test database, applies
// migrations once per test binary, and truncates all tables the purge
// cascade touches so each test starts clean. Skips when no test database
// is configured.
func setupIntegrationDB(t *testing.T) {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}

	integrationMigrateOnce.Do(func() {
		for _, src := range []struct{ path, table string }{
			{"file://../migrations", "schema_migrations_core"},
			{"file://../../channels/fantasy/api/migrations", "schema_migrations_fantasy"},
		} {
			m, err := migrate.New(src.path, integrationMigrateURL(dbURL, src.table))
			if err != nil {
				t.Fatalf("create migrator for %s: %v", src.path, err)
			}
			if err := m.Up(); err != nil && err != migrate.ErrNoChange {
				m.Close()
				t.Fatalf("migrate %s: %v", src.path, err)
			}
			m.Close()
		}
	})

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	prev := DBPool
	DBPool = pool
	t.Cleanup(func() {
		DBPool = prev
		pool.Close()
	})

	_, err = pool.Exec(context.Background(), `
		TRUNCATE TABLE user_channels, user_preferences, stripe_customers,
		               stripe_webhook_events, user_deletion_requests,
		               yahoo_user_leagues, yahoo_users, yahoo_leagues CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
}

// logtoStub fakes the two Logto Management API endpoints the purge path
// uses: the M2M token grant and the user delete.
type logtoStub struct {
	mu         sync.Mutex
	deleted    []string
	failDelete bool
}

func (s *logtoStub) deletedSubs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.deleted...)
}

func newLogtoStub(t *testing.T) *logtoStub {
	t.Helper()
	s := &logtoStub{}
	mux := http.NewServeMux()
	mux.HandleFunc("/oidc/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"test-m2m-token","expires_in":3600}`))
	})
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		s.mu.Lock()
		fail := s.failDelete
		if !fail {
			s.deleted = append(s.deleted, strings.TrimPrefix(r.URL.Path, "/api/users/"))
		}
		s.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	t.Setenv("LOGTO_ENDPOINT", server.URL)
	t.Setenv("LOGTO_M2M_APP_ID", "test-app")
	t.Setenv("LOGTO_M2M_APP_SECRET", "test-secret")

	// Drop any M2M token cached by a previous test so this test's stub
	// issues its own.
	m2mMu.Lock()
	m2mToken = ""
	m2mTokenExpiry = time.Time{}
	m2mMu.Unlock()

	return s
}

// mustExec is shared with handlers_overview_test.go.

func queryCount(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := DBPool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	return n
}

// seedPurgeableUser inserts the full set of rows the purge cascade
// touches: channel config, preferences, Stripe record, Yahoo OAuth +
// league mapping, and a pending deletion request safely past both the
// grace window and the 24h floor guard.
func seedPurgeableUser(t *testing.T, sub string, lifetime bool) {
	t.Helper()
	mustExec(t, `INSERT INTO user_channels (logto_sub, channel_type, config) VALUES ($1, 'finance', '{}')`, sub)
	mustExec(t, `INSERT INTO user_preferences (logto_sub) VALUES ($1)`, sub)
	mustExec(t, `INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
	             VALUES ($1, $2, $3, 'canceled', $4)`,
		sub, "cus_"+sub, map[bool]string{true: "lifetime", false: "monthly"}[lifetime], lifetime)
	mustExec(t, `INSERT INTO yahoo_leagues (league_key, name, game_code, season, data)
	             VALUES ('nfl.l.12345', 'Test League', 'nfl', '2025', '{}')
	             ON CONFLICT (league_key) DO NOTHING`)
	mustExec(t, `INSERT INTO yahoo_users (guid, logto_sub, refresh_token) VALUES ($1, $2, 'refresh-token')`, "guid-"+sub, sub)
	mustExec(t, `INSERT INTO yahoo_user_leagues (guid, league_key) VALUES ($1, 'nfl.l.12345')`, "guid-"+sub)
	mustExec(t, `INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
	             VALUES ($1, now() - interval '31 days', now() - interval '1 day', 'pending')`, sub)
}

func TestIntegrationPurgeUserAccountFullCascade(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_purge_full"
	seedPurgeableUser(t, sub, false)

	if err := purgeUserAccount(context.Background(), sub); err != nil {
		t.Fatalf("purgeUserAccount: %v", err)
	}

	// Logto delete happened, and for the right user.
	if got := stub.deletedSubs(); len(got) != 1 || got[0] != sub {
		t.Errorf("Logto deletions = %v, want [%s]", got, sub)
	}

	// Every user-owned row is gone.
	for _, q := range []struct{ name, sql string }{
		{"user_channels", `SELECT count(*) FROM user_channels WHERE logto_sub = $1`},
		{"user_preferences", `SELECT count(*) FROM user_preferences WHERE logto_sub = $1`},
		{"stripe_customers", `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`},
		{"yahoo_users", `SELECT count(*) FROM yahoo_users WHERE logto_sub = $1`},
	} {
		if n := queryCount(t, q.sql, sub); n != 0 {
			t.Errorf("%s rows after purge = %d, want 0", q.name, n)
		}
	}
	if n := queryCount(t, `SELECT count(*) FROM yahoo_user_leagues WHERE guid = $1`, "guid-"+sub); n != 0 {
		t.Errorf("yahoo_user_leagues rows after purge = %d, want 0", n)
	}

	// The request row is marked purged with a timestamp.
	var status string
	var purgedAt *time.Time
	err := DBPool.QueryRow(context.Background(),
		`SELECT status, purged_at FROM user_deletion_requests WHERE logto_sub = $1`, sub,
	).Scan(&status, &purgedAt)
	if err != nil {
		t.Fatalf("read deletion request: %v", err)
	}
	if status != "purged" || purgedAt == nil {
		t.Errorf("deletion request after purge: status=%q purged_at=%v, want status=purged with timestamp", status, purgedAt)
	}
}

func TestIntegrationPurgeLifetimeAnonymizesStripe(t *testing.T) {
	setupIntegrationDB(t)
	newLogtoStub(t)
	const sub = "user_purge_lifetime"
	seedPurgeableUser(t, sub, true)

	if err := purgeUserAccount(context.Background(), sub); err != nil {
		t.Fatalf("purgeUserAccount: %v", err)
	}

	// The Stripe row survives for tax records, but no longer references
	// the user.
	var anonSub string
	var lifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT logto_sub, lifetime FROM stripe_customers WHERE stripe_customer_id = $1`, "cus_"+sub,
	).Scan(&anonSub, &lifetime)
	if err != nil {
		t.Fatalf("lifetime Stripe row should survive purge: %v", err)
	}
	if !strings.HasPrefix(anonSub, "deleted-") {
		t.Errorf("anonymized logto_sub = %q, want deleted-* placeholder", anonSub)
	}
	if !lifetime {
		t.Errorf("lifetime flag lost during anonymization")
	}
	if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, sub); n != 0 {
		t.Errorf("stripe_customers still references %s after anonymization", sub)
	}
}

func TestIntegrationPurgeAbortsWhenLogtoFails(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	stub.failDelete = true
	const sub = "user_purge_logto_down"
	seedPurgeableUser(t, sub, false)

	if err := purgeUserAccount(context.Background(), sub); err == nil {
		t.Fatal("purgeUserAccount should fail when Logto delete fails")
	}

	// Logto-first ordering: nothing local may be deleted if revoking
	// sign-in failed, so the next pass can retry the full cascade.
	for _, q := range []struct{ name, sql string }{
		{"user_channels", `SELECT count(*) FROM user_channels WHERE logto_sub = $1`},
		{"user_preferences", `SELECT count(*) FROM user_preferences WHERE logto_sub = $1`},
		{"stripe_customers", `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`},
		{"yahoo_users", `SELECT count(*) FROM yahoo_users WHERE logto_sub = $1`},
	} {
		if n := queryCount(t, q.sql, sub); n != 1 {
			t.Errorf("%s rows after failed purge = %d, want 1 (untouched)", q.name, n)
		}
	}
	var status string
	if err := DBPool.QueryRow(context.Background(),
		`SELECT status FROM user_deletion_requests WHERE logto_sub = $1`, sub,
	).Scan(&status); err != nil || status != "pending" {
		t.Errorf("deletion request after failed purge: status=%q err=%v, want pending", status, err)
	}
}

func TestIntegrationPurgePassEligibility(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)

	const eligible = "user_eligible"
	seedPurgeableUser(t, eligible, false)

	// Misconfigured purge_at (e.g. manual SQL edit): purge_at is in the
	// past but the request is only an hour old. The 24h floor guard must
	// block it.
	const tooFresh = "user_too_fresh"
	seedPurgeableUser(t, tooFresh, false)
	mustExec(t, `UPDATE user_deletion_requests
	             SET requested_at = now() - interval '1 hour'
	             WHERE logto_sub = $1`, tooFresh)

	// Still inside the grace window.
	const notDue = "user_not_due"
	seedPurgeableUser(t, notDue, false)
	mustExec(t, `UPDATE user_deletion_requests
	             SET purge_at = now() + interval '10 days'
	             WHERE logto_sub = $1`, notDue)

	// Canceled requests are never purged.
	const canceled = "user_canceled"
	seedPurgeableUser(t, canceled, false)
	mustExec(t, `UPDATE user_deletion_requests
	             SET status = 'canceled', canceled_at = now()
	             WHERE logto_sub = $1`, canceled)

	runGDPRPurgePass(context.Background())

	if got := stub.deletedSubs(); len(got) != 1 || got[0] != eligible {
		t.Errorf("purge pass deleted %v from Logto, want exactly [%s]", got, eligible)
	}

	wantStatus := map[string]string{
		eligible: "purged",
		tooFresh: "pending",
		notDue:   "pending",
		canceled: "canceled",
	}
	for sub, want := range wantStatus {
		var status string
		if err := DBPool.QueryRow(context.Background(),
			`SELECT status FROM user_deletion_requests WHERE logto_sub = $1`, sub,
		).Scan(&status); err != nil {
			t.Errorf("read status for %s: %v", sub, err)
			continue
		}
		if status != want {
			t.Errorf("deletion request %s: status = %q, want %q", sub, status, want)
		}
	}

	// The guarded users' data is intact.
	for _, sub := range []string{tooFresh, notDue, canceled} {
		if n := queryCount(t, `SELECT count(*) FROM user_preferences WHERE logto_sub = $1`, sub); n != 1 {
			t.Errorf("user_preferences for %s after purge pass = %d, want 1 (untouched)", sub, n)
		}
	}
}

// TestIntegrationStripeWebhookIdempotency verifies the atomic
// INSERT ... ON CONFLICT claim in HandleStripeWebhook: replaying the same
// event is accepted (200, so Stripe stops retrying) but only claims one
// idempotency slot.
func TestIntegrationStripeWebhookIdempotency(t *testing.T) {
	setupIntegrationDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(`{"id":"evt_integration_dup","object":"event","type":"product.created","data":{"object":{}}}`)
	sig := signStripePayload(t, payload, "whsec_test_secret", time.Now())

	for i := 0; i < 2; i++ {
		if status := postWebhook(t, app, payload, sig); status != 200 {
			t.Fatalf("webhook delivery %d: status = %d, want 200", i+1, status)
		}
	}

	if n := queryCount(t, `SELECT count(*) FROM stripe_webhook_events WHERE event_id = $1`, "evt_integration_dup"); n != 1 {
		t.Errorf("idempotency rows for replayed event = %d, want 1", n)
	}
}
