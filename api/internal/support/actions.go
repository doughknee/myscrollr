package support

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// The support verbs — one function each, called by every surface (REL-261)
// =============================================================================
//
// Send, Edit, Ask, Skip, Hold, File as bug and Link used to live inside the
// Discord interaction handlers, which made Discord the only place they could
// happen. This file is those flows with the Discord taken out: each one takes
// a draft id (or a ticket number) and its inputs, does the whole thing, and
// returns the new state.
//
// Both surfaces call these and neither reimplements one. That is the point:
// while Discord and the console coexist, a rule changed in one has to change
// in the other, and the only way to guarantee that is for there to be one of
// it. TestEverySurfaceCallsTheSameVerb pins it.
//
// Nothing here is a policy decision. The escalation gates (REL-249) and the
// proven-fix gate (REL-259) run in decideDisposition before a draft ever
// reaches a button, and a person choosing to send is the escape hatch those
// gates were built to require — not one they get to skip. A console click and
// a Discord click are the same click.

var (
	// ErrDraftNotFound is a draft id that is not in the table.
	ErrDraftNotFound = errors.New("draft not found")
	// ErrEmptyBody is an edit or a question with nothing in it.
	ErrEmptyBody = errors.New("body is empty")
	// ErrNotLinked is an unlink on a case with no issue on it.
	ErrNotLinked = errors.New("no issue is linked to this case")
	// ErrBadIssueKey is a Linear identifier that is not shaped like one.
	ErrBadIssueKey = errors.New("not a Linear issue key")
)

// ErrAlreadyLinked reports the key that is already on the case, so a caller
// can say which one rather than only refusing.
type ErrAlreadyLinked struct{ IssueKey string }

func (e ErrAlreadyLinked) Error() string { return "already linked to " + e.IssueKey }

// requirePendingDraft is the precondition every verb shares: the draft exists
// and nobody has actioned it yet. Telling "gone" from "already decided" is
// what lets a surface say which happened instead of "that failed".
func requirePendingDraft(ctx context.Context, draftID int64) (*SupportDraft, error) {
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil {
		return nil, fmt.Errorf("load draft %d: %w", draftID, err)
	}
	if draft == nil {
		return nil, ErrDraftNotFound
	}
	if draft.Status != "pending" {
		return nil, ErrAlreadyDecided
	}
	return draft, nil
}

// claimDraft moves a pending draft to its decided status and returns the row
// as it now stands. The UPDATE is conditional on `status = 'pending'`, so two
// people clicking Send at the same moment produce one send and one
// ErrAlreadyDecided — and that is also what makes Hold, Edit, Ask and Skip
// cancel a running countdown.
func claimDraft(ctx context.Context, draftID int64, status, editedBodyHTML string) (*SupportDraft, error) {
	if _, err := requirePendingDraft(ctx, draftID); err != nil {
		return nil, err
	}
	if err := markDraftDecided(ctx, draftID, status, editedBodyHTML); err != nil {
		return nil, err
	}
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return nil, ErrDraftNotFound
	}
	return draft, nil
}

// ActionSend sends the draft as the model wrote it.
//
// "Send now" and "send" are the same verb: a hold is only a deadline the
// sweeper reads, and claiming the row is what takes it off the sweeper's
// query. There is no separate timer to cancel.
func ActionSend(ctx context.Context, draftID int64) (*SupportDraft, error) {
	draft, err := claimDraft(ctx, draftID, "approved", "")
	if err != nil {
		return nil, err
	}
	if err := sendDraftReply(ctx, draft, draft.DraftBodyHTML); err != nil {
		return draft, fmt.Errorf("send reply for ticket %s: %w", draft.TicketNumber, err)
	}
	applySendStateToThread(ctx, draft, draft.ShouldClose)
	return reloadDraft(ctx, draftID, draft), nil
}

// ActionEditAndSend replaces the body and sends that instead.
//
// editedPlain is plain text — what the console's editor holds and what the
// Discord modal returns — wrapped into paragraphs on the way to the email
// path, which is the one place HTML is required. There is no length cap here:
// Discord's 4000 characters is Discord's limit, never the reply's.
func ActionEditAndSend(ctx context.Context, draftID int64, editedPlain string) (*SupportDraft, error) {
	editedPlain = strings.TrimSpace(editedPlain)
	if editedPlain == "" {
		return nil, ErrEmptyBody
	}
	editedHTML := plainToHTMLParagraphs(editedPlain)

	draft, err := claimDraft(ctx, draftID, "edited", editedHTML)
	if err != nil {
		return nil, err
	}
	markIntervened(ctx, draftID)

	// draft.DraftBodyHTML is still the model's own body — the edit went into
	// edited_body_html — so the diff below compares the two honestly.
	original := draft.DraftBodyHTML
	if err := sendDraftReply(ctx, draft, editedHTML); err != nil {
		return draft, fmt.Errorf("send edited reply for ticket %s: %w", draft.TicketNumber, err)
	}
	applyEditStateToThread(ctx, draft, draft.ShouldClose)
	postEditDiff(ctx, draft, htmlToPlain(original), editedPlain)
	return reloadDraft(ctx, draftID, draft), nil
}

// ActionAsk sends one clarifying question in place of the drafted answer.
//
// The question goes out on the same reply path an approved draft takes, so the
// user reads it as an ordinary support email and their answer comes back
// through the thread-message webhook, which drafts afresh with it.
func ActionAsk(ctx context.Context, draftID int64, question string) (*SupportDraft, error) {
	question = strings.TrimSpace(question)
	if question == "" {
		return nil, ErrEmptyBody
	}
	questionHTML := plainToHTMLParagraphs(question)

	draft, err := claimDraft(ctx, draftID, "asked", questionHTML)
	if err != nil {
		return nil, err
	}
	// A question never closes a ticket, whatever triage thought of the reply
	// it stands in for.
	draft.ShouldClose = false

	if err := sendDraftReply(ctx, draft, questionHTML); err != nil {
		return draft, fmt.Errorf("send question for ticket %s: %w", draft.TicketNumber, err)
	}
	applyAskStateToThread(ctx, draft)
	return reloadDraft(ctx, draftID, draft), nil
}

// ActionSkip decides that this ticket needs no reply from us.
func ActionSkip(ctx context.Context, draftID int64) (*SupportDraft, error) {
	draft, err := claimDraft(ctx, draftID, "skipped", "")
	if err != nil {
		return nil, err
	}
	markIntervened(ctx, draftID)
	applySkipStateToThread(ctx, draft)
	publishSupportEvent(draft.TicketNumber, supportEventSkipped)
	return draft, nil
}

// ActionHold stops a running countdown without deciding anything. The row
// stays pending with every verb still open to it; it simply stops being
// something that happens on its own.
//
// It is the cheapest thing a person can say — "not this one, not yet" — and it
// counts as an intervention, which is what demotes a category out of autonomy.
func ActionHold(ctx context.Context, draftID int64) (*SupportDraft, error) {
	if _, err := requirePendingDraft(ctx, draftID); err != nil {
		return nil, err
	}
	if err := holdDraft(ctx, draftID); err != nil {
		return nil, err
	}
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		return nil, ErrDraftNotFound
	}
	publishSupportEvent(draft.TicketNumber, supportEventHeld)
	return draft, nil
}

// reloadDraft re-reads a row after a send so the caller renders sent_at and
// the promoted status rather than the pre-send copy. Falls back to what it was
// given: a reply that has already gone out is not worth failing a response
// over.
func reloadDraft(ctx context.Context, draftID int64, fallback *SupportDraft) *SupportDraft {
	if fresh, err := loadSupportDraft(ctx, draftID); err == nil && fresh != nil {
		return fresh
	}
	return fallback
}

// ===== Filing and linking =========================================

// FileBugResult is what happened, in fields, so each surface phrases it once.
//
// LinkSaved false with an IssueKey set is the corner that matters: the issue
// exists but the case does not know about it, so the next click would file a
// duplicate. Both surfaces have to say so.
type FileBugResult struct {
	IssueKey  string `json:"issue_key"`
	URL       string `json:"url"`
	Already   bool   `json:"already_filed"`
	LinkSaved bool   `json:"link_saved"`
}

// ActionFileAsBug turns the ticket into a Linear issue and links it.
//
// A second call files nothing and returns the issue that already exists — the
// same button on the same case is how someone checks whether it was filed.
func ActionFileAsBug(ctx context.Context, draftID int64) (FileBugResult, error) {
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil {
		return FileBugResult{}, fmt.Errorf("load draft %d: %w", draftID, err)
	}
	if draft == nil {
		return FileBugResult{}, ErrDraftNotFound
	}

	if existing := caseLinearIssueKey(ctx, draft.TicketNumber); existing != "" {
		return FileBugResult{
			IssueKey: existing, URL: linearIssueURL(existing), Already: true, LinkSaved: true,
		}, nil
	}

	title := strings.TrimSpace(draft.AISummary)
	if title == "" {
		title = strings.TrimSpace(draft.OriginalSubject)
	}
	if title == "" {
		title = "Support ticket #" + draft.TicketNumber
	}
	issue, err := linearCreateIssue(ctx, truncateRunes(title, 120), buildLinearIssueBody(ctx, draft))
	if err != nil {
		return FileBugResult{}, fmt.Errorf("file in Linear: %w", err)
	}

	res := FileBugResult{IssueKey: issue.Identifier, URL: issue.URL}
	if err := setCaseLinearIssueKey(ctx, draft.TicketNumber, issue.Identifier); err != nil {
		// The issue exists; we just cannot remember it. Say so, or the next
		// click files a second one silently.
		log.Printf("[Support] link %s to ticket %s: %v", issue.Identifier, draft.TicketNumber, err)
		return res, nil
	}
	res.LinkSaved = true
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: draft.TicketNumber, Kind: "note",
		BodyText: "filed as " + issue.Identifier, AIDraftID: draft.ID,
	}); err != nil {
		log.Printf("[Cases] %v", err)
	}
	publishSupportEvent(draft.TicketNumber, supportEventLinked)
	return res, nil
}

// issueKeyPattern is Linear's identifier shape. Checking it is not tidiness: a
// typo'd key reads to the proven-fix walk as an issue that cannot be reached,
// and "we could not check" looks a great deal like "not fixed yet".
var issueKeyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]*-[0-9]+$`)

// ActionLinkIssue points a case at an issue that already exists.
//
// It refuses to overwrite an existing link rather than replacing it: two
// people acting at once keep the first answer, and changing a link is unlink
// then link — two deliberate acts instead of one silent one.
func ActionLinkIssue(ctx context.Context, ticket, issueKey string) (string, error) {
	ticket = strings.TrimSpace(ticket)
	issueKey = strings.ToUpper(strings.TrimSpace(issueKey))
	if ticket == "" || issueKey == "" {
		return "", ErrBadIssueKey
	}
	if !issueKeyPattern.MatchString(issueKey) {
		return "", fmt.Errorf("%q: %w", issueKey, ErrBadIssueKey)
	}
	if existing := caseLinearIssueKey(ctx, ticket); existing != "" {
		return existing, ErrAlreadyLinked{IssueKey: existing}
	}
	// Ask Linear whether the issue is real before writing it down. The answer
	// — done or not — is irrelevant here; reaching it at all is the check, and
	// a wrong key is precisely what produces a confidently wrong claim that
	// something shipped (REL-259).
	if _, err := linearIssueIsDone(ctx, issueKey); err != nil {
		return "", fmt.Errorf("%s could not be found in Linear: %w", issueKey, err)
	}
	if err := setCaseLinearIssueKey(ctx, ticket, issueKey); err != nil {
		return "", fmt.Errorf("save link: %w", err)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: ticket, Kind: "note", BodyText: "linked to " + issueKey + " by hand",
	}); err != nil {
		log.Printf("[Cases] %v", err)
	}
	postToTicketThread(ctx, ticket, fmt.Sprintf(
		"🔗 Linked to **%s** — %s. Drafts on this ticket may name the release that carries it once it ships.",
		issueKey, linearIssueURL(issueKey)))
	publishSupportEvent(ticket, supportEventLinked)
	return issueKey, nil
}

// ActionUnlinkIssue takes the issue back off a case, so a fix stops being
// claimable on it. The audit note stays — the link happened, and undoing it is
// its own entry rather than an erasure.
func ActionUnlinkIssue(ctx context.Context, ticket string) error {
	ticket = strings.TrimSpace(ticket)
	if ticket == "" {
		return ErrNotLinked
	}
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	existing := caseLinearIssueKey(ctx, ticket)
	if existing == "" {
		return ErrNotLinked
	}
	if _, err := platform.DBPool.Exec(ctx,
		`UPDATE support_cases SET linear_issue_key = NULL, updated_at = now() WHERE ticket_number = $1`,
		ticket); err != nil {
		return fmt.Errorf("unlink: %w", err)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: ticket, Kind: "note", BodyText: "unlinked from " + existing,
	}); err != nil {
		log.Printf("[Cases] %v", err)
	}
	postToTicketThread(ctx, ticket, fmt.Sprintf(
		"🔗 Unlinked from **%s**. Drafts on this ticket may no longer name a release as the remedy.", existing))
	publishSupportEvent(ticket, supportEventUnlinked)
	return nil
}

// ===== The kill switch ============================================

// ActionSetPaused stops, or restarts, every unattended send at once.
//
// Pending holds keep their deadlines rather than being cleared, so resuming
// puts the queue back where it was instead of firing everything that expired
// meanwhile — which is why the sweeper checks the pause and not each draft.
func ActionSetPaused(ctx context.Context, paused bool) error {
	if paused {
		if err := policySet(ctx, policyPausedKey, time.Now().UTC().Format(time.RFC3339)); err != nil {
			return err
		}
	} else if err := policyDelete(ctx, policyPausedKey); err != nil {
		return err
	}
	publishSupportEvent("", supportEventAutoSend)
	return nil
}
