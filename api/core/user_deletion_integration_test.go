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

	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
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
// test starts clean. The fixtures here use fixed ids (user_purge_full,
// cus_cancel_1, evt_integration_dup), so a re-run needs the previous run's
// rows gone.
//
// This TRUNCATE is only safe because testsupport.Main gives each test
// package its own Postgres schema. It used to run against the one shared
// schema, where it would wipe rows internal/accounts had just inserted and
// fail that package's tests with "want 4, got 0", intermittently, depending
// on how `go test ./...` scheduled the two packages (REL-151). Do not
// reintroduce a shared schema without also fixing this.
func setupIntegrationDB(t *testing.T) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	if testsupport.SharedMiniRedis != nil {
		testsupport.SharedMiniRedis.FlushAll()
	}
	_, err := platform.DBPool.Exec(context.Background(), `
		TRUNCATE TABLE product_analytics_enrollments, user_widgets, user_preferences, stripe_customers,
		               stripe_webhook_events, user_deletion_requests, github_connections,
		               user_custom_feeds, tracked_feeds CASCADE
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
	accounts.ResetM2MTokenCache()

	return s
}

// mustExec is shared with handlers_overview_test.go.

func queryCount(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := platform.DBPool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	return n
}

// seedPurgeableUser inserts the full set of rows the purge cascade
// touches: channel config, preferences, Stripe record, and a pending
// deletion request safely past both the grace window and the 24h floor
// guard.
func seedPurgeableUser(t *testing.T, sub string, lifetime bool) {
	t.Helper()
	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub, widget_type, config) VALUES ($1, 'finance', '{}')`, sub)
	testsupport.MustExec(t, `INSERT INTO user_preferences (logto_sub) VALUES ($1)`, sub)
	testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments (logto_sub, first_active_day) VALUES ($1, CURRENT_DATE - 2)`, sub)
	testsupport.MustExec(t, `INSERT INTO product_activity_daily (logto_sub, day, sports) VALUES ($1, CURRENT_DATE - 2, true)`, sub)
	testsupport.MustExec(t, `INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
	             VALUES ($1, $2, $3, 'canceled', $4)`,
		sub, "cus_"+sub, map[bool]string{true: "lifetime", false: "monthly"}[lifetime], lifetime)
	testsupport.MustExec(t, `INSERT INTO github_connections (logto_sub, github_user_id, github_login, access_token)
	             VALUES ($1, 42, 'octo', 'ciphertext')`, sub)
	testsupport.MustExec(t, `INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
	             VALUES ($1, now() - interval '31 days', now() - interval '1 day', 'pending')`, sub)
}

func TestIntegrationPurgeUserAccountFullCascade(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_purge_full"
	seedPurgeableUser(t, sub, false)
	t.Setenv("SENTRY_USER_SALT", "purge-test-salt")
	actor := platform.HashUserSub(sub)
	testsupport.MustExec(t, `INSERT INTO rss_security_events (hour, actor, reason) VALUES (date_trunc('hour', now()), $1, 'rate_limit')`, actor)

	if err := accounts.PurgeUserAccount(context.Background(), sub); err != nil {
		t.Fatalf("purgeUserAccount: %v", err)
	}
	if n := queryCount(t, `SELECT count(*) FROM rss_security_events WHERE actor=$1`, actor); n != 0 {
		t.Fatalf("security activity survives purge: %d", n)
	}

	// Logto delete happened, and for the right user.
	if got := stub.deletedSubs(); len(got) != 1 || got[0] != sub {
		t.Errorf("Logto deletions = %v, want [%s]", got, sub)
	}

	// Every user-owned row is gone.
	for _, q := range []struct{ name, sql string }{
		{"product_analytics_enrollments", `SELECT count(*) FROM product_analytics_enrollments WHERE logto_sub = $1`},
		{"product_activity_daily", `SELECT count(*) FROM product_activity_daily WHERE logto_sub = $1`},
		{"user_widgets", `SELECT count(*) FROM user_widgets WHERE logto_sub = $1`},
		{"user_preferences", `SELECT count(*) FROM user_preferences WHERE logto_sub = $1`},
		{"stripe_customers", `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`},
		{"github_connections", `SELECT count(*) FROM github_connections WHERE logto_sub = $1`},
	} {
		if n := queryCount(t, q.sql, sub); n != 0 {
			t.Errorf("%s rows after purge = %d, want 0", q.name, n)
		}
	}

	// The request row is marked purged with a timestamp.
	var status string
	var purgedAt *time.Time
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT status, purged_at FROM user_deletion_requests WHERE logto_sub = $1`, sub,
	).Scan(&status, &purgedAt)
	if err != nil {
		t.Fatalf("read deletion request: %v", err)
	}
	if status != "purged" || purgedAt == nil {
		t.Errorf("deletion request after purge: status=%q purged_at=%v, want status=purged with timestamp", status, purgedAt)
	}
}

func TestIntegrationPurgePreservesSharedFeeds(t *testing.T) {
	for _, failure := range []string{"none", "logto", "database"} {
		t.Run(failure, func(t *testing.T) {
			setupIntegrationDB(t)
			stub := newLogtoStub(t)
			stub.failDelete = failure == "logto"
			const owner, other = "feed-purge-owner", "feed-purge-other"
			seedPurgeableUser(t, owner, false)
			testsupport.MustExec(t, `INSERT INTO user_preferences (logto_sub) VALUES ($1)`, other)
			const otherConfig = `{"feeds":[{"url":"https://example.com/shared","name":"My shared source"}]}`
			testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub,widget_type,config) VALUES ($1,'rss_custom',$2::jsonb)`, other, otherConfig)
			testsupport.MustExec(t, `INSERT INTO tracked_feeds (url,name,added_by,is_default,is_enabled) VALUES
				('https://example.com/shared','Shared',$1,false,true),
				('https://example.com/owner-only','Owner only',$1,false,false),
				('https://example.com/other-only','Other only',$2,false,true),
				('https://example.com/curated','Curated',$1,true,true)`, owner, other)
			testsupport.MustExec(t, `INSERT INTO user_custom_feeds (logto_sub,url,name) VALUES
				($1,'https://example.com/shared','Owner name'),
				($1,'https://example.com/owner-only','Owner only'),
				($2,'https://example.com/shared','Other name'),
				($2,'https://example.com/other-only','Other only')`, owner, other)
			testsupport.MustExec(t, `INSERT INTO rss_items (feed_url,guid,title)
				SELECT url,url,'Retained article' FROM tracked_feeds`)
			ctx := context.Background()
			var before string
			if err := platform.DBPool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(f)-'added_by' ORDER BY url)::text FROM tracked_feeds f`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if failure == "database" {
				// Fail after feed cleanup to prove the whole local cascade rolls back.
				testsupport.MustExec(t, `CREATE FUNCTION reject_widget_purge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test purge failure'; END $$`)
				testsupport.MustExec(t, `CREATE TRIGGER reject_widget_purge BEFORE DELETE ON user_widgets FOR EACH ROW EXECUTE FUNCTION reject_widget_purge()`)
				t.Cleanup(func() {
					_, _ = platform.DBPool.Exec(ctx, `DROP TRIGGER reject_widget_purge ON user_widgets; DROP FUNCTION reject_widget_purge()`)
				})
			}
			err := accounts.PurgeUserAccount(ctx, owner)
			if (err != nil) != (failure != "none") {
				t.Fatalf("purge failure=%s err=%v", failure, err)
			}
			wantOwned, wantAttributed := 0, 0
			if failure != "none" {
				wantOwned, wantAttributed = 2, 3
			}
			if n := queryCount(t, `SELECT count(*) FROM user_custom_feeds WHERE logto_sub=$1`, owner); n != wantOwned {
				t.Fatalf("owner feeds=%d want=%d", n, wantOwned)
			}
			if n := queryCount(t, `SELECT count(*) FROM tracked_feeds WHERE added_by=$1`, owner); n != wantAttributed {
				t.Fatalf("owner attribution=%d want=%d", n, wantAttributed)
			}
			if n := queryCount(t, `SELECT count(*) FROM user_custom_feeds WHERE logto_sub=$1`, other); n != 2 {
				t.Fatalf("other user's feeds changed: %d", n)
			}
			if n := queryCount(t, `SELECT count(*) FROM tracked_feeds WHERE added_by=$1`, other); n != 1 {
				t.Fatalf("other attribution changed: %d", n)
			}
			if n := queryCount(t, `SELECT count(*) FROM rss_items WHERE title='Retained article'`); n != 4 {
				t.Fatalf("shared articles changed: %d", n)
			}
			var after string
			if err := platform.DBPool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(f)-'added_by' ORDER BY url)::text FROM tracked_feeds f`).Scan(&after); err != nil || after != before {
				t.Fatalf("polling targets changed: err=%v", err)
			}
			if n := queryCount(t, `SELECT count(*) FROM user_widgets WHERE logto_sub=$1 AND config=$2::jsonb`, other, otherConfig); n != 1 {
				t.Fatal("other user's widget changed")
			}
			if n := queryCount(t, `SELECT count(*) FROM user_preferences WHERE logto_sub=$1`, other); n != 1 {
				t.Fatal("other user's preferences changed")
			}
			wantStatus := "purged"
			if failure != "none" {
				wantStatus = "pending"
			}
			if n := queryCount(t, `SELECT count(*) FROM user_deletion_requests WHERE logto_sub=$1 AND status=$2`, owner, wantStatus); n != 1 {
				t.Fatal("wrong purge status")
			}
		})
	}
}

func TestIntegrationPurgeLifetimeAnonymizesStripe(t *testing.T) {
	setupIntegrationDB(t)
	newLogtoStub(t)
	const sub = "user_purge_lifetime"
	seedPurgeableUser(t, sub, true)

	if err := accounts.PurgeUserAccount(context.Background(), sub); err != nil {
		t.Fatalf("purgeUserAccount: %v", err)
	}

	// The Stripe row survives for tax records, but no longer references
	// the user.
	var anonSub string
	var lifetime bool
	err := platform.DBPool.QueryRow(context.Background(),
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

	if err := accounts.PurgeUserAccount(context.Background(), sub); err == nil {
		t.Fatal("purgeUserAccount should fail when Logto delete fails")
	}

	// Logto-first ordering: nothing local may be deleted if revoking
	// sign-in failed, so the next pass can retry the full cascade.
	for _, q := range []struct{ name, sql string }{
		{"user_widgets", `SELECT count(*) FROM user_widgets WHERE logto_sub = $1`},
		{"user_preferences", `SELECT count(*) FROM user_preferences WHERE logto_sub = $1`},
		{"stripe_customers", `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`},
	} {
		if n := queryCount(t, q.sql, sub); n != 1 {
			t.Errorf("%s rows after failed purge = %d, want 1 (untouched)", q.name, n)
		}
	}
	var status string
	if err := platform.DBPool.QueryRow(context.Background(),
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
	testsupport.MustExec(t, `UPDATE user_deletion_requests
	             SET requested_at = now() - interval '1 hour'
	             WHERE logto_sub = $1`, tooFresh)

	// Still inside the grace window.
	const notDue = "user_not_due"
	seedPurgeableUser(t, notDue, false)
	testsupport.MustExec(t, `UPDATE user_deletion_requests
	             SET purge_at = now() + interval '10 days'
	             WHERE logto_sub = $1`, notDue)

	// Canceled requests are never purged.
	const canceled = "user_canceled"
	seedPurgeableUser(t, canceled, false)
	testsupport.MustExec(t, `UPDATE user_deletion_requests
	             SET status = 'canceled', canceled_at = now()
	             WHERE logto_sub = $1`, canceled)

	accounts.RunGDPRPurgePass(context.Background())

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
		if err := platform.DBPool.QueryRow(context.Background(),
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

	app := testsupport.NewWebhookTestApp(billing.HandleStripeWebhook)
	payload := []byte(`{"id":"evt_integration_dup","object":"event","type":"product.created","data":{"object":{}}}`)
	sig := testsupport.SignStripePayload(t, payload, "whsec_test_secret", time.Now())

	for i := 0; i < 2; i++ {
		if status := testsupport.PostWebhook(t, app, payload, sig); status != 200 {
			t.Fatalf("webhook delivery %d: status = %d, want 200", i+1, status)
		}
	}

	if n := queryCount(t, `SELECT count(*) FROM stripe_webhook_events WHERE event_id = $1`, "evt_integration_dup"); n != 1 {
		t.Errorf("idempotency rows for replayed event = %d, want 1", n)
	}
}
