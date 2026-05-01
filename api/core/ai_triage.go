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
	// ShouldClose is true when the user clearly indicates the issue
	// is resolved (thanks/that worked/resolved/done). When set, the
	// approval handler passes close_ticket=true to the osTicket
	// plugin so the reply also closes the ticket. Conservative —
	// Claude is instructed to set this only on unambiguous resolution.
	ShouldClose bool `json:"should_close,omitempty"`
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

	// Reply-loop fields. Populated when this triage is for a user's
	// follow-up message on an existing ticket (via the osTicket
	// thread-message webhook). The prompt uses these to skip the
	// initial greeting and to thread responses correctly.
	IsReply             bool
	ReplyTicketNumber   string // existing ticket number (e.g. "716831")
	PreviousAIReplyHTML string // most recent AI reply we sent on this ticket, if known
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

	// Claude sometimes wraps JSON in markdown fences AND/OR appends a
	// "note on categorization" or similar commentary after the JSON
	// object — both despite the prompt's "no markdown, no commentary"
	// instruction. Strip leading fences then use json.Decoder.Decode
	// which reads ONE JSON value and ignores everything after it.
	// (json.Unmarshal would fail with "invalid character ... after
	// top-level value" when commentary follows.)
	rawJSON := strings.TrimSpace(apiResp.Content[0].Text)
	rawJSON = strings.TrimPrefix(rawJSON, "```json")
	rawJSON = strings.TrimPrefix(rawJSON, "```")
	rawJSON = strings.TrimSpace(rawJSON)

	var result TriageResult
	dec := json.NewDecoder(strings.NewReader(rawJSON))
	if err := dec.Decode(&result); err != nil {
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

	// Reply-context block. When this triage is for a user follow-up
	// message on an existing ticket, prepend a framing block that
	// changes the AI's voice (no opening greeting, treat as continued
	// conversation) and gives it the previous AI response so it can
	// build on prior advice instead of restarting.
	replyContext := ""
	if input.IsReply {
		var prevReply string
		if input.PreviousAIReplyHTML != "" {
			prevReply = "\n\nYour previous reply on this ticket (for continuity — DO NOT repeat it verbatim):\n" + input.PreviousAIReplyHTML
		}
		replyContext = fmt.Sprintf(`REPLY CONTEXT — IMPORTANT:
This message is the user's FOLLOW-UP reply on an existing ticket (ticket #%s, original subject: %q). Treat it as a continued conversation.

- DO NOT open with a greeting like "Hi!" or "Thanks for reaching out!" — that's reserved for first contact.
- Acknowledge what they said briefly (e.g. "Got it — ", "Thanks for the update — ", "Following up on that:") and move directly to the next action or answer.
- If the user is reporting that your prior fix did NOT work, do not repeat the same suggestion — try a different angle or ask a clarifying question.
- If the user says "thanks, that worked" or similar (resolution signal), acknowledge it warmly and indicate the ticket can be closed (1-2 sentences). Do not propose new steps.
- If the user is asking a follow-up question, answer directly without re-introducing yourself.%s

`, input.ReplyTicketNumber, input.Subject, prevReply)
	}

	return fmt.Sprintf(`You are a support triage assistant for Scrollr, a desktop ticker app for live financial markets, sports scores, news, and Yahoo Fantasy. Categorize incoming tickets and draft warm, direct replies grounded in the FAQ below.

%s

YOUR TASKS:
1. Pick the best category. Definitions and examples below — match the user's actual problem, not just keywords.

   - bug: something is broken, crashes, or behaves contrary to docs/UI promises.
     Examples: "app crashes on startup", "stocks won't update", "OAuth callback fails", "ticker shows stale data after sleep"

   - feature: a NEW capability the user wants that does not currently exist.
     Examples: "can you add weather widget", "would love iOS app", "support for crypto exchange X"

   - feedback: opinions, design takes, or general thoughts with no specific fix requested.
     Examples: "love the dark mode", "the icons feel small", "sports scores feel slow but I'm not sure why"

   - billing: payment, subscription, plan change, refund, invoice, charge dispute, Stripe portal access.
     Examples: "double-charged", "want to cancel", "how do I get an invoice", "lifetime upgrade question"

   - account: login, password, email, username, profile, account deletion, sign-up, GDPR export.
     Examples: "can't log in", "want to change my email", "delete my account", "didn't get verification email"

   - channel: a question or issue about a specific data channel's content, configuration, or connection.
     Examples: "Yahoo OAuth disconnected", "missing AAPL stock", "RSS feed not updating", "wrong score for Lakers game"
     If category is "channel", also identify which: finance, sports, rss, fantasy

   IMPORTANT — respect explicit user classification: if the user's message contains an unambiguous self-classification ("this is a bug:", "feature request:", "billing question:"), use their category UNLESS the actual content clearly contradicts it (e.g., they wrote "feature request" but described an obvious crash — call it a bug and note the override in the summary).

2. Pick a priority based on urgency signals:
   - emergency: lost data, can't log in at all, payment failures blocking access, security issue
   - high: significant feature broken (channel not working, can't connect Yahoo), billing dispute, account access issue
   - normal: minor UX issues, non-blocking bugs, most feature requests, general questions
   - low: nice-to-have feedback, "love this app" notes, low-stakes suggestions

3. Generate a one-line summary (10 words max, no period at the end). Should read like a triage label, not a sentence.

4. If the ticket looks like a duplicate of one in RECENT TICKETS, output its ticket_number.

5. Draft a reply matching this voice:
   - Warm, direct, normal sentence-case capitalization (start every sentence with a capital letter), no corporate-speak
   - NEVER use em dashes (—) or en dashes (–) anywhere in the reply. Use commas, periods, parentheses, or simple hyphens (-) instead. This is a hard rule.
   - Lead with a brief acknowledgment, then action
   - Reference the FAQ if relevant; never make up fix steps
   - 2-4 short paragraphs max
   - Sign off with exactly these two lines, on their own lines, with nothing else after:
       Best Regards,
       Scrollr Support

6. Output confidence: "high" if you're very sure of category/priority, "medium" if some ambiguity, "low" if you'd want a human to double-check

7. Set "should_close" to true ONLY when the user's message contains an unambiguous resolution signal:
   - "thanks, that worked"
   - "issue is resolved"
   - "you can close the ticket"
   - "we're good now"
   - similar clear indicators that the user is done

   Otherwise leave should_close as false. Do NOT set it true on:
   - Vague thanks ("thanks for your help" — could be a polite intro to a follow-up)
   - Ambiguous responses
   - The initial ticket message (set false there too)
   - User asking another question, even after partial thanks

   When should_close is true, your draft_reply_html should ALSO acknowledge the resolution and indicate the ticket is being closed (1-2 sentences). Don't propose new troubleshooting steps when closing.

OUTPUT FORMAT — STRICT:
- Output ONLY a single JSON object. Nothing before it. Nothing after it.
- Do NOT wrap in markdown code fences (no triple-backtick blocks, no "json" language tags).
- No prose, no commentary, no "Note on categorization", no follow-up explanation.
- The output must START with an opening curly brace and END with a closing curly brace, with nothing else around it.
- After the closing brace, your turn ENDS. Do not write another sentence.

JSON SCHEMA:
{
  "category": "bug|feature|feedback|billing|account|channel",
  "channel": "finance|sports|rss|fantasy" or null,
  "priority": "low|normal|high|emergency",
  "summary": "...",
  "duplicate_of": "ticket-number" or null,
  "draft_reply_html": "<p>...</p>",
  "confidence": "high|medium|low",
  "should_close": false
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
		replyContext,
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

// faqContextForTriage delegates to the canonical knowledge base in
// support_kb.go. Kept as a wrapper so the prompt-building call site
// doesn't need to change every time the KB structure evolves.
func faqContextForTriage() string {
	return supportKnowledgeBase()
}

// applyTriageToBody was removed in 2026-05-01 — it used to prepend an
// "AI summary" banner and append the drafted reply as a <details> block
// to the ticket body, but those decorations were visible to users when
// they viewed the ticket via the portal. AI metadata now lives in the
// support_drafts row and the partner-notification email only. The
// user-visible thread is whatever the user wrote and whatever the
// agent answers — nothing else.

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
