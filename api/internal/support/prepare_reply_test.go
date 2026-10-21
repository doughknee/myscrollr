package support

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestPrepareReplyPreservesSentHistoryAndRequiresReview(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	old := seedPendingDraft(t, "900100", "A follow-up")
	testsupport.MustExec(t, `UPDATE support_drafts SET status='sent',sent_at=now() WHERE id=$1`, old.ID)
	testsupport.MustExec(t, `INSERT INTO support_messages(ticket_number,kind,body_text) VALUES ('900100','user','It still happens')`)
	ctx := context.Background()
	draft, err := ActionPrepareReply(ctx, "900100", "A fresh <answer>", old.ID)
	if err != nil {
		t.Fatal(err)
	}
	if draft.ID == old.ID || draft.Status != "pending" || draft.HoldUntil != nil || draft.Disposition != dispositionEscalate || !draft.Intervened {
		t.Fatalf("not a separate review-only draft: %+v", draft)
	}
	if !strings.Contains(draft.DraftBodyHTML, "&lt;answer&gt;") {
		t.Fatal("reply HTML was not escaped")
	}
	if draftStatus(t, old.ID) != "sent" || countMessages(t, "900100", "sent") != 0 {
		t.Fatal("saving changed sent history or sent a message")
	}
	stored, err := loadSupportDraft(ctx, draft.ID)
	if err != nil || stored.Disposition != dispositionEscalate || stored.HoldUntil != nil || !stored.Intervened {
		t.Fatalf("review gate not persisted: %+v %v", stored, err)
	}
	if _, err := ActionPrepareReply(ctx, "900100", "duplicate", old.ID); !errors.Is(err, ErrReplyChanged) {
		t.Fatalf("stale editor: %v", err)
	}
	if _, err := ActionPrepareReply(ctx, "900100", "overwrite", draft.ID); !errors.Is(err, ErrReplyChanged) {
		t.Fatalf("pending draft overwrite: %v", err)
	}
	if _, err := ActionPrepareReply(ctx, "900100", " ", draft.ID); !errors.Is(err, ErrEmptyBody) {
		t.Fatalf("empty reply: %v", err)
	}
	if err := ActionSetCaseDismissed(ctx, "900100", true); err != nil {
		t.Fatal(err)
	}
	if _, err := ActionPrepareReply(ctx, "900100", "dismissed", draft.ID); !errors.Is(err, ErrCaseDismissed) {
		t.Fatalf("dismissed: %v", err)
	}
	var count int
	if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM support_drafts WHERE ticket_number='900100'`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("unexpected drafts: %d %v", count, err)
	}
}
