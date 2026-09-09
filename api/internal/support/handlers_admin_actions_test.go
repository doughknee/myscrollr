package support

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/admin"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// The write half (REL-261)
// =============================================================================

// ===== One verb, two surfaces =====================================

// TestEverySurfaceCallsTheSameVerb is the test this ticket is really about.
//
// The console and the Discord buttons will coexist until REL-262 retires the
// buttons, and the failure to prevent is the boring one: a rule tightened in
// one surface and forgotten in the other, so the same case reaches two
// different outcomes depending on where somebody clicked. The only structural
// guarantee against that is for there to be exactly one implementation, and
// this reads the package's own source to prove there is.
//
// For each verb it asserts the HTTP handler and the Discord handler both name
// the same Action* function, and — the half that actually bites — that neither
// surface reaches past it to the primitives underneath. A copy-pasted flow
// would show up as markDraftDecided or sendDraftReply appearing in a handler
// file, which is exactly what this refuses.
func TestEverySurfaceCallsTheSameVerb(t *testing.T) {
	const (
		httpSurface    = "handlers_admin_actions.go"
		discordSurface = "handlers_discord_interactions.go"
		linkSurface    = "link_backfill.go"
	)
	calls := map[string]map[string]bool{}
	for _, f := range []string{httpSurface, discordSurface, linkSurface} {
		calls[f] = callsIn(t, f)
	}

	// The verb, and the two files that must both reach it through one name.
	for _, v := range []struct{ verb, discordFile string }{
		{"ActionSend", discordSurface},
		{"ActionEditAndSend", discordSurface},
		{"ActionAsk", discordSurface},
		{"ActionSkip", discordSurface},
		{"ActionHold", discordSurface},
		{"ActionFileAsBug", discordSurface},
		{"ActionLinkIssue", linkSurface},
		{"ActionSetPaused", discordSurface},
	} {
		if !calls[httpSurface][v.verb] {
			t.Errorf("%s does not call %s — the console has its own copy of that flow", httpSurface, v.verb)
		}
		if !calls[v.discordFile][v.verb] {
			t.Errorf("%s does not call %s — Discord has its own copy of that flow", v.discordFile, v.verb)
		}
	}

	// The primitives a re-implementation would have to reach for. A handler
	// that calls one of these is a handler doing the verb itself.
	for _, file := range []string{httpSurface, discordSurface, linkSurface} {
		// policySet is deliberately absent: /resume <category> writes a
		// DIFFERENT policy key to un-demote a category, and that stays a
		// Discord command on purpose — it is a judgement about a whole class
		// of tickets, not a button next to one of them.
		for _, primitive := range []string{
			"markDraftDecided", "sendDraftReply", "holdDraft",
			"setCaseLinearIssueKey", "linearCreateIssue",
		} {
			if calls[file][primitive] {
				t.Errorf("%s calls %s directly; that belongs behind an Action* verb so both surfaces get it", file, primitive)
			}
		}
	}
}

// callsIn returns every function name called anywhere in one file of this
// package. Method calls come back by their selector (`x.Foo` -> "Foo"), which
// is fine: nothing here shares a name with a method.
func callsIn(t *testing.T, filename string) map[string]bool {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	out := map[string]bool{}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fn := call.Fun.(type) {
		case *ast.Ident:
			out[fn.Name] = true
		case *ast.SelectorExpr:
			out[fn.Sel.Name] = true
		}
		return true
	})
	return out
}

// ===== The gate ===================================================

// adminActionApp wires the real staff gate in front of the real write
// handlers, so a 403 here is the gate refusing rather than a handler being
// polite.
func adminActionApp(sub string, roles ...string) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", sub)
		c.Locals("user_roles", roles)
		return c.Next()
	})
	registerAdminActionRoutes(app, admin.RequireAdmin)
	return app
}

// anonymousActionApp is the same routes behind the real LogtoAuth, with no
// token anywhere. Nothing under /admin may answer an unauthenticated caller.
func anonymousActionApp() *fiber.App {
	app := fiber.New()
	registerAdminActionRoutes(app, platform.LogtoAuth, admin.RequireAdmin)
	return app
}

// registerAdminActionRoutes mirrors core/server.go. Kept in one place so the
// two deny tests and every verb test walk the same route table.
func registerAdminActionRoutes(app *fiber.App, gate ...fiber.Handler) {
	post := func(path string, h fiber.Handler) {
		app.Post(path, append(append([]fiber.Handler{}, gate...), h)...)
	}
	post("/admin/support/draft/:draft/send", HandleAdminSend)
	post("/admin/support/draft/:draft/edit", HandleAdminEditAndSend)
	post("/admin/support/draft/:draft/ask", HandleAdminAsk)
	post("/admin/support/draft/:draft/skip", HandleAdminSkip)
	post("/admin/support/draft/:draft/hold", HandleAdminHold)
	post("/admin/support/draft/:draft/bug", HandleAdminFileAsBug)
	post("/admin/support/case/:ticket/link", HandleAdminLinkIssue)
	post("/admin/support/autosend", HandleAdminAutoSend)
	app.Delete("/admin/support/case/:ticket/link",
		append(append([]fiber.Handler{}, gate...), HandleAdminUnlinkIssue)...)
}

// everyWriteRoute is the list both deny tests walk, so a route added later
// without a gate cannot slip through by not being in a test.
func everyWriteRoute(draftID string) []struct{ method, path string } {
	return []struct{ method, path string }{
		{"POST", "/admin/support/draft/" + draftID + "/send"},
		{"POST", "/admin/support/draft/" + draftID + "/edit"},
		{"POST", "/admin/support/draft/" + draftID + "/ask"},
		{"POST", "/admin/support/draft/" + draftID + "/skip"},
		{"POST", "/admin/support/draft/" + draftID + "/hold"},
		{"POST", "/admin/support/draft/" + draftID + "/bug"},
		{"POST", "/admin/support/case/900100/link"},
		{"DELETE", "/admin/support/case/900100/link"},
		{"POST", "/admin/support/autosend"},
	}
}

func postJSON(t *testing.T, app *fiber.App, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 30000)
	if err != nil {
		t.Fatalf("app.Test %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// A signed-in account that is not on the admin list gets 403 from every write
// route, and no draft moves.
func TestAdminActionEndpointsRejectASignedInNonAdmin(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	draft := seedPendingDraft(t, "900100", "Ticker froze")

	// A product tier is not staff. super_user exists on real accounts.
	app := adminActionApp("sub-someone-else", "super_user", "uplink_ultimate")
	for _, r := range everyWriteRoute(itoa(draft.ID)) {
		status, body := postJSON(t, app, r.method, r.path, `{"body":"x","question":"x","issue_key":"REL-1","paused":true}`)
		if status != fiber.StatusForbidden {
			t.Errorf("%s %s: got %d, want 403 (body: %s)", r.method, r.path, status, body)
		}
	}
	if got := draftStatus(t, draft.ID); got != "pending" {
		t.Errorf("a refused request still moved the draft: status=%s", got)
	}
}

// With no credential at all, every write route is 401 before RequireAdmin is
// even consulted.
func TestAdminActionEndpointsRejectAnonymousCallers(t *testing.T) {
	app := anonymousActionApp()
	for _, r := range everyWriteRoute("1") {
		req := httptest.NewRequest(r.method, r.path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req, 10000)
		if err != nil {
			t.Fatalf("app.Test: %v", err)
		}
		if resp.StatusCode != fiber.StatusUnauthorized {
			t.Errorf("%s %s: got %d, want 401", r.method, r.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

// ===== The verbs, end to end ======================================

// seedPendingDraft puts one case and one pending draft in the database, with
// the user's own message on the timeline so the editor has something to show.
func seedPendingDraft(t *testing.T, ticket, subject string) *SupportDraft {
	t.Helper()
	ctx := context.Background()
	recordTicketOpened(ctx, SupportCase{
		TicketNumber: ticket, UserEmail: "u@example.com", LogtoSub: "sub-u",
		Subject: subject, Category: "bug",
	}, "<p>The ticker stopped scrolling after sleep</p>")
	draft, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: ticket, UserEmail: "u@example.com", OriginalSubject: subject,
		UserMessageHTML: "<p>The ticker stopped scrolling after sleep</p>",
		DraftBodyHTML:   "<p>Try restarting the app.</p>",
		AISummary:       "ticker freezes after sleep", AICategory: "bug", AIPriority: "high",
		AskUserFor: "which version you are on",
	})
	if err != nil {
		t.Fatal(err)
	}
	return draft
}

func draftStatus(t *testing.T, id int64) string {
	t.Helper()
	var s string
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT status FROM support_drafts WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// decodeCase parses a write response as the case it must answer with. Every
// verb returns the whole case so the page renders what happened rather than
// guessing at it, and this is where that promise is checked.
func decodeCase(t *testing.T, body string) AdminCaseDetail {
	t.Helper()
	var d AdminCaseDetail
	if err := json.Unmarshal([]byte(body), &d); err != nil {
		t.Fatalf("response is not a case: %v (body: %s)", err, truncate(body, 300))
	}
	if d.TicketNumber == "" {
		t.Fatalf("response carries no ticket number: %s", truncate(body, 300))
	}
	return d
}

// Send reaches the user, records the send, and hands back the case.
func TestAdminSendSendsTheReplyAndAnswersWithTheCase(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	srv := httptest.NewServer((&fakeOSTicket{}).handler(t))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)

	draft := seedPendingDraft(t, "900100", "Ticker froze")
	app := adminActionApp("sub-staff")

	status, body := postJSON(t, app, "POST", "/admin/support/draft/"+itoa(draft.ID)+"/send", "{}")
	if status != fiber.StatusOK {
		t.Fatalf("send: got %d (%s)", status, body)
	}
	got := decodeCase(t, body)
	if got.Draft == nil || got.Draft.SentAt == nil {
		t.Fatalf("the case came back without a sent_at, so the page cannot tell the reply went out: %+v", got.Draft)
	}
	// REL-256: sent_at is the fact a reply reached a user, and the console
	// path has to write it exactly like every other send path.
	if got.Draft.Status != "sent" {
		t.Errorf("draft status = %q, want sent", got.Draft.Status)
	}
	// The case history has to be identical whichever surface was used, which
	// means the send is on the timeline as a sent message.
	if n := countMessages(t, "900100", "sent"); n != 1 {
		t.Errorf("sent messages on the case = %d, want 1", n)
	}

	// A second click sends nothing. The claim is conditional on the row still
	// being pending, and the page is told which of the two happened.
	status, body = postJSON(t, app, "POST", "/admin/support/draft/"+itoa(draft.ID)+"/send", "{}")
	if status != fiber.StatusConflict {
		t.Errorf("second send: got %d (%s), want 409", status, body)
	}
	if n := countMessages(t, "900100", "sent"); n != 1 {
		t.Errorf("a second click sent a second reply: %d on the case", n)
	}
}

// Edit stores the edit, sends the edit rather than the draft, and marks the
// draft as one a person intervened on.
func TestAdminEditSendsWhatWasTypedAndRecordsTheIntervention(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	srv := httptest.NewServer((&fakeOSTicket{}).handler(t))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)

	draft := seedPendingDraft(t, "900100", "Ticker froze")
	app := adminActionApp("sub-staff")

	// Deliberately longer than Discord's 4000-character modal limit: the cap
	// belonged to the modal, and nothing about a support email has it.
	long := "Update to 1.6.2, which fixes the freeze after sleep. " + strings.Repeat("Details follow. ", 400)
	status, body := postJSON(t, app, "POST", "/admin/support/draft/"+itoa(draft.ID)+"/edit",
		mustJSON(t, map[string]string{"body": long}))
	if status != fiber.StatusOK {
		t.Fatalf("edit: got %d (%s)", status, body)
	}
	got := decodeCase(t, body)
	if got.Draft == nil || got.Draft.Status != "edited" {
		t.Fatalf("draft status = %v, want edited", got.Draft)
	}
	if !got.Draft.Intervened {
		t.Error("an edit must count as an intervention — it is the numerator that demotes a category")
	}
	if !strings.Contains(got.Draft.Edited, "Update to 1.6.2") {
		t.Errorf("the edit was not stored on the row: %q", truncate(got.Draft.Edited, 120))
	}
	if len(got.Draft.Edited) < 4000 {
		t.Errorf("the edit was truncated to %d characters; there is no length limit here", len(got.Draft.Edited))
	}
	if got.Draft.SentAt == nil {
		t.Error("an edited reply that was sent must still record sent_at (REL-256)")
	}
}

// An empty edit is refused before anything is claimed.
func TestAdminEditRefusesAnEmptyBody(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	draft := seedPendingDraft(t, "900100", "Ticker froze")

	app := adminActionApp("sub-staff")
	status, _ := postJSON(t, app, "POST", "/admin/support/draft/"+itoa(draft.ID)+"/edit",
		mustJSON(t, map[string]string{"body": "   \n  "}))
	if status != fiber.StatusBadRequest {
		t.Errorf("empty edit: got %d, want 400", status)
	}
	if got := draftStatus(t, draft.ID); got != "pending" {
		t.Errorf("a refused edit still claimed the draft: %s", got)
	}
}

// Ask sends the question and parks the draft waiting on the user — and never
// closes the ticket, whatever triage thought of the answer it replaced.
func TestAdminAskParksTheCaseWaitingOnTheUser(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	// A recording osTicket rather than the shared fake: the shared one answers
	// `closed: true` to every reply, which would hide the thing this test is
	// for. What matters is whether the ASK asked for a close.
	var askedToClose bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		askedToClose, _ = payload["close_ticket"].(bool)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "ok", "entry_id": 9002, "closed": askedToClose,
		})
	}))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)

	draft := seedPendingDraft(t, "900100", "Ticker froze")
	// Triage thought the reply it drafted was a resolution. The question that
	// replaces it is not one, whatever triage thought.
	testsupport.MustExec(t, `UPDATE support_drafts SET should_close = true WHERE id = $1`, draft.ID)

	app := adminActionApp("sub-staff")
	status, body := postJSON(t, app, "POST", "/admin/support/draft/"+itoa(draft.ID)+"/ask",
		mustJSON(t, map[string]string{"question": "Which version are you on?"}))
	if status != fiber.StatusOK {
		t.Fatalf("ask: got %d (%s)", status, body)
	}
	got := decodeCase(t, body)
	if got.Draft == nil || got.Draft.Status != "asked" {
		t.Fatalf("draft status = %v, want asked", got.Draft)
	}
	if got.Group != queueWaiting {
		t.Errorf("group = %q, want %q — an ask is waiting on the user", got.Group, queueWaiting)
	}
	if askedToClose {
		t.Error("the ask asked osTicket to close the ticket; a question is never a resolution")
	}
	if got.Status == "closed" {
		t.Error("asking a question closed the ticket")
	}
}

// Skip and hold: one decides, one only stops the clock. Both count as a
// person intervening.
func TestAdminSkipDecidesAndHoldOnlyStopsTheClock(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	app := adminActionApp("sub-staff")

	held := seedPendingDraft(t, "900100", "Held one")
	deadline := time.Now().Add(30 * time.Minute)
	if err := recordDisposition(context.Background(), held.ID, dispositionAutoSend, "confident", &deadline); err != nil {
		t.Fatal(err)
	}
	status, body := postJSON(t, app, "POST", "/admin/support/draft/"+itoa(held.ID)+"/hold", "{}")
	if status != fiber.StatusOK {
		t.Fatalf("hold: got %d (%s)", status, body)
	}
	got := decodeCase(t, body)
	if got.Draft == nil || got.Draft.Status != "pending" {
		t.Fatalf("hold decided the draft: %v", got.Draft)
	}
	if got.Draft.HoldUntil != nil {
		t.Errorf("hold left a deadline on the row: %v", got.Draft.HoldUntil)
	}
	if got.Hold != nil {
		t.Errorf("the case still reports a countdown after a hold: %+v", got.Hold)
	}
	if !got.Draft.Intervened {
		t.Error("a hold is an intervention")
	}

	skipped := seedPendingDraft(t, "900101", "Skipped one")
	status, body = postJSON(t, app, "POST", "/admin/support/draft/"+itoa(skipped.ID)+"/skip", "{}")
	if status != fiber.StatusOK {
		t.Fatalf("skip: got %d (%s)", status, body)
	}
	got = decodeCase(t, body)
	if got.Draft == nil || got.Draft.Status != "skipped" {
		t.Fatalf("draft status = %v, want skipped", got.Draft)
	}
	if got.Group != queueHandled {
		t.Errorf("group = %q, want %q", got.Group, queueHandled)
	}
	// The same audit note the Discord path writes.
	if n := countMessages(t, "900101", "note"); n == 0 {
		t.Error("a skip left no note on the case; the history must not depend on the surface")
	}
}

// Link refuses anything that is not an issue key, and unlink is the only way
// to change one.
func TestAdminLinkRefusesNonsenseAndUnlinkClearsTheKey(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	seedPendingDraft(t, "900100", "Ticker froze")
	app := adminActionApp("sub-staff")

	// Never reaches Linear: the shape is wrong, and a typo'd key reads to the
	// fix check as an issue it could not reach — which looks like "not fixed".
	status, _ := postJSON(t, app, "POST", "/admin/support/case/900100/link",
		mustJSON(t, map[string]string{"issue_key": "not a key"}))
	if status != fiber.StatusBadRequest {
		t.Errorf("malformed key: got %d, want 400", status)
	}

	// Unlink with nothing linked says so rather than pretending it worked.
	status, _ = postJSON(t, app, "DELETE", "/admin/support/case/900100/link", "")
	if status != fiber.StatusConflict {
		t.Errorf("unlink with no link: got %d, want 409", status)
	}

	// With a link in place, unlink clears it and leaves the note behind.
	testsupport.MustExec(t, `UPDATE support_cases SET linear_issue_key = 'REL-261' WHERE ticket_number = '900100'`)
	status, body := postJSON(t, app, "DELETE", "/admin/support/case/900100/link", "")
	if status != fiber.StatusOK {
		t.Fatalf("unlink: got %d (%s)", status, body)
	}
	got := decodeCase(t, body)
	if got.LinearIssueKey != "" {
		t.Errorf("the case still carries %q after unlink", got.LinearIssueKey)
	}
	if !strings.Contains(got.Fix.Reason, "No Linear issue is linked") {
		t.Errorf("the fix answer did not fall back to the unlinked reasoning: %q", got.Fix.Reason)
	}
	if n := countMessages(t, "900100", "note"); n == 0 {
		t.Error("unlinking left no note; undoing a link is its own entry, not an erasure")
	}
}

// The kill switch, from the console, is the same switch /pause throws.
func TestAdminAutoSendPauseAndResume(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "on")
	app := adminActionApp("sub-staff")
	ctx := context.Background()

	status, body := postJSON(t, app, "POST", "/admin/support/autosend", `{"paused":true}`)
	if status != fiber.StatusOK {
		t.Fatalf("pause: got %d (%s)", status, body)
	}
	var state AutoSendState
	if err := json.Unmarshal([]byte(body), &state); err != nil {
		t.Fatal(err)
	}
	if !state.Paused || state.Armed {
		t.Errorf("after pausing: %+v", state)
	}
	if !autosendPaused(ctx) {
		t.Error("the console paused the page but not the pipeline")
	}

	status, body = postJSON(t, app, "POST", "/admin/support/autosend", `{"paused":false}`)
	if status != fiber.StatusOK {
		t.Fatalf("resume: got %d (%s)", status, body)
	}
	if err := json.Unmarshal([]byte(body), &state); err != nil {
		t.Fatal(err)
	}
	if state.Paused || !state.Armed {
		t.Errorf("after resuming: %+v", state)
	}
}

// ===== The queue moves on its own =================================

// A hold that runs out moves its case out of "Needs you" with nobody
// clicking anything. This is the sweeper's job, and it is what the console's
// live stream is there to show — so it has to actually happen.
func TestTheQueueMovesWhenAHoldExpires(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	srv := httptest.NewServer((&fakeOSTicket{}).handler(t))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)
	t.Setenv("SUPPORT_AUTOSEND", "on")

	draft := seedPendingDraft(t, "900100", "Ticker froze")
	past := time.Now().Add(-time.Minute)
	if err := recordDisposition(context.Background(), draft.ID, dispositionAutoSend, "confident and cited", &past); err != nil {
		t.Fatal(err)
	}

	app := adminSupportApp("sub-staff")
	status, body := getJSON(t, app, "/admin/support/queue?state=needs_you")
	if status != fiber.StatusOK {
		t.Fatalf("queue: got %d (%s)", status, body)
	}
	if !strings.Contains(body, "900100") {
		t.Fatalf("the case is not in Needs you before the sweep: %s", truncate(body, 300))
	}

	sweepExpiredHolds(context.Background())

	status, body = getJSON(t, app, "/admin/support/queue?state=needs_you")
	if status != fiber.StatusOK {
		t.Fatalf("queue after sweep: got %d (%s)", status, body)
	}
	if strings.Contains(body, "900100") {
		t.Errorf("the case is still in Needs you after its hold ran out: %s", truncate(body, 400))
	}
	if got := draftStatus(t, draft.ID); got != "sent" {
		t.Errorf("draft status after the sweep = %q, want sent", got)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
