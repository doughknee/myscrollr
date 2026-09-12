package support

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func TestSupportSummaryBucketsTheWholeQueueWithAPayingOverlay(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "off")
	testsupport.MustExec(t, `DELETE FROM stripe_customers`)
	testsupport.MustExec(t, `INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime) VALUES ('sub-paying', 'cus_p', 'monthly', 'active', false)`)
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	prevNow := summaryNow
	summaryNow = func() time.Time { return now }
	t.Cleanup(func() { summaryNow = prevNow })

	// Five hand-written cases, one per state, plus 600 old closed ones so
	// the totals prove they are not read through the queue's 500-row cap.
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, status, opened_at, closed_at, logto_sub, account_source, updated_at) VALUES
		('100', 'needs a person',       'open',   $1::timestamptz - interval '2 days', NULL, 'sub-paying', 'authenticated', $1),
		('101', 'waiting on customer',  'open',   $1::timestamptz - interval '3 days', NULL, NULL, NULL, $1),
		('102', 'closed this week',     'closed', $1::timestamptz - interval '4 days', $1::timestamptz - interval '1 day', NULL, NULL, $1),
		('103', 'dismissed',            'open',   $1::timestamptz - interval '5 days', NULL, NULL, NULL, $1),
		('104', 'email match only',     'open',   $1::timestamptz - interval '6 hours', NULL, NULL, NULL, $1)`, now)
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, status, opened_at, closed_at, updated_at)
		SELECT 'old' || g, 'old case', 'closed', $1::timestamptz - interval '40 days', $1::timestamptz - interval '39 days', $1::timestamptz - interval '39 days' FROM generate_series(1, 600) g`, now)
	testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at) VALUES
		('100', 'user', 'help', $1::timestamptz - interval '2 days'),
		('101', 'user', 'question', $1::timestamptz - interval '3 days'),
		('101', 'sent', 'answer', $1::timestamptz - interval '3 days' + interval '4 hours'),
		('102', 'user', 'bug', $1::timestamptz - interval '4 days'),
		('102', 'sent', 'fixed', $1::timestamptz - interval '4 days' + interval '2 hours'),
		('104', 'user', 'hello', $1::timestamptz - interval '6 hours')`, now)
	testsupport.MustExec(t, `INSERT INTO support_drafts (ticket_number, user_email, original_subject, draft_body_html, status, disposition) VALUES
		('100', 'a@example.com', 'needs a person', '<p>x</p>', 'pending', 'escalate'),
		('101', 'b@example.com', 'waiting', '<p>x</p>', 'sent', 'auto_send'),
		('102', 'c@example.com', 'closed', '<p>x</p>', 'sent', 'auto_send'),
		('103', 'd@example.com', 'dismissed', '<p>x</p>', 'skipped', 'escalate')`)

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
	if out.NeedsAttention.Total != 2 || out.WaitingOnCustomer.Total != 1 || out.Completed.Total != 602 || out.Total.Total != 605 {
		t.Fatalf("buckets = needs %+v waiting %+v completed %+v total %+v", out.NeedsAttention, out.WaitingOnCustomer, out.Completed, out.Total)
	}
	if out.NeedsAttention.Total+out.WaitingOnCustomer.Total+out.Completed.Total != out.Total.Total {
		t.Fatal("buckets must sum to the total")
	}
	if out.CompletedClosed != 601 || out.CompletedDismissed != 1 {
		t.Fatalf("closed/dismissed = %d/%d", out.CompletedClosed, out.CompletedDismissed)
	}
	// Only the verified account is paying; the email-only case is unknown.
	if out.NeedsAttention.Paying != 1 || out.Total.Paying != 1 || out.WaitingOnCustomer.Paying != 0 {
		t.Fatalf("paying overlay = needs %d total %d", out.NeedsAttention.Paying, out.Total.Paying)
	}
	if !out.OldestNeedsAttention.Available || out.OldestNeedsAttention.Value != 48 || out.OldestTicket != "100" {
		t.Fatalf("oldest = %+v ticket %s", out.OldestNeedsAttention, out.OldestTicket)
	}
	// Trends over the last 7 days: five created, one closed; medians from
	// the tickets that carry both timestamps.
	if out.Created.Value != 5 || out.CompletedIn.Value != 1 {
		t.Fatalf("created %v completed %v", out.Created.Value, out.CompletedIn.Value)
	}
	// Nothing was created in the previous window: the zero is reported, but
	// there is no comparison against it.
	if out.Created.Comparison.Comparable || *out.Created.Comparison.Previous != 0 || out.Created.Comparison.Note == "" {
		t.Fatalf("created comparison = %+v", out.Created.Comparison)
	}
	if !out.FirstResponseMedianHours.Available || out.FirstResponseMedianHours.Value != 3 {
		t.Fatalf("first response median = %+v (want 3 h: 4 h and 2 h)", out.FirstResponseMedianHours)
	}
	if !out.CompletionMedianHours.Available || out.CompletionMedianHours.Value != 72 {
		t.Fatalf("completion median = %+v", out.CompletionMedianHours)
	}
	if out.PayingCreated != 1 {
		t.Fatalf("paying created = %d", out.PayingCreated)
	}
	if len(out.CreatedCurve) != 7 || out.BacklogCurve[6].Value != 4 {
		t.Fatalf("curves = created %+v backlog %+v", out.CreatedCurve, out.BacklogCurve)
	}
	if out.AutoSend.Armed || out.Definitions["paying"] == "" || out.HistoryNote == "" {
		t.Fatalf("metadata = %+v", out)
	}

	// The queue page itself still honours its ceiling.
	rows, counts, err := loadQueueRows(context.Background(), 500, out.AutoSend, now)
	if err != nil || len(rows) != 500 || counts[queueHandled] > 500 {
		t.Fatalf("capped queue = %d rows, counts %v, err %v", len(rows), counts, err)
	}
	if platform.DBPool == nil {
		t.Fatal("unreachable")
	}
}
