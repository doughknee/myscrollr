package support

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/admin"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// ===== The grouping rule, with no database and no clock ============

func TestQueueGroupSaysWhoIsWaitingAndWhy(t *testing.T) {
	cases := []struct {
		name      string
		state     queueState
		wantGroup string
		wantSaid  string
	}{
		{
			name:      "a closed ticket is handled",
			state:     queueState{CaseStatus: "closed", HasDraft: true, DraftStatus: "pending"},
			wantGroup: queueHandled,
			wantSaid:  "closed",
		},
		{
			// The failure REL-263 exists for: triage produced nothing, so no
			// button and no timer will ever answer this person.
			name:      "a case with no draft at all needs a person",
			state:     queueState{CaseStatus: "open", HasDraft: false},
			wantGroup: queueNeedsYou,
			wantSaid:  "No draft was ever written",
		},
		{
			name:      "an escalation needs a person and says no timer is running",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "pending", Disposition: dispositionEscalate},
			wantGroup: queueNeedsYou,
			wantSaid:  "No timer is running",
		},
		{
			name:      "an armed hold says doing nothing sends it",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "pending", Disposition: dispositionAutoSend, AutoSendArmed: true},
			wantGroup: queueNeedsYou,
			wantSaid:  "Doing nothing sends it",
		},
		{
			// Same row, switch off. It must NOT still claim doing nothing
			// sends it, because nothing will.
			name:      "the same hold with sending off waits for a person",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "pending", Disposition: dispositionAutoSend},
			wantGroup: queueNeedsYou,
			wantSaid:  "waiting for a person",
		},
		{
			name:      "an ask is waiting on the user",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "asked"},
			wantGroup: queueWaiting,
			wantSaid:  "waiting on the answer",
		},
		{
			name:      "a sent reply is waiting on the user",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "sent"},
			wantGroup: queueWaiting,
			wantSaid:  "We replied",
		},
		{
			name:      "a skipped draft is handled",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "skipped"},
			wantGroup: queueHandled,
			wantSaid:  "no reply",
		},
		{
			name:      "a failed send needs a person",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "failed"},
			wantGroup: queueNeedsYou,
			wantSaid:  "send failed",
		},
		{
			// A status this console does not know must surface, never vanish
			// into "handled" where nobody looks.
			name:      "an unrecognised status is shown rather than filed away",
			state:     queueState{CaseStatus: "open", HasDraft: true, DraftStatus: "quantum"},
			wantGroup: queueNeedsYou,
			wantSaid:  "not one this console recognises",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			group, reason := tc.state.group()
			if group != tc.wantGroup {
				t.Errorf("group = %q, want %q (reason: %s)", group, tc.wantGroup, reason)
			}
			if !strings.Contains(reason, tc.wantSaid) {
				t.Errorf("reason %q does not contain %q", reason, tc.wantSaid)
			}
		})
	}
}

// The countdown is the one number on this page that can be a lie. hold_until
// keeps ticking whether or not anything is going to collect it, so a page that
// renders the remaining seconds while SUPPORT_AUTOSEND is off tells an admin a
// reply is about to go out when none is.
func TestHoldCountdownRefusesToRenderWhenNothingWillSend(t *testing.T) {
	now := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	until := now.Add(12 * time.Minute)

	armed := buildHold(&until, "pending", dispositionAutoSend, true, now)
	if !armed.Remaining.Available || armed.Remaining.Value != 720 {
		t.Fatalf("armed hold: got %+v, want 720 available seconds", armed.Remaining)
	}
	if !strings.Contains(armed.Note, "Doing nothing sends it") {
		t.Errorf("armed hold must say doing nothing sends it, got %q", armed.Note)
	}

	off := buildHold(&until, "pending", dispositionAutoSend, false, now)
	if off.Remaining.Available {
		t.Fatal("a hold with sending off must not render a countdown")
	}
	if off.Remaining.Value != 0 || off.Remaining.Note == "" {
		t.Errorf("an unavailable countdown needs a sentence and no number, got %+v", off.Remaining)
	}

	expired := buildHold(&until, "pending", dispositionAutoClose, true, until.Add(time.Minute))
	if !expired.Expired || expired.Remaining.Value != 0 {
		t.Errorf("an expired hold should read as zero and expired, got %+v", expired)
	}
	if expired.Verb != "Sending and closing the ticket" {
		t.Errorf("auto_close must say it closes the ticket, got %q", expired.Verb)
	}

	if buildHold(nil, "pending", dispositionEscalate, true, now) != nil {
		t.Error("an escalation has no hold and must render none")
	}

	// hold_until is never cleared when a draft is sent, so the row that went
	// out this morning still carries this morning's deadline. Reading it
	// without checking the status put a live countdown on an already-sent
	// reply in the queue — found against real production rows, ticket 143026.
	for _, decided := range []string{"sent", "asked", "skipped", "approved", "edited", "failed"} {
		if h := buildHold(&until, decided, dispositionAutoSend, true, now); h != nil {
			t.Errorf("a %s draft must not report a hold, got %+v", decided, h)
		}
	}
}

// ===== The endpoints ===============================================

// adminSupportApp wires the REAL staff gate in front of the real handlers.
// Testing the handlers without it would prove nothing about the thing this
// ticket is careful about: these two routes carry every user's email, ticket
// history and diagnostics.
func adminSupportApp(sub string, roles ...string) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", sub)
		c.Locals("user_roles", roles)
		return c.Next()
	})
	app.Get("/admin/support/queue", admin.RequireAdmin, HandleAdminQueue)
	app.Get("/admin/support/case/:ticket", admin.RequireAdmin, HandleAdminCase)
	return app
}

func getJSON(t *testing.T, app *fiber.App, path string) (int, string) {
	t.Helper()
	resp, err := app.Test(httptest.NewRequest("GET", path, nil), 30000)
	if err != nil {
		t.Fatalf("app.Test %s: %v", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// seedAdmin pins the one admin row to a sub, so RequireAdmin takes its
// pinned-sub path and never reaches for Logto.
func seedAdmin(t *testing.T, sub string) {
	t.Helper()
	testsupport.MustExec(t, `DELETE FROM admin_users`)
	testsupport.MustExec(t,
		`INSERT INTO admin_users (email, logto_sub, added_by) VALUES ('staff@example.com', $1, 'test')`, sub)
}

// A signed-in account that is not on the admin list gets 403 from both
// endpoints, and the handlers do not run.
//
// The single admin row is already PINNED to another sub, so this holds without
// depending on what Logto answers: the bootstrap UPDATE requires
// `logto_sub IS NULL` and matches nothing.
func TestAdminSupportEndpointsRejectASignedInNonAdmin(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	testsupport.MustExec(t,
		`INSERT INTO support_cases (ticket_number, subject, status) VALUES ('900001', 'hello', 'open')`)

	// A product tier is not staff. super_user exists on real accounts.
	app := adminSupportApp("sub-someone-else", "super_user", "uplink_ultimate")

	for _, path := range []string{"/admin/support/queue", "/admin/support/case/900001"} {
		status, body := getJSON(t, app, path)
		if status != fiber.StatusForbidden {
			t.Errorf("%s: got %d, want 403 (body: %s)", path, status, body)
		}
		if strings.Contains(body, "hello") {
			t.Errorf("%s leaked case content to a non-admin: %s", path, body)
		}
	}
}

// The queue puts every case in exactly one group, counts over the whole queue
// rather than the filter, and refuses to invent a wait for a case with no user
// message on record.
func TestAdminQueueGroupsEveryCaseAndCountsThemAll(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "off")

	// One that needs a person, one waiting on the user, one handled.
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, status, updated_at) VALUES
		('900010', 'escalated one', 'open',   now()),
		('900011', 'asked one',     'open',   now() - interval '1 hour'),
		('900012', 'closed one',    'closed', now() - interval '2 hours')`)
	testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at)
		VALUES ('900010', 'user', 'it is broken', now() - interval '5 hours')`)
	testsupport.MustExec(t, `INSERT INTO support_drafts
		(ticket_number, user_email, original_subject, draft_body_html, status, disposition, disposition_reason)
		VALUES
		('900010', 'a@example.com', 'escalated one', '<p>hi</p>', 'pending', 'escalate', 'money (refund)'),
		('900011', 'b@example.com', 'asked one',     '<p>which OS?</p>', 'asked', 'auto_ask', 'asking the user'),
		('900012', 'c@example.com', 'closed one',    '<p>done</p>', 'sent', 'auto_send', 'grounded')`)

	app := adminSupportApp("sub-staff")

	status, body := getJSON(t, app, "/admin/support/queue")
	if status != fiber.StatusOK {
		t.Fatalf("queue: got %d, want 200 (body: %s)", status, body)
	}
	var res AdminQueueResponse
	if err := json.Unmarshal([]byte(body), &res); err != nil {
		t.Fatalf("decode queue: %v (body: %s)", err, body)
	}

	want := map[string]string{"900010": queueNeedsYou, "900011": queueWaiting, "900012": queueHandled}
	got := map[string]string{}
	for _, r := range res.Rows {
		got[r.TicketNumber] = r.Group
		if r.GroupReason == "" {
			t.Errorf("%s is in %q with no reason given", r.TicketNumber, r.Group)
		}
	}
	for ticket, group := range want {
		if got[ticket] != group {
			t.Errorf("%s grouped as %q, want %q", ticket, got[ticket], group)
		}
	}
	for _, group := range []string{queueNeedsYou, queueWaiting, queueHandled} {
		if res.Counts[group] != 1 {
			t.Errorf("counts[%s] = %d, want 1 (%v)", group, res.Counts[group], res.Counts)
		}
	}
	if res.AutoSend.Armed {
		t.Error("SUPPORT_AUTOSEND=off must report the pipeline as not armed")
	}

	// The escalation reason has to survive to the row: an escalation nobody
	// can read is the Discord queue again.
	for _, r := range res.Rows {
		if r.TicketNumber != "900010" {
			continue
		}
		if r.DispositionReason != "money (refund)" {
			t.Errorf("disposition_reason = %q, want the rule that fired", r.DispositionReason)
		}
		if !r.WaitingHours.Available || r.WaitingHours.Value < 4 {
			t.Errorf("waiting_hours = %+v, want a measured wait of about five hours", r.WaitingHours)
		}
	}
	// 900011 has no user message; the wait is unknown, not zero.
	for _, r := range res.Rows {
		if r.TicketNumber == "900011" && r.WaitingHours.Available {
			t.Errorf("a case with no user message must not report a wait: %+v", r.WaitingHours)
		}
	}

	// Filtering narrows the rows and leaves the counts alone.
	_, body = getJSON(t, app, "/admin/support/queue?state=needs_you")
	if err := json.Unmarshal([]byte(body), &res); err != nil {
		t.Fatalf("decode filtered queue: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0].TicketNumber != "900010" {
		t.Errorf("state=needs_you returned %d rows, want just 900010", len(res.Rows))
	}
	if res.Counts[queueHandled] != 1 {
		t.Errorf("counts must cover the whole queue, not the filter: %v", res.Counts)
	}
}

// The case view is the point of the ticket: everything the pipeline recorded
// has to be reachable, or a person still has to open Discord.
func TestAdminCaseShowsTheWholePipeline(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	// No Linear key and a stubbed release list, so nothing in this test
	// reaches the network.
	t.Setenv("LINEAR_API_KEY", "")
	releases := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[]`))
	}))
	defer releases.Close()
	prevURL := knownIssuesReleasesURL
	knownIssuesReleasesURL = releases.URL + "?per_page=%d"
	defer func() { knownIssuesReleasesURL = prevURL }()

	testsupport.MustExec(t, `INSERT INTO support_cases
		(ticket_number, user_email, subject, category, priority, status, summary, app_version, os, tier_at_open)
		VALUES ('900020', 'user@example.com', 'ticker will not scroll', 'bug', 'high', 'open',
		        'the bar is frozen', '1.5.0', 'Windows 11', 'free')`)
	testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at)
		VALUES ('900020', 'user', 'my ticker stopped moving', now() - interval '3 days')`)
	testsupport.MustExec(t, `INSERT INTO support_drafts
		(ticket_number, user_email, original_subject, draft_body_html, status,
		 ai_summary, ai_category, ai_priority, ai_confidence, sentiment, drafter_category,
		 grounded_in, unknowns, ask_user_for, internal_note, needs_info, should_close,
		 disposition, disposition_reason, hold_until)
		VALUES ('900020', 'user@example.com', 'ticker will not scroll',
		        '<p>Sorry about that. Which build are you on?</p>', 'pending',
		        'ticker frozen', 'bug', 'high', 'medium', 'frustrated', 'feature',
		        'KB: ticker rotation', 'whether they are on 1.6.1', 'their Scrollr version',
		        'looks like REL-234', true, false,
		        'escalate', 'classification and drafting disagreed (bug vs feature)',
		        now() + interval '30 minutes')`)

	app := adminSupportApp("sub-staff")
	status, body := getJSON(t, app, "/admin/support/case/900020")
	if status != fiber.StatusOK {
		t.Fatalf("case: got %d, want 200 (body: %s)", status, body)
	}
	var d AdminCaseDetail
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatalf("decode case: %v (body: %s)", err, body)
	}

	if d.Draft == nil {
		t.Fatalf("no draft on the case (note: %s)", d.DraftNote)
	}
	// Every pipeline field, by name. A field silently dropped from the
	// response is invisible in exactly the way this page exists to fix.
	for name, got := range map[string]string{
		"grounded_in":        d.Draft.GroundedIn,
		"unknowns":           d.Draft.Unknowns,
		"ask_user_for":       d.Draft.AskUserFor,
		"internal_note":      d.Draft.InternalNote,
		"disposition":        d.Draft.Disposition,
		"disposition_reason": d.Draft.DispositionReason,
		"sentiment":          d.Draft.Sentiment,
		"drafter_category":   d.Draft.DrafterCategory,
		"confidence":         d.Draft.Confidence,
		"body":               d.Draft.Body,
	} {
		if strings.TrimSpace(got) == "" {
			t.Errorf("draft.%s is empty; it was written to the row", name)
		}
	}
	if !d.Draft.NeedsInfo {
		t.Error("needs_info was true on the row and false in the response")
	}
	if !strings.Contains(d.Draft.DispositionReason, "disagreed") {
		t.Errorf("the escalation reason must be readable: %q", d.Draft.DispositionReason)
	}
	// The draft is stored as HTML and served as text — what Discord shows,
	// and no stranger's markup rendered in a staff page.
	if strings.Contains(d.Draft.Body, "<p>") {
		t.Errorf("draft body should be plain text, got %q", d.Draft.Body)
	}

	if len(d.Messages) != 1 || d.Messages[0].Kind != "user" {
		t.Fatalf("expected the user's message in the conversation, got %+v", d.Messages)
	}
	if d.Hold == nil || d.Hold.Until.IsZero() {
		t.Fatal("a pending draft with hold_until must report its deadline")
	}
	if d.Group != queueNeedsYou {
		t.Errorf("an escalated pending draft belongs in %q, got %q", queueNeedsYou, d.Group)
	}
	if d.Context.Tier != "free" || d.Context.OS != "Windows 11" || d.Context.AppVersion != "1.5.0" {
		t.Errorf("the user context the model was given is wrong: %+v", d.Context)
	}
	if d.StaleDays < 3 {
		t.Errorf("stale_days = %d, want at least 3", d.StaleDays)
	}
	// No issue is linked, so the console has to say that rather than leaving
	// "no fix on record" to be read as "we checked and there isn't one".
	if d.Fix.Proven || !strings.Contains(d.Fix.Reason, "No Linear issue is linked") {
		t.Errorf("unlinked case fix reason = %q", d.Fix.Reason)
	}
	if d.EvidenceNote == "" {
		t.Error("the similar-cases and known-issues blocks are recomputed and must say so")
	}
}

// A ticket the case DB has never seen is a sentence, not a 500.
func TestAdminCaseSaysWhenThereIsNoSuchTicket(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")

	status, body := getJSON(t, adminSupportApp("sub-staff"), "/admin/support/case/404404")
	if status != fiber.StatusNotFound {
		t.Fatalf("got %d, want 404 (body: %s)", status, body)
	}
	if !strings.Contains(body, "No case with that ticket number") {
		t.Errorf("the 404 should explain itself, got %s", body)
	}
}

// explainFix has to distinguish the three ways a fix can fail to be proven.
// "No fix on record" alone is what let ten backlog drafts want to tell people
// to update.
func TestExplainFixSaysWhichCheckFailed(t *testing.T) {
	if f := explainFix(context.Background(), ""); f.Proven || !strings.Contains(f.Reason, "No Linear issue is linked") {
		t.Errorf("unlinked: %+v", f)
	}
	// With no LINEAR_API_KEY the lookup cannot answer, and "we could not find
	// out" must not read as "there is no fix".
	t.Setenv("LINEAR_API_KEY", "")
	// An unreachable Linear is never cached as "no fix" (see
	// provenFixForIssue), so this holds with or without Redis. The key is one
	// nothing else in the suite touches.
	f := explainFix(context.Background(), "REL-000000")
	if f.Proven {
		t.Error("nothing may be proven when Linear cannot be reached")
	}
	if !strings.Contains(f.Reason, "could not be reached") {
		t.Errorf("reason = %q, want it to say the lookup failed rather than that no fix exists", f.Reason)
	}
}
