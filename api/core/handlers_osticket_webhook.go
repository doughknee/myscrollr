package core

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// osTicket reply-loop webhook
// =============================================================================
//
// The Scrollr core API runs AI triage on the INITIAL message of every
// support ticket via the /support/ticket flow. That flow ends after
// the partner-approved AI reply lands in osTicket.
//
// When the user REPLIES to that reply (or to any subsequent agent
// message), the email lands at osTicket via IMAP polling. osTicket
// creates a new MessageThreadEntry on the existing ticket. Without
// this webhook the conversation dead-ends — no AI follow-up, no
// partner notification, the ticket just sits in osTicket awaiting a
// human.
//
// This handler closes that loop. The scrollr-reply-api plugin
// (osticket-plugins/scrollr-reply-api/notify.message.php) listens for
// osTicket's `threadentry.created` signal, filters to user messages
// that are NOT the first message on a ticket, and POSTs a payload
// here. We:
//
//   1. Validate the X-Scrollr-Webhook-Secret header (constant-time)
//   2. Dedupe — skip if a draft already exists for this thread_entry_id
//   3. Run AI triage with reply-context fields populated so the prompt
//      knows this is a follow-up (no greeting, build on prior advice)
//   4. Persist a support_drafts row tagged with the entry id
//   5. Notify the on-call partner via email with Send/Edit/Skip links
//
// On approval, the existing approval handlers post the AI reply back
// into osTicket via the plugin's /api/tickets/{number}/reply.json
// endpoint, which threads correctly and triggers the standard outbound
// user-notification email. The conversation continues.

type osTicketThreadMessageEvent struct {
	Event         string `json:"event"`
	TicketNumber  string `json:"ticket_number"`
	TicketID      int64  `json:"ticket_id"`
	ThreadEntryID int64  `json:"thread_entry_id"`
	UserEmail     string `json:"user_email"`
	UserName      string `json:"user_name"`
	Subject       string `json:"subject"`
	MessageHTML   string `json:"message_html"`
	Created       string `json:"created"`
}

// HandleOSTicketThreadMessage receives webhooks from the
// scrollr-reply-api plugin when a user posts a follow-up message on
// an existing ticket. Auth via shared secret.
func HandleOSTicketThreadMessage(c *fiber.Ctx) error {
	// 1. Auth — constant-time secret comparison.
	expected := os.Getenv("SCROLLR_WEBHOOK_SECRET")
	if expected == "" {
		log.Println("[OSTicketWebhook] SCROLLR_WEBHOOK_SECRET not set; rejecting")
		return c.Status(fiber.StatusServiceUnavailable).JSON(ErrorResponse{
			Status: "error",
			Error:  "webhook secret not configured",
		})
	}
	provided := c.Get("X-Scrollr-Webhook-Secret")
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		log.Println("[OSTicketWebhook] missing or invalid X-Scrollr-Webhook-Secret")
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "error",
			Error:  "unauthorized",
		})
	}

	// 2. Parse + minimal validation.
	var ev osTicketThreadMessageEvent
	if err := c.BodyParser(&ev); err != nil {
		log.Printf("[OSTicketWebhook] body parse: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "invalid request body",
		})
	}
	if ev.Event != "thread.message" {
		// Unknown event type — accept silently, return 200 so osTicket
		// doesn't think we failed. Log for observability.
		log.Printf("[OSTicketWebhook] ignoring unknown event=%q", ev.Event)
		return c.JSON(fiber.Map{"status": "ignored", "reason": "unknown event"})
	}
	if ev.TicketNumber == "" || ev.MessageHTML == "" {
		log.Printf("[OSTicketWebhook] missing required fields (ticket=%q body_len=%d)", ev.TicketNumber, len(ev.MessageHTML))
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "missing required fields",
		})
	}
	if ev.UserEmail == "" {
		// Without an email we can't do anything useful — partner
		// notification etc. would have nowhere to thread back to.
		log.Printf("[OSTicketWebhook] no user_email for ticket %s; skipping", ev.TicketNumber)
		return c.JSON(fiber.Map{"status": "ignored", "reason": "no user email"})
	}

	// 3. Dedupe via thread_entry_id. Same entry firing twice (osTicket
	//    quirks, plugin retries) won't generate duplicate drafts.
	if hasDraftForThreadEntry(c.Context(), ev.ThreadEntryID) {
		log.Printf("[OSTicketWebhook] draft already exists for thread_entry_id=%d (ticket=%s); skipping", ev.ThreadEntryID, ev.TicketNumber)
		return c.JSON(fiber.Map{"status": "ignored", "reason": "duplicate"})
	}

	// 4. Acknowledge fast — run triage + draft creation + partner
	//    notification in a background goroutine so we don't hold the
	//    osTicket plugin's HTTP request open while Anthropic ponders.
	//    Plugin's curl is configured with a 5s timeout; triage can
	//    take 5-10s. Fire-and-forget is the right shape.
	go processReplyTriageAsync(ev)

	return c.JSON(fiber.Map{
		"status":          "accepted",
		"ticket_number":   ev.TicketNumber,
		"thread_entry_id": ev.ThreadEntryID,
	})
}

// processReplyTriageAsync runs in a detached goroutine after the
// webhook returns 200. Failures are logged but never surfaced — the
// user's message is already persisted in osTicket; the worst case is
// the partner doesn't get an AI-drafted reply for this round and has
// to handle it manually inside osTicket.
func processReplyTriageAsync(ev osTicketThreadMessageEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Pull the most recent SENT reply on this ticket so the triage
	// prompt has continuity context. Best-effort — empty string is OK.
	previousReply := loadLatestSentDraftBody(ctx, ev.TicketNumber)

	// Resolve user name with a fallback. osTicket may have stripped
	// it depending on how the email arrived.
	userName := strings.TrimSpace(ev.UserName)
	if userName == "" {
		userName = fallbackName("", ev.UserEmail)
	}

	// Decode message HTML body. osTicket's Body::getClean() returns
	// the cleaned body — should already be safe. Truncate for the
	// triage prompt budget.
	body := ev.MessageHTML

	// Recent summaries for dupe-detection (same Redis sliding window
	// the initial-message flow uses). Cheap to fetch.
	recent := FetchRecentTicketSummaries(ctx)

	triage := triageTicket(ctx, TriageInput{
		UserCategory:        "", // user didn't pick anything — they're replying to email
		UserEmail:           ev.UserEmail,
		UserName:            userName,
		Subject:             ev.Subject,
		Body:                body,
		RecentSummaries:     recent,
		IsReply:             true,
		ReplyTicketNumber:   ev.TicketNumber,
		PreviousAIReplyHTML: previousReply,
	})
	if triage == nil {
		log.Printf("[OSTicketWebhook] triage returned nil for ticket %s (entry=%d); no draft created", ev.TicketNumber, ev.ThreadEntryID)
		return
	}

	// Persist draft tagged with the thread_entry_id.
	draft, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber:          ev.TicketNumber,
		UserEmail:             ev.UserEmail,
		UserName:              userName,
		OriginalSubject:       ev.Subject,
		DraftBodyHTML:         triage.DraftReplyHTML,
		AISummary:             triage.Summary,
		AICategory:            triage.Category,
		AIPriority:            triage.Priority,
		AIChannel:             triage.Channel,
		AIDuplicateOf:         triage.DuplicateOf,
		AIConfidence:          triage.Confidence,
		OSTicketThreadEntryID: ev.ThreadEntryID,
		ShouldClose:           triage.ShouldClose,
	})
	if err != nil {
		log.Printf("[OSTicketWebhook] createSupportDraft for ticket %s entry=%d: %v", ev.TicketNumber, ev.ThreadEntryID, err)
		return
	}

	// Notify the on-call partner — same email shape as initial-ticket
	// notifications, just with the user's reply quoted instead of the
	// initial complaint.
	notifyPartnerAfterDraft(ctx, draft)

	log.Printf("[OSTicketWebhook] reply triaged for ticket=%s entry=%d draft_id=%d category=%s confidence=%s",
		ev.TicketNumber, ev.ThreadEntryID, draft.ID, triage.Category, triage.Confidence)
}

// fallbackName is defined in handlers_support_public.go and reused here.

// Compile-time assertion that the JSON package is wired (we use it
// indirectly via Fiber's BodyParser). Keeps the import non-redundant
// if the parser layer ever changes.
var _ = json.Marshal
