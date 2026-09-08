package support

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// /regen — re-triage a case the pipeline has already seen (REL-246)
// =============================================================================
//
// Everything the support bot knows has moved since the backlog was drafted:
// the knowledge base is generated from the repo instead of remembered from
// April, the drafter is Sonnet with the user's own context in front of it, and
// the server decides what happens to a draft instead of waiting for a click.
// None of that reaches a ticket that was already triaged. /regen is the thing
// that reaches them.
//
// A regenerated draft is an ordinary draft. It goes into the same thread with
// the same buttons and the same disposition, and — since REL-249 — it sends
// itself when nobody intervenes. That is deliberate: a backlog that needed a
// person to press Send is exactly how thirteen tickets sat unanswered since
// May, and re-drafting them into the same queue would only produce a
// better-written silence.
//
// The draft being replaced is not deleted. It stays on the case as an
// `ai_draft` message flagged `superseded`, because the interesting question
// six months from now is not what we said but what we nearly said.

// regenLimit caps one `/regen pending` run. The pending queue is single
// digits; a run that suddenly wants fifty triage calls is a query bug, and a
// cap makes it a small bill instead of a large one.
const regenLimit = 25

// regenOutcome is one ticket's result, for the summary the operator reads.
type regenOutcome struct {
	Ticket      string
	Disposition string // the new draft's disposition, or "" when nothing was drafted
	Note        string // why it was skipped, when it was
	OK          bool
}

// regenerateDraft re-runs triage on one case and replaces its pending draft.
//
// Fails closed in both directions that matter: a case we have never seen is
// left alone, and a triage call that produces no reply leaves the existing
// draft exactly where it was. The only way to lose a pending draft here is to
// have a new one to put in its place.
func regenerateDraft(ctx context.Context, ticketNumber string) regenOutcome {
	out := regenOutcome{Ticket: ticketNumber}
	if platform.DBPool == nil {
		out.Note = "no database"
		return out
	}

	src, err := loadRegenSource(ctx, ticketNumber)
	if err != nil {
		out.Note = err.Error()
		return out
	}

	// The backfill read subjects and bodies out of osTicket but never looked
	// inside them, so most of the backlog reads as "app version: unknown" —
	// the one fact that decides whether the answer is "update" or "let's
	// troubleshoot". Parse it back out of the user's own message first.
	backfillCaseDiagnostics(ctx, ticketNumber, src.UserMessageHTML)

	triage := triageTicket(ctx, TriageInput{
		UserEmail:         src.UserEmail,
		UserName:          src.UserName,
		Subject:           src.Subject,
		Body:              src.UserMessageHTML,
		RecentSummaries:   FetchRecentTicketSummaries(ctx),
		IsReply:           src.IsReply,
		ReplyTicketNumber: ticketNumber,
		Thread:            FetchCaseThread(ctx, ticketNumber),
		Context:           ticketContextFromCase(ctx, ticketNumber),
	})
	if triage == nil || strings.TrimSpace(triage.DraftReplyHTML) == "" {
		out.Note = "triage produced no reply; the existing draft is untouched"
		return out
	}

	note, ask, grounded, unknowns := triage.groundingFields()
	draft, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber:          ticketNumber,
		UserEmail:             src.UserEmail,
		UserName:              src.UserName,
		OriginalSubject:       src.Subject,
		UserMessageHTML:       src.UserMessageHTML,
		DraftBodyHTML:         triage.DraftReplyHTML,
		AISummary:             triage.Summary,
		AICategory:            triage.Category,
		AIPriority:            triage.Priority,
		AIWidget:              triage.Widget,
		AIDuplicateOf:         triage.DuplicateOf,
		AIConfidence:          triage.Confidence,
		OSTicketThreadEntryID: src.ThreadEntryID,
		ShouldClose:           triage.ShouldClose,
		NeedsInfo:             triage.NeedsInfo,
		Sentiment:             triage.Sentiment,
		DrafterCategory:       triage.DrafterCategory,
		InternalNote:          note,
		AskUserFor:            ask,
		GroundedIn:            grounded,
		Unknowns:              unknowns,
	})
	if err != nil {
		out.Note = "could not save the new draft: " + err.Error()
		return out
	}

	// New draft first, then retire the old one: the reverse order loses a
	// pending draft whenever the insert fails.
	if src.DraftID > 0 {
		supersedeDraft(ctx, ticketNumber, src.DraftID)
		postToTicketThread(ctx, ticketNumber, fmt.Sprintf(
			"♻️ **Re-triaged.** Draft %d is superseded by %d — re-read against today's knowledge base, not the one this ticket first met.",
			src.DraftID, draft.ID))
	} else {
		postToTicketThread(ctx, ticketNumber, fmt.Sprintf(
			"♻️ **Triaged for the first time.** Open since %s with no reply.",
			src.OpenedAt.UTC().Format("2 Jan 2006")))
	}

	// The ordinary path: thread post with buttons, then the disposition and
	// its countdown. Nothing about a regenerated draft is special from here.
	notifyPartnerAfterDraft(ctx, draft)

	out.OK = true
	out.Disposition = draft.Disposition
	if out.Disposition == "" {
		out.Disposition = "pending"
	}
	log.Printf("[Regen] ticket %s: draft %d -> %d (%s)",
		ticketNumber, src.DraftID, draft.ID, out.Disposition)
	return out
}

// regenSource is what a re-triage needs about a case: who wrote, what they
// said, and which draft (if any) is currently standing.
type regenSource struct {
	Subject         string
	UserEmail       string
	UserName        string
	UserMessageHTML string
	OpenedAt        time.Time
	DraftID         int64 // 0 = this case has never been drafted
	ThreadEntryID   int64
	IsReply         bool
}

// loadRegenSource prefers the pending draft's own copy of the ticket, and
// falls back to the case DB for the backlog that was imported from osTicket
// and never drafted at all. Those are the tickets with the longest wait, so
// "no draft to regenerate" is the wrong answer for them.
func loadRegenSource(ctx context.Context, ticketNumber string) (*regenSource, error) {
	var s regenSource
	var status string
	err := platform.DBPool.QueryRow(ctx, `
		SELECT COALESCE(subject,''), COALESCE(user_email,''), opened_at, status
		FROM support_cases WHERE ticket_number = $1`, ticketNumber).
		Scan(&s.Subject, &s.UserEmail, &s.OpenedAt, &status)
	if err != nil {
		return nil, fmt.Errorf("no case for #%s", ticketNumber)
	}
	if status == "closed" {
		return nil, fmt.Errorf("#%s is closed — reopen it in osTicket first if it still needs an answer", ticketNumber)
	}

	// The newest pending draft, when there is one. A decided draft is never
	// replaced: somebody already answered with it, or deliberately did not.
	var draftSubject, draftEmail, draftName, draftBody string
	err = platform.DBPool.QueryRow(ctx, `
		SELECT id, original_subject, user_email, COALESCE(user_name,''),
		       COALESCE(user_message_html,''), COALESCE(osticket_thread_entry_id,0)
		FROM support_drafts
		WHERE ticket_number = $1 AND status = 'pending'
		ORDER BY id DESC LIMIT 1`, ticketNumber).
		Scan(&s.DraftID, &draftSubject, &draftEmail, &draftName, &draftBody, &s.ThreadEntryID)
	if err == nil {
		if draftSubject != "" {
			s.Subject = draftSubject
		}
		if draftEmail != "" {
			s.UserEmail = draftEmail
		}
		s.UserName = draftName
		if strings.TrimSpace(draftBody) != "" {
			s.UserMessageHTML = draftBody
		}
		s.IsReply = s.ThreadEntryID > 0
	}

	// No draft, or a draft that never stored the user's message: the case DB
	// has it. More than one inbound message means we are answering a
	// follow-up, and the newest one is what we owe an answer to.
	if strings.TrimSpace(s.UserMessageHTML) == "" {
		var body string
		var n int
		if err := platform.DBPool.QueryRow(ctx, `
			SELECT COALESCE((SELECT COALESCE(NULLIF(body_html,''), body_text) FROM support_messages
			                 WHERE ticket_number = $1 AND kind = 'user'
			                 ORDER BY created_at DESC, id DESC LIMIT 1), ''),
			       (SELECT count(*) FROM support_messages
			        WHERE ticket_number = $1 AND kind = 'user')`,
			ticketNumber).Scan(&body, &n); err != nil {
			return nil, fmt.Errorf("nothing to re-read on #%s", ticketNumber)
		}
		s.UserMessageHTML = body
		if n > 1 {
			s.IsReply = true
		}
	}
	if strings.TrimSpace(s.UserMessageHTML) == "" {
		return nil, fmt.Errorf("#%s has no user message stored", ticketNumber)
	}
	if s.UserName == "" {
		s.UserName = fallbackName("", s.UserEmail)
	}
	return &s, nil
}

// supersedeDraft retires the draft a regeneration replaces: off 'pending' so
// no sweeper can send it, and flagged on the case so the timeline says which
// of the two was the live one.
//
// The status is 'skipped' because that is the only decided value meaning "this
// never went out", but the note beside it says what actually happened — the
// reply was rewritten, not withdrawn. It deliberately does not call
// markIntervened: nobody stepped in on this draft, so it is not evidence
// against its category.
func supersedeDraft(ctx context.Context, ticketNumber string, draftID int64) {
	if _, err := platform.DBPool.Exec(ctx,
		`UPDATE support_drafts SET status = 'skipped', hold_until = NULL, decided_at = NOW()
		 WHERE id = $1 AND status = 'pending'`, draftID); err != nil {
		log.Printf("[Regen] retire draft %d: %v", draftID, err)
		return
	}
	if _, err := platform.DBPool.Exec(ctx,
		`UPDATE support_messages SET superseded = true WHERE ai_draft_id = $1 AND kind = 'ai_draft'`,
		draftID); err != nil {
		log.Printf("[Regen] flag draft %d superseded: %v", draftID, err)
	}
	// No AIDraftID on the note: (ai_draft_id, kind) is unique, so hanging it
	// off the draft would be silently dropped on any draft that already
	// carries a note — the "filed as REL-nnn" one, most of the time.
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: ticketNumber, Kind: "note",
		BodyText: fmt.Sprintf("AI draft %d superseded by a re-triage", draftID),
	}); err != nil {
		log.Printf("[Cases] %v", err)
	}
}

// diagnosticsBlockRe pulls the JSON out of the <pre> block the desktop's bug
// form appends to every report. Non-greedy so a message with two blocks takes
// the first, and tolerant of attributes because osTicket rewrites the markup.
var diagnosticsBlockRe = regexp.MustCompile(`(?is)<pre[^>]*>\s*(\{.*?\})\s*</pre>`)

// backfillCaseDiagnostics fills in app_version / os on a case that does not
// have them, reading the diagnostics the user's own message carries.
//
// upsertSupportCase is first-writer-wins on these two columns, so this can
// never overwrite what the desktop told us at open time — it only fills the
// gap left by tickets that reached the case DB through the osTicket backfill,
// which kept the message but never looked inside it.
func backfillCaseDiagnostics(ctx context.Context, ticketNumber, userMessageHTML string) {
	var version, osName string
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT COALESCE(app_version,''), COALESCE(os,'') FROM support_cases WHERE ticket_number = $1`,
		ticketNumber).Scan(&version, &osName); err != nil {
		return
	}
	if version != "" && osName != "" {
		return
	}
	v, o := diagnosticsFields(userMessageHTML)
	if v == "" && o == "" {
		return
	}
	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: ticketNumber, AppVersion: v, OS: o,
	}); err != nil {
		log.Printf("[Regen] backfill diagnostics for %s: %v", ticketNumber, err)
		return
	}
	log.Printf("[Regen] ticket %s: recovered app_version=%q os=%q from the message body",
		ticketNumber, v, o)
}

// diagnosticsFields parses the desktop diagnostics blob out of a message body.
// Pure, so the parsing is testable without a database.
func diagnosticsFields(userMessageHTML string) (appVersion, osName string) {
	m := diagnosticsBlockRe.FindStringSubmatch(userMessageHTML)
	if len(m) < 2 {
		return "", ""
	}
	var diag map[string]interface{}
	if err := json.Unmarshal([]byte(html.UnescapeString(m[1])), &diag); err != nil {
		return "", ""
	}
	return caseFieldsFromDiagnostics(diag)
}

// pendingRegenTickets lists the tickets `/regen pending` acts on: every draft
// sitting in `pending`, oldest first.
//
// Deliberately the drafts, not "every case we never answered". A pending draft
// is proof that triage has already read this ticket and written something for
// a user; the rest of the backlog includes mail that reached the support
// mailbox by accident, and picking one of those up is a decision for whoever
// types the ticket number, not for a batch.
func pendingRegenTickets(ctx context.Context) ([]string, error) {
	// Oldest draft first, so the longest wait is answered first.
	rows, err := platform.DBPool.Query(ctx, `
		SELECT ticket_number FROM (
			SELECT DISTINCT ON (ticket_number) ticket_number, id
			FROM support_drafts WHERE status = 'pending'
			ORDER BY ticket_number, id DESC
		) p ORDER BY id LIMIT $1`, regenLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			continue
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// =============================================================================
// The Discord command
// =============================================================================

// handleDiscordRegenCommand runs `/regen ticket:<number>` or
// `/regen ticket:pending`. Deferred in both cases: one re-triage is two model
// calls, which is not a three-second answer.
func handleDiscordRegenCommand(c *fiber.Ctx, ix *discordInteraction) error {
	arg := strings.TrimSpace(commandOption(ix, "ticket"))
	if arg == "" {
		return discordEphemeralResponse(c, "Missing `ticket` option — a ticket number, or `pending`.")
	}
	appID, token := ix.ApplicationID, ix.Token
	go func() {
		// Generous: the cap is 25 tickets at two model calls each, and the
		// interaction token outlives the request either way.
		ctx, cancel := context.WithTimeout(context.Background(), 14*time.Minute)
		defer cancel()
		if err := discordCompleteDeferred(ctx, appID, token, runRegen(ctx, appID, token, arg)); err != nil {
			log.Printf("[Regen] follow-up for %q: %v", arg, err)
		}
	}()
	return c.JSON(fiber.Map{"type": discordResponseDeferredChannelMessage})
}

// runRegen does the work and returns what the operator should read. Never an
// error: whatever happened, it has to be legible in Discord.
func runRegen(ctx context.Context, appID, token, arg string) string {
	if platform.DBPool == nil {
		return "No database."
	}
	if !strings.EqualFold(arg, "pending") {
		return renderRegenOutcome(regenerateDraft(ctx, strings.TrimPrefix(arg, "#")))
	}

	tickets, err := pendingRegenTickets(ctx)
	if err != nil {
		log.Printf("[Regen] pending list: %v", err)
		return "Could not list pending drafts."
	}
	if len(tickets) == 0 {
		return "Nothing pending — no draft to regenerate."
	}
	// Say what is about to happen before it takes several minutes, then
	// overwrite the same message with the result.
	if err := discordCompleteDeferred(ctx, appID, token, fmt.Sprintf(
		"♻️ Re-triaging %d pending draft(s): #%s.\nEach lands in its own thread with its disposition; the summary replaces this message.",
		len(tickets), strings.Join(tickets, ", #"))); err != nil {
		log.Printf("[Regen] progress message: %v", err)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "♻️ **Re-triaged %d pending draft(s).**\n", len(tickets))
	counts := map[string]int{}
	for _, t := range tickets {
		o := regenerateDraft(ctx, t)
		if o.OK {
			counts[o.Disposition]++
		} else {
			counts["skipped"]++
		}
		b.WriteString(renderRegenOutcome(o))
		b.WriteString("\n")
	}
	b.WriteString("\n")
	for _, k := range []string{"auto_send", "auto_ask", "escalate", "auto_close", "pending", "skipped"} {
		if counts[k] > 0 {
			fmt.Fprintf(&b, "`%s` %d  ", k, counts[k])
		}
	}
	return truncateRunes(strings.TrimSpace(b.String()), 1990)
}

func renderRegenOutcome(o regenOutcome) string {
	if !o.OK {
		return fmt.Sprintf("⏭️ **#%s** — %s", o.Ticket, o.Note)
	}
	return fmt.Sprintf("✅ **#%s** — `%s`", o.Ticket, o.Disposition)
}
