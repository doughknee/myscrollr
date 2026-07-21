package core

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// GitHub PR-merge webhook — auto-close osTicket tickets on PR merge
// =============================================================================
//
// When a PR is merged, the GitHub Action at
// .github/workflows/auto-close-osticket.yml extracts ticket numbers
// from the PR title + body via the syntax `[fixes #NNNNNN]` or
// `[closes #NNNNNN]` (case-insensitive), then POSTs them here.
//
// Why this lives in core-api instead of the GitHub Action calling
// osTicket directly: osTicket API keys are bound to ONE IP each
// (exact-match enforced; no CIDR support). GitHub Actions runners use
// hundreds of rotating IPs from documented-but-large ranges. Trying
// to maintain an osTicket API key bound to "any GitHub Actions IP" is
// fragile. Instead, the Action authenticates to core-api via shared
// secret, and core-api proxies the close call to osTicket using the
// existing OSTICKET_API_KEY (which IS bound to core-api's egress IP
// and works fine).
//
// For each ticket: posts a templated agent reply via the existing
// scrollr-reply-api plugin's /api/tickets/{number}/reply.json
// endpoint with close_ticket=true and signal_alert=true. That gives
// us:
//   - Reply lands in the user's inbox via osTicket's mailer (the
//     standard outbound user-notification flow)
//   - Ticket flips to closed status
//   - Discord thread auto-archives (existing flow on close)
//   - Single source of truth for "this PR fixed that ticket"
//
// On any failure (osTicket down, plugin missing, ticket already
// closed) we log and continue — closing is best-effort. The Action
// itself never fails the workflow on close errors so a flaky osTicket
// doesn't block PR merges.

// githubPRClosedEvent is the payload the Action sends. Ticket numbers
// are strings (osTicket numbers can have leading zeros).
type githubPRClosedEvent struct {
	TicketNumbers []string `json:"ticket_numbers"`
	PRNumber      int      `json:"pr_number"`
	PRTitle       string   `json:"pr_title"`
	PRURL         string   `json:"pr_url"`
}

// HandleGitHubPRClosed receives the webhook from the auto-close Action
// when a PR merges. Validates secret, parses payload, and asynchronously
// closes each referenced ticket via the existing osTicket reply plugin.
func HandleGitHubPRClosed(c *fiber.Ctx) error {
	// 1. Auth — constant-time secret comparison. Mirrors
	//    HandleOSTicketThreadMessage's pattern.
	expected := os.Getenv("GITHUB_PR_WEBHOOK_SECRET")
	if expected == "" {
		log.Println("[GitHubWebhook] GITHUB_PR_WEBHOOK_SECRET not set; rejecting")
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "webhook secret not configured",
		})
	}
	provided := c.Get("X-GitHub-Webhook-Secret")
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		log.Println("[GitHubWebhook] missing or invalid X-GitHub-Webhook-Secret")
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "invalid webhook secret",
		})
	}

	// 2. Parse event payload.
	var ev githubPRClosedEvent
	if err := json.Unmarshal(c.Body(), &ev); err != nil {
		log.Printf("[GitHubWebhook] body parse error: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "invalid JSON body",
		})
	}

	if len(ev.TicketNumbers) == 0 {
		// Empty list isn't an error — Action may have submitted with
		// nothing to close (e.g. PR with no fix-tags). 200 + log.
		log.Printf("[GitHubWebhook] PR #%d submitted with empty ticket list; nothing to do", ev.PRNumber)
		return c.JSON(fiber.Map{
			"status":  "ok",
			"closed":  0,
			"errors":  0,
			"message": "no tickets in payload",
		})
	}

	// Cap to a sane limit so a malformed PR title with 200 spurious
	// numbers doesn't trigger 200 osTicket calls.
	const maxTicketsPerPR = 20
	if len(ev.TicketNumbers) > maxTicketsPerPR {
		log.Printf("[GitHubWebhook] PR #%d has %d ticket numbers; capping at %d", ev.PRNumber, len(ev.TicketNumbers), maxTicketsPerPR)
		ev.TicketNumbers = ev.TicketNumbers[:maxTicketsPerPR]
	}

	// 3. Fire-and-forget close calls. We respond 200 to the Action
	//    immediately so a slow osTicket doesn't time out the
	//    GitHub workflow.
	go closePRReferencedTickets(ev)

	return c.JSON(fiber.Map{
		"status":    "accepted",
		"queued":    len(ev.TicketNumbers),
		"pr_number": ev.PRNumber,
		"message":   "tickets queued for close",
	})
}

// closePRReferencedTickets calls the existing scrollr-reply-api plugin
// reply endpoint for each ticket number, with close_ticket=true and a
// templated message body. Any individual close failure is logged but
// not retried — this is best-effort cleanup, not a guaranteed delivery.
func closePRReferencedTickets(ev githubPRClosedEvent) {
	osticketURL := strings.TrimRight(os.Getenv("OSTICKET_URL"), "/")
	osticketKey := os.Getenv("OSTICKET_API_KEY")
	if osticketURL == "" || osticketKey == "" {
		log.Println("[GitHubWebhook] OSTICKET_URL or OSTICKET_API_KEY missing; cannot close tickets")
		return
	}

	staffIDStr := os.Getenv("SUPPORT_AGENT_STAFF_ID")
	staffEmail := os.Getenv("SUPPORT_AGENT_EMAIL")
	if staffIDStr == "" && staffEmail == "" {
		log.Println("[GitHubWebhook] neither SUPPORT_AGENT_STAFF_ID nor SUPPORT_AGENT_EMAIL set; replies cannot be attributed")
		return
	}

	// Build the reply body once — same template for every ticket.
	replyHTML := buildAutoCloseReplyHTML(ev)

	successes := 0
	failures := 0
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for _, num := range ev.TicketNumbers {
		num = strings.TrimSpace(num)
		if num == "" {
			continue
		}

		if err := callPluginReplyAndClose(ctx, osticketURL, osticketKey, num, staffIDStr, staffEmail, replyHTML, ev.PRNumber); err != nil {
			log.Printf("[GitHubWebhook] close ticket #%s for PR #%d failed: %v", num, ev.PRNumber, err)
			failures++
			continue
		}
		successes++
		log.Printf("[GitHubWebhook] closed ticket #%s for PR #%d", num, ev.PRNumber)
	}

	log.Printf("[GitHubWebhook] PR #%d auto-close complete: %d closed, %d failed", ev.PRNumber, successes, failures)
}

// callPluginReplyAndClose POSTs to the scrollr-reply-api plugin to send
// a reply and close the ticket atomically. Returns an error on
// transport, auth, or upstream failure.
func callPluginReplyAndClose(
	ctx context.Context,
	osticketURL, apiKey, ticketNumber, staffID, staffEmail, replyHTML string,
	prNumber int,
) error {
	body := map[string]interface{}{
		"reply_html":   replyHTML,
		"signal_alert": true,
		"close_ticket": true,
		"title":        fmt.Sprintf("Re: Fixed in PR #%d", prNumber),
	}
	if staffID != "" {
		// staff_id is an int in the plugin schema; pass numeric value.
		// We accept the ENV var as a string for compatibility with the
		// existing configmap layout.
		body["staff_id"] = atoiOrZero(staffID)
	} else {
		body["staff_email"] = staffEmail
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	url := fmt.Sprintf("%s/api/tickets/%s/reply.json", osticketURL, ticketNumber)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", apiKey)

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("plugin call: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("plugin returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// buildAutoCloseReplyHTML is the templated message that goes out to the
// user when a PR closes their ticket. Branded tone matches existing AI
// reply voice (sentence-case, no em dashes, "Best Regards, Scrollr
// Support" sign-off — same as supportKnowledgeBase() guidance).
func buildAutoCloseReplyHTML(ev githubPRClosedEvent) string {
	// PR URL is optional (some Action invocations may not have it).
	prLink := ""
	if ev.PRURL != "" {
		prLink = fmt.Sprintf(`<a href="%s" style="color:#10b981;">PR #%d</a>`, htmlEscape(ev.PRURL), ev.PRNumber)
	} else {
		prLink = fmt.Sprintf("PR #%d", ev.PRNumber)
	}

	// PR title quoted to give the user some context. Empty title falls
	// back to "the linked pull request".
	titleClause := "the linked pull request"
	if ev.PRTitle != "" {
		titleClause = fmt.Sprintf(`"%s"`, htmlEscape(ev.PRTitle))
	}

	return fmt.Sprintf(
		`<p>Hi,</p>`+
			`<p>We shipped a fix for this issue. It's part of %s (%s) which has been merged.</p>`+
			`<p>The fix will be in the next desktop release. Please update your app via Settings &rarr; General &rarr; Updates &rarr; Check for Updates and let us know if you still see the issue.</p>`+
			`<p>Closing this ticket. You can reply any time to reopen it.</p>`+
			`<p>Best Regards,<br>Scrollr Support</p>`,
		prLink,
		titleClause,
	)
}

// atoiOrZero is a tiny helper for parsing the staff-id string env var.
// Returns 0 on parse failure, which the plugin handles by falling
// through to the staff_email or assigned-agent path.
func atoiOrZero(s string) int {
	var n int
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0
		}
		n = n*10 + int(ch-'0')
	}
	return n
}

// htmlEscape is a minimal HTML escaper for inserting URLs + titles
// into the reply template. Avoids pulling in html/template just for
// this one use case (and keeps the body as a plain string for the
// JSON marshal step).
func htmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return r.Replace(s)
}
