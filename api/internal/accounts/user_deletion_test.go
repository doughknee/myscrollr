package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/getsentry/sentry-go"
	"github.com/gofiber/fiber/v2"
)

// stubLogtoEmails answers GET /api/users/{sub} with the given verified emails
// (404 for anyone else), the way the export and purge read an account.
func stubLogtoEmails(t *testing.T, emails map[string]string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email, ok := emails[strings.TrimPrefix(r.URL.Path, "/api/users/")]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"primaryEmail": email, "isSuspended": false})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("LOGTO_ENDPOINT", srv.URL)
	m2mMu.Lock()
	m2mToken, m2mTokenExpiry = "test", time.Now().Add(time.Hour)
	m2mMu.Unlock()
	t.Cleanup(ResetM2MTokenCache)
}

// SCROLLR-453: the export carries the account's support cases (by sub or by
// verified email), the messages the user wrote or was sent, and its business
// leads; never staff material and never anyone else's rows.
func TestExportSupportHistoryIsAccountScoped(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	const sub = "export-support-owner"
	stubLogtoEmails(t, map[string]string{sub: "Export.Owner@example.com"})
	testsupport.MustExec(t, `TRUNCATE support_messages, support_drafts, support_cases, business_leads CASCADE`)
	for _, c := range []struct{ ticket, email, sub string }{
		{"E-SUB", "elsewhere@example.com", sub},
		{"E-MAIL", "export.owner@EXAMPLE.com", ""},
		{"E-OTHER", "someone@example.com", ""},
		{"E-LOOK", "export.owner@example.com.evil.test", ""},
		{"E-OTHERSUB", "export.owner@example.com", "export-support-other"},
	} {
		testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number,user_email,logto_sub,subject,summary) VALUES ($1,$2,NULLIF($3,''),'Subject '||$1,'AI summary')`, c.ticket, c.email, c.sub)
		testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number,kind,body_text) VALUES
			($1,'user','user text '||$1),($1,'sent','reply text '||$1),($1,'ai_draft','UNSENT DRAFT'),($1,'note','INTERNAL NOTE')`, c.ticket)
	}
	for _, e := range []string{"export.owner@example.com", "export.owner@example.com.evil.test"} {
		testsupport.MustExec(t, `INSERT INTO business_leads (name,email,company,use_case,message) VALUES ('N',$1,'C','U','lead '||$1)`, e)
	}
	resp, err := newDeletionTestApp(sub).Test(httptest.NewRequest("GET", "/users/me/export", nil))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("export status err=%v", err)
	}
	defer resp.Body.Close()
	var archive struct {
		Support struct {
			Cases []struct {
				Ticket   string `json:"ticket_number"`
				Messages []struct {
					From string `json:"from"`
					Body string `json:"body"`
				} `json:"messages"`
			} `json:"cases"`
			Leads []struct {
				Email string `json:"email"`
			} `json:"business_leads"`
		} `json:"support"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&archive); err != nil {
		t.Fatal(err)
	}
	got := map[string]int{}
	for _, c := range archive.Support.Cases {
		got[c.Ticket] = len(c.Messages)
		for _, m := range c.Messages {
			if strings.Contains(m.Body, "UNSENT") || strings.Contains(m.Body, "INTERNAL") {
				t.Fatalf("staff material exported: %q", m.Body)
			}
		}
	}
	if len(got) != 2 || got["E-SUB"] != 2 || got["E-MAIL"] != 2 {
		t.Fatalf("exported cases = %v, want E-SUB and E-MAIL with 2 messages each", got)
	}
	if len(archive.Support.Leads) != 1 || archive.Support.Leads[0].Email != "export.owner@example.com" {
		t.Fatalf("exported leads = %+v", archive.Support.Leads)
	}
}

func TestExportCustomFeedsIsAccountScoped(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	stubLogtoEmails(t, map[string]string{})
	const owner, other = "export-feeds-owner", "export-feeds-other"
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(), `DELETE FROM user_custom_feeds WHERE logto_sub IN ($1,$2)`, owner, other)
	})
	testsupport.MustExec(t, `INSERT INTO user_custom_feeds (logto_sub,url,name,category) VALUES
		($1,'https://example.com/shared','My shared feed','News'),
		($1,'https://example.com/saved-only','Saved without a widget','Custom'),
		($2,'https://example.com/shared','Someone else''s name','Other'),
		($2,'https://example.com/private','Someone else''s feed','Other')`, owner, other)
	for _, sub := range []string{owner, "export-feeds-empty"} {
		resp, err := newDeletionTestApp(sub).Test(httptest.NewRequest("GET", "/users/me/export", nil))
		if err != nil {
			t.Fatal(err)
		}
		var archive struct {
			Feeds []struct {
				URL       string    `json:"url"`
				Name      string    `json:"name"`
				Category  string    `json:"category"`
				CreatedAt time.Time `json:"created_at"`
			} `json:"custom_feeds"`
		}
		err = json.NewDecoder(resp.Body).Decode(&archive)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || archive.Feeds == nil {
			t.Fatalf("export status=%d err=%v feeds=%v", resp.StatusCode, err, archive.Feeds)
		}
		if sub != owner {
			if len(archive.Feeds) != 0 {
				t.Fatal("empty account received feeds")
			}
			continue
		}
		if len(archive.Feeds) != 2 {
			t.Fatalf("exported %d feeds; want 2", len(archive.Feeds))
		}
		for _, feed := range archive.Feeds {
			if feed.CreatedAt.IsZero() {
				t.Fatal("missing saved date")
			}
			switch feed.URL {
			case "https://example.com/shared":
				if feed.Name != "My shared feed" || feed.Category != "News" {
					t.Fatalf("wrong account metadata: %+v", feed)
				}
			case "https://example.com/saved-only":
				if feed.Name != "Saved without a widget" {
					t.Fatalf("wrong saved feed: %+v", feed)
				}
			default:
				t.Fatalf("unexpected feed: %+v", feed)
			}
		}
	}
}

// =============================================================================
// Subscription guard — deletionBlockedBySubscription
// =============================================================================

func TestDeletionBlockedBySubscription(t *testing.T) {
	tests := []struct {
		name         string
		stripeStatus string
		lifetime     bool
		want         bool
	}{
		// Live or still-billable subscriptions must be canceled first.
		{"active blocks", "active", false, true},
		{"trialing blocks", "trialing", false, true},
		{"canceling blocks", "canceling", false, true},
		{"past_due blocks", "past_due", false, true},

		// Ended subscriptions don't block.
		{"canceled does not block", "canceled", false, false},
		{"none does not block", "none", false, false},
		// No stripe_customers row at all (scan left zero values).
		{"no billing record does not block", "", false, false},

		// Lifetime members are never blocked — their Stripe row is
		// anonymized at purge time, not deleted.
		{"lifetime with active status does not block", "active", true, false},
		{"lifetime with trialing status does not block", "trialing", true, false},
		{"lifetime with past_due status does not block", "past_due", true, false},
		{"lifetime with no status does not block", "", true, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := deletionBlockedBySubscription(tc.stripeStatus, tc.lifetime)
			if got != tc.want {
				t.Errorf("deletionBlockedBySubscription(%q, %v) = %v, want %v",
					tc.stripeStatus, tc.lifetime, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Worker safety invariants
// =============================================================================

// TestGDPRPurgeGuards pins the relationship between the grace window and the
// purge worker's safety floor. If someone shrinks the grace window below the
// floor, pending requests would never become eligible; if someone removes
// the floor, a bad purge_at row could trigger an immediate mass-purge.
func TestGDPRPurgeGuards(t *testing.T) {
	if GDPRGraceWindow != 30*24*time.Hour {
		t.Errorf("GDPRGraceWindow = %v, want 30 days — this is a public product promise (account deletion undo period); update the website/legal copy if changing it", GDPRGraceWindow)
	}
	if GDPRMinGraceForPurge < 24*time.Hour {
		t.Errorf("GDPRMinGraceForPurge = %v, want >= 24h — it is the floor guard against an immediate mass-purge from a misconfigured purge_at", GDPRMinGraceForPurge)
	}
	if GDPRMinGraceForPurge >= GDPRGraceWindow {
		t.Errorf("GDPRMinGraceForPurge (%v) must be < GDPRGraceWindow (%v), otherwise requests are never eligible for purge", GDPRMinGraceForPurge, GDPRGraceWindow)
	}
	if GDPRPurgeInterval <= 0 || GDPRPurgeInterval > 24*time.Hour {
		t.Errorf("GDPRPurgeInterval = %v, want a sane scan cadence (0 < interval <= 24h)", GDPRPurgeInterval)
	}
}

// =============================================================================
// Handler request validation (no-DB paths)
// =============================================================================

// newDeletionTestApp mounts the deletion handlers behind a middleware that
// fakes the LogtoAuth locals, mirroring handlers_overview_test.go. An empty
// userID simulates an unauthenticated request.
func newDeletionTestApp(userID string) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		if userID != "" {
			c.Locals("user_id", userID)
		}
		return c.Next()
	})
	app.Post("/users/me/delete", HandleRequestAccountDeletion)
	app.Post("/users/me/delete/cancel", HandleCancelAccountDeletion)
	app.Get("/users/me/delete/status", HandleAccountDeletionStatus)
	app.Get("/users/me/export", HandleExportUserData)
	return app
}

func testRequest(t *testing.T, app *fiber.App, method, path, body string) int {
	t.Helper()
	var req = httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestDeletionEndpointsRequireAuth(t *testing.T) {
	app := newDeletionTestApp("")

	cases := []struct {
		method string
		path   string
	}{
		{"POST", "/users/me/delete"},
		{"POST", "/users/me/delete/cancel"},
		{"GET", "/users/me/delete/status"},
		{"GET", "/users/me/export"},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			status := testRequest(t, app, tc.method, tc.path, "")
			if status != fiber.StatusUnauthorized {
				t.Errorf("%s %s without auth: status = %d, want %d", tc.method, tc.path, status, fiber.StatusUnauthorized)
			}
		})
	}
}

func TestRequestAccountDeletionRejectsBadConfirmation(t *testing.T) {
	app := newDeletionTestApp("user_test_123")

	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"malformed json", `{"confirm":`},
		{"missing confirm field", `{}`},
		{"empty confirm", `{"confirm":""}`},
		{"wrong phrase", `{"confirm":"delete my account please"}`},
		// The phrase is case-sensitive and exact-match by design.
		{"lowercase phrase", `{"confirm":"delete my account"}`},
		{"phrase with whitespace", `{"confirm":" DELETE MY ACCOUNT "}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := testRequest(t, app, "POST", "/users/me/delete", tc.body)
			if status != fiber.StatusBadRequest {
				t.Errorf("confirm=%s: status = %d, want %d", tc.body, status, fiber.StatusBadRequest)
			}
		})
	}
}

// SCROLLR-484 B4-2: a purged request is terminal. A still-valid access token
// must not re-open it (and so cancel it and unlock purchases); a canceled one
// can still be re-opened.
func TestRequestAccountDeletionNeverReopensPurged(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	testsupport.MustExec(t, `TRUNCATE user_deletion_requests`)
	testsupport.MustExec(t, `INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status, purged_at)
		VALUES ('reopen-purged', now() - interval '31 days', now() - interval '1 day', 'purged', now()),
		       ('reopen-canceled', now() - interval '2 days', now() + interval '28 days', 'canceled', now())`)
	body := `{"confirm":"DELETE MY ACCOUNT"}`
	if got := testRequest(t, newDeletionTestApp("reopen-purged"), "POST", "/users/me/delete", body); got != fiber.StatusConflict {
		t.Errorf("purged request: status = %d, want 409", got)
	}
	st, _ := DeletionRequestStatus(context.Background(), "reopen-purged")
	if st != "purged" {
		t.Errorf("purged request became %q", st)
	}
	if got := testRequest(t, newDeletionTestApp("reopen-canceled"), "POST", "/users/me/delete", body); got != fiber.StatusOK {
		t.Errorf("canceled request: status = %d, want 200", got)
	}
}

type captureTransport struct{ events []*sentry.Event }

func (c *captureTransport) Configure(sentry.ClientOptions)        {}
func (c *captureTransport) SendEvent(e *sentry.Event)             { c.events = append(c.events, e) }
func (c *captureTransport) Flush(time.Duration) bool              { return true }
func (c *captureTransport) FlushWithContext(context.Context) bool { return true }
func (c *captureTransport) Close()                                {}

// SCROLLR-484 B4-1: a failed pass for a purge that has started reaches Sentry
// (no sub, no message text); one that has not started stays a log line.
func TestReportStuckPurgeOnlyAfterStart(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	tr := &captureTransport{}
	if err := sentry.Init(sentry.ClientOptions{Transport: tr}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sentry.CurrentHub().BindClient(nil) })
	testsupport.MustExec(t, `TRUNCATE user_deletion_requests`)
	testsupport.MustExec(t, `INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status, purge_started_at)
		VALUES ('stuck-started', now() - interval '31 days', now() - interval '1 day', 'pending', now()),
		       ('stuck-fresh', now() - interval '31 days', now() - interval '1 day', 'pending', NULL)`)
	perr := fmt.Errorf("logto delete stuck-started: %w", errors.New("boom"))
	reportStuckPurge(context.Background(), "stuck-fresh", perr)
	if len(tr.events) != 0 {
		t.Fatalf("not-started purge reported %d events", len(tr.events))
	}
	reportStuckPurge(context.Background(), "stuck-started", perr)
	if len(tr.events) != 1 {
		t.Fatalf("started purge reported %d events, want 1", len(tr.events))
	}
	if m := tr.events[0].Message; strings.Contains(m, "stuck-started") || strings.Contains(m, "boom") {
		t.Errorf("event message leaks detail: %q", m)
	}
}
