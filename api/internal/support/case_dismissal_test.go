package support

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/admin"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

func TestDismissAndRestoreCaseWithoutDraft(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject) VALUES ('dismiss-test', 'Unrelated email')`)
	for _, dismiss := range []bool{true, true, false, false} {
		if err := ActionSetCaseDismissed(ctx, "dismiss-test", dismiss); err != nil {
			t.Fatal(err)
		}
	}
	var status, console string
	if err := platform.DBPool.QueryRow(ctx, `SELECT status, console_status FROM support_cases WHERE ticket_number = 'dismiss-test'`).Scan(&status, &console); err != nil {
		t.Fatal(err)
	}
	if status != "unknown" || console != "review" {
		t.Fatalf("status=%s console=%s", status, console)
	}
	if n := countMessages(t, "dismiss-test", "note"); n != 2 {
		t.Fatalf("idempotent actions made %d notes", n)
	}
	group, _ := (queueState{ConsoleStatus: console}).group()
	if group != queueNeedsYou {
		t.Fatalf("restore group=%s", group)
	}
	if err := ActionSetCaseDismissed(ctx, "missing", true); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing case: %v", err)
	}
}

func TestDismissStopsPendingAndFutureDraftsWithoutRearmingOnRestore(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject) VALUES ('dismiss-test', 'Unrelated email')`)
	draft, err := createSupportDraft(ctx, &SupportDraft{TicketNumber: "dismiss-test", UserEmail: "test@example.com", OriginalSubject: "Synthetic", DraftBodyHTML: "<p>Reply</p>"})
	if err != nil {
		t.Fatal(err)
	}
	testsupport.MustExec(t, `UPDATE support_drafts SET hold_until = now() WHERE id = $1`, draft.ID)
	if err := ActionSetCaseDismissed(ctx, draft.TicketNumber, true); err != nil {
		t.Fatal(err)
	}
	fresh, err := loadSupportDraft(ctx, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Status != "skipped" || fresh.HoldUntil != nil || !fresh.Intervened {
		t.Fatalf("draft not stopped: %+v", fresh)
	}
	if err := markDraftDecided(ctx, draft.ID, "approved", ""); !errors.Is(err, ErrCaseDismissed) {
		t.Fatalf("send not blocked: %v", err)
	}
	if _, err := createSupportDraft(ctx, draft); !errors.Is(err, ErrCaseDismissed) {
		t.Fatalf("new draft not blocked: %v", err)
	}
	rows, counts, err := loadQueueRows(ctx, 500, AutoSendState{}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || counts[queueHandled] != 1 {
		t.Fatalf("dismissed queue: rows=%d counts=%v", len(rows), counts)
	}
	if err := ActionSetCaseDismissed(ctx, draft.TicketNumber, false); err != nil {
		t.Fatal(err)
	}
	if err := markDraftDecided(ctx, draft.ID, "approved", ""); !errors.Is(err, ErrAlreadyDecided) {
		t.Fatalf("restore rearmed old draft: %v", err)
	}
	_, counts, err = loadQueueRows(ctx, 500, AutoSendState{}, time.Now())
	if err != nil || counts[queueNeedsYou] != 1 {
		t.Fatalf("restored queue: counts=%v err=%v", counts, err)
	}
}

func TestDismissCannotOvertakeClaimedSend(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject) VALUES ('sending-test', 'Synthetic')`)
	draft, err := createSupportDraft(ctx, &SupportDraft{TicketNumber: "sending-test", UserEmail: "test@example.com", OriginalSubject: "Synthetic", DraftBodyHTML: "<p>Reply</p>"})
	if err != nil {
		t.Fatal(err)
	}
	if err := markDraftDecided(ctx, draft.ID, "approved", ""); err != nil {
		t.Fatal(err)
	}
	if err := ActionSetCaseDismissed(ctx, draft.TicketNumber, true); !errors.Is(err, ErrCaseSending) {
		t.Fatalf("claimed send: %v", err)
	}
	markDraftSent(ctx, draft.ID)
	if err := ActionSetCaseDismissed(ctx, draft.TicketNumber, true); err != nil {
		t.Fatal(err)
	}
}

func TestCaseDismissalRequiresStaff(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	seedAdmin(t, "real-staff")
	app := adminSupportApp("not-staff")
	app.Post("/admin/support/case/:ticket/dismiss", admin.RequireAdmin, HandleAdminDismissCase)
	app.Post("/admin/support/case/:ticket/restore", admin.RequireAdmin, HandleAdminRestoreCase)
	for _, action := range []string{"dismiss", "restore"} {
		res, err := app.Test(httptest.NewRequest("POST", "/admin/support/case/test/"+action, nil))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != fiber.StatusForbidden {
			t.Fatalf("%s: %d", action, res.StatusCode)
		}
	}
}

func TestStaffCanDismissAndRestoreUnknownTicketThroughConsole(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "dismiss-staff")
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject) VALUES ('unknown-ticket', 'Unrelated email')`)
	app := adminSupportApp("dismiss-staff")
	app.Post("/admin/support/case/:ticket/dismiss", admin.RequireAdmin, HandleAdminDismissCase)
	app.Post("/admin/support/case/:ticket/restore", admin.RequireAdmin, HandleAdminRestoreCase)
	for _, step := range []struct{ action, console, group string }{
		{"dismiss", "dismissed", queueHandled},
		{"restore", "review", queueNeedsYou},
	} {
		code, body := postJSON(t, app, "POST", "/admin/support/case/unknown-ticket/"+step.action, "{}")
		if code != fiber.StatusOK {
			t.Fatalf("%s returned %d: %s", step.action, code, body)
		}
		var detail AdminCaseDetail
		if err := json.Unmarshal([]byte(body), &detail); err != nil {
			t.Fatal(err)
		}
		if detail.ConsoleStatus != step.console || detail.Group != step.group || detail.Draft != nil || detail.Status != "unknown" {
			t.Fatalf("%s changed the wrong state: console=%s group=%s status=%s draft=%v", step.action, detail.ConsoleStatus, detail.Group, detail.Status, detail.Draft)
		}
	}
}

func TestConcurrentDismissAndClaimHaveOnlyOneWinner(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()
	testsupport.MustExec(t, `INSERT INTO support_cases (ticket_number, subject) VALUES ('race-ticket', 'Synthetic')`)
	draft, err := createSupportDraft(ctx, &SupportDraft{TicketNumber: "race-ticket", UserEmail: "test@example.com", OriginalSubject: "Synthetic", DraftBodyHTML: "<p>Reply</p>"})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	claimResult, dismissResult := make(chan error, 1), make(chan error, 1)
	go func() {
		<-start
		claimResult <- markDraftDecided(ctx, draft.ID, "approved", "")
	}()
	go func() {
		<-start
		dismissResult <- ActionSetCaseDismissed(ctx, draft.TicketNumber, true)
	}()
	close(start)
	claimErr, dismissErr := <-claimResult, <-dismissResult
	if claimErr == nil && errors.Is(dismissErr, ErrCaseSending) {
		return
	}
	if dismissErr == nil && errors.Is(claimErr, ErrCaseDismissed) {
		return
	}
	t.Fatalf("claim=%v dismissal=%v; exactly one must win", claimErr, dismissErr)
}
