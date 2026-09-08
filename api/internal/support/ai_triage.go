package support

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
// AI support triage — classify with Haiku, draft with Sonnet (REL-244)
// =============================================================================
//
// Two calls, because they are two jobs. Classification is a cheap labelling
// problem: category, priority, which widget, is this a duplicate, is the user
// telling us it is fixed, do we even have enough to go on. Drafting is the
// expensive one, and it is the one that has to be right in front of a user.
//
// Both are structured through TOOL USE with tool_choice pinned to a single
// tool, so the model fills a schema instead of being asked to "output only
// JSON" and then being talked out of markdown fences. The fence-stripping
// and the "your turn ENDS after the closing brace" pleading are gone.
//
// The system prompt is the knowledge base plus the standing policy and voice
// rules, and it is identical on every ticket so Anthropic's prompt cache
// holds it (cache_control: ephemeral). Everything that varies per ticket —
// who is writing, what is known-broken, what we said to people who wrote in
// with the same thing — rides in the user message.
//
// Everything here fails soft. A nil result puts the ticket back on the
// legacy path: it still reaches osTicket, the partner still gets it, they
// just do not get a draft.

const (
	anthropicAPIURL  = "https://api.anthropic.com/v1/messages"
	classifyModel    = "claude-haiku-4-5"
	draftModel       = "claude-sonnet-5"
	anthropicVersion = "2023-06-01"

	classifyTimeout = 10 * time.Second
	draftTimeout    = 25 * time.Second

	maxTriageBodyChars = 8000 // truncate the ticket body to keep the prompt bounded
	similarCaseCount   = 3
)

// TriageResult is the merged output of both calls. It is the shape the rest
// of the support flow already reads, plus the grounding fields the drafter
// now reports (persisted as nullable columns on support_drafts).
type TriageResult struct {
	// From the classifier.
	Category    string
	Widget      string
	Priority    string
	Summary     string
	DuplicateOf string
	NeedsInfo   bool

	// From the drafter.
	DraftReplyHTML string
	Confidence     string
	GroundedIn     []string
	Unknowns       []string
	AskUserFor     []string
	InternalNote   string

	// ShouldClose is true only when BOTH calls agree the user has told us
	// the issue is resolved. Closing a ticket is the one triage decision
	// with a cost when it is wrong, so a disagreement leaves it open.
	ShouldClose bool

	// Usage is for logs and the live test's cost report. Never persisted.
	Usage TriageUsage
}

// TriageUsage is the token cost of one ticket across both calls.
type TriageUsage struct {
	ClassifyIn, ClassifyOut int
	DraftIn, DraftOut       int
	CacheRead, CacheWrite   int
}

func (u TriageUsage) String() string {
	return fmt.Sprintf("classify %d in/%d out, draft %d in/%d out, cache %d read/%d write",
		u.ClassifyIn, u.ClassifyOut, u.DraftIn, u.DraftOut, u.CacheRead, u.CacheWrite)
}

// TriageInput is what the call sites hand us. Context, KnownIssues, Similar
// and Thread are filled in by triageTicket itself when the caller leaves
// them empty — the prompt builders stay pure so the golden tests can pin
// them without a network or a database.
type TriageInput struct {
	UserCategory    string
	UserEmail       string
	UserName        string
	Subject         string
	Body            string
	RecentSummaries []RecentTicketSummary
	Widget          string // user-picked widget hint, if any

	Context     TicketContext
	KnownIssues string
	Similar     []SimilarCase

	// Reply-loop fields. Populated when this triage is for a user's
	// follow-up on an existing ticket (osTicket thread-message webhook).
	IsReply           bool
	ReplyTicketNumber string
	Thread            []SupportMessage
}

// RecentTicketSummary is one line of dupe-detection context for the
// classifier: the last 50 support_cases (FetchRecentTicketSummaries in
// support_cases.go). Kept compact — the list rides on every call.
type RecentTicketSummary struct {
	TicketNumber string `json:"ticket_number"`
	Category     string `json:"category"`
	Summary      string `json:"summary"`
	CreatedAt    string `json:"created_at"`
}

// triageTicket runs both calls and merges them. Returns nil when the
// classifier fails — without a category there is nothing worth persisting.
// When the classifier succeeds and the drafter does not, the result comes
// back with an empty DraftReplyHTML: the ticket still gets its category and
// priority, and createSupportDraft refuses the bodiless draft.
func triageTicket(ctx context.Context, input TriageInput) *TriageResult {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		log.Println("[Triage] ANTHROPIC_API_KEY not set; skipping triage")
		return nil
	}
	if os.Getenv("AI_TRIAGE_ENABLED") == "false" {
		return nil
	}

	if len(input.Body) > maxTriageBodyChars {
		input.Body = input.Body[:maxTriageBodyChars] + "\n\n...[truncated]"
	}
	if input.KnownIssues == "" {
		input.KnownIssues = knownIssuesBlock(ctx)
	}
	if input.Similar == nil {
		input.Similar = FetchSimilarCases(ctx,
			input.Subject+" "+htmlToPlain(input.Body), input.ReplyTicketNumber, similarCaseCount)
	}

	cls, clsUsage, err := classifyTicket(ctx, input)
	if err != nil {
		log.Printf("[Triage] classify failed: %v", err)
		return nil
	}

	result := &TriageResult{
		Category:    cls.Category,
		Widget:      cls.Widget,
		Priority:    cls.Priority,
		Summary:     cls.Summary,
		DuplicateOf: cls.DuplicateOf,
		NeedsInfo:   cls.NeedsInfo,
		Usage:       clsUsage,
	}

	draft, draftUsage, err := draftReply(ctx, input, cls)
	if err != nil {
		log.Printf("[Triage] draft failed for %q (classification kept): %v", input.Subject, err)
		return result
	}
	result.DraftReplyHTML = draft.ReplyHTML
	result.Confidence = draft.Confidence
	result.GroundedIn = draft.GroundedIn
	result.Unknowns = draft.Unknowns
	result.AskUserFor = draft.AskUserFor
	result.InternalNote = draft.InternalNote
	result.ShouldClose = cls.ShouldClose && draft.ShouldClose
	result.Usage.DraftIn = draftUsage.DraftIn
	result.Usage.DraftOut = draftUsage.DraftOut
	result.Usage.CacheRead += draftUsage.CacheRead
	result.Usage.CacheWrite += draftUsage.CacheWrite

	log.Printf("[Triage] OK: category=%s priority=%s confidence=%s needs_info=%t summary=%q usage=[%s]",
		result.Category, result.Priority, result.Confidence, result.NeedsInfo, result.Summary, result.Usage)
	return result
}

// ===== Call 1: classification =====================================

type classification struct {
	Category    string `json:"category"`
	Priority    string `json:"priority"`
	Summary     string `json:"summary"`
	Widget      string `json:"widget"`
	DuplicateOf string `json:"duplicate_of"`
	ShouldClose bool   `json:"should_close"`
	NeedsInfo   bool   `json:"needs_info"`
}

var classifyTool = map[string]interface{}{
	"name":        "classify_ticket",
	"description": "Record the triage classification for this support ticket.",
	"input_schema": map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"category": map[string]interface{}{
				"type": "string",
				"enum": []string{"bug", "feature", "feedback", "billing", "account", "widget"},
			},
			"priority": map[string]interface{}{
				"type": "string",
				"enum": []string{"low", "normal", "high", "emergency"},
			},
			"summary": map[string]interface{}{
				"type":        "string",
				"description": "Triage label, 10 words maximum, no trailing period. Reads like a label, not a sentence.",
			},
			"widget": map[string]interface{}{
				"type":        "string",
				"description": "The catalog widget this is about, by its catalog name. Empty when the ticket is not about one widget.",
			},
			"duplicate_of": map[string]interface{}{
				"type":        "string",
				"description": "Ticket number from RECENT TICKETS that this duplicates. Empty when it is not a duplicate.",
			},
			"should_close": map[string]interface{}{
				"type":        "boolean",
				"description": "True only on an unambiguous resolution signal from the user. False on the opening message, on vague thanks, and whenever they ask anything further.",
			},
			"needs_info": map[string]interface{}{
				"type":        "boolean",
				"description": "True when this is a bug report and we cannot troubleshoot it with what we have: no OS, no app version, or no description of what actually happened.",
			},
		},
		"required": []string{"category", "priority", "summary", "widget", "duplicate_of", "should_close", "needs_info"},
	},
}

func classifyTicket(ctx context.Context, in TriageInput) (*classification, TriageUsage, error) {
	raw, usage, err := anthropicToolCall(ctx, classifyModel, classifyTimeout, 1024,
		buildClassifyPrompt(in), classifyTool)
	if err != nil {
		return nil, TriageUsage{}, err
	}
	var cls classification
	if err := json.Unmarshal(raw, &cls); err != nil {
		return nil, TriageUsage{}, fmt.Errorf("decode classification: %w", err)
	}
	if cls.Category == "" || cls.Priority == "" || cls.Summary == "" {
		return nil, TriageUsage{}, fmt.Errorf("incomplete classification: %+v", cls)
	}
	return &cls, TriageUsage{
		ClassifyIn: usage.InputTokens, ClassifyOut: usage.OutputTokens,
		CacheRead: usage.CacheReadInputTokens, CacheWrite: usage.CacheCreationInputTokens,
	}, nil
}

// ===== Call 2: the reply ==========================================

type replyDraft struct {
	ReplyHTML    string   `json:"reply_html"`
	Confidence   string   `json:"confidence"`
	GroundedIn   []string `json:"grounded_in"`
	Unknowns     []string `json:"unknowns"`
	AskUserFor   []string `json:"ask_user_for"`
	ShouldClose  bool     `json:"should_close"`
	InternalNote string   `json:"internal_note"`
}

var draftTool = map[string]interface{}{
	"name":        "draft_reply",
	"description": "Record the drafted reply to the user, and say what it rests on.",
	"input_schema": map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"reply_html": map[string]interface{}{
				"type":        "string",
				"description": "The reply to the user, as HTML paragraphs. Ends with the two sign-off lines.",
			},
			"confidence": map[string]interface{}{
				"type": "string",
				"enum": []string{"high", "medium", "low"},
				"description": "high when every claim comes from the knowledge base or the live blocks; " +
					"low whenever the reply leaves something open or guesses.",
			},
			"grounded_in": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "What each claim in the reply rests on: knowledge base section headings, release versions, or issue keys. One entry per claim.",
			},
			"unknowns": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "Anything the reply had to leave open because nothing given to you covers it. Empty when the reply answers everything asked.",
			},
			"ask_user_for": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "Exactly the things the reply asks the user to send back. Empty when it asks for nothing.",
			},
			"should_close": map[string]interface{}{
				"type":        "boolean",
				"description": "True only when this reply acknowledges a resolution the user reported and proposes no further steps.",
			},
			"internal_note": map[string]interface{}{
				"type":        "string",
				"description": "For the partner reviewing this draft. Never shown to the user. When the ticket matches a known open issue, this is its issue key. Empty when there is nothing to add.",
			},
		},
		"required": []string{"reply_html", "confidence", "grounded_in", "unknowns", "ask_user_for", "should_close", "internal_note"},
	},
}

func draftReply(ctx context.Context, in TriageInput, cls *classification) (*replyDraft, TriageUsage, error) {
	raw, usage, err := anthropicToolCall(ctx, draftModel, draftTimeout, 2048,
		buildDraftPrompt(in, cls), draftTool)
	if err != nil {
		return nil, TriageUsage{}, err
	}
	var d replyDraft
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, TriageUsage{}, fmt.Errorf("decode draft: %w", err)
	}
	if strings.TrimSpace(d.ReplyHTML) == "" {
		return nil, TriageUsage{}, fmt.Errorf("empty reply_html")
	}
	d.ReplyHTML = ensureSignOff(d.ReplyHTML)
	return &d, TriageUsage{
		DraftIn: usage.InputTokens, DraftOut: usage.OutputTokens,
		CacheRead: usage.CacheReadInputTokens, CacheWrite: usage.CacheCreationInputTokens,
	}, nil
}

// ensureSignOff guarantees the reply ends the way every Scrollr reply ends.
// The system prompt asks for it, the draft prompt asks for it and the tool
// schema asks for it, and the drafter still drops it on the short "we need
// more information" replies — so it is not left to the model. Appended here
// rather than in decorateUserReplyHTML because the partner reviews this body
// and should see exactly what the user will.
func ensureSignOff(replyHTML string) string {
	replyHTML = strings.TrimSpace(replyHTML)
	if strings.Contains(replyHTML, "Scrollr Support") {
		return replyHTML
	}
	return replyHTML + "<p>Best Regards,<br>Scrollr Support</p>"
}

// ===== The Anthropic call =========================================

type anthropicUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

// anthropicToolCall posts one message pinned to a single tool and returns
// that tool call's input. tool_choice makes the schema the only thing the
// model can produce, which is why nothing downstream has to repair prose.
func anthropicToolCall(ctx context.Context, model string, timeout time.Duration, maxTokens int,
	userMessage string, tool map[string]interface{}) (json.RawMessage, anthropicUsage, error) {

	var usage anthropicUsage
	reqBody := map[string]interface{}{
		"model":      model,
		"max_tokens": maxTokens,
		"system": []map[string]interface{}{{
			"type":          "text",
			"text":          triageSystemPrompt(),
			"cache_control": map[string]string{"type": "ephemeral"},
		}},
		"messages":    []map[string]string{{"role": "user", "content": userMessage}},
		"tools":       []map[string]interface{}{tool},
		"tool_choice": map[string]string{"type": "tool", "name": tool["name"].(string)},
	}
	reqBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, usage, fmt.Errorf("marshal request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicEndpoint(), bytes.NewReader(reqBytes))
	if err != nil {
		return nil, usage, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", os.Getenv("ANTHROPIC_API_KEY"))
	req.Header.Set("anthropic-version", anthropicVersion)

	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return nil, usage, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, usage, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, usage, fmt.Errorf("anthropic %d: %s", resp.StatusCode, truncate(string(respBody), 400))
	}

	var apiResp struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		Usage anthropicUsage `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return nil, usage, fmt.Errorf("parse response: %w", err)
	}
	usage = apiResp.Usage
	for _, block := range apiResp.Content {
		if block.Type == "tool_use" && block.Name == tool["name"] {
			return block.Input, usage, nil
		}
	}
	return nil, usage, fmt.Errorf("no %s tool call in response", tool["name"])
}

// anthropicEndpoint exists so the tests can point the client at a stub.
func anthropicEndpoint() string {
	if u := os.Getenv("ANTHROPIC_API_URL"); u != "" {
		return u
	}
	return anthropicAPIURL
}

// ===== Prompts ====================================================

// triageSystemPrompt is byte-identical on every ticket so Anthropic's prompt
// cache holds it: the knowledge base is ~70 KB and would otherwise be the
// whole cost of triage. Nothing per-ticket may be added here.
func triageSystemPrompt() string {
	return `You are the support assistant for Scrollr, a desktop ticker app for live financial
markets, sports scores, news, prediction markets and Yahoo Fantasy. You classify incoming
tickets and draft the replies a human partner approves before they are sent.

The knowledge base below is ground truth. Where it and your training data disagree, the
knowledge base wins. If it does not cover something, say so — never fill the gap with a
guess about how Scrollr works.

HARD RULES for anything the user will read:
- Never name internal infrastructure: the auth provider, hosting, databases, queues, the
  ticketing system, the data providers we buy from, or any of their rate limits or quotas.
  To a user, "Scrollr" is the whole system, and an outage is "a problem on our side".
- Never mention the Super User program, by name or by description.
- Never give a date, an estimate or a promise for anything that has not shipped.
- Never quote a dollar amount. Link https://myscrollr.com/uplink instead.
- Never use an em dash or an en dash. Commas, periods, parentheses and hyphens only.
- Sentence case. Warm, plain, short. Answer the question asked and do not tour features.
- End every reply with exactly these two lines, and nothing after them:
    Best Regards,
    Scrollr Support

KNOWLEDGE BASE
` + supportKnowledgeBase()
}

// buildClassifyPrompt is the labelling prompt. Pure — the golden test pins it.
func buildClassifyPrompt(in TriageInput) string {
	recentJSON, _ := json.Marshal(in.RecentSummaries)
	if len(recentJSON) == 0 {
		recentJSON = []byte("[]")
	}

	var b strings.Builder
	b.WriteString(`Classify this support ticket. Call classify_ticket once with your answer.

CATEGORIES — match the user's actual problem, not their keywords:
- bug: something is broken, crashes, or behaves contrary to what the docs or the UI promise.
- feature: a new capability that does not exist yet.
- feedback: an opinion or a design take with no specific fix requested.
- billing: payment, subscription, plan change, refund, invoice, charge dispute.
- account: login, password, email, username, profile, deletion, sign-up, data export.
- widget: a question or a fault in one specific widget's content, configuration or connection.

Respect an unambiguous self-classification ("this is a bug:", "feature request:") unless the
content plainly contradicts it, in which case classify by the content and say so in the summary.

PRIORITY:
- emergency: lost data, cannot log in at all, a payment failure blocking access, a security issue.
- high: a widget or a whole feature is broken, a billing dispute, an account-access problem.
- normal: minor UX problems, non-blocking bugs, most feature requests, general questions.
- low: nice-to-have feedback, praise, low-stakes suggestions.

needs_info is about whether WE can act. Set it true when this is a bug report and we are missing
what it would take to troubleshoot: no OS, no app version, or no account of what actually
happened. The context block below says whether diagnostics were attached.

`)
	if in.IsReply {
		fmt.Fprintf(&b, "This is a FOLLOW-UP message on existing ticket #%s, not a new report.\n\n", in.ReplyTicketNumber)
	}
	b.WriteString(in.Context.render())
	fmt.Fprintf(&b, "\nRECENT TICKETS (for duplicate detection only):\n%s\n", recentJSON)
	b.WriteString("\n" + renderUserTicket(in))
	return b.String()
}

// buildDraftPrompt is the reply prompt. Pure — the golden test pins it.
func buildDraftPrompt(in TriageInput, cls *classification) string {
	var b strings.Builder
	b.WriteString("Draft the reply to this support ticket. Call draft_reply once with your answer.\n\n")

	if cls != nil {
		fmt.Fprintf(&b, "TRIAGE (already decided; do not re-argue it): category=%s priority=%s",
			cls.Category, cls.Priority)
		if cls.Widget != "" {
			fmt.Fprintf(&b, " widget=%s", cls.Widget)
		}
		if cls.DuplicateOf != "" {
			fmt.Fprintf(&b, " duplicate_of=#%s", cls.DuplicateOf)
		}
		fmt.Fprintf(&b, " should_close=%t needs_info=%t\n\n", cls.ShouldClose, cls.NeedsInfo)
	}

	b.WriteString(in.Context.render())
	b.WriteString("\n" + in.KnownIssues + "\n")

	if s := renderSimilarCases(in.Similar); s != "" {
		b.WriteString("\n" + s)
	}

	if in.IsReply {
		fmt.Fprintf(&b, `
THIS IS A FOLLOW-UP on ticket #%s. It is a continued conversation:
- Do not open with a greeting. Acknowledge briefly ("Got it,", "Thanks for the update,") and
  go straight to the answer.
- If your last suggestion did not work, do not repeat it. Try a different angle or ask one
  clarifying question.
- If they are telling you it is resolved, say so warmly in one or two sentences, propose
  nothing further, and set should_close true.

`, in.ReplyTicketNumber)
		if t := renderThread(in.Thread); t != "" {
			b.WriteString(t + "\n")
		}
	}

	if cls != nil && cls.NeedsInfo {
		b.WriteString(`
ASK FOR INFORMATION. We cannot troubleshoot this yet. The reply is ONE short paragraph, then
the sign-off. That paragraph acknowledges the problem and asks for their operating system,
their Scrollr version (Settings › Updates shows it) and a screenshot of what they see. Do not
guess at a cause and do not offer steps that depend on the answer. List each thing you ask for
in ask_user_for.

`)
	}

	b.WriteString(`
HOW TO WRITE IT:
- Two to four short paragraphs of HTML, <p> tags, no headings and no lists unless the answer
  is genuinely a sequence of steps.
- Lead with a brief acknowledgement, then the action. Say what to click, in the app's own words.
- Every factual claim must come from the knowledge base, the release notes or the known-issues
  block above. List what each rests on in grounded_in.
- Anything you cannot answer from those goes in unknowns, and the reply says the partner will
  follow up rather than guessing. Set confidence low when unknowns is not empty.
- The similar past cases are reference for approach and tone. Never reuse their wording or
  their specifics.
- Every reply, however short, ends with these two lines and nothing after them:
      Best Regards,
      Scrollr Support

`)
	b.WriteString(renderUserTicket(in))
	return b.String()
}

// renderUserTicket is the ticket itself, shared by both prompts so the two
// calls read exactly the same message.
func renderUserTicket(in TriageInput) string {
	var b strings.Builder
	b.WriteString("THE TICKET:\n")
	fmt.Fprintf(&b, "From: %s <%s>\n", in.UserName, in.UserEmail)
	if in.UserCategory != "" {
		fmt.Fprintf(&b, "Category the user picked: %s\n", in.UserCategory)
	}
	if in.Widget != "" {
		fmt.Fprintf(&b, "Widget the user picked: %s\n", in.Widget)
	}
	fmt.Fprintf(&b, "Subject: %s\nBody:\n%s\n", in.Subject, in.Body)
	return b.String()
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
