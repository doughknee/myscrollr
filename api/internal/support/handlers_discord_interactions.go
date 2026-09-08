package support

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Discord interactions handler — POST /webhooks/discord/interactions
// =============================================================================
//
// Discord POSTs all interaction events (slash commands, button clicks,
// modal submissions) to a single endpoint. Each request is signed with
// Ed25519 using the application's signing key. We verify the signature
// before processing, respond inline.
//
// Interaction types we handle:
//   - PING (1)               — Discord verifies the endpoint URL
//   - APPLICATION_COMMAND (2) — slash commands (/inbox, /ticket)
//   - MESSAGE_COMPONENT (3)   — button clicks (Send, Edit, Skip)
//   - MODAL_SUBMIT (5)        — partner submitting an edited reply
//
// Response types we use:
//   - PONG (1)                          — for PING
//   - CHANNEL_MESSAGE_WITH_SOURCE (4)   — visible message
//   - DEFERRED_CHANNEL_MESSAGE (5)      — "thinking..." placeholder
//   - MODAL (9)                         — open a modal
//   - UPDATE_MESSAGE (7)                — edit the message that triggered the interaction
//
// Discord docs: https://discord.com/developers/docs/interactions/receiving-and-responding

// Discord interaction types.
const (
	discordInteractionPing               = 1
	discordInteractionApplicationCommand = 2
	discordInteractionMessageComponent   = 3
	discordInteractionModalSubmit        = 5
)

// Discord interaction response types.
const (
	discordResponsePong                     = 1
	discordResponseChannelMessageWithSource = 4
	discordResponseDeferredChannelMessage   = 5
	discordResponseUpdateMessage            = 7
	discordResponseDeferredUpdateMessage    = 6
	discordResponseModal                    = 9
)

// discordInteractionFlagEphemeral marks a response as visible only to
// the user who triggered it. Used for confirmations and errors so we
// don't clutter the channel.
const discordInteractionFlagEphemeral = 64

// discordInteraction is the part of Discord's interaction payload we
// actually consume. The full schema has many more fields; we ignore them.
type discordInteraction struct {
	ID            string                  `json:"id"`
	Type          int                     `json:"type"`
	Token         string                  `json:"token"`
	ApplicationID string                  `json:"application_id"`
	GuildID       string                  `json:"guild_id"`
	ChannelID     string                  `json:"channel_id"`
	Member        *discordMember          `json:"member"`
	Data          *discordInteractionData `json:"data"`
}

type discordMember struct {
	User *discordUser `json:"user"`
}

type discordUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type discordInteractionData struct {
	// APPLICATION_COMMAND fields
	Name    string                         `json:"name"`
	Options []discordInteractionDataOption `json:"options,omitempty"`
	// MESSAGE_COMPONENT fields
	CustomID      string `json:"custom_id"`
	ComponentType int    `json:"component_type"`
	// MODAL_SUBMIT fields
	Components []discordModalComponentRow `json:"components,omitempty"`
}

type discordInteractionDataOption struct {
	Name  string `json:"name"`
	Type  int    `json:"type"`
	Value string `json:"value"`
}

type discordModalComponentRow struct {
	Type       int                          `json:"type"`
	Components []discordModalComponentInput `json:"components"`
}

type discordModalComponentInput struct {
	Type     int    `json:"type"`
	CustomID string `json:"custom_id"`
	Value    string `json:"value"`
}

// HandleDiscordInteractions verifies the signature, dispatches by
// interaction type, returns the appropriate response.
//
// Only requires DISCORD_PUBLIC_KEY to be set — Discord's URL
// verification PING uses only the public key. Outbound paths invoked
// from button + modal handlers (e.g. discordArchiveThread) gate on
// loadDiscordConfig themselves and degrade gracefully when the bot
// token isn't yet wired.
func HandleDiscordInteractions(c *fiber.Ctx) error {
	publicKey, ok := loadDiscordPublicKey()
	if !ok {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "DISCORD_PUBLIC_KEY not configured",
		})
	}

	signature := c.Get("X-Signature-Ed25519")
	timestamp := c.Get("X-Signature-Timestamp")
	if signature == "" || timestamp == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("missing signature headers")
	}

	body := c.Body()
	if err := verifyDiscordSignature(publicKey, signature, timestamp, body); err != nil {
		log.Printf("[DiscordInteraction] signature verify failed: %v", err)
		return c.Status(fiber.StatusUnauthorized).SendString("invalid signature")
	}

	var interaction discordInteraction
	if err := json.Unmarshal(body, &interaction); err != nil {
		log.Printf("[DiscordInteraction] body parse: %v", err)
		return c.Status(fiber.StatusBadRequest).SendString("malformed body")
	}

	switch interaction.Type {
	case discordInteractionPing:
		return c.JSON(fiber.Map{"type": discordResponsePong})
	case discordInteractionApplicationCommand:
		return handleDiscordSlashCommand(c, &interaction)
	case discordInteractionMessageComponent:
		return handleDiscordButtonClick(c, &interaction)
	case discordInteractionModalSubmit:
		return handleDiscordModalSubmit(c, &interaction)
	default:
		log.Printf("[DiscordInteraction] unknown type %d", interaction.Type)
		return c.Status(fiber.StatusBadRequest).SendString("unknown interaction type")
	}
}

// =============================================================================
// Button clicks — Send / Edit / Skip
// =============================================================================

// handleDiscordButtonClick routes button presses by the action prefix
// in their `custom_id`.
//
// custom_id format: "support_<action>:<draft_id>" where action is
// send / edit / skip.
func handleDiscordButtonClick(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}
	customID := ix.Data.CustomID
	parts := strings.SplitN(customID, ":", 2)
	if len(parts) != 2 {
		return discordEphemeralResponse(c, "malformed custom_id")
	}
	prefix, idStr := parts[0], parts[1]

	// Two buttons carry something other than a draft id: /inbox paging carries
	// an offset, and a /link confirmation carries the pair it is confirming.
	if prefix == "support_link" {
		return handleDiscordLinkConfirm(c, idStr)
	}
	if prefix == "support_inbox" {
		offset, err := strconv.Atoi(idStr)
		if err != nil || offset < 0 {
			return discordEphemeralResponse(c, "malformed page offset")
		}
		return respondWithInboxPage(c, offset, discordResponseUpdateMessage)
	}

	draftID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return discordEphemeralResponse(c, "malformed draft id")
	}

	switch prefix {
	case "support_send":
		return handleDiscordSendAction(c, ix, draftID)
	case "support_hold":
		return handleDiscordHoldAction(c, ix, draftID)
	case "support_edit":
		return handleDiscordEditOpenModal(c, ix, draftID)
	case "support_ask":
		return handleDiscordAskOpenModal(c, ix, draftID)
	case "support_skip":
		return handleDiscordSkipAction(c, ix, draftID)
	case "support_bug":
		return handleDiscordFileAsBug(c, ix, draftID)
	default:
		log.Printf("[DiscordInteraction] unknown button prefix %q", prefix)
		return discordEphemeralResponse(c, "unknown action")
	}
}

// handleDiscordSendAction calls the existing approve-and-send flow.
func handleDiscordSendAction(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil {
		log.Printf("[DiscordInteraction] load draft %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not load draft.")
	}
	if draft == nil {
		return discordEphemeralResponse(c, "Draft not found (already actioned?).")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	// Atomic decide → approved (no edits). Same call the email
	// approval flow makes for the Send action.
	if err := markDraftDecided(ctx, draftID, "approved", ""); err != nil {
		log.Printf("[DiscordInteraction] markDraftDecided for %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not mark draft as approved.")
	}
	// Reload to get the post-mark state (status='approved').
	draft, _ = loadSupportDraft(ctx, draftID)

	// Fire-and-forget the actual reply send + thread state transition.
	// On send success: flip thread to "sent" tag, prefix [SENT] in name.
	// If close-flag also set: append "closed" tag, archive thread.
	// On send failure: leave thread in "pending" so partner can retry.
	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()
		if err := sendDraftReply(bgCtx, draft, draft.DraftBodyHTML); err != nil {
			log.Printf("[DiscordInteraction] sendDraftReply for ticket %s: %v",
				draft.TicketNumber, err)
			return
		}
		applySendStateToThread(bgCtx, draft, draft.ShouldClose)
	}()

	// Render a richer confirmation than just "✅ Sent" — give the
	// partner the recipient + ticket-number + auto-close indicator
	// without making them re-read the thread header.
	confirmation := buildSendConfirmation(draft)
	return discordVisibleResponse(c, confirmation)
}

// buildSendConfirmation renders the post-Send message visible in the
// thread. Includes the ticket number, recipient, and close-state hint
// so the partner doesn't need to scroll back up to see what they sent.
// The reporter's email address is deliberately NOT in here. The thread is
// a queue, not a CRM: the ticket number identifies the case, and osTicket
// holds the address.
func buildSendConfirmation(draft *SupportDraft) string {
	var b strings.Builder
	b.WriteString("✅ Sent — ticket #")
	b.WriteString(draft.TicketNumber)
	b.WriteString(" marked answered in osTicket.")
	if draft.ShouldClose {
		b.WriteString("\n🔒 Ticket auto-closing (AI flagged resolution).")
	}
	return b.String()
}

// applySendStateToThread updates the thread's tags + name after a
// successful send. Used by both the regular Send and the Edit-then-
// Send paths. closing=true also archives the thread (terminal state).
//
// All Discord operations here are fail-open — log + continue. The
// reply has already been sent to the user; thread cosmetics shouldn't
// block that success.
func applySendStateToThread(ctx context.Context, draft *SupportDraft, closing bool) {
	t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil || t == nil {
		return
	}

	// Status tag transition: pending → sent (or pending → closed).
	newStatus := "sent"
	if closing {
		// "closed" tag is appended on top of "sent" so the thread is
		// visually marked both — partner can scan for closed-out
		// tickets in the tag filter.
		newStatus = "sent"
	}
	transitionThreadStatus(ctx, t, newStatus, closing)

	// Thread-name prefix: [SENT] or [CLOSED] so the thread list
	// reflects state without clicking in.
	prefix := "[SENT] "
	if closing {
		prefix = "[CLOSED] "
	}
	if newName := buildPrefixedThreadName(prefix, draft); newName != "" {
		if err := discordUpdateThreadName(ctx, t.DiscordThreadID, newName); err != nil {
			log.Printf("[DiscordInteraction] rename thread for ticket %s: %v",
				draft.TicketNumber, err)
		}
	}

	// Final step on close: archive the thread.
	if closing {
		if err := discordArchiveThread(ctx, t.DiscordThreadID); err != nil {
			log.Printf("[DiscordInteraction] archive thread for ticket %s: %v",
				draft.TicketNumber, err)
		} else {
			_ = markSupportTicketThreadArchived(ctx, draft.TicketNumber)
		}
	}
}

// applySkipStateToThread updates tags + name on the Skip path.
func applySkipStateToThread(ctx context.Context, draft *SupportDraft) {
	t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil || t == nil {
		return
	}
	transitionThreadStatus(ctx, t, "skipped", false)
	if newName := buildPrefixedThreadName("[SKIPPED] ", draft); newName != "" {
		if err := discordUpdateThreadName(ctx, t.DiscordThreadID, newName); err != nil {
			log.Printf("[DiscordInteraction] rename thread (skip) for ticket %s: %v",
				draft.TicketNumber, err)
		}
	}
}

// buildPrefixedThreadName composes a new thread name with the given
// prefix in front of the existing format. Preserves priority emoji
// + ticket number + truncated subject. Returns "" if name would
// exceed Discord's 100-char limit even after truncation (defensive).
func buildPrefixedThreadName(prefix string, draft *SupportDraft) string {
	subject := draft.OriginalSubject
	if subject == "" {
		subject = "support ticket"
	}
	priority := priorityEmojiPrefix(draft.AIPriority)
	// Compute remaining budget: 100 - prefix - priority - "[#NNNNNN] "
	overhead := len(prefix) + len(priority) + len(draft.TicketNumber) + 4 // "[#] "
	budget := 100 - overhead
	if budget < 10 {
		// Extreme case — drop subject entirely.
		return fmt.Sprintf("%s%s[#%s]", prefix, priority, draft.TicketNumber)
	}
	subject = truncateRunes(subject, budget)
	return fmt.Sprintf("%s%s[#%s] %s", prefix, priority, draft.TicketNumber, subject)
}

// handleDiscordEditOpenModal opens a modal so the partner can edit the
// AI's draft before sending. The modal's text-area is pre-filled with
// the current draft body (HTML stripped to plain text since Discord
// modals are plain-text only).
func handleDiscordEditOpenModal(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	stopHoldForModal(draftID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil {
		log.Printf("[DiscordInteraction] load draft %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not load draft.")
	}
	if draft == nil {
		return discordEphemeralResponse(c, "Draft not found.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	// Convert draft HTML to plain text for the modal's text area.
	prefilled := truncateRunes(htmlToPlain(draft.DraftBodyHTML), 4000)

	components := []fiber.Map{
		{
			"type": 1,
			"components": []fiber.Map{
				{
					"type":        4,
					"custom_id":   "edited_body",
					"label":       "Reply body (plain text)",
					"style":       2, // Paragraph
					"value":       prefilled,
					"min_length":  1,
					"max_length":  4000,
					"required":    true,
					"placeholder": "Edit the reply...",
				},
			},
		},
	}

	// Second field: the user's own words, pre-filled and optional. Discord
	// has no read-only input, so this is the only way to keep the question
	// in front of whoever is rewriting the answer — the modal covers the
	// thread while it is open, and the old flow made people cancel out to
	// re-read what was asked. Its submitted value is ignored.
	if userMsg := strings.TrimSpace(htmlToPlain(draft.UserMessageHTML)); userMsg != "" {
		components = append(components, fiber.Map{
			"type": 1,
			"components": []fiber.Map{
				{
					"type":       4,
					"custom_id":  "user_message_context",
					"label":      "What the user asked (reference only)",
					"style":      2,
					"value":      truncateRunes(userMsg, 4000),
					"max_length": 4000,
					"required":   false,
				},
			},
		})
	}

	resp := fiber.Map{
		"type": discordResponseModal,
		"data": fiber.Map{
			"custom_id":  fmt.Sprintf("support_edit_modal:%d", draftID),
			"title":      fmt.Sprintf("Edit reply for #%s", draft.TicketNumber),
			"components": components,
		},
	}
	return c.JSON(resp)
}

// handleDiscordAskOpenModal opens the one-field modal behind the Ask
// button: a single clarifying question, sent to the user in place of the
// drafted answer. A draft that needs information the ticket does not carry
// is worse than no draft, and this is the cheap way out of that corner.
func handleDiscordAskOpenModal(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	stopHoldForModal(draftID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return discordEphemeralResponse(c, "Could not load draft.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	// Triage's own "what I still need" line (REL-244) is the obvious
	// first draft of the question, so it pre-fills the box.
	prefilled := truncateRunes(strings.TrimSpace(draft.AskUserFor), 1000)

	resp := fiber.Map{
		"type": discordResponseModal,
		"data": fiber.Map{
			"custom_id": fmt.Sprintf("support_ask_modal:%d", draftID),
			"title":     fmt.Sprintf("Ask about #%s", draft.TicketNumber),
			"components": []fiber.Map{
				{
					"type": 1,
					"components": []fiber.Map{
						{
							"type":        4,
							"custom_id":   "ask_body",
							"label":       "Question to send the user",
							"style":       2,
							"value":       prefilled,
							"min_length":  1,
							"max_length":  1000,
							"required":    true,
							"placeholder": "Which version are you on, and does it happen on every launch?",
						},
					},
				},
			},
		},
	}
	return c.JSON(resp)
}

// stopHoldForModal clears the countdown when someone opens Edit or Ask. The
// old flow relied on the status changing to cancel a pending send, but the
// status does not change until the modal is submitted — and typing a reply
// takes longer than a hold that is nearly up. Cancelling on open, rather than
// on submit, is what makes "I am working on this one" mean something.
//
// Best-effort and synchronous: it is one UPDATE, and getting it wrong sends a
// draft out from under the person editing it.
func stopHoldForModal(draftID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := holdDraft(ctx, draftID); err != nil && !errors.Is(err, ErrAlreadyDecided) {
		log.Printf("[DiscordInteraction] stop hold for draft %d: %v", draftID, err)
	}
}

// handleDiscordSkipAction marks the draft as skipped.
func handleDiscordSkipAction(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil {
		return discordEphemeralResponse(c, "Could not load draft.")
	}
	if draft == nil {
		return discordEphemeralResponse(c, "Draft not found.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	if err := markDraftDecided(ctx, draftID, "skipped", ""); err != nil {
		log.Printf("[DiscordInteraction] markDraftDecided (skipped) %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not skip draft.")
	}

	markIntervened(ctx, draftID)

	// Update thread cosmetics fire-and-forget.
	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer bgCancel()
		applySkipStateToThread(bgCtx, draft)
	}()

	return discordVisibleResponse(c,
		fmt.Sprintf("⏭️ Skipped — ticket #%s left without an AI reply.", draft.TicketNumber))
}

// handleDiscordHoldAction stops a running countdown without deciding the
// draft. The row stays pending with its buttons; it simply stops being
// something that happens on its own.
//
// Hold is the button this ticket adds, and the one that says the most: it is
// a person saying "not this one, not yet" without having to also say what
// should happen instead. It counts as an intervention.
func handleDiscordHoldAction(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return discordEphemeralResponse(c, "Draft not found.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}
	if err := holdDraft(ctx, draftID); err != nil {
		log.Printf("[DiscordInteraction] holdDraft %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not hold this draft.")
	}
	return discordVisibleResponse(c, fmt.Sprintf(
		"✋ Held — ticket #%s will not send by itself. Send, Edit, Ask or Skip when you are ready.",
		draft.TicketNumber))
}

// =============================================================================
// Modal submit — partner submitted edited reply
// =============================================================================

// handleDiscordModalSubmit processes the modal-submit event from the
// Edit flow. Reads the edited body out of the components array,
// applies it to the draft, and dispatches the reply.
func handleDiscordModalSubmit(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}
	customID := ix.Data.CustomID
	parts := strings.SplitN(customID, ":", 2)
	if len(parts) != 2 {
		return discordEphemeralResponse(c, "malformed modal custom_id")
	}
	draftID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return discordEphemeralResponse(c, "malformed draft id")
	}
	switch parts[0] {
	case "support_edit_modal":
	case "support_ask_modal":
		return handleDiscordAskSubmit(c, ix, draftID)
	default:
		return discordEphemeralResponse(c, "malformed modal custom_id")
	}

	editedBody := strings.TrimSpace(modalFieldValue(ix, "edited_body"))
	if editedBody == "" {
		return discordEphemeralResponse(c, "Edited body is empty.")
	}

	// Wrap plain-text in basic HTML so the email rendering path doesn't
	// break. Existing pipeline expects HTML.
	editedBodyHTML := plainToHTMLParagraphs(editedBody)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return discordEphemeralResponse(c, "Draft not found.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	// Atomic decide → edited with the edited body persisted on the row.
	if err := markDraftDecided(ctx, draftID, "edited", editedBodyHTML); err != nil {
		log.Printf("[DiscordInteraction] markDraftDecided (edited) %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not save edits.")
	}
	markIntervened(ctx, draftID)
	draft, _ = loadSupportDraft(ctx, draftID)

	originalBody := draft.DraftBodyHTML
	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()
		if err := sendDraftReply(bgCtx, draft, editedBodyHTML); err != nil {
			log.Printf("[DiscordInteraction] sendDraftReply (edited) for ticket %s: %v",
				draft.TicketNumber, err)
			return
		}
		// Edit-then-send still goes through the same thread state
		// transitions as plain Send. Tag flips to "edited" instead of
		// "sent" so we can distinguish them in /stats.
		applyEditStateToThread(bgCtx, draft, draft.ShouldClose)
		postEditDiff(bgCtx, draft, htmlToPlain(originalBody), editedBody)
	}()

	confirmation := buildEditConfirmation(draft)
	return discordVisibleResponse(c, confirmation)
}

// buildEditConfirmation parallels buildSendConfirmation for the
// edited-then-sent path so the partner sees the same level of detail.
func buildEditConfirmation(draft *SupportDraft) string {
	var b strings.Builder
	b.WriteString("✏️ Edited and sent — ticket #")
	b.WriteString(draft.TicketNumber)
	b.WriteString(" marked answered in osTicket.")
	if draft.ShouldClose {
		b.WriteString("\n🔒 Ticket auto-closing (AI flagged resolution).")
	}
	return b.String()
}

// applyEditStateToThread is the Edit-then-Send analog of
// applySendStateToThread. Identical logic except the tag transition
// uses "edited" instead of "sent" so we can tell the difference in
// thread filters + stats queries.
func applyEditStateToThread(ctx context.Context, draft *SupportDraft, closing bool) {
	t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil || t == nil {
		return
	}
	transitionThreadStatus(ctx, t, "edited", closing)

	prefix := "[EDITED] "
	if closing {
		prefix = "[CLOSED] "
	}
	if newName := buildPrefixedThreadName(prefix, draft); newName != "" {
		if err := discordUpdateThreadName(ctx, t.DiscordThreadID, newName); err != nil {
			log.Printf("[DiscordInteraction] rename thread (edited) for ticket %s: %v",
				draft.TicketNumber, err)
		}
	}

	if closing {
		if err := discordArchiveThread(ctx, t.DiscordThreadID); err != nil {
			log.Printf("[DiscordInteraction] archive thread (edited) for ticket %s: %v",
				draft.TicketNumber, err)
		} else {
			_ = markSupportTicketThreadArchived(ctx, draft.TicketNumber)
		}
	}
}

// modalFieldValue pulls one input's value out of a modal submission.
// Discord nests them one level deep: components is a list of action rows,
// each holding a single input.
func modalFieldValue(ix *discordInteraction, customID string) string {
	for _, row := range ix.Data.Components {
		for _, comp := range row.Components {
			if comp.CustomID == customID {
				return comp.Value
			}
		}
	}
	return ""
}

// handleDiscordAskSubmit sends the partner's clarifying question to the
// user in place of the drafted reply and parks the draft as 'asked'.
//
// The question goes out on the same osTicket reply path an approved draft
// takes, so the user gets it as a normal support email and their answer
// comes back through the thread-message webhook — which drafts a fresh
// reply with the new information in it.
func handleDiscordAskSubmit(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	question := strings.TrimSpace(modalFieldValue(ix, "ask_body"))
	if question == "" {
		return discordEphemeralResponse(c, "Question is empty.")
	}
	questionHTML := plainToHTMLParagraphs(question)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return discordEphemeralResponse(c, "Draft not found.")
	}
	if draft.Status != "pending" {
		return discordEphemeralResponse(c,
			fmt.Sprintf("Draft is `%s` (already actioned).", draft.Status))
	}

	if err := markDraftDecided(ctx, draftID, "asked", questionHTML); err != nil {
		log.Printf("[DiscordInteraction] markDraftDecided (asked) %d: %v", draftID, err)
		return discordEphemeralResponse(c, "Could not record the question.")
	}
	draft, _ = loadSupportDraft(ctx, draftID)
	if draft == nil {
		return discordEphemeralResponse(c, "Draft vanished mid-ask.")
	}
	// A question never closes a ticket, whatever triage thought of the
	// reply it replaces.
	draft.ShouldClose = false

	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()
		if err := sendDraftReply(bgCtx, draft, questionHTML); err != nil {
			log.Printf("[DiscordInteraction] send question for ticket %s: %v", draft.TicketNumber, err)
			return
		}
		applyAskStateToThread(bgCtx, draft)
	}()

	return discordVisibleResponse(c, fmt.Sprintf(
		"❓ Asked on ticket #%s — waiting on the user:\n> %s",
		draft.TicketNumber, strings.ReplaceAll(question, "\n", "\n> ")))
}

// applyAskStateToThread is the Ask analog of applySendStateToThread. The
// thread stays open and un-archived: an answer is expected.
func applyAskStateToThread(ctx context.Context, draft *SupportDraft) {
	t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil || t == nil {
		return
	}
	transitionThreadStatus(ctx, t, "asked", false)
	if newName := buildPrefixedThreadName("[ASKED] ", draft); newName != "" {
		if err := discordUpdateThreadName(ctx, t.DiscordThreadID, newName); err != nil {
			log.Printf("[DiscordInteraction] rename thread (asked) for ticket %s: %v",
				draft.TicketNumber, err)
		}
	}
}

// =============================================================================
// Draft-vs-edited diff
// =============================================================================

// postEditDiff posts what the partner actually changed into the thread.
// Half of every actioned draft in the May–September audit was rewritten
// before sending, and nothing recorded what was wrong with it — so the
// prompt never improved. This is that record, in the place someone reading
// the thread will see it.
func postEditDiff(ctx context.Context, draft *SupportDraft, original, edited string) {
	t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil || t == nil {
		return
	}
	diff := lineDiff(original, edited)
	if diff == "" {
		return
	}
	content := "**What changed before sending**\n```diff\n" + diff + "\n```"
	for _, chunk := range splitForDiscord(content, discordMessageLimit) {
		if _, err := discordPostMessage(ctx, t.DiscordThreadID, chunk, nil); err != nil {
			log.Printf("[DiscordInteraction] post edit diff for ticket %s: %v", draft.TicketNumber, err)
			return
		}
	}
}

// lineDiff renders a line-level diff of before → after in `diff` fence
// syntax (`-` removed, `+` added, ` ` kept). Returns "" when the two are
// identical after trimming.
//
// Standard LCS over lines. The inputs are support replies — tens of lines,
// not thousands — so the O(n·m) table is the right amount of machinery.
func lineDiff(before, after string) string {
	a := splitLines(before)
	b := splitLines(after)
	if strings.Join(a, "\n") == strings.Join(b, "\n") {
		return ""
	}

	// lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
	lcs := make([][]int, len(a)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	var out []string
	i, j := 0, 0
	for i < len(a) && j < len(b) {
		switch {
		case a[i] == b[j]:
			out = append(out, "  "+a[i])
			i, j = i+1, j+1
		case lcs[i+1][j] >= lcs[i][j+1]:
			out = append(out, "- "+a[i])
			i++
		default:
			out = append(out, "+ "+b[j])
			j++
		}
	}
	for ; i < len(a); i++ {
		out = append(out, "- "+a[i])
	}
	for ; j < len(b); j++ {
		out = append(out, "+ "+b[j])
	}
	return strings.Join(out, "\n")
}

// splitLines splits on newlines, dropping blank lines so a reflowed
// paragraph doesn't read as a wall of changes.
func splitLines(s string) []string {
	var out []string
	for _, l := range strings.Split(strings.TrimSpace(s), "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

// =============================================================================
// File as bug — support thread → Linear issue
// =============================================================================

// handleDiscordFileAsBug turns the ticket into a Linear issue and links it
// on the case. Deferred because the Linear round-trip does not reliably
// fit inside Discord's 3-second interaction budget.
//
// A second click links the issue that already exists rather than filing a
// duplicate — the same button on the same thread is how someone checks
// whether it was already filed.
func handleDiscordFileAsBug(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
	appID, token := ix.ApplicationID, ix.Token
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		msg := fileDraftAsBug(ctx, draftID)
		if err := discordCompleteDeferred(ctx, appID, token, msg); err != nil {
			log.Printf("[DiscordInteraction] file-as-bug follow-up for draft %d: %v", draftID, err)
		}
	}()
	return c.JSON(fiber.Map{"type": discordResponseDeferredChannelMessage})
}

// fileDraftAsBug does the work and returns the message to post in the
// thread — success, "already filed", or why it failed. Never returns an
// error: whatever happened, the partner needs to read it in Discord.
func fileDraftAsBug(ctx context.Context, draftID int64) string {
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return "Could not load draft."
	}

	if existing := caseLinearIssueKey(ctx, draft.TicketNumber); existing != "" {
		return fmt.Sprintf("🐛 Already filed as **%s** — %s",
			existing, linearIssueURL(existing))
	}

	title := strings.TrimSpace(draft.AISummary)
	if title == "" {
		title = strings.TrimSpace(draft.OriginalSubject)
	}
	if title == "" {
		title = "Support ticket #" + draft.TicketNumber
	}
	title = truncateRunes(title, 120)

	issue, err := linearCreateIssue(ctx, title, buildLinearIssueBody(ctx, draft))
	if err != nil {
		log.Printf("[DiscordInteraction] linear create for ticket %s: %v", draft.TicketNumber, err)
		return "⚠️ Could not file in Linear: " + err.Error()
	}

	if err := setCaseLinearIssueKey(ctx, draft.TicketNumber, issue.Identifier); err != nil {
		// The issue exists; we just can't remember it. Say so, or the next
		// click files a second one silently.
		log.Printf("[DiscordInteraction] link %s to ticket %s: %v", issue.Identifier, draft.TicketNumber, err)
		return fmt.Sprintf("🐛 Filed **%s** (%s) — but the link back to ticket #%s did not save; a second click will file a duplicate.",
			issue.Identifier, issue.URL, draft.TicketNumber)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: draft.TicketNumber, Kind: "note",
		BodyText: "filed as " + issue.Identifier, AIDraftID: draft.ID,
	}); err != nil {
		log.Printf("[Cases] %v", err)
	}
	return fmt.Sprintf("🐛 Filed as **%s** — %s", issue.Identifier, issue.URL)
}

// buildLinearIssueBody is what an engineer needs to pick the issue up: the
// reporter's own words, the two diagnostics fields the case DB keeps, and
// a link back to the ticket. No email address, and no diagnostics beyond
// what the thread already shows.
func buildLinearIssueBody(ctx context.Context, draft *SupportDraft) string {
	var b strings.Builder
	b.WriteString("**Reported via support ticket #")
	b.WriteString(draft.TicketNumber)
	b.WriteString("**\n\n")

	if userText := strings.TrimSpace(htmlToPlain(draft.UserMessageHTML)); userText != "" {
		b.WriteString("> ")
		b.WriteString(strings.ReplaceAll(userText, "\n", "\n> "))
		b.WriteString("\n\n")
	}

	b.WriteString("| | |\n|---|---|\n")
	fmt.Fprintf(&b, "| Category | %s |\n", orDash(draft.AICategory))
	fmt.Fprintf(&b, "| Priority | %s |\n", orDash(draft.AIPriority))
	fmt.Fprintf(&b, "| App version | %s |\n", orDash(caseAppVersion(ctx, draft.TicketNumber)))
	fmt.Fprintf(&b, "| OS | %s |\n", orDash(caseOS(ctx, draft.TicketNumber)))
	fmt.Fprintf(&b, "| Opened | %s |\n", draft.CreatedAt.UTC().Format("2006-01-02"))

	if note := strings.TrimSpace(draft.InternalNote); note != "" {
		b.WriteString("\n**Triage note:** ")
		b.WriteString(note)
		b.WriteString("\n")
	}
	if url := osTicketTicketURL(draft.TicketNumber); url != "" {
		fmt.Fprintf(&b, "\n[Open ticket #%s in osTicket](%s)\n", draft.TicketNumber, url)
	}
	return b.String()
}

func orDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

// osTicketTicketURL builds the agent-side link to a ticket, or "" when
// OSTICKET_URL isn't configured.
func osTicketTicketURL(ticketNumber string) string {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("OSTICKET_URL")), "/")
	if base == "" {
		return ""
	}
	return fmt.Sprintf("%s/scp/tickets.php?number=%s", base, ticketNumber)
}

// linearIssueURL reconstructs the browser link for an identifier. Linear
// redirects any workspace slug to the right issue, so "scrollr" here is a
// path placeholder, not a lookup.
func linearIssueURL(identifier string) string {
	return "https://linear.app/scrollr/issue/" + identifier
}

// caseLinearIssueKey returns the Linear issue already linked to a ticket,
// or "" when none is.
func caseLinearIssueKey(ctx context.Context, ticketNumber string) string {
	if platform.DBPool == nil {
		return ""
	}
	var key *string
	err := platform.DBPool.QueryRow(ctx,
		`SELECT linear_issue_key FROM support_cases WHERE ticket_number = $1`, ticketNumber).Scan(&key)
	if err != nil || key == nil {
		return ""
	}
	return strings.TrimSpace(*key)
}

// setCaseLinearIssueKey links the issue to the case, refusing to overwrite
// an existing link — two people clicking at once file one issue and keep
// the first answer.
func setCaseLinearIssueKey(ctx context.Context, ticketNumber, key string) error {
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	if _, err := platform.DBPool.Exec(ctx,
		`INSERT INTO support_cases (ticket_number) VALUES ($1) ON CONFLICT DO NOTHING`, ticketNumber); err != nil {
		return err
	}
	_, err := platform.DBPool.Exec(ctx,
		`UPDATE support_cases SET linear_issue_key = $2, updated_at = now()
		 WHERE ticket_number = $1 AND linear_issue_key IS NULL`, ticketNumber, key)
	return err
}

// caseOS returns the reporter's OS from the case DB, or "".
func caseOS(ctx context.Context, ticketNumber string) string {
	if platform.DBPool == nil {
		return ""
	}
	var v *string
	err := platform.DBPool.QueryRow(ctx,
		`SELECT os FROM support_cases WHERE ticket_number = $1`, ticketNumber).Scan(&v)
	if err != nil || v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}

// =============================================================================
// Slash commands — /inbox, /case, /search, /ticket, /stats
// =============================================================================

func handleDiscordSlashCommand(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}
	switch ix.Data.Name {
	case "inbox":
		return respondWithInboxPage(c, 0, discordResponseChannelMessageWithSource)
	case "case":
		return handleDiscordCaseCommand(c, ix)
	case "search":
		return handleDiscordSearchCommand(c, ix)
	case "ticket":
		return handleDiscordTicketCommand(c, ix)
	case "regen":
		return handleDiscordRegenCommand(c, ix)
	case "link":
		return handleDiscordLinkCommand(c, ix)
	case "stats":
		return handleDiscordStatsCommand(c, ix)
	case "pause":
		return handleDiscordPauseCommand(c)
	case "resume":
		return handleDiscordResumeCommand(c, ix)
	default:
		return discordEphemeralResponse(c,
			fmt.Sprintf("Unknown command: %s", ix.Data.Name))
	}
}

// =============================================================================
// /pause and /resume — the kill switch and the pardon
// =============================================================================

// handleDiscordPauseCommand stops every unattended send at once. Pending holds
// keep their deadlines rather than being cleared, so /resume puts the queue
// back exactly where it was instead of firing everything that expired while it
// was paused... which is why the sweeper checks the pause, not each draft.
func handleDiscordPauseCommand(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := policySet(ctx, policyPausedKey, time.Now().UTC().Format(time.RFC3339)); err != nil {
		log.Printf("[DiscordInteraction] pause: %v", err)
		return discordEphemeralResponse(c, "Could not pause. Set SUPPORT_AUTOSEND=off if this keeps failing.")
	}
	return discordVisibleResponse(c,
		"⏸️ **Paused.** Nothing sends without a click until `/resume`. Drafts keep arriving with their buttons.")
}

// handleDiscordResumeCommand lifts the pause, or — with a category — forgives
// that category's demotion by moving its watermark past every draft counted so
// far. Recovery is deliberately manual: a category that earned its way out of
// autonomy earns its way back in when a person says so.
func handleDiscordResumeCommand(c *fiber.Ctx, ix *discordInteraction) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	category := strings.ToLower(strings.TrimSpace(commandOption(ix, "category")))
	if category == "" {
		if err := policyDelete(ctx, policyPausedKey); err != nil {
			log.Printf("[DiscordInteraction] resume: %v", err)
			return discordEphemeralResponse(c, "Could not resume.")
		}
		return discordVisibleResponse(c, "▶️ **Resumed.** Holds that expired while paused go out on the next sweep.")
	}

	var maxID int64
	if platform.DBPool != nil {
		_ = platform.DBPool.QueryRow(ctx, `SELECT COALESCE(MAX(id), 0) FROM support_drafts`).Scan(&maxID)
	}
	if err := policySet(ctx, demoteFloorKey(category), strconv.FormatInt(maxID, 10)); err != nil {
		log.Printf("[DiscordInteraction] resume %s: %v", category, err)
		return discordEphemeralResponse(c, "Could not un-demote that category.")
	}
	return discordVisibleResponse(c, fmt.Sprintf(
		"▶️ **`%s` is autonomous again.** Its intervention window starts fresh from here.", category))
}

// handleDiscordStatsCommand returns a breakdown of AI-support
// pipeline activity over a configurable window (default 24h, max 7d).
//
// Reports:
//   - Total drafts created
//   - Status breakdown (pending / approved-and-sent / edited-and-sent / skipped / failed)
//   - Category breakdown (top 5)
//   - Auto-close rate
//   - Average AI confidence (high/medium/low distribution)
func handleDiscordStatsCommand(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}

	hours := 24
	for _, opt := range ix.Data.Options {
		if opt.Name == "hours" {
			if h, err := strconv.Atoi(strings.TrimSpace(opt.Value)); err == nil {
				if h < 1 {
					h = 1
				}
				if h > 168 {
					h = 168
				}
				hours = h
			}
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	// Aggregate query: counts by status, by category, plus confidence
	// histogram. Three CTEs for clarity. Postgres handles this in one
	// query — no N+1 concern.
	const q = `
		WITH drafts AS (
			SELECT id, status, ai_category, ai_confidence, should_close
			FROM support_drafts
			WHERE created_at >= $1
		),
		by_status AS (
			SELECT status, COUNT(*) AS n FROM drafts GROUP BY status
		),
		by_category AS (
			SELECT COALESCE(NULLIF(ai_category, ''), 'unknown') AS cat,
				   COUNT(*) AS n
			FROM drafts
			GROUP BY 1
			ORDER BY n DESC
			LIMIT 5
		),
		by_confidence AS (
			SELECT COALESCE(NULLIF(ai_confidence, ''), 'unknown') AS conf,
				   COUNT(*) AS n
			FROM drafts
			GROUP BY 1
		)
		SELECT
			(SELECT COUNT(*) FROM drafts) AS total,
			(SELECT json_agg(json_build_object('status', status, 'n', n)) FROM by_status) AS status_breakdown,
			(SELECT json_agg(json_build_object('cat', cat, 'n', n)) FROM by_category) AS category_breakdown,
			(SELECT json_agg(json_build_object('conf', conf, 'n', n)) FROM by_confidence) AS confidence_breakdown,
			(SELECT COUNT(*) FROM drafts WHERE should_close = TRUE) AS close_count
	`

	var (
		total          int
		statusJSON     []byte
		categoryJSON   []byte
		confidenceJSON []byte
		closeCount     int
	)
	err := platform.DBPool.QueryRow(ctx, q, since).Scan(&total, &statusJSON, &categoryJSON, &confidenceJSON, &closeCount)
	if err != nil {
		log.Printf("[DiscordInteraction] /stats query: %v", err)
		return discordEphemeralResponse(c, "Database query failed.")
	}

	if total == 0 {
		return discordEphemeralResponse(c,
			fmt.Sprintf("📊 No drafts in the last %dh.", hours))
	}

	// Decode JSON aggregates for friendly rendering.
	type statusRow struct {
		Status string `json:"status"`
		N      int    `json:"n"`
	}
	type catRow struct {
		Cat string `json:"cat"`
		N   int    `json:"n"`
	}
	type confRow struct {
		Conf string `json:"conf"`
		N    int    `json:"n"`
	}
	var statuses []statusRow
	var cats []catRow
	var confs []confRow
	_ = json.Unmarshal(statusJSON, &statuses)
	_ = json.Unmarshal(categoryJSON, &cats)
	_ = json.Unmarshal(confidenceJSON, &confs)

	var b strings.Builder
	fmt.Fprintf(&b, "📊 **AI support pipeline — last %dh**\n", hours)
	fmt.Fprintf(&b, "Total drafts: **%d**\n\n", total)

	if len(statuses) > 0 {
		b.WriteString("**Status breakdown:**\n")
		statusEmoji := map[string]string{
			"pending":  "⏳",
			"approved": "✅",
			"edited":   "✏️",
			"skipped":  "⏭️",
			"asked":    "❓",
			"sent":     "📨",
			"failed":   "❌",
		}
		for _, s := range statuses {
			emoji := statusEmoji[s.Status]
			if emoji == "" {
				emoji = "•"
			}
			fmt.Fprintf(&b, "%s `%s`: %d\n", emoji, s.Status, s.N)
		}
		b.WriteString("\n")
	}

	if closeCount > 0 {
		fmt.Fprintf(&b, "🔒 **Auto-close rate:** %d / %d (%.0f%%)\n\n",
			closeCount, total, float64(closeCount)*100.0/float64(total))
	}

	if len(cats) > 0 {
		b.WriteString("**Top categories:**\n")
		for _, c := range cats {
			fmt.Fprintf(&b, "• `%s`: %d\n", c.Cat, c.N)
		}
		b.WriteString("\n")
	}

	if len(confs) > 0 {
		b.WriteString("**AI confidence:**\n")
		confEmoji := map[string]string{
			"high":   "🟢",
			"medium": "🟡",
			"low":    "🔴",
		}
		for _, cf := range confs {
			emoji := confEmoji[cf.Conf]
			if emoji == "" {
				emoji = "•"
			}
			fmt.Fprintf(&b, "%s `%s`: %d\n", emoji, cf.Conf, cf.N)
		}
	}

	return discordEphemeralResponse(c, b.String())
}

// inboxPageSize is how many pending drafts one /inbox page shows. Ten
// fits an ephemeral message with room for the Next button and reads as a
// working set rather than a wall.
const inboxPageSize = 10

// respondWithInboxPage renders one page of the pending queue, oldest
// first — the queue is worked from the back, and the audit's problem was
// old drafts, not new ones.
//
// responseType is CHANNEL_MESSAGE_WITH_SOURCE when /inbox is typed, and
// UPDATE_MESSAGE when Next is clicked, so paging replaces the message in
// place instead of stacking pages down the channel.
func respondWithInboxPage(c *fiber.Ctx, offset, responseType int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	const q = `
		SELECT ticket_number, ai_summary, ai_priority, ai_category, created_at,
			   COUNT(*) OVER () AS total
		FROM support_drafts
		WHERE status = 'pending'
		ORDER BY created_at ASC
		LIMIT $1 OFFSET $2
	`
	rows, err := platform.DBPool.Query(ctx, q, inboxPageSize, offset)
	if err != nil {
		log.Printf("[DiscordInteraction] /inbox query: %v", err)
		return discordEphemeralResponse(c, "Database query failed.")
	}
	defer rows.Close()

	var lines []string
	total := 0
	for rows.Next() {
		var (
			ticketNumber                string
			summary, priority, category *string
			createdAt                   time.Time
		)
		if err := rows.Scan(&ticketNumber, &summary, &priority, &category, &createdAt, &total); err != nil {
			continue
		}
		summaryText := "(no summary)"
		if summary != nil && *summary != "" {
			summaryText = truncateRunes(*summary, 110)
		}
		tags := ""
		if category != nil && *category != "" {
			tags += " · `" + *category + "`"
		}
		if priority != nil && *priority != "" {
			tags += " · `" + *priority + "`"
		}
		lines = append(lines, fmt.Sprintf("• **#%s**%s — %s _(%s old)_",
			ticketNumber, tags, summaryText, humanAge(time.Since(createdAt))))
	}
	if err := rows.Err(); err != nil {
		log.Printf("[DiscordInteraction] /inbox rows: %v", err)
	}

	if len(lines) == 0 {
		if offset == 0 {
			return discordEphemeralResponse(c, "📭 Inbox is empty — no pending drafts.")
		}
		return discordEphemeralResponse(c, "That was the last page.")
	}

	shown := offset + len(lines)
	content := fmt.Sprintf("**Pending support drafts — %d–%d of %d** (oldest first)\n%s",
		offset+1, shown, total, strings.Join(lines, "\n"))

	data := fiber.Map{
		"content":          content,
		"flags":            discordInteractionFlagEphemeral,
		"allowed_mentions": fiber.Map{"parse": []string{}},
	}
	// Discord clears components when they're omitted on an UPDATE_MESSAGE,
	// which is what we want on the final page.
	components := []DiscordActionRow{}
	if shown < total {
		next := DiscordMessageButton{
			Type: 2, Style: 1, Label: "Next",
			CustomID: fmt.Sprintf("support_inbox:%d", shown),
		}
		next.Emoji = &struct {
			Name string `json:"name"`
		}{Name: "➡️"}
		components = append(components, DiscordActionRow{Type: 1, Components: []DiscordMessageButton{next}})
	}
	data["components"] = components

	return c.JSON(fiber.Map{"type": responseType, "data": data})
}

// handleDiscordCaseCommand prints one case's timeline out of the case DB:
// what the user said, what we drafted, what actually went out, in order.
// Bodies are snippets — the full text lives in the thread and in osTicket;
// this is for finding your place in a conversation quickly.
func handleDiscordCaseCommand(c *fiber.Ctx, ix *discordInteraction) error {
	ticketNumber := strings.TrimSpace(commandOption(ix, "number"))
	if ticketNumber == "" {
		return discordEphemeralResponse(c, "Missing `number` option.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var (
		subject, category, priority, status, summary string
		appVersion, osName, linearKey, threadID      string
		opened, updated                              time.Time
	)
	const caseQ = `
		SELECT subject, COALESCE(category,''), COALESCE(priority,''), status,
			   COALESCE(summary,''), COALESCE(app_version,''), COALESCE(os,''),
			   COALESCE(linear_issue_key,''), COALESCE(discord_thread_id,''),
			   opened_at, updated_at
		FROM support_cases WHERE ticket_number = $1
	`
	err := platform.DBPool.QueryRow(ctx, caseQ, ticketNumber).Scan(
		&subject, &category, &priority, &status, &summary,
		&appVersion, &osName, &linearKey, &threadID, &opened, &updated)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return discordEphemeralResponse(c, fmt.Sprintf("No case for ticket #%s.", ticketNumber))
		}
		log.Printf("[DiscordInteraction] /case query: %v", err)
		return discordEphemeralResponse(c, "Database query failed.")
	}

	var b strings.Builder
	fmt.Fprintf(&b, "**#%s — %s**\n", ticketNumber, truncateRunes(subject, 120))
	fmt.Fprintf(&b, "`%s` · %s · %s · opened %s\n",
		status, orDash(category), orDash(priority), opened.UTC().Format("2006-01-02"))
	if appVersion != "" || osName != "" {
		fmt.Fprintf(&b, "Reported on %s / %s\n", orDash(appVersion), orDash(osName))
	}
	if summary != "" {
		fmt.Fprintf(&b, "_%s_\n", truncateRunes(summary, 300))
	}
	if linearKey != "" {
		fmt.Fprintf(&b, "🐛 %s — %s\n", linearKey, linearIssueURL(linearKey))
	}
	if threadID != "" {
		fmt.Fprintf(&b, "🧵 https://discord.com/channels/%s/%s\n", ix.GuildID, threadID)
	}

	const msgQ = `
		SELECT kind, body_text, created_at, superseded FROM support_messages
		WHERE ticket_number = $1 ORDER BY created_at DESC, id DESC LIMIT 20
	`
	rows, err := platform.DBPool.Query(ctx, msgQ, ticketNumber)
	if err != nil {
		log.Printf("[DiscordInteraction] /case messages: %v", err)
		return discordEphemeralResponse(c, b.String())
	}
	defer rows.Close()

	kindIcon := map[string]string{"user": "👤", "ai_draft": "🤖", "sent": "📨", "note": "📝"}
	var events []string
	for rows.Next() {
		var kind, body string
		var created time.Time
		var superseded bool
		if err := rows.Scan(&kind, &body, &created, &superseded); err != nil {
			continue
		}
		icon := kindIcon[kind]
		if icon == "" {
			icon = "•"
		}
		// A draft that was re-triaged away is still on the timeline, but it
		// is not what this ticket is currently being answered with.
		if superseded {
			icon, kind = "🗑️", kind+" (superseded)"
		}
		snippet := truncateRunes(strings.Join(strings.Fields(body), " "), 140)
		events = append(events, fmt.Sprintf("%s `%s` %s — %s",
			icon, created.UTC().Format("Jan 2 15:04"), kind, snippet))
	}
	// Oldest first reads as a conversation; the query took the newest 20.
	for i := len(events) - 1; i >= 0; i-- {
		b.WriteString("\n")
		b.WriteString(events[i])
	}
	if len(events) == 0 {
		b.WriteString("\n_(no recorded messages)_")
	}

	return discordEphemeralResponse(c, truncateRunes(b.String(), 1990))
}

// handleDiscordSearchCommand runs the case DB's full-text search — the
// same one the support bot reads — and lists what it found.
func handleDiscordSearchCommand(c *fiber.Ctx, ix *discordInteraction) error {
	query := strings.TrimSpace(commandOption(ix, "text"))
	if query == "" {
		return discordEphemeralResponse(c, "Missing `text` option.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cases, err := SearchSupportCases(ctx, query, "", "", 10)
	if err != nil {
		log.Printf("[DiscordInteraction] /search: %v", err)
		return discordEphemeralResponse(c, "Search failed.")
	}
	if len(cases) == 0 {
		return discordEphemeralResponse(c, fmt.Sprintf("🔍 Nothing matched `%s`.", query))
	}

	var b strings.Builder
	fmt.Fprintf(&b, "🔍 **%d result(s) for `%s`**\n", len(cases), query)
	for _, sc := range cases {
		text := sc.Summary
		if text == "" {
			text = sc.Subject
		}
		fmt.Fprintf(&b, "• **#%s** `%s`%s — %s _(%s)_\n",
			sc.TicketNumber, sc.Status, categoryTag(sc.Category),
			truncateRunes(text, 110), sc.UpdatedAt.UTC().Format("2006-01-02"))
	}
	b.WriteString("\n`/case <number>` for the full timeline.")
	return discordEphemeralResponse(c, truncateRunes(b.String(), 1990))
}

func categoryTag(category string) string {
	if category == "" {
		return ""
	}
	return " · `" + category + "`"
}

// commandOption reads one slash-command option by name.
func commandOption(ix *discordInteraction, name string) string {
	if ix.Data == nil {
		return ""
	}
	for _, opt := range ix.Data.Options {
		if opt.Name == name {
			return opt.Value
		}
	}
	return ""
}

// handleDiscordTicketCommand shows the latest draft for a specific
// ticket number.
func handleDiscordTicketCommand(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}
	var ticketNumber string
	for _, opt := range ix.Data.Options {
		if opt.Name == "number" {
			ticketNumber = strings.TrimSpace(opt.Value)
		}
	}
	if ticketNumber == "" {
		return discordEphemeralResponse(c, "Missing `number` option.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	const q = `
		SELECT id, ticket_number, user_email, user_name, original_subject,
			   user_message_html, draft_body_html, ai_summary, ai_category,
			   ai_priority, ai_widget, ai_duplicate_of, ai_confidence, status,
			   edited_body_html, decided_at, sent_at, created_at, should_close
		FROM support_drafts
		WHERE ticket_number = $1
		ORDER BY created_at DESC
		LIMIT 1
	`
	var d SupportDraft
	var userName, userMsg, summary, category, priority, widget, dupOf, confidence, editedBody *string
	err := platform.DBPool.QueryRow(ctx, q, ticketNumber).Scan(
		&d.ID, &d.TicketNumber, &d.UserEmail, &userName, &d.OriginalSubject,
		&userMsg, &d.DraftBodyHTML, &summary, &category, &priority, &widget,
		&dupOf, &confidence, &d.Status, &editedBody,
		&d.DecidedAt, &d.SentAt, &d.CreatedAt, &d.ShouldClose,
	)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return discordEphemeralResponse(c,
				fmt.Sprintf("No draft found for ticket #%s.", ticketNumber))
		}
		log.Printf("[DiscordInteraction] /ticket query: %v", err)
		return discordEphemeralResponse(c, "Database query failed.")
	}
	// Hydrate
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
	if widget != nil {
		d.AIWidget = *widget
	}
	if dupOf != nil {
		d.AIDuplicateOf = *dupOf
	}
	if confidence != nil {
		d.AIConfidence = *confidence
	}

	// Ephemeral replies are one message, so this is the one place a draft
	// is still abridged — the thread itself carries the unabridged copy,
	// and /case points at it.
	starter, rest := buildDraftMessages(&d, true)
	content := starter
	if len(rest) > 0 {
		content += "\n\n" + rest[0]
	}
	content = truncateRunes(content, 1900)
	if len(rest) > 1 {
		content += "\n\n_…full draft in the ticket's thread._"
	}
	content += fmt.Sprintf("\n_Status: `%s`_", d.Status)

	// Buttons only if still pending.
	var components []DiscordActionRow
	if d.Status == "pending" {
		components = buildDraftActionButtons(d.ID)
	}

	resp := fiber.Map{
		"type": discordResponseChannelMessageWithSource,
		"data": fiber.Map{
			"content":          content,
			"embeds":           []*discordEmbed{buildDraftHeaderEmbed(ctx, &d)},
			"components":       components,
			"flags":            discordInteractionFlagEphemeral,
			"allowed_mentions": fiber.Map{"parse": []string{}},
		},
	}
	return c.JSON(resp)
}

// =============================================================================
// Response helpers
// =============================================================================

// discordEphemeralResponse returns an ephemeral message (visible only
// to the user who triggered the interaction).
func discordEphemeralResponse(c *fiber.Ctx, content string) error {
	return c.JSON(fiber.Map{
		"type": discordResponseChannelMessageWithSource,
		"data": fiber.Map{
			"content":          content,
			"flags":            discordInteractionFlagEphemeral,
			"allowed_mentions": fiber.Map{"parse": []string{}},
		},
	})
}

// discordVisibleResponse posts a message visible to everyone in the
// thread/channel where the interaction happened.
func discordVisibleResponse(c *fiber.Ctx, content string) error {
	return c.JSON(fiber.Map{
		"type": discordResponseChannelMessageWithSource,
		"data": fiber.Map{
			"content":          content,
			"allowed_mentions": fiber.Map{"parse": []string{}},
		},
	})
}

// plainToHTMLParagraphs converts user-typed plain text into very basic
// HTML so the existing email-rendering path can handle it. Each
// blank-line-separated block becomes a <p>; line-breaks within a block
// become <br>.
func plainToHTMLParagraphs(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	paragraphs := strings.Split(s, "\n\n")
	var out strings.Builder
	for _, p := range paragraphs {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// Escape minimal HTML so user text is rendered safely.
		p = strings.ReplaceAll(p, "&", "&amp;")
		p = strings.ReplaceAll(p, "<", "&lt;")
		p = strings.ReplaceAll(p, ">", "&gt;")
		p = strings.ReplaceAll(p, "\n", "<br>")
		out.WriteString("<p>")
		out.WriteString(p)
		out.WriteString("</p>")
	}
	return out.String()
}

// readBody is a small helper to keep handlers symmetric. Currently
// unused but kept for future modal-or-attachment paths that may need
// raw body access.
func readBody(c *fiber.Ctx) ([]byte, error) {
	r := c.Context().RequestBodyStream()
	if r == nil {
		return c.Body(), nil
	}
	return io.ReadAll(r)
}
