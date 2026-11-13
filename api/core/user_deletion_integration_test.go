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
		TRUNCATE TABLE support_messages, support_drafts, support_cases, support_ticket_threads,
		               osticket_message_ids, business_leads, product_analytics_enrollments, user_widgets, user_preferences, stripe_customers,
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
	emails     map[string]string // sub -> verified primary email; absent = 404
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
				delete(s.emails, parts[0]) // Logto forgets the account
			}
			s.mu.Unlock()
			if fail {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		// GET /api/users/{sub} — account read (verified primary email)
		case len(parts) == 1 && r.Method == http.MethodGet:
			s.mu.Lock()
			email, ok := s.emails[parts[0]]
			s.mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"id": parts[0], "primaryEmail": email, "isSuspended": false})
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
	testsupport.MustExec(t, `SELECT record_security_request($1,'source','GET','/users/me',200,$2)`, actor, sub)

	if err := accounts.PurgeUserAccount(context.Background(), sub); err != nil {
		t.Fatalf("purgeUserAccount: %v", err)
	}
	if n := queryCount(t, `SELECT count(*) FROM rss_security_events WHERE actor=$1`, actor); n != 0 {
		t.Fatalf("security activity survives purge: %d", n)
	}

	if n := queryCount(t, `SELECT count(*) FROM security_request_audit WHERE actor=$1`, actor); n != 0 {
		t.Fatal("request audit survives purge")
	}
	testsupport.MustExec(t, `SELECT record_security_request($1,'source','GET','/users/me',200,$2)`, actor, sub)
	if n := queryCount(t, `SELECT count(*) FROM security_request_audit WHERE actor=$1`, actor); n != 0 {
		t.Fatal("late request recreated purged audit")
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

// SCROLLR-453: the purge removes the account's support history, matched by sub
// or by the Logto-verified email, and touches nobody else's.
func TestIntegrationPurgeRemovesSupportData(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub, other = "support-purge-owner", "support-purge-other"
	stub.emails = map[string]string{sub: "Owner@Example.com"}
	seedPurgeableUser(t, sub, false)
	ctx := context.Background()
	testsupport.MustExec(t, `TRUNCATE support_messages, support_drafts, support_cases, support_ticket_threads, osticket_message_ids, business_leads CASCADE`)

	// Mine: one by sub (address differs), one by verified email (different case, no sub),
	// each with a message, a draft, a thread copy and a mail id.
	// Decoys: another address, a look-alike address, and the same address stamped with another account.
	for _, c := range []struct{ ticket, email, sub string }{
		{"T-SUB", "elsewhere@example.com", sub},
		{"T-MAIL", "owner@EXAMPLE.com", ""},
		{"T-OTHER", "someone@example.com", ""},
		{"T-LOOK", "owner@example.com.evil.test", ""},
		{"T-LOOK2", "xowner@example.com", ""},
		{"T-OTHERSUB", "owner@example.com", other},
	} {
		testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number,user_email,logto_sub,subject,summary,category,status,account_source,contact_source,discord_thread_id)
			VALUES ($1,$2,NULLIF($3,''),'Secret subject','Secret summary','bug','open','authenticated','form','thr-'||$1)`, c.ticket, c.email, c.sub)
		testsupport.MustExec(t, `INSERT INTO support_drafts (ticket_number,user_email,original_subject,draft_body_html,status) VALUES ($1,$2,'s','<p>draft</p>','pending')`, c.ticket, c.email)
		testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number,kind,body_text) VALUES ($1,'user','hello')`, c.ticket)
		testsupport.MustExec(t, `INSERT INTO support_ticket_threads (ticket_number,discord_thread_id,channel_id) VALUES ($1,'thr-'||$1,'chan')`, c.ticket)
		testsupport.MustExec(t, `INSERT INTO osticket_message_ids (ticket_number,message_id,recipient_email,direction) VALUES ($1,'<'||$1||'@x>',$2,'outbound_ai')`, c.ticket, c.email)
	}
	// A draft with no case row, from the verified address.
	testsupport.MustExec(t, `INSERT INTO support_drafts (ticket_number,user_email,original_subject,draft_body_html,status) VALUES ('T-ORPHAN','OWNER@example.com','s','x','skipped')`)
	for _, e := range []string{"owner@example.com", "OWNER@example.com.evil.test", "other@example.com"} {
		testsupport.MustExec(t, `INSERT INTO business_leads (name,email,company,use_case,message) VALUES ('N',$1,'C','U','M')`, e)
	}

	if err := accounts.PurgeUserAccount(ctx, sub); err != nil {
		t.Fatalf("purge: %v", err)
	}

	mine := `('T-SUB','T-MAIL','T-ORPHAN')`
	decoys := `('T-OTHER','T-LOOK','T-LOOK2','T-OTHERSUB')`
	for _, tbl := range []string{"support_messages", "support_drafts", "support_ticket_threads", "osticket_message_ids"} {
		if n := queryCount(t, `SELECT count(*) FROM `+tbl+` WHERE ticket_number IN `+mine); n != 0 {
			t.Errorf("%s: %d of the account's rows survive", tbl, n)
		}
		if n := queryCount(t, `SELECT count(*) FROM `+tbl+` WHERE ticket_number IN `+decoys); n != 4 {
			t.Errorf("%s: decoy rows = %d, want 4", tbl, n)
		}
	}
	// Cases survive as anonymous counters, dismissed, with nothing identifying.
	if n := queryCount(t, `SELECT count(*) FROM support_cases WHERE ticket_number IN ('T-SUB','T-MAIL')
		AND user_email IS NULL AND user_name IS NULL AND logto_sub IS NULL AND subject='' AND summary IS NULL
		AND discord_thread_id IS NULL AND account_source IS NULL AND contact_source IS NULL
		AND console_status='dismissed' AND category='bug'`); n != 2 {
		t.Errorf("anonymised cases = %d, want 2", n)
	}
	if n := queryCount(t, `SELECT count(*) FROM support_cases WHERE ticket_number IN `+decoys+`
		AND subject='Secret subject' AND summary='Secret summary' AND console_status='' AND user_email IS NOT NULL`); n != 4 {
		t.Errorf("decoy cases changed: %d unchanged, want 4", n)
	}
	if n := queryCount(t, `SELECT count(*) FROM support_cases WHERE ticket_number='T-OTHERSUB' AND logto_sub=$1`, other); n != 1 {
		t.Error("another account's case lost its sub")
	}
	if n := queryCount(t, `SELECT count(*) FROM business_leads WHERE lower(email)='owner@example.com'`); n != 0 {
		t.Error("account's business lead survives")
	}
	if n := queryCount(t, `SELECT count(*) FROM business_leads`); n != 2 {
		t.Errorf("decoy leads = %d, want 2", n)
	}
}

// SCROLLR-457: the verified email survives a purge that fails after Logto
// forgot the account, so the retry still removes the email-matched case; it
// is cleared once the purge commits, and the case is stamped purged_at.
func TestIntegrationPurgeKeepsEmailAcrossFailedPass(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "purge-email-retry"
	stub.emails = map[string]string{sub: "Retry@Example.com"}
	seedPurgeableUser(t, sub, false)
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number,user_email,subject,category,status)
		VALUES ('T-RETRY','retry@example.com','Secret','bug','open')`)
	// Make the database transaction fail after the Logto delete.
	testsupport.MustExec(t, `CREATE OR REPLACE FUNCTION fail_pref_delete() RETURNS trigger AS $$
		BEGIN RAISE EXCEPTION 'injected purge failure'; END $$ LANGUAGE plpgsql`)
	testsupport.MustExec(t, `CREATE TRIGGER fail_pref_delete BEFORE DELETE ON user_preferences
		FOR EACH ROW EXECUTE FUNCTION fail_pref_delete()`)
	dropTrigger := func() {
		_, _ = platform.DBPool.Exec(context.Background(), `DROP TRIGGER IF EXISTS fail_pref_delete ON user_preferences`)
	}
	t.Cleanup(dropTrigger)

	ctx := context.Background()
	if err := accounts.PurgeUserAccount(ctx, sub); err == nil {
		t.Fatal("first pass should fail")
	}
	if len(stub.deletedSubs()) != 1 {
		t.Fatal("first pass should have deleted the Logto user")
	}
	if n := queryCount(t, `SELECT count(*) FROM user_deletion_requests WHERE logto_sub=$1 AND purge_email='Retry@Example.com'`, sub); n != 1 {
		t.Fatal("email was not kept with the pending deletion")
	}

	dropTrigger()
	if err := accounts.PurgeUserAccount(ctx, sub); err != nil {
		t.Fatalf("second pass: %v", err)
	}
	if n := queryCount(t, `SELECT count(*) FROM support_cases WHERE ticket_number='T-RETRY'
		AND user_email IS NULL AND subject='' AND purged_at IS NOT NULL`); n != 1 {
		t.Error("email-matched case survived the retry")
	}
	if n := queryCount(t, `SELECT count(*) FROM user_deletion_requests WHERE logto_sub=$1 AND status='purged' AND purge_email IS NULL`, sub); n != 1 {
		t.Error("email outlived the purge")
	}
}

// SCROLLR-465: an account that subscribed during its grace period has every
// live subscription canceled at Stripe before its billing row goes, and a
// Stripe failure stops the purge so the next pass retries.
func TestIntegrationPurgeCancelsGracePeriodSubscription(t *testing.T) {
	for _, stripeDown := range []bool{false, true} {
		t.Run(map[bool]string{false: "stripe up", true: "stripe down"}[stripeDown], func(t *testing.T) {
			setupIntegrationDB(t)
			logto := newLogtoStub(t)
			const sub = "user_purge_grace_sub"
			seedPurgeableUser(t, sub, false)
			testsupport.MustExec(t, `UPDATE stripe_customers SET status = 'active', stripe_subscription_id = 'sub_grace' WHERE logto_sub = $1`, sub)

			var mu sync.Mutex
			var canceled []string
			stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case stripeDown:
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"down"}}`))
				case r.Method == http.MethodGet && r.URL.Path == "/v1/subscriptions":
					if r.URL.Query().Get("customer") != "cus_"+sub || r.URL.Query().Get("status") != "all" {
						t.Errorf("listed subscriptions with %s, want customer=cus_%s status=all", r.URL.RawQuery, sub)
					}
					_, _ = w.Write([]byte(`{"object":"list","url":"/v1/subscriptions","has_more":false,"data":[
						{"id":"sub_grace","object":"subscription","status":"active"},
						{"id":"sub_second","object":"subscription","status":"past_due"},
						{"id":"sub_old","object":"subscription","status":"canceled"}]}`))
				case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
					if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, sub); n != 1 {
						t.Errorf("billing row gone before the subscription was canceled")
					}
					if len(logto.deletedSubs()) != 0 {
						t.Errorf("Logto user deleted before the subscription was canceled")
					}
					id := strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/")
					mu.Lock()
					canceled = append(canceled, id)
					mu.Unlock()
					_, _ = w.Write([]byte(`{"id":"` + id + `","object":"subscription","status":"canceled"}`))
				default:
					t.Errorf("unexpected Stripe call %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			})

			err := accounts.PurgeUserAccount(context.Background(), sub)
			if stripeDown {
				if err == nil {
					t.Fatal("purge succeeded although Stripe could not be reached")
				}
				if len(logto.deletedSubs()) != 0 {
					t.Error("Logto user deleted although the subscription could not be canceled")
				}
				if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, sub); n != 1 {
					t.Error("billing row removed although the subscription could not be canceled")
				}
				if n := queryCount(t, `SELECT count(*) FROM user_deletion_requests WHERE logto_sub = $1 AND status = 'pending'`, sub); n != 1 {
					t.Error("deletion request no longer pending, so the next pass would not retry")
				}
				return
			}
			if err != nil {
				t.Fatalf("purge: %v", err)
			}
			if strings.Join(canceled, ",") != "sub_grace,sub_second" {
				t.Errorf("canceled at Stripe = %v, want [sub_grace sub_second]", canceled)
			}
			if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, sub); n != 0 {
				t.Error("billing row survives the purge")
			}
		})
	}
}
