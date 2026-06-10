package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// =============================================================================
// GDPR purge cascade — integration tests
// =============================================================================
//
// These tests exercise the real SQL against a real PostgreSQL database and
// are skipped when TEST_DATABASE_URL is unset. TestMain (main_test.go)
// owns the database connection and migrations. Logto is stubbed with a
// local HTTP server via LOGTO_ENDPOINT.

// setupIntegrationDB skips unless TestMain put the package in integration
// mode, then truncates every table the integration tests touch so each
// test starts clean.
func setupIntegrationDB(t *testing.T) {
	t.Helper()
	if DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	if testMiniRedis != nil {
		testMiniRedis.FlushAll()
	}
	_, err := DBPool.Exec(context.Background(), `
		TRUNCATE TABLE user_channels, user_preferences, stripe_customers,
		               stripe_webhook_events, user_deletion_requests,
		               yahoo_user_leagues, yahoo_users, yahoo_leagues CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate test tables: %v", err)
	}
}

// logtoStub fakes the Logto Management API endpoints the webhook and
// purge paths use: the M2M token grant, user delete, and role
// assignment/removal. Role calls are recorded as "sub:roleID" strings.
type logtoStub struct {
	mu         sync.Mutex
	deleted    []string
	assigned   []string
	removed    []string
	failDelete bool
}

func (s *logtoStub) deletedSubs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.deleted...)
}

func (s *logtoStub) assignedRoles() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.assigned...)
}

func (s *logtoStub) removedRoles() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.removed...)
}

// Role IDs the stub environment configures — tests assert against these.
const (
	stubRoleUplink   = "role-uplink"
	stubRolePro      = "role-pro"
	stubRoleUltimate = "role-ultimate"
)

func newLogtoStub(t *testing.T) *logtoStub {
	t.Helper()
	s := &logtoStub{}
	mux := http.NewServeMux()
	mux.HandleFunc("/oidc/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"test-m2m-token","expires_in":3600}`))
	})
	mux.HandleFunc("/api/users/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/users/"), "/")
		switch {
		// DELETE /api/users/{sub} — account deletion
		case len(parts) == 1 && r.Method == http.MethodDelete:
			s.mu.Lock()
			fail := s.failDelete
			if !fail {
				s.deleted = append(s.deleted, parts[0])
			}
			s.mu.Unlock()
			if fail {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		// POST /api/users/{sub}/roles — assign roles
		case len(parts) == 2 && parts[1] == "roles" && r.Method == http.MethodPost:
			var body struct {
				RoleIDs []string `json:"roleIds"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			s.mu.Lock()
			for _, id := range body.RoleIDs {
				s.assigned = append(s.assigned, parts[0]+":"+id)
			}
			s.mu.Unlock()
			w.WriteHeader(http.StatusCreated)
		// DELETE /api/users/{sub}/roles/{roleID} — remove role
		case len(parts) == 3 && parts[1] == "roles" && r.Method == http.MethodDelete:
			s.mu.Lock()
			s.removed = append(s.removed, parts[0]+":"+parts[2])
			s.mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	t.Setenv("LOGTO_ENDPOINT", server.URL)
	t.Setenv("LOGTO_M2M_APP_ID", "test-app")
	t.Setenv("LOGTO_M2M_APP_SECRET", "test-secret")
	t.Setenv("LOGTO_UPLINK_ROLE_ID", stubRoleUplink)
	t.Setenv("LOGTO_PRO_ROLE_ID", stubRolePro)
	t.Setenv("LOGTO_ULTIMATE_ROLE_ID", stubRoleUltimate)

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
