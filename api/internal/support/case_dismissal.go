package support

import (
	"context"
	"errors"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/jackc/pgx/v5"
)

var ErrCaseDismissed = errors.New("this ticket is dismissed; restore it before preparing a reply")
var ErrCaseSending = errors.New("a reply is already being sent; reload before dismissing this ticket")

// Draft creation, claiming and dismissal share this transaction lock across
// replicas. Dismissal never reports success while a claimed send is in flight.
func lockCase(ctx context.Context, tx pgx.Tx, ticket string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 351))`, ticket)
	return err
}

func caseAllowsDraft(ctx context.Context, tx pgx.Tx, ticket string) error {
	var status string
	err := tx.QueryRow(ctx, `SELECT console_status FROM support_cases WHERE ticket_number = $1`, ticket).Scan(&status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if status == "dismissed" {
		return ErrCaseDismissed
	}
	return nil
}

// ActionSetCaseDismissed is local and reversible: no email is sent, no
// osTicket record is deleted or closed, and restoring never rearms old drafts.
// New inbound messages remain recorded while dismissal suppresses new drafts.
func ActionSetCaseDismissed(ctx context.Context, ticket string, dismiss bool) error {
	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockCase(ctx, tx, ticket); err != nil {
		return err
	}
	var current string
	if err := tx.QueryRow(ctx, `SELECT console_status FROM support_cases WHERE ticket_number = $1 FOR UPDATE`, ticket).Scan(&current); err != nil {
		return err
	}
	if dismiss == (current == "dismissed") {
		return nil
	}
	status, note := "review", "Ticket restored to Needs you. Previous replies remain stopped."
	if dismiss {
		var sending bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM support_drafts WHERE ticket_number = $1
			AND status IN ('approved', 'edited', 'asked') AND sent_at IS NULL
		)`, ticket).Scan(&sending); err != nil {
			return err
		}
		if sending {
			return ErrCaseSending
		}
		if _, err := tx.Exec(ctx, `UPDATE support_drafts
			SET status = 'skipped', decided_at = now(), hold_until = NULL, intervened = true
			WHERE ticket_number = $1 AND status = 'pending'`, ticket); err != nil {
			return err
		}
		status, note = "dismissed", "Ticket dismissed without replying. Bot replies are stopped until this ticket is restored. History is retained; osTicket is unchanged."
	}
	if _, err := tx.Exec(ctx, `UPDATE support_cases SET console_status = $2, updated_at = now() WHERE ticket_number = $1`, ticket, status); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO support_messages (ticket_number, kind, body_text) VALUES ($1, 'note', $2)`, ticket, note); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	publishSupportEvent(ticket, supportEventDecided)
	return nil
}
