package support

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// The Support section's three "who answered" facts are replyProvenance
// counted up. The interesting row is the fourth: a draft edited through the
// older approval endpoint carries edited_body_html but keeps status
// 'approved', and replyProvenance calls that edited — so the aggregate must
// too, or the page and the queue would disagree about the same draft.
func TestSupportSummaryCountsRepliesByTheQueuesOwnProvenanceRule(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "off")
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	prevNow := summaryNow
	summaryNow = func() time.Time { return now }
	t.Cleanup(func() { summaryNow = prevNow })

	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, status, opened_at, updated_at)
		SELECT g::text, 'case', 'open', $1::timestamptz - interval '2 days', $1 FROM generate_series(200, 206) g`, now)

	// sent_at places a draft in the window; decided_at and created_at cover
	// the ones that never went out.
	testsupport.MustExec(t, `INSERT INTO support_drafts
		(ticket_number, user_email, original_subject, draft_body_html, edited_body_html, status, disposition, intervened, sent_at, decided_at, created_at) VALUES
		-- the bot, unattended: auto disposition, nobody intervened
		('200', 'a@example.com', 's', '<p>draft</p>', NULL,            'sent',     'auto_send', false, $1::timestamptz - interval '1 day', NULL, $1::timestamptz - interval '1 day'),
		('201', 'b@example.com', 's', '<p>draft</p>', NULL,            'asked',    'auto_ask',  false, $1::timestamptz - interval '2 days', NULL, $1::timestamptz - interval '2 days'),
		-- edited: the status the Edit button writes
		('202', 'c@example.com', 's', '<p>draft</p>', '<p>mine</p>',   'edited',   'auto_send', true,  $1::timestamptz - interval '1 day', NULL, $1::timestamptz - interval '1 day'),
		-- edited through the OLDER approval endpoint: body replaced, status still 'approved'
		('203', 'd@example.com', 's', '<p>draft</p>', '<p>rewrite</p>','approved', 'auto_send', false, $1::timestamptz - interval '1 day', NULL, $1::timestamptz - interval '1 day'),
		-- a person sent it: no auto disposition
		('204', 'e@example.com', 's', '<p>draft</p>', NULL,            'sent',     'escalate',  true,  $1::timestamptz - interval '1 day', NULL, $1::timestamptz - interval '1 day'),
		-- escalated and still sitting there: no reply, so no provenance
		('205', 'f@example.com', 's', '<p>draft</p>', NULL,            'pending',  'escalate',  false, NULL, NULL, $1::timestamptz - interval '3 days'),
		-- outside the window entirely
		('206', 'g@example.com', 's', '<p>draft</p>', NULL,            'sent',     'auto_send', false, $1::timestamptz - interval '40 days', NULL, $1::timestamptz - interval '40 days')`, now)

	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("user_id", "sub-staff"); return c.Next() })
	app.Get("/admin/support/summary", HandleAdminSupportSummary)
	status, body := getJSON(t, app, "/admin/support/summary?period=7d")
	if status != fiber.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var out SupportSummaryResponse
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if out.RepliedByBot != 2 {
		t.Errorf("replied_by_bot = %d, want 2 (the auto_send and auto_ask nobody touched)", out.RepliedByBot)
	}
	if out.RepliedAfterEdit != 2 {
		t.Errorf("replied_after_edit = %d, want 2 — the 'edited' status AND the older approval path that only replaced the body", out.RepliedAfterEdit)
	}
	if out.Escalated != 2 {
		t.Errorf("escalated = %d, want 2 (sent by a person, and still pending)", out.Escalated)
	}

	// The aggregate is replyProvenance, not a second rule: every draft in the
	// window must land where the queue would put it.
	wantBot, wantEdited := 0, 0
	rows := [][5]any{
		{"sent", "auto_send", "<p>draft</p>", "", false},
		{"asked", "auto_ask", "<p>draft</p>", "", false},
		{"edited", "auto_send", "<p>draft</p>", "<p>mine</p>", true},
		{"approved", "auto_send", "<p>draft</p>", "<p>rewrite</p>", false},
		{"sent", "escalate", "<p>draft</p>", "", true},
		{"pending", "escalate", "<p>draft</p>", "", false},
	}
	for _, r := range rows {
		switch p, _ := replyProvenance(r[0].(string), r[1].(string), r[2].(string), r[3].(string), r[4].(bool)); p {
		case provenanceBot:
			wantBot++
		case provenanceEdited:
			wantEdited++
		}
	}
	if out.RepliedByBot != wantBot || out.RepliedAfterEdit != wantEdited {
		t.Errorf("aggregate (%d bot, %d edited) disagrees with replyProvenance (%d, %d)",
			out.RepliedByBot, out.RepliedAfterEdit, wantBot, wantEdited)
	}
}
