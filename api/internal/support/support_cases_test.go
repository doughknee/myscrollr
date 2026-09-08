package support

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
	"github.com/gofiber/fiber/v2"
)

// resetCases empties the case tables between tests (schema is private to
// this package, see testsupport.Main).
func resetCases(t *testing.T) {
	t.Helper()
	testsupport.MustExec(t, `TRUNCATE support_messages, support_cases, support_drafts, support_ticket_threads RESTART IDENTITY CASCADE`)
}

func countMessages(t *testing.T, ticket, kind string) int {
	t.Helper()
	var n int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM support_messages WHERE ticket_number = $1 AND ($2 = '' OR kind = $2)`,
		ticket, kind).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// fakeOSTicket is the plugin's reply + list + detail surface, enough for
// the send path and the backfill. Threads are keyed by ticket number.
type fakeOSTicket struct {
	tickets map[string]map[string]interface{}
}

func (f *fakeOSTicket) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "k1" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/reply.json"):
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "entry_id": 9001, "closed": true})
		case r.Method == "GET" && r.URL.Path == "/api/tickets.json":
			if r.URL.Query().Get("status") != "all" || r.URL.Query().Get("topic") != "all" {
				t.Errorf("list must ask for every ticket, got %s", r.URL.RawQuery)
			}
			list := []map[string]interface{}{}
			for n := range f.tickets {
				list = append(list, map[string]interface{}{"number": n})
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"count": len(list), "tickets": list})
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/tickets/"):
			n := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/tickets/"), ".json")
			d, ok := f.tickets[n]
			if !ok {
				w.WriteHeader(404)
				return
			}
			_ = json.NewEncoder(w).Encode(d)
		default:
			w.WriteHeader(404)
		}
	})
}

func entry(id int64, typ, body string) map[string]interface{} {
	return map[string]interface{}{"id": id, "type": typ, "created": "2026-06-01T10:00:00Z", "body_plain": body}
}

func setOSTicketEnv(t *testing.T, url string) {
	t.Helper()
	t.Setenv("OSTICKET_URL", url)
	t.Setenv("OSTICKET_API_KEY", "k1")
}

// TestCases_IngestOnEveryEvent walks the four live paths: ticket open,
// draft create, follow-up webhook, send (with close) and skip.
func TestCases_IngestOnEveryEvent(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()
	srv := httptest.NewServer((&fakeOSTicket{}).handler(t))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)

	diag := map[string]interface{}{
		"app":    map[string]interface{}{"version": "1.6.2", "platform": "windows"},
		"system": map[string]interface{}{"osName": "Windows 11"},
	}
	appVersion, osName := caseFieldsFromDiagnostics(diag)
	recordTicketOpened(ctx, SupportCase{
		TicketNumber: "100", UserEmail: "u@example.com", LogtoSub: "sub-1", Subject: "Ticker froze",
		Category: "bug", AppVersion: appVersion, OS: osName, TierAtOpen: platform.TierFromRoles([]string{"uplink_pro"}),
	}, "<p>The ticker stopped scrolling after sleep</p>")

	draft, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "100", UserEmail: "u@example.com", OriginalSubject: "Ticker froze",
		DraftBodyHTML: "<p>Try restarting the app</p>", AISummary: "ticker freezes after sleep",
		AICategory: "bug", AIPriority: "High",
	})
	if err != nil {
		t.Fatal(err)
	}

	// Follow-up via the webhook path. No ANTHROPIC_API_KEY → triage is nil
	// and the function returns right after the case-DB write.
	t.Setenv("ANTHROPIC_API_KEY", "")
	processReplyTriageAsync(osTicketThreadMessageEvent{
		Event: "thread.message", TicketNumber: "100", ThreadEntryID: 555,
		UserEmail: "u@example.com", Subject: "Ticker froze", MessageHTML: "<p>Restart did not help</p>",
	})
	processReplyTriageAsync(osTicketThreadMessageEvent{ // same entry twice = one row
		Event: "thread.message", TicketNumber: "100", ThreadEntryID: 555,
		UserEmail: "u@example.com", Subject: "Ticker froze", MessageHTML: "<p>Restart did not help</p>",
	})

	if err := markDraftDecided(ctx, draft.ID, "edited", "<p>Edited: update to 1.6.2</p>"); err != nil {
		t.Fatal(err)
	}
	if err := doSendApprovedReply(ctx, draft, "<p>Edited: update to 1.6.2</p>"); err != nil {
		t.Fatal(err)
	}

	skip, _ := createSupportDraft(ctx, &SupportDraft{TicketNumber: "100", UserEmail: "u@example.com",
		OriginalSubject: "Ticker froze", DraftBodyHTML: "<p>second draft</p>"})
	if err := markDraftDecided(ctx, skip.ID, "skipped", ""); err != nil {
		t.Fatal(err)
	}

	var c SupportCase
	var tier, appV, osV, cat, prio, sum string
	if err := platform.DBPool.QueryRow(ctx, `SELECT status, tier_at_open, app_version, os, category, priority, summary FROM support_cases WHERE ticket_number='100'`).
		Scan(&c.Status, &tier, &appV, &osV, &cat, &prio, &sum); err != nil {
		t.Fatal(err)
	}
	if c.Status != "closed" || tier != "uplink_pro" || appV != "1.6.2" || osV != "Windows 11" || cat != "bug" || prio != "high" || sum == "" {
		t.Fatalf("case row wrong: status=%s tier=%s app=%s os=%s cat=%s prio=%s sum=%q", c.Status, tier, appV, osV, cat, prio, sum)
	}
	for kind, want := range map[string]int{"user": 2, "ai_draft": 2, "sent": 1, "note": 1} {
		if got := countMessages(t, "100", kind); got != want {
			t.Errorf("%s messages: got %d want %d", kind, got, want)
		}
	}
	var sentEntry int64
	var sentBody string
	_ = platform.DBPool.QueryRow(ctx, `SELECT osticket_entry_id, body_html FROM support_messages WHERE kind='sent'`).Scan(&sentEntry, &sentBody)
	if sentEntry != 9001 || !strings.Contains(sentBody, "Edited") {
		t.Fatalf("sent message: entry=%d body=%q", sentEntry, sentBody)
	}

	recent := FetchRecentTicketSummaries(ctx)
	if len(recent) != 1 || recent[0].TicketNumber != "100" || recent[0].Summary != "ticker freezes after sleep" {
		t.Fatalf("recent summaries: %+v", recent)
	}
}

// TestBackfill_Idempotent runs the osTicket walk twice: an existing
// edited draft gets linked to its R entry, the unlinked opening message
// gets its entry id, and the second run changes nothing.
func TestBackfill_Idempotent(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	// A draft from before the case DB existed: edited, sent, no entry id.
	var draftID int64
	if err := platform.DBPool.QueryRow(ctx, `
		INSERT INTO support_drafts (ticket_number, user_email, original_subject, user_message_html,
			draft_body_html, edited_body_html, ai_summary, ai_category, status, decided_at, sent_at, created_at)
		VALUES ('200','a@example.com','Cannot log in','<p>Login loops</p>','<p>AI: clear cache</p>',
			'<p>Human: we shipped a fix in 1.6.1</p>','login loop','account','edited',
			'2026-06-01T11:00:00Z','2026-06-01T11:00:00Z','2026-06-01T10:00:00Z') RETURNING id`).Scan(&draftID); err != nil {
		t.Fatal(err)
	}
	testsupport.MustExec(t, `INSERT INTO support_ticket_threads (ticket_number, discord_thread_id, channel_id) VALUES ('200','thr-1','chan-1')`)

	fake := &fakeOSTicket{tickets: map[string]map[string]interface{}{
		"200": {
			"number": "200", "subject": "Cannot log in", "topic": "Account & Login", "status": "Closed",
			"status_state": "closed", "priority": "Normal", "created": "2026-06-01T10:00:00Z",
			"updated": "2026-06-02T10:00:00Z", "closed": true, "user_email": "a@example.com",
			"thread": []map[string]interface{}{
				entry(1, "M", "Login loops"), entry(2, "R", "Human: we shipped a fix in 1.6.1"), entry(3, "N", "internal note"),
			},
		},
		"201": { // never seen by this API (IMAP-only ticket)
			"number": "201", "subject": "Weather widget shows nothing", "topic": "Bug Report", "status": "Open",
			"status_state": "open", "priority": "High", "created": "2026-06-03T10:00:00Z",
			"updated": "2026-06-03T10:00:00Z", "closed": false, "user_email": "b@example.com",
			"thread": []map[string]interface{}{entry(10, "M", "Weather widget is blank since the update")},
		},
	}}
	srv := httptest.NewServer(fake.handler(t))
	defer srv.Close()
	setOSTicketEnv(t, srv.URL)

	first, err := BackfillFromOSTicket(ctx, time.Time{})
	if err != nil || first.Errors != 0 {
		t.Fatalf("first run: %+v err=%v", first, err)
	}
	second, err := BackfillFromOSTicket(ctx, time.Time{})
	if err != nil || second.Errors != 0 {
		t.Fatalf("second run: %+v err=%v", second, err)
	}
	if first.Tickets != 2 || second.Tickets != 2 || first.Drafts != 1 {
		t.Fatalf("stats: first=%+v second=%+v", first, second)
	}

	var cases int
	_ = platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM support_cases`).Scan(&cases)
	if cases != 2 {
		t.Fatalf("cases: %d", cases)
	}
	if got := countMessages(t, "200", ""); got != 4 { // user, ai_draft, sent, note
		t.Fatalf("ticket 200 messages: %d", got)
	}
	if got := countMessages(t, "201", ""); got != 1 {
		t.Fatalf("ticket 201 messages: %d", got)
	}

	// The draft's sent copy was claimed by the R entry, and it differs
	// from the AI draft (the edited body went out).
	var sentEntry int64
	var sentBody, draftBody string
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT COALESCE(osticket_entry_id,0), body_html FROM support_messages WHERE kind='sent' AND ai_draft_id=$1`, draftID).
		Scan(&sentEntry, &sentBody); err != nil {
		t.Fatal(err)
	}
	_ = platform.DBPool.QueryRow(ctx, `SELECT body_html FROM support_messages WHERE kind='ai_draft' AND ai_draft_id=$1`, draftID).Scan(&draftBody)
	if sentEntry != 2 || sentBody == draftBody {
		t.Fatalf("sent link: entry=%d sent=%q draft=%q", sentEntry, sentBody, draftBody)
	}
	var userEntry int64
	_ = platform.DBPool.QueryRow(ctx, `SELECT COALESCE(osticket_entry_id,0) FROM support_messages WHERE kind='user' AND ticket_number='200'`).Scan(&userEntry)
	if userEntry != 1 {
		t.Fatalf("user message not claimed: entry=%d", userEntry)
	}

	var status, cat, thread string
	var closedAt *time.Time
	_ = platform.DBPool.QueryRow(ctx, `SELECT status, category, COALESCE(discord_thread_id,''), closed_at FROM support_cases WHERE ticket_number='200'`).
		Scan(&status, &cat, &thread, &closedAt)
	if status != "closed" || closedAt == nil || cat != "account" || thread != "thr-1" {
		t.Fatalf("case 200: status=%s closed=%v cat=%s thread=%s", status, closedAt, cat, thread)
	}

	// Search: a word only in a message body finds the case; the handler
	// gates on the shared secret.
	hits, err := SearchSupportCases(ctx, "blank weather", "", "", 10)
	if err != nil || len(hits) != 1 || hits[0].TicketNumber != "201" {
		t.Fatalf("search: %+v err=%v", hits, err)
	}
	hits, _ = SearchSupportCases(ctx, "", "account", "closed", 10)
	if len(hits) != 1 || hits[0].TicketNumber != "200" {
		t.Fatalf("filter search: %+v", hits)
	}

	t.Setenv("SCROLLR_WEBHOOK_SECRET", "s3cret")
	app := fiber.New()
	app.Get("/internal/support/cases", HandleSearchSupportCases)
	req := httptest.NewRequest("GET", "/internal/support/cases?q=weather", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 401 {
		t.Fatalf("no secret: %d", resp.StatusCode)
	}
	req.Header.Set("X-Scrollr-Webhook-Secret", "s3cret")
	resp, _ = app.Test(req)
	var body struct {
		Count int           `json:"count"`
		Cases []SupportCase `json:"cases"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 200 || body.Count != 1 || body.Cases[0].TicketNumber != "201" {
		t.Fatalf("handler: %d %+v", resp.StatusCode, body)
	}
}

// TestCategoryFromTopic pins the topic → category mapping.
func TestCategoryFromTopic(t *testing.T) {
	for in, want := range map[string]string{"Bug Report": "bug", "Feature Request": "feature",
		"Account & Login": "account", "Channel Help": "widget", "Other": "other"} {
		s := in
		if got := categoryFromTopic(&s); got != want {
			t.Errorf("%s: got %s want %s", in, got, want)
		}
	}
	if categoryFromTopic(nil) != "" {
		t.Error("nil topic")
	}
	_ = fmt.Sprint
}

// The drafting prompt is only as good as what it is shown. These two reads
// are that: the precedent (what we actually sent last time) and the thread
// (what this user has already read). Both are easy to get subtly wrong —
// the sent copy has to be the EDITED body when the partner edited it, and
// an unanswered ticket is not a precedent.
func TestFetchSimilarCasesAndThread(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	// 300: asked about frozen scores, we answered (and the partner edited
	// the draft before it went out). 301: same topic, never answered.
	// 302: unrelated.
	for _, c := range []struct{ num, subject, user string }{
		{"300", "Scores are frozen in the 6th inning", "The MLB scores froze and never moved"},
		{"301", "Scores frozen again", "Frozen scores, same as before"},
		{"302", "Billing question about my invoice", "Where do I find an invoice"},
	} {
		if err := upsertSupportCase(ctx, SupportCase{TicketNumber: c.num, Subject: c.subject}); err != nil {
			t.Fatal(err)
		}
		if err := recordSupportMessage(ctx, SupportMessage{
			TicketNumber: c.num, Kind: "user", BodyHTML: "<p>" + c.user + "</p>"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: "300", Kind: "sent", BodyHTML: "<p>The game was stuck on our side. Fixed now.</p>",
		OSTicketEntryID: 3001}); err != nil {
		t.Fatal(err)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: "302", Kind: "sent", BodyHTML: "<p>Invoices are on your account page.</p>",
		OSTicketEntryID: 3002}); err != nil {
		t.Fatal(err)
	}

	hits := FetchSimilarCases(ctx, "frozen scores inning", "", 3)
	if len(hits) != 1 || hits[0].TicketNumber != "300" {
		t.Fatalf("want only the answered frozen-scores case, got %+v", hits)
	}
	if !strings.Contains(hits[0].WeSent, "stuck on our side") {
		t.Errorf("similar case carries no sent body: %+v", hits[0])
	}
	if !strings.Contains(hits[0].UserWrote, "froze") {
		t.Errorf("similar case carries no user message: %+v", hits[0])
	}
	// The ticket being triaged is never its own precedent.
	if hits := FetchSimilarCases(ctx, "frozen scores inning", "300", 3); len(hits) != 0 {
		t.Errorf("excluded ticket came back: %+v", hits)
	}
	if hits := FetchSimilarCases(ctx, "", "", 3); hits != nil {
		t.Errorf("an empty query should match nothing, got %+v", hits)
	}

	// The thread is user + sent, oldest first. Drafts and notes stay out.
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: "300", Kind: "note", BodyText: "AI draft skipped"}); err != nil {
		t.Fatal(err)
	}
	thread := FetchCaseThread(ctx, "300")
	if len(thread) != 2 || thread[0].Kind != "user" || thread[1].Kind != "sent" {
		t.Fatalf("thread: %+v", thread)
	}
	if rendered := renderThread(thread); !strings.Contains(rendered, "The user wrote") ||
		!strings.Contains(rendered, "We replied") {
		t.Errorf("rendered thread: %s", rendered)
	}
}

// The grounding columns are nullable, and a draft with no body is not a
// draft — the partner has nothing to approve.
func TestDraftGroundingRoundTrip(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	if _, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "400", UserEmail: "u@example.com", OriginalSubject: "s",
		DraftBodyHTML: "   ",
	}); !errors.Is(err, ErrNoDraftBody) {
		t.Fatalf("a bodiless draft should be refused, got %v", err)
	}

	d, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "400", UserEmail: "u@example.com", OriginalSubject: "s",
		DraftBodyHTML: "<p>hello</p>", AICategory: "bug", AIPriority: "high", AISummary: "sum",
		NeedsInfo: true, GroundedIn: "Policies; 1.6.2",
		AskUserFor: "OS; version", InternalNote: "REL-999",
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := loadSupportDraft(ctx, d.ID)
	if err != nil || got == nil {
		t.Fatalf("load: %v", err)
	}
	if !got.NeedsInfo || got.InternalNote != "REL-999" ||
		got.GroundedIn != "Policies; 1.6.2" || got.AskUserFor != "OS; version" {
		t.Fatalf("grounding did not round-trip: %+v", got)
	}
	// unknowns was never set, so it stays NULL rather than becoming "".
	if got.Unknowns != "" {
		t.Errorf("unset unknowns came back as %q, want empty", got.Unknowns)
	}
}
