package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// =============================================================================
// AI Support Triage — Anthropic Haiku integration
// =============================================================================
//
// Best-effort categorization, summarization, dupe-detection, and reply
// drafting for incoming support tickets. All functions in this file are
// designed to fail soft: any error path returns nil so the support flow
// continues with the legacy (no-AI) behavior. We never block ticket
// creation on triage success.

const (
	anthropicAPIURL    = "https://api.anthropic.com/v1/messages"
	anthropicModel     = "claude-haiku-4-5"
	anthropicVersion   = "2023-06-01"
	triageTimeout      = 10 * time.Second
	maxTriageBodyChars = 8000 // truncate ticket body before sending to keep prompt size bounded
)

// TriageResult is the structured output from Claude. Fields use
// lowercase JSON tags so we can unmarshal Claude's JSON response
// directly. Confidence drives whether we override the user-picked
// category.
type TriageResult struct {
	Category       string `json:"category"`
	Channel        string `json:"channel,omitempty"`
	Priority       string `json:"priority"`
	Summary        string `json:"summary"`
	DuplicateOf    string `json:"duplicate_of,omitempty"`
	DraftReplyHTML string `json:"draft_reply_html"`
	Confidence     string `json:"confidence"`
}

// TriageInput is what we pass to triageTicket. Builds the prompt
// from these fields plus a small bundle of recent ticket summaries
// pulled from Redis (for dupe detection) and a static FAQ snippet.
type TriageInput struct {
	UserCategory    string
	UserEmail       string
	UserName        string
	Subject         string
	Body            string
	RecentSummaries []RecentTicketSummary
	Channel         string // user-picked channel hint, if any
}

// RecentTicketSummary is what we cache in Redis for dupe-detection
// context. Kept compact — this list is sent on every triage call.
type RecentTicketSummary struct {
	TicketNumber string `json:"ticket_number"`
	Category     string `json:"category"`
	Summary      string `json:"summary"`
	CreatedAt    string `json:"created_at"`
}

// triageTicket calls Anthropic Haiku and returns a parsed TriageResult.
// On any failure (network error, non-200, malformed JSON, missing
// required fields) returns nil. Caller must handle nil gracefully —
// AI triage is best-effort, never blocks the ticket flow.
func triageTicket(ctx context.Context, input TriageInput) *TriageResult {
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		log.Println("[Triage] ANTHROPIC_API_KEY not set; skipping triage")
		return nil
	}
	if os.Getenv("AI_TRIAGE_ENABLED") == "false" {
		return nil
	}

	body := input.Body
	if len(body) > maxTriageBodyChars {
		body = body[:maxTriageBodyChars] + "\n\n...[truncated]"
	}

	prompt := buildTriagePrompt(input, body)

	reqBody := map[string]interface{}{
		"model":      anthropicModel,
		"max_tokens": 2048,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
	}
	reqBytes, err := json.Marshal(reqBody)
	if err != nil {
		log.Printf("[Triage] marshal request: %v", err)
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, triageTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPIURL, bytes.NewReader(reqBytes))
	if err != nil {
		log.Printf("[Triage] build request: %v", err)
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)

	client := &http.Client{Timeout: triageTimeout}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Triage] HTTP request failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Triage] read response: %v", err)
		return nil
	}

	if resp.StatusCode >= 400 {
		log.Printf("[Triage] Anthropic returned %d: %s", resp.StatusCode, string(respBody))
		return nil
	}

	// Anthropic response: {content: [{type:"text", text:"..."}]}
	var apiResp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		log.Printf("[Triage] parse Anthropic response: %v", err)
		return nil
	}
	if len(apiResp.Content) == 0 {
		log.Printf("[Triage] empty content from Anthropic")
		return nil
	}

	// Claude sometimes wraps JSON in markdown fences despite instructions.
	rawJSON := strings.TrimSpace(apiResp.Content[0].Text)
	rawJSON = strings.TrimPrefix(rawJSON, "```json")
	rawJSON = strings.TrimPrefix(rawJSON, "```")
	rawJSON = strings.TrimSuffix(rawJSON, "```")
	rawJSON = strings.TrimSpace(rawJSON)

	var result TriageResult
	if err := json.Unmarshal([]byte(rawJSON), &result); err != nil {
		log.Printf("[Triage] parse triage JSON: %v\nraw: %s", err, rawJSON)
		return nil
	}

	// Sanity-check required fields
	if result.Category == "" || result.Priority == "" || result.Summary == "" {
		log.Printf("[Triage] incomplete result: %+v", result)
		return nil
	}

	log.Printf("[Triage] OK: category=%s priority=%s confidence=%s summary=%q",
		result.Category, result.Priority, result.Confidence, result.Summary)
	return &result
}

// buildTriagePrompt constructs the user-message prompt sent to Claude.
// Kept as a pure function for unit testing.
func buildTriagePrompt(input TriageInput, body string) string {
	recentJSON, _ := json.Marshal(input.RecentSummaries)
	if len(recentJSON) == 0 {
		recentJSON = []byte("[]")
	}

	channelHint := ""
	if input.Channel != "" {
		channelHint = fmt.Sprintf("Channel hint from user: %s\n", input.Channel)
	}

	return fmt.Sprintf(`You are a support triage assistant for Scrollr, a desktop ticker app for live financial markets, sports scores, news, and Yahoo Fantasy. Categorize incoming tickets and draft warm, direct replies grounded in the FAQ below.

YOUR TASKS:
1. Pick the best category from: bug, feature, feedback, billing, account, channel
2. Pick a priority based on urgency signals (lost data / can't log in / can't pay → high or emergency; "love this app" / "would be cool if" → low)
3. If category is "channel", identify which: finance, sports, rss, fantasy
4. Generate a one-line summary (10 words max, no period at the end)
5. If the ticket looks like a duplicate of one in RECENT TICKETS, output its ticket_number
6. Draft a reply matching this voice:
   - Warm, direct, normal sentence-case capitalization (start every sentence with a capital letter), no corporate-speak
   - NEVER use em dashes (—) or en dashes (–) anywhere in the reply. Use commas, periods, parentheses, or simple hyphens (-) instead. This is a hard rule.
   - Lead with a brief acknowledgment, then action
   - Reference the FAQ if relevant; never make up fix steps
   - 2-4 short paragraphs max
   - Sign off as: "the scrollr team" on its own line, with nothing before it
7. Output confidence: "high" if you're very sure of category/priority, "medium" if some ambiguity, "low" if you'd want a human to double-check

OUTPUT EXACTLY THIS JSON (no markdown fences, no commentary):
{
  "category": "bug|feature|feedback|billing|account|channel",
  "channel": "finance|sports|rss|fantasy" or null,
  "priority": "low|normal|high|emergency",
  "summary": "...",
  "duplicate_of": "ticket-number" or null,
  "draft_reply_html": "<p>...</p>",
  "confidence": "high|medium|low"
}

RECENT TICKETS (for dupe-detection only):
%s

FAQ EXCERPTS:
%s

USER TICKET:
Email: %s
Name: %s
User-picked category: %s
%sSubject: %s
Body:
%s
`,
		string(recentJSON),
		faqContextForTriage(),
		input.UserEmail,
		input.UserName,
		input.UserCategory,
		channelHint,
		input.Subject,
		body,
	)
}

// faqContextForTriage returns a short FAQ snippet to ground Claude's
// reply suggestions. Keep this small (<2000 chars) — it's sent on every
// triage call. Update when the FAQ content evolves significantly.
func faqContextForTriage() string {
	return `# Scrollr FAQ (quick reference for triage replies)

## Connecting Yahoo Fantasy
Open the Fantasy channel page in the desktop app, click "Connect Yahoo," walk through the OAuth flow. Leagues import automatically once connected.

## Updating the desktop app
Settings → General → Updates → Check for Updates. Auto-updates are also available; v1.0.4 is the latest as of April 2026.

## Subscription & billing
Manage all subscriptions through the Stripe portal: Account page → "Manage Subscription". Cancellation, payment-method updates, and invoices are all there. Super-users have permanent free Ultimate access (per the early-access program).

## Resetting password
Account page, click "Send password reset email", and Logto handles the rest.

## Reporting bugs
The Contact Us form in the desktop app collects diagnostics automatically. Always include OS + Scrollr version (Settings → General → About).

## Channel issues
Finance: stocks/crypto via TwelveData. Sports: api-sports.io. News: RSS pull-based ingestion. Fantasy: Yahoo OAuth + cached league data.

## Multi-row ticker
Available on Pro (2 rows), Ultimate (3 rows), and super_user. Configure in Settings → Ticker → Rows. Per-channel row assignment in the Settings → Ticker source picker, or right-click the tray menu.

## Channel.ticker_enabled / "missing channel"
If a channel disappears from the ticker, it's likely the per-channel ticker toggle is off. Check the Home/Feed page → channel header → ticker icon.
`
}

// applyTriageToBody prepends the AI summary and appends the duplicate
// hint to the ticket body HTML. The drafted reply is appended as a
// collapsible <details> block so the partner can copy it inside
// osTicket. Returns the modified body.
func applyTriageToBody(originalBody string, triage *TriageResult) string {
	if triage == nil {
		return originalBody
	}

	var prefix strings.Builder
	prefix.WriteString(`<div style="background:#0f3a2c;border-left:4px solid #10b981;padding:12px;margin-bottom:16px;color:#a7f3d0;border-radius:4px;">`)
	prefix.WriteString(fmt.Sprintf(`<strong>🤖 AI summary:</strong> %s`, escapeHTML(triage.Summary)))
	prefix.WriteString(fmt.Sprintf(`<br><span style="font-size:11px;opacity:0.8;">priority=%s · category=%s · confidence=%s`,
		escapeHTML(triage.Priority),
		escapeHTML(triage.Category),
		escapeHTML(triage.Confidence)))
	if triage.Channel != "" {
		prefix.WriteString(fmt.Sprintf(` · channel=%s`, escapeHTML(triage.Channel)))
	}
	prefix.WriteString(`</span></div>`)

	body := prefix.String() + originalBody

	if triage.DuplicateOf != "" {
		body += fmt.Sprintf(`<div style="background:#3a2c0f;border-left:4px solid #f59e0b;padding:8px;margin-top:16px;color:#fde68a;border-radius:4px;font-size:13px;">🔗 <strong>Possibly related:</strong> ticket %s</div>`,
			escapeHTML(triage.DuplicateOf))
	}

	if triage.DraftReplyHTML != "" {
		body += fmt.Sprintf(`<details style="margin-top:16px;background:#1a1a2e;border:1px solid #2a2a3e;padding:12px;border-radius:4px;"><summary style="cursor:pointer;color:#10b981;font-weight:600;">💡 AI suggested reply (click to expand)</summary><div style="margin-top:8px;padding:8px;background:#0a0a1a;border-radius:4px;color:#e2e8f0;">%s</div></details>`,
			triage.DraftReplyHTML)
	}

	return body
}

// mapTriagePriorityToOSTicket converts AI priority strings to osTicket's
// expected priority IDs. osTicket's default priority IDs are 1=Low, 2=Normal,
// 3=High, 4=Emergency. NOTE: this assumes default priority IDs; if the user's
// osTicket install has custom IDs, this will need adjustment via env var.
func mapTriagePriorityToOSTicket(priority string) string {
	switch strings.ToLower(priority) {
	case "low":
		return "1"
	case "normal":
		return "2"
	case "high":
		return "3"
	case "emergency":
		return "4"
	default:
		return ""
	}
}
