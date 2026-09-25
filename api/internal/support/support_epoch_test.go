package support

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// The support reset: a case opened before SupportEpoch is history. The
// console queue does not list it and the drafter is not shown it as a
// similar past case, even though it matches the search and was answered.
func TestSupportEpochHidesCasesOpenedBeforeIt(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		t.Skip("TEST_DATABASE_URL not set")
	}
	testsupport.MustExec(t, `TRUNCATE support_messages, support_cases, support_drafts, support_ticket_threads RESTART IDENTITY CASCADE`)

	epoch := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	prev := SupportEpoch
	SupportEpoch = epoch
	t.Cleanup(func() { SupportEpoch = prev })

	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject, status, opened_at, updated_at) VALUES
		('old', 'ticker stuck on one item', 'closed', $1, $1),
		('new', 'ticker stuck on one item', 'open',   $2, $2)`,
		epoch.Add(-time.Hour), epoch.Add(time.Hour))
	for _, tn := range []string{"old", "new"} {
		testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at) VALUES
			($1, 'user', 'the ticker is stuck on one item', $2),
			($1, 'sent', 'try restarting the app', $2)`, tn, epoch)
	}

	ctx := context.Background()
	rows, _, err := loadQueueRows(ctx, 0, AutoSendState{}, epoch.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TicketNumber != "new" {
		t.Fatalf("queue should list only the post-epoch case, got %+v", rows)
	}
	rows, _, err = loadQueueRows(ctx, 10, AutoSendState{}, epoch.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TicketNumber != "new" {
		t.Fatalf("capped queue should list only the post-epoch case, got %+v", rows)
	}

	similar := FetchSimilarCases(ctx, "ticker stuck", "", 5)
	if len(similar) != 1 || similar[0].TicketNumber != "new" {
		t.Fatalf("similar cases should exclude the pre-epoch case, got %+v", similar)
	}
}
