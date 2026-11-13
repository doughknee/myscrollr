package support

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// SCROLLR-457: the account purge stamps purged_at on the cases it anonymises;
// both osTicket import paths must then leave the ticket alone, while a case
// staff dismissed by hand is still imported.
func seedPurgedAndDismissed(t *testing.T) {
	t.Helper()
	resetCases(t)
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, console_status, purged_at)
		VALUES ('P-1', '', 'dismissed', now())`)
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, user_email, subject, console_status)
		VALUES ('D-1', 'staff@example.com', 'Kept', 'dismissed')`)
}

func TestCasePurged_OnlyThePurgeCounts(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	seedPurgedAndDismissed(t)
	for ticket, want := range map[string]bool{"P-1": true, "D-1": false, "NOPE": false} {
		got, err := casePurged(context.Background(), ticket)
		if err != nil || got != want {
			t.Errorf("casePurged(%s) = %v, %v; want %v", ticket, got, err, want)
		}
	}
}

func TestSyncTicketSkipsPurgedCase(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	seedPurgedAndDismissed(t)
	ctx := context.Background()
	var st BackfillStats

	// The purged ticket is skipped before osTicket is even asked.
	if err := syncTicket(ctx, "P-1", &st); err != nil {
		t.Fatalf("purged ticket: %v", err)
	}
	var email *string
	if err := platform.DBPool.QueryRow(ctx, `SELECT user_email FROM support_cases WHERE ticket_number='P-1'`).Scan(&email); err != nil || email != nil {
		t.Fatalf("purged case was repopulated: %v %v", email, err)
	}
	// A hand-dismissed case is not skipped: it goes on to ask osTicket,
	// which is not configured here, so it errors.
	t.Setenv("OSTICKET_URL", "")
	if err := syncTicket(ctx, "D-1", &st); err == nil {
		t.Fatal("hand-dismissed case was skipped as if purged")
	}
}

func TestOSTicketWebhookIgnoresPurgedCase(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	seedPurgedAndDismissed(t)
	t.Setenv("SCROLLR_WEBHOOK_SECRET", "hook")
	app := fiber.New()
	app.Post("/hook", HandleOSTicketThreadMessage)

	body, _ := json.Marshal(map[string]any{
		"event": "thread.message", "ticket_number": "P-1", "thread_entry_id": 9001,
		"user_email": "gone@example.com", "message_html": "<p>hello again</p>", "created": "2026-11-13T10:00:00Z",
	})
	req := httptest.NewRequest("POST", "/hook", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Scrollr-Webhook-Secret", "hook")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out["status"] != "ignored" || out["reason"] != "purged" {
		t.Fatalf("want ignored/purged, got %v", out)
	}
	if n := countMessages(t, "P-1", "user"); n != 0 {
		t.Fatalf("purged ticket got %d messages back", n)
	}
}
