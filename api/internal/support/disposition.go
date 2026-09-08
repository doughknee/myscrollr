package support

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/jackc/pgx/v5"
)

// =============================================================================
// Dispositions — the server decides what happens to a draft (REL-249)
// =============================================================================
//
// Approval used to be the rule and auto-send the exception, allow-listed by
// category. That axis was wrong: a bug reply saying "known issue, here is the
// workaround" is safe, and a confident feature promise is not. So the gate is
// re-cut by CONSEQUENCE, and doing nothing is now what sends a reply.
//
// The model reports grounding, unknowns and sentiment. It does not choose its
// own disposition — everything below is the server's decision, written to
// support_drafts.disposition with the reason that produced it.
//
// One line holds regardless of confidence, configuration, or how well the bot
// has been behaving: nothing touching money or account access auto-sends.

const (
	dispositionAutoSend  = "auto_send"
	dispositionAutoAsk   = "auto_ask"
	dispositionEscalate  = "escalate"
	dispositionAutoClose = "auto_close"
)

// dispositionSignals is everything the decision reads, gathered before it is
// made so the decision itself is pure and the table test needs no database,
// no clock and no Discord.
type dispositionSignals struct {
	HasDraft        bool // triage produced a reply body at all
	Category        string
	DrafterCategory string
	Priority        string
	Confidence      string
	Sentiment       string
	GroundedIn      string
	Unknowns        string
	AskUserFor      string
	NeedsInfo       bool
	ShouldClose     bool
	DraftBody       string // what we would say to the user
	UserText        string // what the user said to us — data, never instructions
	OutboundLast24h int
	MaxAutoReplies  int
	CategoryDemoted bool

	// REL-259. HasProvenFix is the server's answer to "did a shipped release
	// close THIS report" — a linked Linear issue, done, with a merged PR that
	// went out. StaleDays is how long the reporter has been waiting and
	// StaleAfter is the threshold, passed in so the decision stays pure.
	HasProvenFix bool
	StaleDays    int
	StaleAfter   int
}

// decideDisposition is the whole policy, in order. The escalation checks run
// first because every one of them is a reason no timer should start.
//
// The grounding checks (grounded_in / unknowns / confidence) come AFTER the
// auto_ask and auto_close branches on purpose. Both of those make no claims to
// the user: one asks a question, the other agrees the user's problem is over.
// Requiring a citation for "which operating system are you on" would escalate
// every clarifying question, which is the waiting this ticket exists to remove.
func decideDisposition(s dispositionSignals) (disposition, reason string) {
	if !s.HasDraft {
		return dispositionEscalate, "triage produced no reply"
	}
	if hit := firstMatch(s.UserText, injectionPatterns); hit != "" {
		return dispositionEscalate, fmt.Sprintf("ticket text contains instruction-shaped content (%q)", hit)
	}
	if hit := consequenceMoney(s.Category, s.UserText); hit != "" {
		return dispositionEscalate, "money (" + hit + ")"
	}
	if hit := consequenceAccount(s.Category, s.UserText); hit != "" {
		return dispositionEscalate, "account access or identity (" + hit + ")"
	}
	if hit := firstMatch(s.UserText, humanRequestPatterns); hit != "" {
		return dispositionEscalate, fmt.Sprintf("the user asked for a human (%q)", hit)
	}
	if sentimentIsHot(s.Sentiment) {
		return dispositionEscalate, "the user is " + strings.ToLower(strings.TrimSpace(s.Sentiment))
	}
	if strings.EqualFold(strings.TrimSpace(s.Priority), "emergency") {
		return dispositionEscalate, "emergency priority"
	}
	if categoriesDisagree(s.Category, s.DrafterCategory) {
		return dispositionEscalate, fmt.Sprintf("classification and drafting disagreed (%s vs %s)",
			s.Category, s.DrafterCategory)
	}
	if s.MaxAutoReplies > 0 && s.OutboundLast24h >= s.MaxAutoReplies {
		return dispositionEscalate, fmt.Sprintf(
			"%d replies already sent on this ticket in 24 h with no resolution", s.OutboundLast24h)
	}
	if s.CategoryDemoted {
		return dispositionEscalate, fmt.Sprintf("category %q is demoted on its intervention rate", s.Category)
	}
	if hit := firstMatch(s.DraftBody, promisePatterns); hit != "" {
		return dispositionEscalate, fmt.Sprintf("the draft would promise something (%q)", hit)
	}

	// REL-259: the bot may only claim a fix it can prove. The system prompt
	// forbids the unprovable claim and the FIX ON RECORD block tells the
	// drafter what is on record — but the prompt is guidance and this is the
	// guarantee. A reply that says something was fixed, or offers a version as
	// the remedy, with nothing on record behind it does not leave the building.
	if !s.HasProvenFix {
		if hit := firstMatch(s.DraftBody, unprovenFixPatterns); hit != "" {
			return dispositionEscalate, fmt.Sprintf(
				"the draft offers a fix or an update as the answer (%q) and no shipped fix is on record", hit)
		}
		// An old ticket asks rather than tells. Nothing here has closed this
		// report, and several releases have gone out since it was written, so
		// asserting anything about it is a guess. The drafter is told to ask
		// (renderFixRecord), and a reply that does ask falls through to the
		// auto_ask branch below; one that does not gets a human.
		if s.StaleAfter > 0 && s.StaleDays >= s.StaleAfter && strings.TrimSpace(s.AskUserFor) == "" {
			return dispositionEscalate, fmt.Sprintf(
				"the ticket is %d days old with no fix on record and the draft tells rather than asks",
				s.StaleDays)
		}
	}

	// A reply that asks the user for something is not a final answer, so the
	// grounding gate below does not apply to it.
	//
	// The ticket wrote this rule as "needs_info AND ask_user_for", and the
	// first production ticket showed why the server cannot lean on
	// needs_info: the classifier returned false for "It stopped working.
	// Nothing shows up in the bar any more", while the drafter wrote a pure
	// question and listed four things in ask_user_for. Under the literal
	// rule that escalated on `unknowns`, and the unknowns WERE the questions.
	// The classifier's flag is a hint; what the reply actually does is the
	// fact, and the drafter is the one that knows it.
	//
	// Everything with a consequence has already escalated above this line, so
	// what is left is the case the ticket cares most about: someone waiting an
	// hour to be asked which operating system they are on.
	if ask := strings.TrimSpace(s.AskUserFor); ask != "" {
		reason := "asking the user for what we need to troubleshoot: " + truncate(ask, 200)
		if !s.NeedsInfo {
			reason += " (the drafter asked; the classifier did not flag needs_info)"
		}
		return dispositionAutoAsk, reason
	}
	if s.ShouldClose {
		return dispositionAutoClose, "the user confirmed the issue is resolved"
	}

	if strings.TrimSpace(s.GroundedIn) == "" {
		return dispositionEscalate, "the draft cites nothing"
	}
	if strings.TrimSpace(s.Unknowns) != "" {
		return dispositionEscalate, "the draft leaves something open: " + truncate(s.Unknowns, 200)
	}
	if !confidenceIsSendable(s.Confidence) {
		return dispositionEscalate, "confidence is " + orDash(s.Confidence)
	}
	return dispositionAutoSend, "grounded, complete, and nothing to escalate on"
}

// ===== The consequence tests =====================================
//
// Both are two-sided: the classifier's label AND the user's own words. A
// refund request filed under "feature" is still a refund request, and the
// label is the thing most likely to be wrong.
//
// The pattern lists are deliberately loose. Escalating a ticket that did not
// need it costs one click; auto-sending a wrong answer about someone's money
// or their account costs trust.

var moneyPatterns = []string{
	"refund", "charge", "chargeback", "invoice", "billing", "billed",
	"payment", "credit card", "debit card", "paypal", "subscription",
	"dispute", "money back", "cancel my", "cancel the subscription",
	"cancellation", "unsubscribe me", "double charged", "charged twice",
	"upgrade my plan", "downgrade", "free trial",
}

var accountPatterns = []string{
	"log in", "login", "logged in", "sign in", "signin", "signed out",
	"password", "delete my account", "close my account", "data export",
	"export my data", "gdpr", "ccpa", "hacked", "breach", "unauthorized",
	"two-factor", "2fa", "verify my identity", "lawyer", "legal", "lawsuit",
	"subpoena", "personal information", "change my email", "locked out",
}

func consequenceMoney(category, userText string) string {
	if strings.EqualFold(strings.TrimSpace(category), "billing") {
		return "category billing"
	}
	if hit := firstMatch(userText, moneyPatterns); hit != "" {
		return strconv.Quote(hit)
	}
	return ""
}

func consequenceAccount(category, userText string) string {
	if strings.EqualFold(strings.TrimSpace(category), "account") {
		return "category account"
	}
	if hit := firstMatch(userText, accountPatterns); hit != "" {
		return strconv.Quote(hit)
	}
	return ""
}

// humanRequestPatterns: someone who has asked for a person should get one, and
// should not get a robot explaining that it is happy to help instead.
var humanRequestPatterns = []string{
	"speak to a human", "talk to a human", "speak with a human",
	"real person", "actual person", "human being", "human agent",
	"speak to someone", "talk to someone", "a manager", "supervisor",
	"escalate this", "not a bot", "talking to a bot", "stop the bot",
}

// promisePatterns are checked against OUR draft, not the user's ticket. The
// system prompt already forbids every one of these, so a hit means the model
// broke a hard rule and the reply needs eyes before it leaves the building.
var promisePatterns = []string{
	"we will add", "we'll add", "will be added", "will be available",
	"will be fixed", "will be released", "will be shipping",
	"in the next release", "in the next update", "coming soon",
	"we plan to", "we will refund", "we'll refund", "we will credit",
	"make an exception", "as an exception", "by the end of",
	"next week", "next month", "estimated time", "guarantee",
}

// unprovenFixPatterns are checked against OUR draft, and only when nothing is
// on record as having fixed the report (REL-259). Two shapes, one list because
// they are the same mistake: asserting a fix shipped, and handing somebody an
// update as the remedy. Both are claims about a change closing THIS report,
// and release notes cannot support either.
//
// Deliberately loose, like promisePatterns. Escalating a reply that only meant
// to be helpful costs one click; telling a four-month-old reporter their bug is
// gone when nobody knows that costs the trust the reply was for. Asking which
// version somebody runs is diagnostic and appears nowhere in this list.
var unprovenFixPatterns = []string{
	"was fixed", "were fixed", "has been fixed", "have been fixed", "is now fixed",
	"we fixed", "already fixed", "should be fixed", "fixed in ", "fixed this in",
	"resolved in ", "was resolved", "has been resolved", "addressed in ",
	"shipped a fix", "shipped the fix", "the fix for", "went out in ",
	"no longer an issue", "no longer happens", "patched in ", "corrected in ",
	"update to", "updating to", "upgrade to", "update your scrollr", "update your app",
	"install the latest", "download the latest", "get the latest version",
	"once you update", "after you update", "updating should", "update should",
	"update and let", "update fixes",
}

// injectionPatterns treat the ticket body as what it is: text a stranger
// wrote. A ticket that talks to the assistant rather than to us is escalated
// unread rather than drafted against — and it can never reach the disposition
// by any other route, because nothing here reads the user's text as anything
// but a substring match.
var injectionPatterns = []string{
	"ignore previous", "ignore all previous", "ignore the above",
	"ignore your", "disregard previous", "disregard the above",
	"your instructions", "your system prompt", "system prompt:",
	"you are now", "pretend to be", "new instructions", "jailbreak",
	"developer mode", "print your prompt", "reveal your", "</system",
	"<|im_start|", "role: system", "act as if you",
}

// firstMatch returns the first pattern present in s, or "".
func firstMatch(s string, patterns []string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	lower := strings.ToLower(s)
	for _, p := range patterns {
		if strings.Contains(lower, p) {
			return p
		}
	}
	return ""
}

func sentimentIsHot(sentiment string) bool {
	switch strings.ToLower(strings.TrimSpace(sentiment)) {
	case "angry", "frustrated":
		return true
	}
	return false
}

// confidenceIsSendable: low, and anything we cannot read, is not sendable.
// Medium is — the draft still had to cite everything it claimed and leave
// nothing open to get this far.
func confidenceIsSendable(confidence string) bool {
	switch strings.ToLower(strings.TrimSpace(confidence)) {
	case "high", "medium":
		return true
	}
	return false
}

// categoriesDisagree ignores an empty drafter category: pre-REL-249 rows and a
// drafting call that skipped the field are not a disagreement.
func categoriesDisagree(classifier, drafter string) bool {
	c := strings.ToLower(strings.TrimSpace(classifier))
	d := strings.ToLower(strings.TrimSpace(drafter))
	return c != "" && d != "" && c != d
}

// ===== Configuration ==============================================

const (
	holdDefault            = 15 * time.Minute
	maxAutoRepliesDefault  = 3
	demoteThresholdDefault = 0.30
	// demoteWindow is the "rolling 30 sends" from the ticket; demoteMinSample
	// is the smallest window we will act on, so one edit out of the first two
	// drafts in a category does not switch that category off for good.
	demoteWindow    = 30
	demoteMinSample = 10
)

// autosendEnabled reports whether autonomous sending is switched on. Off
// forces approval everywhere: the disposition is still computed and recorded,
// it just arms nothing and pings nobody.
func autosendEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_AUTOSEND"))
	if raw == "" {
		return true // REL-249 default: on
	}
	return strings.EqualFold(raw, "on")
}

// holdDuration is how long an auto_send draft waits before it sends itself.
func holdDuration() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_HOLD_MINUTES"))
	if raw == "" {
		return holdDefault
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 {
		log.Printf("[Disposition] SUPPORT_HOLD_MINUTES=%q is not a non-negative integer; using %s", raw, holdDefault)
		return holdDefault
	}
	return time.Duration(n) * time.Minute
}

func maxAutoReplies() int {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_MAX_AUTO_REPLIES"))
	if raw == "" {
		return maxAutoRepliesDefault
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		log.Printf("[Disposition] SUPPORT_MAX_AUTO_REPLIES=%q is not a positive integer; using %d", raw, maxAutoRepliesDefault)
		return maxAutoRepliesDefault
	}
	return n
}

func demoteThreshold() float64 {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_DEMOTE_THRESHOLD"))
	if raw == "" {
		return demoteThresholdDefault
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || f <= 0 || f > 1 {
		log.Printf("[Disposition] SUPPORT_DEMOTE_THRESHOLD=%q is not a fraction in (0,1]; using %.2f", raw, demoteThresholdDefault)
		return demoteThresholdDefault
	}
	return f
}

// escalateMention is what an escalation post pings. Empty posts the escalation
// without a mention rather than pinging a whole channel.
func escalateMention() string {
	return strings.TrimSpace(os.Getenv("SUPPORT_ESCALATE_MENTION"))
}

// ===== support_policy — the switches that must outlive a pod =====

const policyPausedKey = "paused"

func policyGet(ctx context.Context, key string) string {
	if platform.DBPool == nil {
		return ""
	}
	var v string
	err := platform.DBPool.QueryRow(ctx, `SELECT value FROM support_policy WHERE key = $1`, key).Scan(&v)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[Policy] get %s: %v", key, err)
		}
		return ""
	}
	return v
}

func policySet(ctx context.Context, key, value string) error {
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	_, err := platform.DBPool.Exec(ctx,
		`INSERT INTO support_policy (key, value) VALUES ($1, $2)
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, value)
	return err
}

func policyDelete(ctx context.Context, key string) error {
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	_, err := platform.DBPool.Exec(ctx, `DELETE FROM support_policy WHERE key = $1`, key)
	return err
}

// autosendPaused is the /pause kill switch. DB-backed so it survives the
// restart that tends to follow someone pausing because something is wrong.
func autosendPaused(ctx context.Context) bool {
	return policyGet(ctx, policyPausedKey) != ""
}

// autosendArmed: is anything allowed to leave without a click right now.
func autosendArmed(ctx context.Context) bool {
	return autosendEnabled() && !autosendPaused(ctx)
}

// demoteFloorKey is the draft id watermark /resume writes. Interventions at or
// below it are forgiven, which is what makes recovery manual and explicit.
func demoteFloorKey(category string) string {
	return "demote_floor:" + strings.ToLower(strings.TrimSpace(category))
}

// ===== Signal gathering ===========================================

// categoryIntervention is one category's rolling record.
type categoryIntervention struct {
	Category      string
	Window        int // drafts counted, at most demoteWindow
	Interventions int
	Rate          float64
	Demoted       bool
}

// interventionRate reads the last demoteWindow auto-eligible drafts in a
// category (above the /resume watermark) and reports how many needed a human.
func interventionRate(ctx context.Context, category string) categoryIntervention {
	ci := categoryIntervention{Category: category}
	if platform.DBPool == nil || strings.TrimSpace(category) == "" {
		return ci
	}
	floor, _ := strconv.ParseInt(policyGet(ctx, demoteFloorKey(category)), 10, 64)

	const q = `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE intervened)
		FROM (
			SELECT intervened FROM support_drafts
			WHERE lower(ai_category) = lower($1)
			  AND disposition IN ('auto_send', 'auto_ask', 'auto_close')
			  AND id > $2
			ORDER BY id DESC
			LIMIT $3
		) w
	`
	if err := platform.DBPool.QueryRow(ctx, q, category, floor, demoteWindow).
		Scan(&ci.Window, &ci.Interventions); err != nil {
		log.Printf("[Disposition] intervention rate for %q: %v", category, err)
		return ci
	}
	if ci.Window > 0 {
		ci.Rate = float64(ci.Interventions) / float64(ci.Window)
	}
	ci.Demoted = ci.Window >= demoteMinSample && ci.Rate > demoteThreshold()
	return ci
}

// outboundRepliesLast24h counts what we have already said on this ticket
// today. It is both the loop cap and the "going in circles" trigger: a third
// fruitless reply is where a human should take over.
func outboundRepliesLast24h(ctx context.Context, ticketNumber string) int {
	if platform.DBPool == nil {
		return 0
	}
	var n int
	const q = `
		SELECT COUNT(*) FROM support_messages
		WHERE ticket_number = $1 AND kind = 'sent' AND created_at > now() - interval '24 hours'
	`
	if err := platform.DBPool.QueryRow(ctx, q, ticketNumber).Scan(&n); err != nil {
		log.Printf("[Disposition] outbound count for %s: %v", ticketNumber, err)
		return 0
	}
	return n
}

// isOurOwnOutbound reports whether an osTicket thread entry is a reply WE
// posted. The plugin filters to user messages, but a mail loop, a shared
// mailbox or a plugin change would put our own words back through triage and
// the bot would answer itself; this is the check that stops it dead.
func isOurOwnOutbound(ctx context.Context, threadEntryID int64) bool {
	if platform.DBPool == nil || threadEntryID <= 0 {
		return false
	}
	var exists bool
	const q = `SELECT EXISTS(SELECT 1 FROM support_messages WHERE osticket_entry_id = $1 AND kind = 'sent')`
	if err := platform.DBPool.QueryRow(ctx, q, threadEntryID).Scan(&exists); err != nil {
		log.Printf("[Disposition] own-outbound check for entry %d: %v", threadEntryID, err)
		return false
	}
	return exists
}

// gatherDispositionSignals collects everything decideDisposition reads for a
// persisted draft.
func gatherDispositionSignals(ctx context.Context, draft *SupportDraft) dispositionSignals {
	return dispositionSignals{
		HasDraft:        strings.TrimSpace(draft.DraftBodyHTML) != "",
		Category:        draft.AICategory,
		DrafterCategory: draft.DrafterCategory,
		Priority:        draft.AIPriority,
		Confidence:      draft.AIConfidence,
		Sentiment:       draft.Sentiment,
		GroundedIn:      draft.GroundedIn,
		Unknowns:        draft.Unknowns,
		AskUserFor:      draft.AskUserFor,
		NeedsInfo:       draft.NeedsInfo,
		ShouldClose:     draft.ShouldClose,
		DraftBody:       htmlToPlain(draft.DraftBodyHTML),
		UserText:        draft.OriginalSubject + "\n" + htmlToPlain(draft.UserMessageHTML),
		OutboundLast24h: outboundRepliesLast24h(ctx, draft.TicketNumber),
		MaxAutoReplies:  maxAutoReplies(),
		CategoryDemoted: interventionRate(ctx, draft.AICategory).Demoted,
		HasProvenFix:    lookupProvenFix(ctx, draft.TicketNumber) != nil,
		StaleDays:       caseStaleDays(ctx, draft.TicketNumber),
		StaleAfter:      staleTicketDays(),
	}
}
