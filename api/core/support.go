package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ===== Support ticket types =====

type SupportTicketRequest struct {
	Category         string                 `json:"category"`
	Subject          string                 `json:"subject"`
	Description      string                 `json:"description"`
	WhatWentWrong    string                 `json:"what_went_wrong"`
	ExpectedBehavior string                 `json:"expected_behavior,omitempty"`
	Frequency        string                 `json:"frequency"`
	Priority         string                 `json:"priority,omitempty"`
	Diagnostics      map[string]interface{} `json:"diagnostics,omitempty"`
	Attachments      []TicketAttachment     `json:"attachments,omitempty"`
	Email            string                 `json:"email,omitempty"`
	Name             string                 `json:"name,omitempty"`
	Channel          string                 `json:"channel,omitempty"`
}

type TicketAttachment struct {
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

// OSTicketPayload is the wire shape we send to the OS Ticket REST API.
// Exported so the anonymous public handler in handlers_support_public.go
// can reuse the same forwarding helper as the authenticated handler —
// keeping a single source of truth for the upstream contract. Field
// tags are pinned by what OS Ticket expects; do not rename.
type OSTicketPayload struct {
	Name        string                    `json:"name"`
	Email       string                    `json:"email"`
	Subject     string                    `json:"subject"`
	Message     string                    `json:"message"`
	TopicID     string                    `json:"topicId,omitempty"`
	PriorityID  string                    `json:"priorityId,omitempty"`
	Attachments []osTicketAttachmentEntry `json:"attachments,omitempty"`
}

type osTicketAttachmentEntry struct {
	Filename string `json:"name"`
	MimeType string `json:"type"`
	Data     string `json:"data"`
}

// ===== Per-user rate limiting =====
//
// One accepted ticket per user per minute. "Accepted" means we
// successfully pushed it to OS Ticket — if the OS Ticket API or our own
// validation rejects the submission, the user isn't locked out for 60
// seconds. Otherwise a single server-side glitch could silently trap a
// user behind a cooldown they didn't earn.

var (
	supportRateMu    sync.Mutex
	supportRateMap   = make(map[string]time.Time)
	supportRateLimit = 1 * time.Minute
)

// allowedBySupportRateLimit returns true iff the user hasn't submitted
// an accepted ticket within the last `supportRateLimit` window. Does
// NOT record the submission — the caller must call
// `recordSupportSubmission(userID)` AFTER the ticket is accepted by OS
// Ticket.
func allowedBySupportRateLimit(userID string) bool {
	supportRateMu.Lock()
	defer supportRateMu.Unlock()

	if last, ok := supportRateMap[userID]; ok {
		if time.Since(last) < supportRateLimit {
			return false
		}
	}
	return true
}

// recordSupportSubmission marks the user's most recent accepted
// submission, starting the rate-limit window.
func recordSupportSubmission(userID string) {
	supportRateMu.Lock()
	defer supportRateMu.Unlock()
	supportRateMap[userID] = time.Now()
}

// ===== Handler =====

func HandleSubmitSupportTicket(c *fiber.Ctx) error {
	setCORSHeaders(c)

	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "error",
			Error:  "Authentication required",
		})
	}

	if !allowedBySupportRateLimit(userID) {
		return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
			Status: "error",
			Error:  "Please wait a minute before submitting another ticket",
		})
	}

	var req SupportTicketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if strings.TrimSpace(req.WhatWentWrong) == "" && strings.TrimSpace(req.Description) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Either 'what_went_wrong' or 'description' is required",
		})
	}

	// Determine user identity (email is set by LogtoAuth middleware in c.Locals)
	email, _ := c.Locals("user_email").(string)
	if email == "" {
		email = req.Email
	}
	if email == "" {
		email = "anonymous@scrollr.user"
	}

	name := req.Name
	if name == "" {
		parts := strings.SplitN(email, "@", 2)
		name = parts[0]
	}

	// Build subject
	var subjectPrefix string
	switch req.Category {
	case "feature":
		subjectPrefix = "Feature Request: "
	case "feedback":
		subjectPrefix = "Feedback: "
	case "billing":
		subjectPrefix = "Billing: "
	case "account":
		subjectPrefix = "Account: "
	case "channel":
		ch := strings.TrimSpace(req.Channel)
		if ch != "" {
			subjectPrefix = fmt.Sprintf("Channel Help (%s): ", ch)
		} else {
			subjectPrefix = "Channel Help: "
		}
	default:
		subjectPrefix = "Bug Report: "
	}

	subject := req.Subject
	if subject == "" {
		content := strings.TrimSpace(req.WhatWentWrong)
		if content == "" {
			content = strings.TrimSpace(req.Description)
		}
		if len(content) > 80 {
			content = content[:80] + "..."
		}
		subject = subjectPrefix + content
	}

	// Build HTML message body (category-aware)
	var body strings.Builder
	switch req.Category {
	case "feature":
		body.WriteString("<h3>Feature Request</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
		if req.Priority != "" {
			body.WriteString(fmt.Sprintf("<p><strong>Priority:</strong> %s</p>", escapeHTML(req.Priority)))
		}
	case "feedback":
		body.WriteString("<h3>Feedback</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
	case "billing":
		body.WriteString("<h3>Billing &amp; Subscription</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
	case "account":
		body.WriteString("<h3>Account &amp; Login</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
	case "channel":
		ch := strings.TrimSpace(req.Channel)
		if ch != "" {
			body.WriteString(fmt.Sprintf("<h3>Channel Help — %s</h3>", escapeHTML(ch)))
		} else {
			body.WriteString("<h3>Channel Help</h3>")
		}
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
	default:
		body.WriteString("<h3>What were you trying to do?</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.Description)))
		body.WriteString("<h3>What went wrong?</h3>")
		body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.WhatWentWrong)))
		if req.ExpectedBehavior != "" {
			body.WriteString("<h3>What did you expect to happen instead?</h3>")
			body.WriteString(fmt.Sprintf("<p>%s</p>", escapeHTML(req.ExpectedBehavior)))
		}
		if req.Frequency != "" {
			body.WriteString(fmt.Sprintf("<p><strong>Frequency:</strong> %s</p>", escapeHTML(req.Frequency)))
		}
	}

	// Append diagnostics as collapsible block
	if req.Diagnostics != nil {
		diagJSON, err := json.MarshalIndent(req.Diagnostics, "", "  ")
		if err == nil {
			body.WriteString("<details><summary><strong>System Diagnostics</strong></summary>")
			body.WriteString(fmt.Sprintf("<pre>%s</pre>", escapeHTML(string(diagJSON))))
			body.WriteString("</details>")
		}
	}

	// Run AI triage BEFORE building the final OS Ticket payload so
	// high-confidence categorization can override the user's pick (and
	// thus route to a different osTicket topic). Triage is best-effort:
	// nil result falls through to the legacy flow.
	originalBody := body.String()
	recentSummaries := FetchRecentTicketSummaries(c.Context())
	triage := triageTicket(c.Context(), TriageInput{
		UserCategory:    req.Category,
		UserEmail:       email,
		UserName:        name,
		Subject:         subject,
		Body:            originalBody,
		RecentSummaries: recentSummaries,
		Channel:         req.Channel,
	})

	// Resolve effective category — use AI's pick only on high confidence.
	effectiveCategory := req.Category
	if triage != nil && strings.EqualFold(triage.Confidence, "high") && triage.Category != "" {
		effectiveCategory = triage.Category
	}

	topicID := resolveOSTicketTopicID(effectiveCategory)

	// Post the user's CLEAN body to osTicket. AI metadata (summary,
	// drafted reply, confidence, etc.) lives in the support_drafts row
	// and the partner-notification email — never in the user-visible
	// thread. Earlier versions decorated the body with an "AI summary"
	// banner + a <details> block containing the drafted reply, but
	// that was visible to users when they viewed the ticket via the
	// portal. Cleaner architecture: thread is what the user wrote and
	// what the agent answered, nothing else.
	payload := OSTicketPayload{
		Name:    name,
		Email:   email,
		Subject: subject,
		Message: fmt.Sprintf("data:text/html;charset=utf-8,%s", originalBody),
	}

	if topicID != "" {
		payload.TopicID = topicID
	}
	if triage != nil {
		if pid := mapTriagePriorityToOSTicket(triage.Priority); pid != "" {
			payload.PriorityID = pid
		}
	}

	// Forward attachments
	for _, att := range req.Attachments {
		payload.Attachments = append(payload.Attachments, osTicketAttachmentEntry{
			Filename: att.Filename,
			MimeType: att.MimeType,
			Data:     att.Data,
		})
	}

	ticketNumber, err := forwardToOSTicket(c.Context(), payload)
	if err != nil {
		// Distinguish "not configured" so we can keep the existing 500
		// vs. upstream rejection (502).
		if errors.Is(err, errOSTicketNotConfigured) {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "Support ticket system is not configured",
			})
		}
		if errors.Is(err, errOSTicketMarshal) {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "Failed to prepare ticket",
			})
		}
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to submit bug report — support system rejected all API keys",
		})
	}

	log.Printf("[Support] Ticket created for user %s (osTicket=%s)", userID, ticketNumber)
	// Only record the submission AFTER OS Ticket confirms. If the
	// request fails upstream the user isn't trapped in a cooldown
	// they didn't earn — see allowedBySupportRateLimit.
	recordSupportSubmission(userID)

	// Side effects after successful ticket creation: persist the AI
	// draft for partner approval, push to the recent-tickets sliding
	// window, and notify the partner. All best-effort — failures here
	// must not surface to the user, who has already gotten their
	// success response logically.
	if triage != nil && ticketNumber != "" {
		persistTriageSideEffects(ticketNumber, email, name, subject, originalBody, triage)
	}

	return c.JSON(fiber.Map{
		"status":  "ok",
		"message": "Bug report submitted successfully",
	})
}

// resolveOSTicketTopicID maps a category string to its osTicket topic
// ID, honoring per-category env var overrides. Default falls back to
// OSTICKET_TOPIC_ID. Extracted as a helper so both authenticated and
// public handlers (and the AI override path) use one source of truth.
func resolveOSTicketTopicID(category string) string {
	topicID := os.Getenv("OSTICKET_TOPIC_ID")
	switch category {
	case "feature":
		if id := os.Getenv("OSTICKET_TOPIC_ID_FEATURE"); id != "" {
			topicID = id
		}
	case "feedback":
		if id := os.Getenv("OSTICKET_TOPIC_ID_FEEDBACK"); id != "" {
			topicID = id
		}
	case "billing":
		if id := os.Getenv("OSTICKET_TOPIC_ID_BILLING"); id != "" {
			topicID = id
		}
	case "account":
		if id := os.Getenv("OSTICKET_TOPIC_ID_ACCOUNT"); id != "" {
			topicID = id
		}
	case "channel":
		if id := os.Getenv("OSTICKET_TOPIC_ID_CHANNEL"); id != "" {
			topicID = id
		}
	}
	return topicID
}

// persistTriageSideEffects fans out the post-submit AI bookkeeping:
// persists the draft, pushes a recent-summary entry to the sliding
// window, and (in Phase 1D) fires the partner notification email.
// Each step is logged on failure but never surfaced to the user.
//
// Runs in a background goroutine so it doesn't block the user's
// response — the user has already had their ticket accepted by
// osTicket at this point.
func persistTriageSideEffects(ticketNumber, userEmail, userName, subject, originalBody string, triage *TriageResult) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		// Save the draft (even if we don't end up notifying — useful for audit).
		draft, err := createSupportDraft(ctx, &SupportDraft{
			TicketNumber:    ticketNumber,
			UserEmail:       userEmail,
			UserName:        userName,
			OriginalSubject: subject,
			UserMessageHTML: originalBody,
			DraftBodyHTML:   triage.DraftReplyHTML,
			AISummary:       triage.Summary,
			AICategory:      triage.Category,
			AIPriority:      triage.Priority,
			AIChannel:       triage.Channel,
			AIDuplicateOf:   triage.DuplicateOf,
			AIConfidence:    triage.Confidence,
			ShouldClose:     triage.ShouldClose,
		})
		if err != nil {
			log.Printf("[Support] createSupportDraft failed for ticket %s: %v", ticketNumber, err)
		}

		// Recent-tickets sliding window for dupe detection on subsequent submissions.
		PushRecentTicketSummary(ctx, RecentTicketSummary{
			TicketNumber: ticketNumber,
			Category:     triage.Category,
			Summary:      triage.Summary,
			CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		})

		// Partner notification — wired in Phase 1D once SendPartnerNotification exists.
		if draft != nil {
			notifyPartnerAfterDraft(ctx, draft)
		}
	}()
}

// ===== OS Ticket forwarding helper =====
//
// Single source of truth for talking to OS Ticket. Used by both the
// authenticated HandleSubmitSupportTicket and the anonymous
// HandleSubmitPublicSupportTicket so they can't drift on auth headers,
// retry behaviour, or timeouts.
//
// Caller responsibilities (NOT done here):
//   - All input validation (subject/body length, email format, etc.)
//   - Rate limiting (per-user for authed, per-IP for anonymous)
//   - Persisting any local audit trail
//   - Recording cooldown state on success
//
// Returns nil on a 2xx response from OS Ticket. Returns one of the
// sentinel errors below for known-failure modes; otherwise wraps the
// underlying transport / status error so the caller can log it.

var (
	errOSTicketNotConfigured = errors.New("osticket: OSTICKET_URL or OSTICKET_API_KEY not configured")
	errOSTicketMarshal       = errors.New("osticket: failed to marshal payload")
	errOSTicketAllKeysFailed = errors.New("osticket: all API keys rejected")
)

// forwardToOSTicket POSTs a ticket-create payload to OS Ticket via the
// shared transport (postOSTicketJSON, below).
//
// Returns the ticket number on success along with nil error. osTicket's
// REST API returns the bare ticket number as the response body on a
// 201 Created (it is a plain string, not JSON, in default installs).
// We trim whitespace and surrounding quotes defensively to tolerate
// either form. Empty string + nil error is acceptable when osTicket
// answers 201 with no body — caller treats missing ticket numbers as
// non-fatal (no draft will be created, but the ticket itself succeeded).
func forwardToOSTicket(ctx context.Context, payload OSTicketPayload) (string, error) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Support] Failed to marshal OS Ticket payload: %v", err)
		return "", fmt.Errorf("%w: %v", errOSTicketMarshal, err)
	}

	status, body, err := postOSTicketJSON(ctx, "/api/tickets.json", payloadBytes)
	if err != nil {
		return "", err
	}
	if status == http.StatusCreated || status == http.StatusOK {
		return parseOSTicketNumber(body), nil
	}
	return "", fmt.Errorf("osticket: unexpected status %d", status)
}

// postOSTicketJSON is the shared transport for any osTicket REST call.
// Tries each comma-separated API key in OSTICKET_API_KEY in order. OS
// Ticket ties keys to source IPs and pods can land on different nodes,
// so a 401 on one key just means try the next; any other non-2xx
// aborts the loop and returns the status + body so the caller can
// decide what to do with it.
//
// Used by both the create-ticket flow (forwardToOSTicket) and the
// reply flow (postOSTicketReply in support_drafts.go).
func postOSTicketJSON(ctx context.Context, path string, payloadBytes []byte) (int, []byte, error) {
	osTicketURL := os.Getenv("OSTICKET_URL")
	apiKeysRaw := os.Getenv("OSTICKET_API_KEY")
	if osTicketURL == "" || apiKeysRaw == "" {
		log.Println("[Support] OSTICKET_URL or OSTICKET_API_KEY not configured")
		return 0, nil, errOSTicketNotConfigured
	}

	fullURL := strings.TrimSuffix(osTicketURL, "/") + path
	apiKeys := strings.Split(apiKeysRaw, ",")
	client := &http.Client{Timeout: 15 * time.Second}

	var lastStatus int
	var lastBody []byte

	for i, key := range apiKeys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}

		httpReq, err := http.NewRequestWithContext(ctx, "POST", fullURL, bytes.NewReader(payloadBytes))
		if err != nil {
			log.Printf("[Support] Failed to create OS Ticket request: %v", err)
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("X-API-Key", key)

		resp, err := client.Do(httpReq)
		if err != nil {
			log.Printf("[Support] OS Ticket request failed (key %d): %v", i+1, err)
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		lastStatus = resp.StatusCode
		lastBody = respBody

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return resp.StatusCode, respBody, nil
		}

		// 401 (wrong IP for this key) — try next key.
		if resp.StatusCode == http.StatusUnauthorized {
			log.Printf("[Support] Key %d rejected (401), trying next...", i+1)
			continue
		}

		// Any other error — don't retry, return the status to the caller.
		log.Printf("[Support] OS Ticket returned %d at %s: %s", resp.StatusCode, path, string(respBody))
		return resp.StatusCode, respBody, fmt.Errorf("osticket: status %d", resp.StatusCode)
	}

	log.Printf("[Support] All API keys failed at %s. Last status: %d, body: %s", path, lastStatus, string(lastBody))
	return lastStatus, lastBody, fmt.Errorf("%w: last status %d", errOSTicketAllKeysFailed, lastStatus)
}

// parseOSTicketNumber returns the ticket number from a successful
// osTicket create response. Default osTicket installs return the bare
// number as plain text; some versions / themes wrap it in JSON like
// `{"id":1247}` or `{"number":"TKT-1247"}`. We try plain first, fall
// back to JSON parsing on failure. Returns "" if neither yields a
// usable value — caller is expected to treat that as non-fatal.
func parseOSTicketNumber(body []byte) string {
	s := strings.TrimSpace(string(body))
	s = strings.Trim(s, "\"")
	if s == "" {
		return ""
	}
	// If it parses as a JSON object, extract id/number/ticket_number.
	if strings.HasPrefix(s, "{") {
		var obj map[string]interface{}
		if err := json.Unmarshal([]byte(s), &obj); err == nil {
			for _, k := range []string{"number", "ticket_number", "id"} {
				if v, ok := obj[k]; ok {
					switch t := v.(type) {
					case string:
						return strings.TrimSpace(t)
					case float64:
						return fmt.Sprintf("%d", int64(t))
					}
				}
			}
		}
		return ""
	}
	return s
}

// notifyPartnerAfterDraft is the seam wired up in Phase 1D once
// SendPartnerNotification exists. Defined here as an indirection so
// support.go can compile through the phase boundary without referencing
// a function that doesn't exist yet. Phase 1D replaces the body to
// call SendPartnerNotification.
var notifyPartnerAfterDraft = func(ctx context.Context, draft *SupportDraft) {
	// no-op until Phase 1D wires in the email send
	_ = ctx
	_ = draft
}

// escapeHTML replaces < > & " with HTML entities.
func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
