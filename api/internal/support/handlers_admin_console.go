package support

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// =============================================================================
// The staff support console, read half (REL-263)
// =============================================================================
//
// Everything this serves has been in Postgres since REL-243/249. None of it has
// ever been shown properly: Discord truncates a reply at 2000 characters,
// splits it across posts, and has no room at all for the pipeline underneath —
// what the classifier decided, what the drafter cited, what it admits it does
// not know, and which rule chose the disposition. So this is not new data. It
// is the first surface wide enough to read it.
//
// Read-only on purpose. Every verb is REL-261, and proving each fact is
// visible has to come before a button can act on one.
//
// These handlers live in package support rather than package admin because
// everything they need — the disposition vocabulary, the proven-fix walk, the
// context the prompt was given, the hold clock — is here and unexported.
// Moving them would have meant exporting a dozen internals so another package
// could reassemble them in the same order. The staff gate is applied where the
// routes are declared: platform.LogtoAuth + admin.RequireAdmin, and never the
// SCROLLR_WEBHOOK_SECRET header that guards /internal/support/cases — that
// secret is for machine-to-machine callers and a browser has no business
// holding one.

// queueLimit caps how many cases one queue read considers. The whole table is
// in the low hundreds, so this is a ceiling rather than a pager: showing an
// admin a partial queue and calling it the queue is the failure to avoid.
const queueLimit = 500

const (
	queueNeedsYou = "needs_you"
	queueWaiting  = "waiting"
	queueHandled  = "handled"
)

// AutoSendState is the pipeline's switch position. Every countdown on the page
// is meaningless without it: a hold running against a paused pipeline is not
// counting down to anything.
type AutoSendState struct {
	Armed       bool   `json:"armed"`
	Paused      bool   `json:"paused"`
	Enabled     bool   `json:"enabled"`
	HoldMinutes int    `json:"hold_minutes"`
	Note        string `json:"note"`
}

func autoSendState(ctx context.Context) AutoSendState {
	s := AutoSendState{
		Enabled:     autosendEnabled(),
		Paused:      autosendPaused(ctx),
		HoldMinutes: int(holdDuration() / time.Minute),
	}
	s.Armed = s.Enabled && !s.Paused
	switch {
	case !s.Enabled:
		s.Note = "Autonomous sending is off (SUPPORT_AUTOSEND). Every draft waits for a person, whatever its disposition says."
	case s.Paused:
		s.Note = "Autonomous sending is paused. Holds keep their deadlines and resume where they were, but nothing goes out until /resume."
	default:
		s.Note = fmt.Sprintf("Autonomous sending is on, with a %d-minute hold. A draft on a hold sends itself when the countdown runs out — doing nothing is what sends it.", s.HoldMinutes)
	}
	return s
}

// AdminHold is a live countdown, or an honest refusal to show one.
//
// Remaining is Measured rather than a bare number because the number is only a
// countdown while the pipeline is armed. Printing "sends in 12 minutes" with
// SUPPORT_AUTOSEND off is exactly the failure that type exists to stop.
type AdminHold struct {
	Until     time.Time         `json:"until"`
	Remaining platform.Measured `json:"remaining_seconds"`
	Verb      string            `json:"verb"`
	Expired   bool              `json:"expired"`
	Note      string            `json:"note"`
}

// draftStatus is a parameter and not an afterthought: hold_until is NEVER
// cleared when a draft is sent, held or skipped, so a row that went out this
// morning still carries this morning's deadline. Reading it without checking
// the status renders a countdown for a reply that has already been sent, which
// is the same lie as counting down against a switched-off pipeline. The
// sweeper's own query says `status = 'pending'`; so does this.
func buildHold(until *time.Time, draftStatus, disposition string, armed bool, now time.Time) *AdminHold {
	if until == nil || draftStatus != "pending" {
		return nil
	}
	h := &AdminHold{Until: until.UTC(), Verb: "Sending"}
	if disposition == dispositionAutoClose {
		h.Verb = "Sending and closing the ticket"
	}
	remaining := int(until.Sub(now).Round(time.Second) / time.Second)
	h.Expired = remaining <= 0
	switch {
	case !armed:
		h.Remaining = platform.Unmeasured("Autonomous sending is off or paused, so this deadline is not counting down to anything. It waits for a person.")
		h.Note = h.Remaining.Note
	case h.Expired:
		h.Remaining = platform.Measured{Value: 0, Available: true}
		h.Note = "The hold has run out. The sweeper runs once a minute and sends this on its next pass."
	default:
		h.Remaining = platform.Measured{Value: remaining, Available: true}
		h.Note = "Doing nothing sends it."
	}
	return h
}

// AdminFix is the proven-fix answer with the reasoning that produced it.
//
// The reasoning is the point. "No fix on record" is the ordinary answer and
// says nothing on its own; whether that is because nobody linked an issue,
// because the issue is not done, or because the fix has not shipped yet
// changes what the reader should do next.
type AdminFix struct {
	IssueKey   string     `json:"issue_key,omitempty"`
	Proven     bool       `json:"proven"`
	Version    string     `json:"version,omitempty"`
	ReleaseURL string     `json:"release_url,omitempty"`
	MergedAt   *time.Time `json:"merged_at,omitempty"`
	Reason     string     `json:"reason"`
}

const noIssueLinkedReason = "No Linear issue is linked to this case, so no fix may be claimed. Linking one is a person's decision — the model never does it, because a wrong link produces a confidently wrong claim that something shipped."

// queueFix is the cheap answer, for a row in a list: proven or not, with no
// explanation of a negative. Costs one Redis-cached lookup per issue key.
func queueFix(ctx context.Context, issueKey string) *AdminFix {
	if issueKey == "" {
		return nil
	}
	f := &AdminFix{IssueKey: issueKey}
	pf := provenFixForIssue(ctx, issueKey)
	if pf == nil {
		// Deliberately says only what a nil answer supports. A nil covers both
		// "the issue is not done and shipped" and "Linear could not be
		// reached", and the queue does not know which — the case view asks the
		// second question and names the answer.
		f.Reason = "No released fix is on record for " + issueKey + ". Open the case for why."
		return f
	}
	merged := pf.MergedAt
	f.Proven, f.Version, f.ReleaseURL, f.MergedAt = true, pf.Version, pf.ReleaseURL, &merged
	f.Reason = fmt.Sprintf("%s is done and shipped in Scrollr %s.", issueKey, pf.Version)
	return f
}

// explainFix is the case view's answer: it walks the same three checks
// lookupProvenFix does and says which one failed.
func explainFix(ctx context.Context, issueKey string) AdminFix {
	if issueKey == "" {
		return AdminFix{Reason: noIssueLinkedReason}
	}
	if f := queueFix(ctx, issueKey); f != nil && f.Proven {
		f.Reason = fmt.Sprintf(
			"%s is done, and the pull request that closed it merged on %s — before Scrollr %s went out. The reply is allowed to say the fix shipped in %s.",
			issueKey, f.MergedAt.UTC().Format("2 Jan 2006"), f.Version, f.Version)
		return *f
	}

	f := AdminFix{IssueKey: issueKey}
	mergedAt, err := linearClosingMerge(ctx, issueKey)
	switch {
	case err != nil:
		f.Reason = fmt.Sprintf("%s is linked, but Linear could not be reached to check it (%v). An unreachable Linear is a reason to say nothing, never a reason to guess.", issueKey, err)
	case mergedAt.IsZero():
		f.Reason = fmt.Sprintf("%s is linked but is not in a completed state with a merged pull request behind it. Nothing is proven, so the reply may not name a version as the remedy.", issueKey)
	default:
		f.Reason = fmt.Sprintf("%s was fixed — merged %s — but no published release has gone out since, so there is still nothing for this user to update to.", issueKey, mergedAt.UTC().Format("2 Jan 2006"))
	}
	return f
}

// ===== Grouping ===================================================

// queueState is everything the grouping reads. Split out so the rule is a pure
// function over it: the three groups are the shape of the whole page and they
// deserve a test that needs no database and no clock.
type queueState struct {
	CaseStatus    string
	HasDraft      bool
	DraftStatus   string
	Disposition   string
	AutoSendArmed bool
}

// group answers which of the three columns a case belongs in, and why in
// words. The reason is not decoration: "Needs you" with no explanation is the
// Discord queue again, where thirteen drafts sat pending since May because
// nothing ever said what was waiting on whom.
func (q queueState) group() (string, string) {
	if strings.EqualFold(strings.TrimSpace(q.CaseStatus), "closed") {
		return queueHandled, "The ticket is closed."
	}
	if !q.HasDraft {
		return queueNeedsYou, "No draft was ever written for this ticket, so nothing is going to answer it on its own."
	}

	switch q.DraftStatus {
	case "pending":
		return queueNeedsYou, q.pendingReason()
	case "failed":
		return queueNeedsYou, "The send failed. The draft is still here and the user has heard nothing."
	case "asked":
		return queueWaiting, "We asked the user for what we need to troubleshoot and are waiting on the answer."
	case "sent", "approved", "edited":
		return queueWaiting, "We replied. Nothing is due from us until they write back."
	case "skipped":
		return queueHandled, "Someone decided this needed no reply."
	default:
		return queueNeedsYou, fmt.Sprintf("Draft status %q is not one this console recognises, so it is being shown rather than filed away.", q.DraftStatus)
	}
}

func (q queueState) pendingReason() string {
	switch q.Disposition {
	case "":
		return "No disposition was recorded, so nothing will send this on its own."
	case dispositionEscalate:
		return "Escalated. No timer is running and nothing will send it."
	case dispositionAutoAsk:
		return "Queued to ask the user. An ask has no hold, so if it is still here the send did not go through."
	case dispositionAutoSend, dispositionAutoClose:
		if q.AutoSendArmed {
			return "On a hold. Doing nothing sends it."
		}
		return "Would send on a hold, but autonomous sending is off or paused, so it is waiting for a person."
	default:
		return fmt.Sprintf("Disposition %q, still pending.", q.Disposition)
	}
}

// ===== The queue ==================================================

type AdminQueueRow struct {
	TicketNumber string `json:"ticket_number"`
	Subject      string `json:"subject"`
	UserEmail    string `json:"user_email,omitempty"`
	Category     string `json:"category,omitempty"`
	Priority     string `json:"priority,omitempty"`
	Status       string `json:"status"`
	Summary      string `json:"summary,omitempty"`

	Group       string `json:"group"`
	GroupReason string `json:"group_reason"`

	DraftID           int64  `json:"draft_id,omitempty"`
	DraftStatus       string `json:"draft_status,omitempty"`
	Disposition       string `json:"disposition,omitempty"`
	DispositionReason string `json:"disposition_reason,omitempty"`

	LastUserMessageAt *time.Time        `json:"last_user_message_at,omitempty"`
	WaitingHours      platform.Measured `json:"waiting_hours"`

	Hold *AdminHold `json:"hold,omitempty"`
	Fix  *AdminFix  `json:"fix,omitempty"`

	OpenedAt  time.Time `json:"opened_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AdminQueueResponse struct {
	GeneratedAt time.Time       `json:"generated_at"`
	AutoSend    AutoSendState   `json:"autosend"`
	Counts      map[string]int  `json:"counts"`
	State       string          `json:"state"`
	Rows        []AdminQueueRow `json:"rows"`
}

const queueSQL = `
	WITH latest AS (
		SELECT DISTINCT ON (ticket_number)
		       ticket_number, id, status, disposition, disposition_reason, hold_until
		  FROM support_drafts
		 ORDER BY ticket_number, created_at DESC, id DESC
	)
	SELECT c.ticket_number, coalesce(c.user_email, ''), c.subject,
	       coalesce(c.category, ''), coalesce(c.priority, ''), c.status,
	       coalesce(c.summary, ''), coalesce(c.linear_issue_key, ''),
	       c.opened_at, c.updated_at,
	       (SELECT max(m.created_at) FROM support_messages m
	         WHERE m.ticket_number = c.ticket_number AND m.kind = 'user'),
	       d.id, d.status, d.disposition, d.disposition_reason, d.hold_until
	  FROM support_cases c
	  LEFT JOIN latest d ON d.ticket_number = c.ticket_number
	 ORDER BY c.updated_at DESC
	 LIMIT $1
`

// HandleAdminQueue - GET /admin/support/queue?state=needs_you|waiting|handled|all
//
// The counts are always over the whole queue and never over the filter, so
// switching to "Handled" cannot make "Needs you" look empty.
func HandleAdminQueue(c *fiber.Ctx) error {
	if platform.DBPool == nil {
		return adminSupportError(c, "The support database is not reachable from this API instance.")
	}
	state := strings.TrimSpace(c.Query("state", "all"))
	if state == "" {
		state = "all"
	}
	switch state {
	case queueNeedsYou, queueWaiting, queueHandled, "all":
	default:
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "state must be one of needs_you, waiting, handled, all",
		})
	}

	// context.Background(), not c.Context(): Fiber's request context is
	// already cancelled by the time a handler under app.Test reaches the
	// database, which turns every query in a test into "context canceled".
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	autosend := autoSendState(ctx)
	rows, err := platform.DBPool.Query(ctx, queueSQL, queueLimit)
	if err != nil {
		log.Printf("[AdminSupport] queue: %v", err)
		return adminSupportError(c, "Could not read the support queue.")
	}
	defer rows.Close()

	now := time.Now()
	all := make([]AdminQueueRow, 0, 64)
	counts := map[string]int{queueNeedsYou: 0, queueWaiting: 0, queueHandled: 0}

	for rows.Next() {
		var r AdminQueueRow
		var issueKey string
		var draftID *int64
		var draftStatus, disposition, dispositionReason *string
		var holdUntil, lastUser *time.Time

		if err := rows.Scan(&r.TicketNumber, &r.UserEmail, &r.Subject,
			&r.Category, &r.Priority, &r.Status, &r.Summary, &issueKey,
			&r.OpenedAt, &r.UpdatedAt, &lastUser,
			&draftID, &draftStatus, &disposition, &dispositionReason, &holdUntil); err != nil {
			log.Printf("[AdminSupport] scan queue row: %v", err)
			continue
		}

		if draftID != nil {
			r.DraftID = *draftID
		}
		r.DraftStatus = deref(draftStatus)
		r.Disposition = deref(disposition)
		r.DispositionReason = deref(dispositionReason)
		r.LastUserMessageAt = lastUser

		// A backfilled case can have no user message on record. That is not a
		// wait of zero hours, and rendering it as one would put a months-old
		// ticket at the bottom of anything sorted by how long someone waited.
		if lastUser == nil {
			r.WaitingHours = platform.Unmeasured("No message from the user is on record for this ticket, so there is nothing to measure the wait from.")
		} else {
			r.WaitingHours = platform.Measured{Value: int(now.Sub(*lastUser).Hours()), Available: true}
		}

		r.Hold = buildHold(holdUntil, r.DraftStatus, r.Disposition, autosend.Armed, now)
		r.Group, r.GroupReason = queueState{
			CaseStatus:    r.Status,
			HasDraft:      draftID != nil,
			DraftStatus:   r.DraftStatus,
			Disposition:   r.Disposition,
			AutoSendArmed: autosend.Armed,
		}.group()
		counts[r.Group]++

		if issueKey != "" {
			r.Fix = &AdminFix{IssueKey: issueKey}
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[AdminSupport] queue rows: %v", err)
	}

	out := make([]AdminQueueRow, 0, len(all))
	for _, r := range all {
		if state == "all" || r.Group == state {
			out = append(out, r)
		}
	}
	resolveQueueFixes(ctx, out)

	return c.JSON(AdminQueueResponse{
		GeneratedAt: now.UTC(),
		AutoSend:    autosend,
		Counts:      counts,
		State:       state,
		Rows:        out,
	})
}

// resolveQueueFixes fills in the proven-fix answer for the rows being
// returned, once per DISTINCT issue key rather than once per row: several
// tickets routinely point at the same bug, and each lookup is a Linear call
// plus a GitHub call on a cold cache.
func resolveQueueFixes(ctx context.Context, rows []AdminQueueRow) {
	byKey := map[string][]int{}
	for i, r := range rows {
		if r.Fix != nil {
			byKey[r.Fix.IssueKey] = append(byKey[r.Fix.IssueKey], i)
		}
	}
	if len(byKey) == 0 {
		return
	}

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		sem    = make(chan struct{}, 4)
		answer = map[string]*AdminFix{}
	)
	for key := range byKey {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			f := queueFix(ctx, key)
			mu.Lock()
			answer[key] = f
			mu.Unlock()
		}(key)
	}
	wg.Wait()

	for key, idxs := range byKey {
		f := answer[key]
		if f == nil {
			continue
		}
		for _, i := range idxs {
			copied := *f
			rows[i].Fix = &copied
		}
	}
}

// ===== One case ===================================================

type AdminMessage struct {
	Kind       string    `json:"kind"`
	Body       string    `json:"body"`
	Superseded bool      `json:"superseded"`
	DraftID    int64     `json:"draft_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// AdminDraft is every field the pipeline wrote about one draft. Nothing is
// dropped for tidiness: an empty field is itself the answer, and the gap
// between "the drafter cited nothing" and "we did not show you what it cited"
// is exactly the gap this page exists to close.
type AdminDraft struct {
	ID     int64  `json:"id"`
	Status string `json:"status"`
	Body   string `json:"body"`
	Edited string `json:"edited_body,omitempty"`

	Summary     string `json:"summary,omitempty"`
	Category    string `json:"category,omitempty"`
	Priority    string `json:"priority,omitempty"`
	Confidence  string `json:"confidence,omitempty"`
	DuplicateOf string `json:"duplicate_of,omitempty"`
	Sentiment   string `json:"sentiment,omitempty"`
	// DrafterCategory is what the second model call thought this was. A
	// disagreement with Category is itself an escalation rule.
	DrafterCategory string `json:"drafter_category,omitempty"`

	GroundedIn   string `json:"grounded_in,omitempty"`
	Unknowns     string `json:"unknowns,omitempty"`
	AskUserFor   string `json:"ask_user_for,omitempty"`
	InternalNote string `json:"internal_note,omitempty"`
	NeedsInfo    bool   `json:"needs_info"`
	ShouldClose  bool   `json:"should_close"`

	Disposition       string     `json:"disposition,omitempty"`
	DispositionReason string     `json:"disposition_reason,omitempty"`
	// HoldUntil is the raw deadline on the row. It survives the send, so read
	// Hold on the case (which checks the status) rather than this.
	HoldUntil  *time.Time `json:"hold_until,omitempty"`
	Intervened bool       `json:"intervened"`
	CreatedAt         time.Time  `json:"created_at"`
	DecidedAt         *time.Time `json:"decided_at,omitempty"`
	SentAt            *time.Time `json:"sent_at,omitempty"`
}

type AdminWidget struct {
	Type     string `json:"type"`
	OnTicker bool   `json:"on_ticker"`
}

// AdminUserContext is the WHO IS WRITING block the model was given, as
// structure rather than prose. VersionState is the server's comparison and the
// browser must not redo it — "out of date" is a diagnostic here and never
// permission to tell the user to update, which needs Fix.
type AdminUserContext struct {
	Tier             string        `json:"tier"`
	AppVersion       string        `json:"app_version,omitempty"`
	CurrentVersion   string        `json:"current_version,omitempty"`
	VersionState     string        `json:"version_state"` // unknown | behind | current
	OS               string        `json:"os,omitempty"`
	MonitorsAttached int           `json:"monitors_attached"`
	MonitorsChosen   int           `json:"monitors_chosen"`
	Widgets          []AdminWidget `json:"widgets"`
	HasDiagnostics   bool          `json:"has_diagnostics"`
	Note             string        `json:"note"`
}

type AdminSimilarCase struct {
	TicketNumber string `json:"ticket_number"`
	Subject      string `json:"subject"`
	UserWrote    string `json:"user_wrote"`
	WeSent       string `json:"we_sent"`
}

type AdminCaseDetail struct {
	TicketNumber    string     `json:"ticket_number"`
	Subject         string     `json:"subject"`
	UserEmail       string     `json:"user_email,omitempty"`
	LogtoSub        string     `json:"logto_sub,omitempty"`
	Status          string     `json:"status"`
	Category        string     `json:"category,omitempty"`
	Priority        string     `json:"priority,omitempty"`
	Summary         string     `json:"summary,omitempty"`
	LinearIssueKey  string     `json:"linear_issue_key,omitempty"`
	DiscordThreadID string     `json:"discord_thread_id,omitempty"`
	DiscordURL      string     `json:"discord_url,omitempty"`
	OpenedAt        time.Time  `json:"opened_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`

	Group       string `json:"group"`
	GroupReason string `json:"group_reason"`

	Messages []AdminMessage `json:"messages"`
	Draft    *AdminDraft    `json:"draft"`
	// DraftNote says why Draft is nil when it is. A missing draft is a fact
	// about the pipeline, not an empty panel.
	DraftNote string `json:"draft_note,omitempty"`

	Context  AdminUserContext `json:"context"`
	Fix      AdminFix         `json:"fix"`
	AutoSend AutoSendState    `json:"autosend"`
	Hold     *AdminHold       `json:"hold,omitempty"`

	// StaleDays is how long the user has been waiting since they last wrote;
	// StaleAfter is the threshold past which the policy makes a reply ask
	// rather than tell.
	StaleDays  int `json:"stale_days"`
	StaleAfter int `json:"stale_after"`

	Similar     []AdminSimilarCase `json:"similar"`
	KnownIssues string             `json:"known_issues,omitempty"`
	// EvidenceNote is the honesty line on the two blocks above: neither is
	// stored per draft, so both are rebuilt now and can differ from what the
	// model was actually shown.
	EvidenceNote string `json:"evidence_note"`
}

const caseSQL = `
	SELECT ticket_number, subject, coalesce(user_email, ''), coalesce(logto_sub, ''),
	       status, coalesce(category, ''), coalesce(priority, ''), coalesce(summary, ''),
	       coalesce(linear_issue_key, ''), coalesce(discord_thread_id, ''),
	       opened_at, updated_at, closed_at
	  FROM support_cases WHERE ticket_number = $1
`

// HandleAdminCase - GET /admin/support/case/:ticket
func HandleAdminCase(c *fiber.Ctx) error {
	if platform.DBPool == nil {
		return adminSupportError(c, "The support database is not reachable from this API instance.")
	}
	ticket := strings.TrimSpace(c.Params("ticket"))
	if ticket == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "A ticket number is required",
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var d AdminCaseDetail
	err := platform.DBPool.QueryRow(ctx, caseSQL, ticket).Scan(
		&d.TicketNumber, &d.Subject, &d.UserEmail, &d.LogtoSub, &d.Status,
		&d.Category, &d.Priority, &d.Summary, &d.LinearIssueKey,
		&d.DiscordThreadID, &d.OpenedAt, &d.UpdatedAt, &d.ClosedAt)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "No case with that ticket number. The case database only carries tickets the API has seen or backfilled.",
		})
	}
	if err != nil {
		log.Printf("[AdminSupport] case %s: %v", ticket, err)
		return adminSupportError(c, "Could not read that case.")
	}
	if d.DiscordThreadID != "" {
		if guild := strings.TrimSpace(os.Getenv("DISCORD_GUILD_ID")); guild != "" {
			d.DiscordURL = "https://discord.com/channels/" + guild + "/" + d.DiscordThreadID
		}
	}

	d.Messages = adminCaseMessages(ctx, ticket)
	d.Draft, d.DraftNote = adminCurrentDraft(ctx, ticket)
	d.AutoSend = autoSendState(ctx)
	if d.Draft != nil {
		d.Hold = buildHold(d.Draft.HoldUntil, d.Draft.Status, d.Draft.Disposition, d.AutoSend.Armed, time.Now())
	}
	d.Group, d.GroupReason = queueState{
		CaseStatus:    d.Status,
		HasDraft:      d.Draft != nil,
		DraftStatus:   draftStatusOf(d.Draft),
		Disposition:   draftDispositionOf(d.Draft),
		AutoSendArmed: d.AutoSend.Armed,
	}.group()

	d.Context = adminUserContext(ctx, ticket)
	d.Fix = explainFix(ctx, d.LinearIssueKey)
	d.StaleDays = caseStaleDays(ctx, ticket)
	d.StaleAfter = staleTicketDays()

	d.Similar = make([]AdminSimilarCase, 0, 3)
	for _, s := range FetchSimilarCases(ctx, d.Subject+" "+d.Summary, ticket, 3) {
		d.Similar = append(d.Similar, AdminSimilarCase{
			TicketNumber: s.TicketNumber, Subject: s.Subject,
			UserWrote: s.UserWrote, WeSent: s.WeSent,
		})
	}
	d.KnownIssues = knownIssuesBlock(ctx)
	d.EvidenceNote = "The similar cases and the known-issues block are rebuilt now, by the same queries the prompt uses. Neither is stored per draft, so on an older case they can differ from what the model was actually shown."

	return c.JSON(d)
}

func adminCaseMessages(ctx context.Context, ticket string) []AdminMessage {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT kind, coalesce(body_text, ''), coalesce(body_html, ''), superseded,
		       coalesce(ai_draft_id, 0), created_at
		  FROM support_messages WHERE ticket_number = $1
		 ORDER BY created_at, id`, ticket)
	if err != nil {
		log.Printf("[AdminSupport] messages for %s: %v", ticket, err)
		return nil
	}
	defer rows.Close()

	out := make([]AdminMessage, 0, 8)
	for rows.Next() {
		var m AdminMessage
		var text, bodyHTML string
		if err := rows.Scan(&m.Kind, &text, &bodyHTML, &m.Superseded, &m.DraftID, &m.CreatedAt); err != nil {
			continue
		}
		// Plain text, always. It is what Discord shows, what the model was
		// given, and what a reply looks like once an email client is done with
		// it — and it means this page never renders a stranger's HTML.
		//
		// htmlToPlain runs over body_text as well as over the fallback, not
		// only over the fallback: osTicket's own thread bodies arrived in
		// body_text WITH their markup — ticket 819835's opening message
		// starts "<h3>Bug Report</h3>" — so trusting the column name prints
		// tags at a reader instead of a conversation. The cost is that a
		// message genuinely containing "a < b > c" loses that fragment; the
		// benefit is that every backfilled ticket reads as prose.
		if strings.TrimSpace(text) == "" {
			text = bodyHTML
		}
		m.Body = strings.TrimSpace(htmlToPlain(text))
		out = append(out, m)
	}
	return out
}

// adminCurrentDraft returns the newest draft on a case, or the sentence that
// explains why there is not one.
func adminCurrentDraft(ctx context.Context, ticket string) (*AdminDraft, string) {
	var id int64
	err := platform.DBPool.QueryRow(ctx, `
		SELECT id FROM support_drafts WHERE ticket_number = $1
		 ORDER BY created_at DESC, id DESC LIMIT 1`, ticket).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, "No draft was ever written for this ticket. Either triage produced no reply body, or the case was backfilled from osTicket without one — either way nothing is going to answer it on its own."
	}
	if err != nil {
		log.Printf("[AdminSupport] draft id for %s: %v", ticket, err)
		return nil, "The draft for this ticket could not be read."
	}
	draft, err := loadSupportDraft(ctx, id)
	if err != nil || draft == nil {
		log.Printf("[AdminSupport] load draft %d: %v", id, err)
		return nil, "The draft for this ticket could not be read."
	}
	return &AdminDraft{
		ID:                draft.ID,
		Status:            draft.Status,
		Body:              strings.TrimSpace(htmlToPlain(draft.DraftBodyHTML)),
		Edited:            strings.TrimSpace(htmlToPlain(draft.EditedBodyHTML)),
		Summary:           draft.AISummary,
		Category:          draft.AICategory,
		Priority:          draft.AIPriority,
		Confidence:        draft.AIConfidence,
		DuplicateOf:       draft.AIDuplicateOf,
		Sentiment:         draft.Sentiment,
		DrafterCategory:   draft.DrafterCategory,
		GroundedIn:        draft.GroundedIn,
		Unknowns:          draft.Unknowns,
		AskUserFor:        draft.AskUserFor,
		InternalNote:      draft.InternalNote,
		NeedsInfo:         draft.NeedsInfo,
		ShouldClose:       draft.ShouldClose,
		Disposition:       draft.Disposition,
		DispositionReason: draft.DispositionReason,
		HoldUntil:         draft.HoldUntil,
		Intervened:        draft.Intervened,
		CreatedAt:         draft.CreatedAt,
		DecidedAt:         draft.DecidedAt,
		SentAt:            draft.SentAt,
	}, ""
}

func adminUserContext(ctx context.Context, ticket string) AdminUserContext {
	tc := ticketContextFromCase(ctx, ticket)
	out := AdminUserContext{
		Tier:             tc.Tier,
		AppVersion:       tc.AppVersion,
		CurrentVersion:   currentDesktopVersion(),
		OS:               tc.OS,
		MonitorsAttached: tc.MonitorCount,
		MonitorsChosen:   tc.ChosenMonitors,
		HasDiagnostics:   tc.HasDiagnostics,
		Widgets:          make([]AdminWidget, 0, len(tc.Widgets)),
		Note:             "Rebuilt from the case row and this account's widgets, by the same function that builds the prompt's WHO IS WRITING block. Being behind is a diagnostic and never permission to tell someone to update — that needs a fix on record.",
	}
	switch {
	case tc.AppVersion == "" || out.CurrentVersion == "":
		out.VersionState = "unknown"
	case compareVersions(tc.AppVersion, out.CurrentVersion) < 0:
		out.VersionState = "behind"
	default:
		out.VersionState = "current"
	}
	for _, w := range tc.Widgets {
		out.Widgets = append(out.Widgets, AdminWidget{Type: w.Type, OnTicker: w.OnTicker})
	}
	return out
}

// ===== small helpers ==============================================

func adminSupportError(c *fiber.Ctx, message string) error {
	return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
		Status: "error", Error: message,
	})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func draftStatusOf(d *AdminDraft) string {
	if d == nil {
		return ""
	}
	return d.Status
}

func draftDispositionOf(d *AdminDraft) string {
	if d == nil {
		return ""
	}
	return d.Disposition
}
