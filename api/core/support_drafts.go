package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
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
// transition its status, and — on Send — post the approved reply
// directly into osTicket via the scrollr-reply-api plugin
// (doSendApprovedReply, below).

// SupportDraft mirrors the support_drafts table.
type SupportDraft struct {
	ID                    int64
	TicketNumber          string
	UserEmail             string
	UserName              string
	OriginalSubject       string
	UserMessageHTML       string // The user's actual message body (for partner-email context). Separate from DraftBodyHTML which is the AI-drafted reply.
	DraftBodyHTML         string
	AISummary             string
	AICategory            string
	AIPriority            string
	AIChannel             string
	AIDuplicateOf         string
	AIConfidence          string
	Status                string
	EditedBodyHTML        string
	OSTicketThreadEntryID int64 // 0 = unknown (legacy rows + initial /support/ticket flow)
	ShouldClose           bool  // AI-detected resolution signal — when true, send-time also closes the ticket
	DecidedAt             *time.Time
	SentAt                *time.Time
	CreatedAt             time.Time
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
			 user_message_html,
			 draft_body_html, ai_summary, ai_category, ai_priority,
			 ai_channel, ai_duplicate_of, ai_confidence, status,
			 osticket_thread_entry_id, should_close)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14)
		RETURNING id, created_at
	`
	// 0 → NULL via NULLIF so the partial unique index doesn't reject
	// the row (legacy / /support-ticket-flow rows have no entry id).
	var entryID *int64
	if draft.OSTicketThreadEntryID > 0 {
		entryID = &draft.OSTicketThreadEntryID
	}
	// user_message_html is nullable for back-compat with old rows; we
	// always populate it on new writes but use NULL when the field is
	// empty so the column reads as the absence of a message rather
	// than an empty string.
	var userMsg *string
	if draft.UserMessageHTML != "" {
		userMsg = &draft.UserMessageHTML
	}
	err := DBPool.QueryRow(ctx, q,
		draft.TicketNumber,
		draft.UserEmail,
		draft.UserName,
		draft.OriginalSubject,
		userMsg,
		draft.DraftBodyHTML,
		draft.AISummary,
		draft.AICategory,
		draft.AIPriority,
		draft.AIChannel,
		draft.AIDuplicateOf,
		draft.AIConfidence,
		entryID,
		draft.ShouldClose,
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
			   user_message_html,
			   draft_body_html, ai_summary, ai_category, ai_priority,
			   ai_channel, ai_duplicate_of, ai_confidence, status,
			   edited_body_html, decided_at, sent_at, created_at,
			   should_close
		FROM support_drafts WHERE id = $1
	`
	var d SupportDraft
	var userName, userMsg, summary, category, priority, channel, dupOf, confidence, editedBody *string
	err := DBPool.QueryRow(ctx, q, id).Scan(
		&d.ID, &d.TicketNumber, &d.UserEmail, &userName, &d.OriginalSubject,
		&userMsg,
		&d.DraftBodyHTML, &summary, &category, &priority, &channel,
		&dupOf, &confidence, &d.Status,
		&editedBody, &d.DecidedAt, &d.SentAt, &d.CreatedAt,
		&d.ShouldClose,
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
	if userMsg != nil {
		d.UserMessageHTML = *userMsg
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

// loadLatestSentDraftBody returns the most recent SENT reply we've
// posted on this ticket. Used by the reply-loop webhook to give the
// AI continuity (so it doesn't repeat the same suggestion verbatim
// when the user follows up). Returns "" when no sent draft exists or
// on any DB error — the triage call still succeeds without it.
func loadLatestSentDraftBody(ctx context.Context, ticketNumber string) string {
	const q = `
		SELECT COALESCE(NULLIF(edited_body_html, ''), draft_body_html)
		FROM support_drafts
		WHERE ticket_number = $1 AND status = 'sent'
		ORDER BY sent_at DESC NULLS LAST, id DESC
		LIMIT 1
	`
	var body string
	if err := DBPool.QueryRow(ctx, q, ticketNumber).Scan(&body); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[Drafts] loadLatestSentDraftBody for ticket %s: %v", ticketNumber, err)
		}
		return ""
	}
	return body
}

// hasDraftForThreadEntry returns true if a support_drafts row already
// exists for the given osTicket thread_entry_id. Used by the webhook
// handler to dedupe (in case osTicket signals fire twice for the same
// entry, or the plugin re-fires after a transient failure).
func hasDraftForThreadEntry(ctx context.Context, threadEntryID int64) bool {
	if threadEntryID <= 0 {
		return false
	}
	var exists bool
	const q = `SELECT EXISTS(SELECT 1 FROM support_drafts WHERE osticket_thread_entry_id = $1)`
	if err := DBPool.QueryRow(ctx, q, threadEntryID).Scan(&exists); err != nil {
		log.Printf("[Drafts] hasDraftForThreadEntry(%d): %v", threadEntryID, err)
		return false
	}
	return exists
}

// =============================================================================
// Outbound replies via the osTicket scrollr-reply-api plugin
// =============================================================================

// doSendApprovedReply posts the partner-approved reply directly to
// osTicket via the scrollr-reply-api plugin (POST
// /api/tickets/{number}/reply.json). osTicket then:
//   - Creates a thread entry of type='R' (Response — agent reply)
//     attributed to the configured staff agent
//   - Sends the user-notification email through Dept::getReplyEmail()
//     using its own template set, signature, and from-address
//   - Sets isanswered=1 and bumps lastupdate on the ticket
//
// This replaces an earlier Resend-BCC pattern that tried to thread
// replies into osTicket via inbound mail. That approach failed
// architecturally: osTicket treats inbound mail from a staff address
// as a NOTE (type='N'), not a reply, AND does NOT trigger an outbound
// user notification. The plugin path is the only way to get a real
// agent reply with a real outbound email through osTicket's mailer.
// See osticket-plugins/scrollr-reply-api/README.md for the rationale.
func doSendApprovedReply(ctx context.Context, draft *SupportDraft, body string) error {
	// Decorate the AI-drafted body with a small CTA footer that gives
	// users a clear path to either continue the conversation or signal
	// resolution (which the AI will detect on the reply and mark the
	// ticket should_close=true). osTicket's email template wraps this
	// further; our footer lives inside that wrapper.
	decoratedBody := decorateUserReplyHTML(body, draft.ShouldClose)

	payload := map[string]interface{}{
		"reply_html":   decoratedBody,
		"signal_alert": true, // ALWAYS true — that's the whole point of this path
	}

	// Optional: pin a specific staff agent. When unset, the plugin
	// falls back to the ticket's currently-assigned agent (or returns
	// 400 if the ticket has no assignee).
	if staffIDStr := os.Getenv("SUPPORT_AGENT_STAFF_ID"); staffIDStr != "" {
		if id, err := strconv.Atoi(strings.TrimSpace(staffIDStr)); err == nil && id > 0 {
			payload["staff_id"] = id
		} else {
			log.Printf("[Drafts] SUPPORT_AGENT_STAFF_ID=%q is not a positive integer; falling back to ticket assignee", staffIDStr)
		}
	}

	// Auto-close: when the AI flagged this as a resolution-style reply,
	// pass close_ticket=true so the plugin closes the ticket after
	// posting. The partner already approved by clicking Send, which
	// is the human-in-the-loop confirmation that the close is correct.
	if draft.ShouldClose {
		payload["close_ticket"] = true
		log.Printf("[Drafts] reply for ticket=%s will close ticket (should_close=true)", draft.TicketNumber)
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	path := "/api/tickets/" + draft.TicketNumber + "/reply.json"
	status, respBody, err := postOSTicketJSON(ctx, path, payloadBytes)
	if err != nil {
		return fmt.Errorf("osticket reply (status=%d body=%s): %w", status, string(respBody), err)
	}

	log.Printf("[Drafts] reply posted to osTicket for ticket=%s status=%d body=%s",
		draft.TicketNumber, status, string(respBody))
	return nil
}

// SendPartnerNotification emails the support agent (partner) with the
// AI-drafted reply and three approval links. Sent via Resend.
//
// If SUPPORT_AGENT_EMAIL isn't configured, returns nil — the draft is
// still persisted, the partner just won't get a notification email
// for this round.
func SendPartnerNotification(ctx context.Context, draft *SupportDraft) error {
	agentEmail := os.Getenv("SUPPORT_AGENT_EMAIL")
	if agentEmail == "" {
		log.Println("[Drafts] SUPPORT_AGENT_EMAIL not set; skipping partner notification")
		return nil
	}

	sendURL, editURL, skipURL, err := buildApprovalURLs(draft.ID)
	if err != nil {
		return fmt.Errorf("build approval URLs: %w", err)
	}

	// Build the "what the user wrote" block. Hidden when we don't have
	// the body (legacy rows). User-supplied HTML is rendered verbatim
	// inside a styled container; the upstream Contact Us form already
	// goes through escapeHTML when triage builds the prompt, so what's
	// in user_message_html is safe-ish HTML already. We still wrap it
	// so it's visually distinct from the AI's draft.
	userMessageBlock := ""
	if draft.UserMessageHTML != "" {
		userMessageBlock = fmt.Sprintf(`<div style="padding:0 24px 20px;">
  <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">What the user wrote</p>
  <div style="background:#fafafa;padding:12px;border-radius:6px;font-size:13px;color:#444;border-left:3px solid #6b7280;line-height:1.5;">
    %s
  </div>
</div>`, draft.UserMessageHTML)
	}

	// Local var name `htmlBody` to avoid shadowing the imported `html` package.
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">
<div style="padding:20px 24px;border-bottom:1px solid #e5e5e5;">
  <h1 style="margin:0 0 4px;font-size:18px;color:#10b981;">New ticket — draft ready</h1>
  <p style="margin:0;font-size:12px;color:#888;">Ticket #%s · From %s</p>
</div>
<div style="padding:20px 24px;">
  <p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>AI summary:</strong> %s</p>
  <p style="margin:0 0 16px;font-size:11px;color:#666;">Category: %s · Priority: %s · Confidence: %s</p>
</div>
%s
<div style="padding:0 24px 20px;">
  <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;">AI-drafted reply</p>
  <div style="background:#f9f9f9;padding:12px;border-radius:6px;font-size:13px;color:#333;border-left:3px solid #10b981;line-height:1.5;">
    %s
  </div>
</div>
<div style="padding:20px 24px;border-top:1px solid #e5e5e5;">
  <table cellpadding="0" cellspacing="0" border="0" style="width:100%%;">
    <tr>
      <td><a href="%s" style="display:inline-block;background:#10b981;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Send</a></td>
      <td><a href="%s" style="display:inline-block;background:#3b82f6;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Edit</a></td>
      <td align="right"><a href="%s" style="display:inline-block;background:#6b7280;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Skip</a></td>
    </tr>
  </table>
</div>
<div style="padding:12px 24px;border-top:1px solid #e5e5e5;background:#fafafa;font-size:11px;color:#999;">
  <p style="margin:0;">Subject: %s</p>
  <p style="margin:0;">Links expire in 24h. Single-use.</p>
</div>
</div>
</body></html>`,
		html.EscapeString(draft.TicketNumber),
		html.EscapeString(draft.UserEmail),
		html.EscapeString(draft.AISummary),
		html.EscapeString(draft.AICategory),
		html.EscapeString(draft.AIPriority),
		html.EscapeString(draft.AIConfidence),
		userMessageBlock,    // empty string when no user message available; otherwise the styled block
		draft.DraftBodyHTML, // already HTML, don't double-escape
		sendURL, editURL, skipURL,
		html.EscapeString(draft.OriginalSubject),
	)

	resendKey := os.Getenv("RESEND_API_KEY")
	if resendKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}
	// Partner approval emails are sent FROM the support address so they
	// match the rest of the support pipeline (osTicket auto-responses,
	// AI replies, etc.) instead of the marketing/invites address. Reuse
	// SUPPORT_REPLY_FROM_EMAIL since it already exists and points at
	// support@. Fall back to the legacy RESEND_FROM_EMAIL only if the
	// support-specific one is unset.
	from := os.Getenv("SUPPORT_REPLY_FROM_EMAIL")
	if from == "" {
		from = os.Getenv("RESEND_FROM_EMAIL")
	}
	if from == "" {
		from = "support@myscrollr.com"
	}

	payload := map[string]interface{}{
		"from":    from,
		"to":      []string{agentEmail},
		"subject": fmt.Sprintf("[#%s] Draft ready: %s", draft.TicketNumber, draft.AISummary),
		"html":    htmlBody,
	}
	bodyBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build resend req: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+resendKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend send: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// init wires the Phase-1A/1C indirection seams to the real
// implementations in this file. Keeping the bind here lets each phase
// compile independently while still ending up with a single working
// flow at deploy time.
func init() {
	sendApprovedReply = doSendApprovedReply
	notifyPartnerAfterDraft = func(ctx context.Context, draft *SupportDraft) {
		if err := SendPartnerNotification(ctx, draft); err != nil {
			log.Printf("[Drafts] SendPartnerNotification for ticket %s failed: %v", draft.TicketNumber, err)
		}
	}
}
