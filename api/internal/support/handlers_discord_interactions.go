package support

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
	draftID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return discordEphemeralResponse(c, "malformed draft id")
	}

	switch prefix {
	case "support_send":
		return handleDiscordSendAction(c, ix, draftID)
	case "support_edit":
		return handleDiscordEditOpenModal(c, ix, draftID)
	case "support_skip":
		return handleDiscordSkipAction(c, ix, draftID)
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
		if err := sendApprovedReply(bgCtx, draft, draft.DraftBodyHTML); err != nil {
			log.Printf("[DiscordInteraction] sendApprovedReply for ticket %s: %v",
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
func buildSendConfirmation(draft *SupportDraft) string {
	var b strings.Builder
	b.WriteString("✅ Sent to ")
	b.WriteString(draft.UserEmail)
	b.WriteString(" — ticket #")
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
	if len(subject) > budget {
		subject = subject[:budget-3] + "..."
	}
	return fmt.Sprintf("%s%s[#%s] %s", prefix, priority, draft.TicketNumber, subject)
}

// handleDiscordEditOpenModal opens a modal so the partner can edit the
// AI's draft before sending. The modal's text-area is pre-filled with
// the current draft body (HTML stripped to plain text since Discord
// modals are plain-text only).
func handleDiscordEditOpenModal(c *fiber.Ctx, ix *discordInteraction, draftID int64) error {
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
	prefilled := htmlToPlain(draft.DraftBodyHTML)
	if len(prefilled) > 4000 {
		// Discord text-area max is 4000 chars.
		prefilled = prefilled[:4000]
	}

	resp := fiber.Map{
		"type": discordResponseModal,
		"data": fiber.Map{
			"custom_id": fmt.Sprintf("support_edit_modal:%d", draftID),
			"title":     fmt.Sprintf("Edit reply for #%s", draft.TicketNumber),
			"components": []fiber.Map{
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
			},
		},
	}
	return c.JSON(resp)
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

	// Update thread cosmetics fire-and-forget.
	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer bgCancel()
		applySkipStateToThread(bgCtx, draft)
	}()

	return discordVisibleResponse(c,
		fmt.Sprintf("⏭️ Skipped — ticket #%s left without an AI reply.", draft.TicketNumber))
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
	if len(parts) != 2 || parts[0] != "support_edit_modal" {
		return discordEphemeralResponse(c, "malformed modal custom_id")
	}
	draftID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return discordEphemeralResponse(c, "malformed draft id")
	}

	// Discord nests modal field values one level deep: components is
	// a list of action rows, each containing one input component.
	var editedBody string
	for _, row := range ix.Data.Components {
		for _, comp := range row.Components {
			if comp.CustomID == "edited_body" {
				editedBody = comp.Value
			}
		}
	}
	editedBody = strings.TrimSpace(editedBody)
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
	draft, _ = loadSupportDraft(ctx, draftID)

	go func() {
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()
		if err := sendApprovedReply(bgCtx, draft, editedBodyHTML); err != nil {
			log.Printf("[DiscordInteraction] sendApprovedReply (edited) for ticket %s: %v",
				draft.TicketNumber, err)
			return
		}
		// Edit-then-send still goes through the same thread state
		// transitions as plain Send. Tag flips to "edited" instead of
		// "sent" so we can distinguish them in /stats.
		applyEditStateToThread(bgCtx, draft, draft.ShouldClose)
	}()

	confirmation := buildEditConfirmation(draft)
	return discordVisibleResponse(c, confirmation)
}

// buildEditConfirmation parallels buildSendConfirmation for the
// edited-then-sent path so the partner sees the same level of detail.
func buildEditConfirmation(draft *SupportDraft) string {
	var b strings.Builder
	b.WriteString("✏️ Edited and sent to ")
	b.WriteString(draft.UserEmail)
	b.WriteString(" — ticket #")
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

// =============================================================================
// Slash commands — /inbox and /ticket <number>
// =============================================================================

func handleDiscordSlashCommand(c *fiber.Ctx, ix *discordInteraction) error {
	if ix.Data == nil {
		return discordEphemeralResponse(c, "missing data")
	}
	switch ix.Data.Name {
	case "inbox":
		return handleDiscordInboxCommand(c, ix)
	case "ticket":
		return handleDiscordTicketCommand(c, ix)
	case "stats":
		return handleDiscordStatsCommand(c, ix)
	default:
		return discordEphemeralResponse(c,
			fmt.Sprintf("Unknown command: %s", ix.Data.Name))
	}
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

// handleDiscordInboxCommand lists the 5 most recent pending drafts.
func handleDiscordInboxCommand(c *fiber.Ctx, ix *discordInteraction) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	const q = `
		SELECT id, ticket_number, ai_summary, ai_priority, created_at
		FROM support_drafts
		WHERE status = 'pending'
		ORDER BY created_at DESC
		LIMIT 5
	`
	rows, err := platform.DBPool.Query(ctx, q)
	if err != nil {
		log.Printf("[DiscordInteraction] /inbox query: %v", err)
		return discordEphemeralResponse(c, "Database query failed.")
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var (
			id           int64
			ticketNumber string
			summary      *string
			priority     *string
			createdAt    time.Time
		)
		if err := rows.Scan(&id, &ticketNumber, &summary, &priority, &createdAt); err != nil {
			continue
		}
		summaryText := "(no summary)"
		if summary != nil && *summary != "" {
			summaryText = *summary
		}
		priorityText := ""
		if priority != nil && *priority != "" {
			priorityText = " · `" + *priority + "`"
		}
		age := time.Since(createdAt).Round(time.Minute)
		lines = append(lines,
			fmt.Sprintf("• **#%s**%s — %s _(%s ago)_",
				ticketNumber, priorityText, summaryText, age))
	}
	if err := rows.Err(); err != nil {
		log.Printf("[DiscordInteraction] /inbox rows: %v", err)
	}

	if len(lines) == 0 {
		return discordEphemeralResponse(c, "📭 Inbox is empty — no pending drafts.")
	}

	content := "**Pending support drafts:**\n" + strings.Join(lines, "\n")
	return discordEphemeralResponse(c, content)
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

	content := buildDraftMessageContent(&d) +
		fmt.Sprintf("\n\n_Status: `%s`_", d.Status)

	// Buttons only if still pending.
	var components []DiscordActionRow
	if d.Status == "pending" {
		components = buildDraftActionButtons(d.ID)
	}

	resp := fiber.Map{
		"type": discordResponseChannelMessageWithSource,
		"data": fiber.Map{
			"content":          content,
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
