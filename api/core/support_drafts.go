package core

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
)

// =============================================================================
// Support drafts — DB-backed state for the L2 (partner-approval) flow
// =============================================================================
//
// Each incoming support ticket spawns a `support_drafts` row holding the
// AI-generated draft reply plus its triage metadata. The partner's
// approval URL handlers (handlers_support_approval.go) load this row,
// transition its status, and — on Send — kick off the outbound email
// via Resend (sendApprovedReply, defined below in Phase 1D).

// SupportDraft mirrors the support_drafts table.
type SupportDraft struct {
	ID              int64
	TicketNumber    string
	UserEmail       string
	UserName        string
	OriginalSubject string
	DraftBodyHTML   string
	AISummary       string
	AICategory      string
	AIPriority      string
	AIChannel       string
	AIDuplicateOf   string
	AIConfidence    string
	Status          string
	EditedBodyHTML  string
	DecidedAt       *time.Time
	SentAt          *time.Time
	CreatedAt       time.Time
}

// ErrAlreadyDecided indicates a draft was already actioned (single-use enforcement).
var ErrAlreadyDecided = errors.New("draft already decided")

// createSupportDraft persists a new pending draft. The caller hands us
// a fully-populated SupportDraft (other than ID/CreatedAt/Status) and
// receives the row back with those fields filled in. Status is always
// 'pending' on create; the partner-approval handlers transition it.
func createSupportDraft(ctx context.Context, draft *SupportDraft) (*SupportDraft, error) {
	if DBPool == nil {
		return nil, fmt.Errorf("DB not initialized")
	}

	const q = `
		INSERT INTO support_drafts
			(ticket_number, user_email, user_name, original_subject,
			 draft_body_html, ai_summary, ai_category, ai_priority,
			 ai_channel, ai_duplicate_of, ai_confidence, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
		RETURNING id, created_at
	`
	err := DBPool.QueryRow(ctx, q,
		draft.TicketNumber,
		draft.UserEmail,
		draft.UserName,
		draft.OriginalSubject,
		draft.DraftBodyHTML,
		draft.AISummary,
		draft.AICategory,
		draft.AIPriority,
		draft.AIChannel,
		draft.AIDuplicateOf,
		draft.AIConfidence,
	).Scan(&draft.ID, &draft.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("createSupportDraft: %w", err)
	}
	draft.Status = "pending"
	return draft, nil
}

// loadSupportDraft fetches a draft by primary key. Returns (nil, nil)
// when the row doesn't exist so callers can distinguish "missing" from
// "DB error".
func loadSupportDraft(ctx context.Context, id int64) (*SupportDraft, error) {
	const q = `
		SELECT id, ticket_number, user_email, user_name, original_subject,
			   draft_body_html, ai_summary, ai_category, ai_priority,
			   ai_channel, ai_duplicate_of, ai_confidence, status,
			   edited_body_html, decided_at, sent_at, created_at
		FROM support_drafts WHERE id = $1
	`
	var d SupportDraft
	var userName, summary, category, priority, channel, dupOf, confidence, editedBody *string
	err := DBPool.QueryRow(ctx, q, id).Scan(
		&d.ID, &d.TicketNumber, &d.UserEmail, &userName, &d.OriginalSubject,
		&d.DraftBodyHTML, &summary, &category, &priority, &channel,
		&dupOf, &confidence, &d.Status,
		&editedBody, &d.DecidedAt, &d.SentAt, &d.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("loadSupportDraft: %w", err)
	}
	if userName != nil {
		d.UserName = *userName
	}
	if summary != nil {
		d.AISummary = *summary
	}
	if category != nil {
		d.AICategory = *category
	}
	if priority != nil {
		d.AIPriority = *priority
	}
	if channel != nil {
		d.AIChannel = *channel
	}
	if dupOf != nil {
		d.AIDuplicateOf = *dupOf
	}
	if confidence != nil {
		d.AIConfidence = *confidence
	}
	if editedBody != nil {
		d.EditedBodyHTML = *editedBody
	}
	return &d, nil
}

// markDraftDecided atomically transitions a pending draft to the new
// status if and only if it's still pending. This is the single-use
// gate enforced for partner approval URLs — once a draft has been
// actioned, all subsequent token redemptions return ErrAlreadyDecided.
//
// editedBody is persisted only when newStatus is 'edited'; pass an
// empty string for other transitions. Empty editedBody is stored as
// NULL via NULLIF($3,”).
func markDraftDecided(ctx context.Context, id int64, newStatus string, editedBody string) error {
	const q = `
		UPDATE support_drafts
		SET status = $2, edited_body_html = NULLIF($3,''), decided_at = NOW()
		WHERE id = $1 AND status = 'pending'
	`
	tag, err := DBPool.Exec(ctx, q, id, newStatus, editedBody)
	if err != nil {
		return fmt.Errorf("markDraftDecided: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrAlreadyDecided
	}
	return nil
}

// markDraftSent records that the outbound reply email actually left
// our gateway. Best-effort — failures here only affect the audit
// trail, not user-visible behavior.
func markDraftSent(ctx context.Context, id int64) {
	if _, err := DBPool.Exec(ctx, `UPDATE support_drafts SET status='sent', sent_at=NOW() WHERE id=$1`, id); err != nil {
		log.Printf("[Drafts] markDraftSent for %d failed: %v", id, err)
	}
}

// markDraftFailed records that the Send path tried to send the reply
// and got a hard error from Resend. The partner may need to retry
// manually inside osTicket.
func markDraftFailed(ctx context.Context, id int64) {
	if _, err := DBPool.Exec(ctx, `UPDATE support_drafts SET status='failed' WHERE id=$1`, id); err != nil {
		log.Printf("[Drafts] markDraftFailed for %d failed: %v", id, err)
	}
}

// recordOSTicketMessageID stores a Message-ID we captured from a
// Resend webhook event so we can later set In-Reply-To when sending
// our AI reply. Idempotent via the UNIQUE(message_id) index.
func recordOSTicketMessageID(ctx context.Context, ticketNumber, messageID, recipient, direction string) error {
	const q = `
		INSERT INTO osticket_message_ids (ticket_number, message_id, recipient_email, direction)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (message_id) DO NOTHING
	`
	_, err := DBPool.Exec(ctx, q, ticketNumber, messageID, recipient, direction)
	return err
}

// fetchOSTicketMessageIDForReply returns the Message-ID of the most
// recent osTicket-originated email for this ticket. Used when sending
// our AI reply to set In-Reply-To correctly. Returns "" if none
// (which is fine — the reply will still send, just without threading).
func fetchOSTicketMessageIDForReply(ctx context.Context, ticketNumber string) string {
	const q = `
		SELECT message_id FROM osticket_message_ids
		WHERE ticket_number = $1 AND direction = 'outbound_osticket'
		ORDER BY captured_at DESC LIMIT 1
	`
	var id string
	if err := DBPool.QueryRow(ctx, q, ticketNumber).Scan(&id); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[Drafts] fetchOSTicketMessageIDForReply: %v", err)
		}
		return ""
	}
	return id
}
