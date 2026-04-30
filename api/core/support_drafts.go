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

// =============================================================================
// Outbound replies + partner notifications via Resend
// =============================================================================

// doSendApprovedReply sends the partner-approved reply email via
// Resend with proper In-Reply-To and References headers so osTicket
// can thread it back into the original ticket. Also BCCs the support@
// address so osTicket has its own copy of the agent reply via inbound
// piping.
//
// We don't surface threading-failure as a hard error: if no
// osTicket-side Message-ID has been captured yet, the reply still
// goes out — the user just sees a fresh thread. Threading is
// best-effort and depends on the Resend webhook having fired before
// the partner clicks Send.
func doSendApprovedReply(ctx context.Context, draft *SupportDraft, body string) error {
	resendKey := os.Getenv("RESEND_API_KEY")
	if resendKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}
	from := os.Getenv("SUPPORT_REPLY_FROM_EMAIL")
	if from == "" {
		from = "support@myscrollr.com"
	}
	bcc := os.Getenv("OSTICKET_BCC_EMAIL")
	if bcc == "" {
		bcc = "support@myscrollr.com"
	}

	osticketMsgID := fetchOSTicketMessageIDForReply(ctx, draft.TicketNumber)

	var headers []map[string]string
	if osticketMsgID != "" {
		// Email standard requires Message-IDs to be wrapped in <>
		wrappedID := osticketMsgID
		if !strings.HasPrefix(wrappedID, "<") {
			wrappedID = "<" + wrappedID + ">"
		}
		headers = append(headers,
			map[string]string{"name": "In-Reply-To", "value": wrappedID},
			map[string]string{"name": "References", "value": wrappedID},
		)
	}

	subject := "Re: [#" + draft.TicketNumber + "] " + draft.OriginalSubject

	payload := map[string]interface{}{
		"from":    from,
		"to":      []string{draft.UserEmail},
		"bcc":     []string{bcc},
		"subject": subject,
		"html":    body,
	}
	if len(headers) > 0 {
		payload["headers"] = headers
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+resendKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		respBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, string(respBytes))
	}

	log.Printf("[Drafts] reply sent for ticket=%s to=%s in-reply-to-set=%v",
		draft.TicketNumber, draft.UserEmail, osticketMsgID != "")
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
  <div style="background:#f9f9f9;padding:12px;border-radius:6px;font-size:13px;color:#333;border-left:3px solid #10b981;">
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
		draft.DraftBodyHTML, // already HTML, don't double-escape
		sendURL, editURL, skipURL,
		html.EscapeString(draft.OriginalSubject),
	)

	resendKey := os.Getenv("RESEND_API_KEY")
	if resendKey == "" {
		return fmt.Errorf("RESEND_API_KEY not set")
	}
	from := os.Getenv("RESEND_FROM_EMAIL")
	if from == "" {
		from = "noreply@myscrollr.com"
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
