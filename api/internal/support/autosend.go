package support

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// =============================================================================
// Auto-send — the delayed, opt-in, never-for-bugs path (REL-245)
// =============================================================================
//
// Off by default. When SUPPORT_AUTOSEND=on, a draft that clears every gate
// below is sent on its own after a delay, with a live countdown posted in
// the thread; clicking Skip, Edit or Ask before the timer fires cancels it,
// because those all move the draft off 'pending' and the timer re-reads the
// status before sending.
//
// The gate is deliberately narrow. A wrong answer to "when does Uplink Pro
// renew" costs a follow-up; a wrong answer to a billing or account question
// costs trust and possibly money, and a wrong answer to a bug report tells
// someone their broken app is working as intended. Those three categories
// are refused here regardless of configuration — there is no env var that
// turns them on.

// autosendNeverCategories can never auto-send. Not configurable: see above.
var autosendNeverCategories = map[string]struct{}{
	"bug":     {},
	"billing": {},
	"account": {},
}

const (
	autosendDefaultCategories = "feature,feedback"
	autosendDefaultDelay      = 30 * time.Minute
)

// autosendEnabled reports whether SUPPORT_AUTOSEND is switched on.
func autosendEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("SUPPORT_AUTOSEND")), "on")
}

// autosendCategories is the allow-list from SUPPORT_AUTOSEND_CATEGORIES,
// lowercased. Empty env falls back to feature + feedback.
func autosendCategories() map[string]struct{} {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_AUTOSEND_CATEGORIES"))
	if raw == "" {
		raw = autosendDefaultCategories
	}
	out := map[string]struct{}{}
	for _, c := range strings.Split(raw, ",") {
		if c = strings.ToLower(strings.TrimSpace(c)); c != "" {
			out[c] = struct{}{}
		}
	}
	return out
}

// autosendDelay is how long the partner has to intervene.
func autosendDelay() time.Duration {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_AUTOSEND_DELAY"))
	if raw == "" {
		return autosendDefaultDelay
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		log.Printf("[Autosend] SUPPORT_AUTOSEND_DELAY=%q is not a positive duration; using %s", raw, autosendDefaultDelay)
		return autosendDefaultDelay
	}
	return d
}

// autosendAllowed is the whole decision, in one pure function so the gate
// is testable without a database, a clock or Discord.
//
// Every condition must hold: the feature is on, the AI is confident, the
// category is on the allow-list AND not one of the three that are never
// eligible, the AI is not waiting on information from the user, and the
// draft is still pending and has a body to send.
func autosendAllowed(draft *SupportDraft) bool {
	if draft == nil || !autosendEnabled() {
		return false
	}
	if draft.Status != "pending" {
		return false
	}
	if strings.TrimSpace(draft.DraftBodyHTML) == "" {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(draft.AIConfidence), "high") {
		return false
	}
	if strings.TrimSpace(draft.AskUserFor) != "" {
		return false
	}
	category := strings.ToLower(strings.TrimSpace(draft.AICategory))
	if _, never := autosendNeverCategories[category]; never {
		return false
	}
	_, ok := autosendCategories()[category]
	return ok
}

// scheduleAutoSend arms the timer for a freshly-posted draft and announces
// the deadline in its thread. No-op when the draft doesn't clear the gate.
//
// ponytail: the timer lives in this process, so a pod restart drops it and
// the draft simply stays pending — the failure direction is "a human still
// has to click", which is the safe one. Move it to a scanned deadline
// column if auto-send ever becomes the main path.
func scheduleAutoSend(draft *SupportDraft) {
	if !autosendAllowed(draft) {
		return
	}
	delay := autosendDelay()
	deadline := time.Now().Add(delay)

	// Discord renders <t:unix:R> as a live "in 29 minutes" that keeps
	// counting down in place — a real countdown, not a printed duration.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		t, err := loadSupportTicketThread(ctx, draft.TicketNumber)
		if err != nil || t == nil {
			return
		}
		msg := fmt.Sprintf(
			"⏳ Auto-sending <t:%d:R> — `%s` · confidence `%s`. Skip, Edit or Ask cancels it.",
			deadline.Unix(), draft.AICategory, draft.AIConfidence)
		if _, err := discordPostMessage(ctx, t.DiscordThreadID, msg, nil); err != nil {
			log.Printf("[Autosend] countdown post for ticket %s: %v", draft.TicketNumber, err)
		}
	}()

	draftID := draft.ID
	time.AfterFunc(delay, func() { fireAutoSend(draftID) })
	log.Printf("[Autosend] draft %d (ticket %s) armed for %s", draft.ID, draft.TicketNumber, deadline.Format(time.RFC3339))
}

// fireAutoSend re-reads the draft when the timer expires and sends it only
// if nobody got there first. The status re-check is what makes Skip / Edit
// / Ask a cancel, and markDraftDecided's `WHERE status = 'pending'` makes
// the whole thing safe to run on several replicas at once.
func fireAutoSend(draftID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		log.Printf("[Autosend] draft %d gone at fire time (err=%v)", draftID, err)
		return
	}
	if !autosendAllowed(draft) {
		log.Printf("[Autosend] draft %d no longer eligible (status=%s); cancelled", draftID, draft.Status)
		return
	}

	if err := markDraftDecided(ctx, draftID, "approved", ""); err != nil {
		log.Printf("[Autosend] draft %d not claimed: %v", draftID, err)
		return
	}
	draft, _ = loadSupportDraft(ctx, draftID)
	if draft == nil {
		return
	}
	if err := sendApprovedReply(ctx, draft, draft.DraftBodyHTML); err != nil {
		log.Printf("[Autosend] send for ticket %s: %v", draft.TicketNumber, err)
		return
	}
	applySendStateToThread(ctx, draft, draft.ShouldClose)

	if t, err := loadSupportTicketThread(ctx, draft.TicketNumber); err == nil && t != nil {
		if _, err := discordPostMessage(ctx, t.DiscordThreadID,
			"🤖 Auto-sent — nobody intervened before the timer.", nil); err != nil {
			log.Printf("[Autosend] confirmation post for ticket %s: %v", draft.TicketNumber, err)
		}
	}
	log.Printf("[Autosend] draft %d auto-sent for ticket %s", draftID, draft.TicketNumber)
}
