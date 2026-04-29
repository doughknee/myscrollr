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

	// Resolve topic ID (per-category env vars override the default)
	topicID := os.Getenv("OSTICKET_TOPIC_ID")
	switch req.Category {
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

	// Build OS Ticket payload
	payload := OSTicketPayload{
		Name:    name,
		Email:   email,
		Subject: subject,
		Message: fmt.Sprintf("data:text/html;charset=utf-8,%s", body.String()),
	}

	if topicID != "" {
		payload.TopicID = topicID
	}

	// Forward attachments
	for _, att := range req.Attachments {
		payload.Attachments = append(payload.Attachments, osTicketAttachmentEntry{
			Filename: att.Filename,
			MimeType: att.MimeType,
			Data:     att.Data,
		})
	}

	if err := forwardToOSTicket(c.Context(), payload); err != nil {
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

	log.Printf("[Support] Ticket created for user %s", userID)
	// Only record the submission AFTER OS Ticket confirms. If the
	// request fails upstream the user isn't trapped in a cooldown
	// they didn't earn — see allowedBySupportRateLimit.
	recordSupportSubmission(userID)
	return c.JSON(fiber.Map{
		"status":  "ok",
		"message": "Bug report submitted successfully",
	})
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

// forwardToOSTicket POSTs the payload to OS Ticket, trying each
// comma-separated API key in OSTICKET_API_KEY in order. OS Ticket ties
// keys to source IPs and pods can land on different nodes, so a 401 on
// one key just means try the next; any other non-2xx aborts the loop.
func forwardToOSTicket(ctx context.Context, payload OSTicketPayload) error {
	osTicketURL := os.Getenv("OSTICKET_URL")
	apiKeysRaw := os.Getenv("OSTICKET_API_KEY")
	if osTicketURL == "" || apiKeysRaw == "" {
		log.Println("[Support] OSTICKET_URL or OSTICKET_API_KEY not configured")
		return errOSTicketNotConfigured
	}

	ticketURL := strings.TrimSuffix(osTicketURL, "/") + "/api/tickets.json"

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[Support] Failed to marshal OS Ticket payload: %v", err)
		return fmt.Errorf("%w: %v", errOSTicketMarshal, err)
	}

	apiKeys := strings.Split(apiKeysRaw, ",")
	client := &http.Client{Timeout: 15 * time.Second}
	var lastStatus int
	var lastBody string

	for i, key := range apiKeys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}

		httpReq, err := http.NewRequestWithContext(ctx, "POST", ticketURL, bytes.NewReader(payloadBytes))
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
		lastBody = string(respBody)

		if resp.StatusCode == http.StatusCreated || resp.StatusCode == http.StatusOK {
			return nil
		}

		// 401 (wrong IP for this key) — try next key.
		if resp.StatusCode == http.StatusUnauthorized {
			log.Printf("[Support] Key %d rejected (401), trying next...", i+1)
			continue
		}

		// Any other error — don't retry, it's not an IP issue.
		log.Printf("[Support] OS Ticket returned %d: %s", resp.StatusCode, lastBody)
		break
	}

	log.Printf("[Support] All API keys failed. Last status: %d, body: %s", lastStatus, lastBody)
	return fmt.Errorf("%w: last status %d", errOSTicketAllKeysFailed, lastStatus)
}

// escapeHTML replaces < > & " with HTML entities.
func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	return s
}
