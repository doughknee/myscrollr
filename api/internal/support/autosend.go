package support

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Acting on a disposition — the hold timer, the sweeper, the escalation
// =============================================================================
//
// decideDisposition (disposition.go) says what should happen. This file makes
// it happen: it writes the decision to the row, says so in the thread, and —
// for the two dispositions that end in an outbound reply — either sends now or
// arms a hold the sweeper collects.
//
// The timer is a hold_until column swept once a minute rather than a
// time.AfterFunc, because the failure direction reversed. Under REL-245 a lost
// timer meant "a human still has to click", which was safe. Now doing nothing
// is what sends, so a lost timer is a reply that never happens and a user who
// is never answered.

// applyDisposition decides, records and acts. Called once per draft, after the
// Discord thread exists so there is somewhere to post the countdown.
//
// Fail-soft throughout: a draft whose disposition cannot be recorded stays
// pending with its buttons, which is exactly the pre-REL-249 behaviour.
func applyDisposition(ctx context.Context, draft *SupportDraft) {
	if draft == nil || platform.DBPool == nil {
		return
	}
	disposition, reason := decideDisposition(gatherDispositionSignals(ctx, draft))
	armed := autosendArmed(ctx)

	var holdUntil *time.Time
	if armed && (disposition == dispositionAutoSend || disposition == dispositionAutoClose) {
		t := time.Now().Add(holdDuration())
		holdUntil = &t
	}
	if err := recordDisposition(ctx, draft.ID, disposition, reason, holdUntil); err != nil {
		log.Printf("[Disposition] record for draft %d: %v", draft.ID, err)
		return
	}
	draft.Disposition, draft.DispositionReason = disposition, reason
	log.Printf("[Disposition] draft %d (ticket %s) -> %s (%s) armed=%t",
		draft.ID, draft.TicketNumber, disposition, reason, armed)

	if !armed {
		postToTicketThread(ctx, draft.TicketNumber, fmt.Sprintf(
			"🔒 Would be `%s` — %s. Autonomous sending is %s, so this one waits for a button.",
			disposition, reason, pausedOrOff(ctx)))
		return
	}

	switch disposition {
	case dispositionEscalate:
		postEscalation(ctx, draft, reason)
	case dispositionAutoAsk:
		// No hold. Asking a user which operating system they are on carries
		// almost no risk, and the waiting is what has been costing us.
		postToTicketThread(ctx, draft.TicketNumber, "❓ Asking the user now — "+reason+".")
		sendDraftNow(ctx, draft.ID, "asked")
	case dispositionAutoSend, dispositionAutoClose:
		// Discord renders <t:unix:R> as a live "in 59 minutes" that keeps
		// counting down in place — a real countdown, not a printed duration.
		verb := "Sending"
		if disposition == dispositionAutoClose {
			verb = "Sending and closing"
		}
		postToTicketThread(ctx, draft.TicketNumber, fmt.Sprintf(
			"⏳ %s <t:%d:R> — %s. Hold, Edit or Skip stops it; doing nothing sends it.",
			verb, holdUntil.Unix(), reason))
	}
}

func pausedOrOff(ctx context.Context) string {
	if autosendPaused(ctx) {
		return "paused (`/resume` to lift it)"
	}
	return "off (`SUPPORT_AUTOSEND`)"
}

// postEscalation is the one disposition with no timer: it says why, pings, and
// waits for a person.
func postEscalation(ctx context.Context, draft *SupportDraft, reason string) {
	msg := fmt.Sprintf("🚨 **Escalated — not sending.** %s\nSend, Edit or Ask when you have looked at it.", reason)
	if m := escalateMention(); m != "" {
		msg = m + " " + msg
	}
	postToTicketThread(ctx, draft.TicketNumber, msg)
}

// escalateWithoutDraft is the failed-triage path. There is no draft row to
// hang a disposition on, and on a brand new ticket there is no thread either —
// the thread is created by the draft that never arrived. So this one opens the
// thread itself. Saying nothing is how thirteen tickets sat pending since May.
func escalateWithoutDraft(ctx context.Context, ticketNumber, subject, reason string) {
	log.Printf("[Disposition] ticket %s escalated with no draft: %s", ticketNumber, reason)
	if !shouldNotifyDiscord() {
		return
	}
	cfg, ok := loadDiscordConfig()
	if !ok {
		return
	}
	threadID, _, err := getOrCreateThreadForTicket(ctx, cfg,
		&SupportDraft{TicketNumber: ticketNumber, OriginalSubject: subject, AIPriority: "high"},
		"🚨 **Escalated — no draft.** This ticket needs a reply written by hand.", nil, nil)
	if err != nil {
		log.Printf("[Disposition] thread for undrafted ticket %s: %v", ticketNumber, err)
		return
	}
	msg := reason
	if m := escalateMention(); m != "" {
		msg = m + " " + msg
	}
	if _, err := discordPostMentioning(ctx, threadID, msg); err != nil {
		log.Printf("[Disposition] escalation post for ticket %s: %v", ticketNumber, err)
	}
}

// postToTicketThread posts one line into a ticket's Discord thread when there
// is one. Silent no-op otherwise: Discord is a workspace, not the record.
func postToTicketThread(ctx context.Context, ticketNumber, content string) {
	if !shouldNotifyDiscord() {
		return
	}
	t, err := loadSupportTicketThread(ctx, ticketNumber)
	if err != nil || t == nil {
		return
	}
	// allowed_mentions suppresses parsed mentions, so an explicit user id has
	// to be allow-listed for the ping to actually reach anyone.
	if _, err := discordPostMentioning(ctx, t.DiscordThreadID, content); err != nil {
		log.Printf("[Disposition] post to thread for ticket %s: %v", ticketNumber, err)
	}
}

// ===== The sweeper ================================================

const holdSweepInterval = time.Minute

// StartAutoSendSweeper sends the drafts whose hold has run out. One tick a
// minute; the claim is markDraftDecided's `WHERE status = 'pending'`, so
// several replicas sweeping at once is safe and needs no lock.
func StartAutoSendSweeper(ctx context.Context) {
	if platform.DBPool == nil {
		log.Println("[Autosend] DB not initialized; sweeper disabled")
		return
	}
	go func() {
		ticker := time.NewTicker(holdSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweepExpiredHolds(ctx)
			}
		}
	}()
	log.Printf("[Autosend] hold sweeper started (every %s, hold %s)", holdSweepInterval, holdDuration())
}

// sweepExpiredHolds fires every draft whose countdown has finished. A pause
// stops the whole sweep rather than each draft: the holds keep running and
// resume where they were, which is what a kill switch should do.
func sweepExpiredHolds(ctx context.Context) {
	if !autosendArmed(ctx) {
		return
	}
	const q = `
		SELECT id FROM support_drafts
		WHERE status = 'pending'
		  AND hold_until IS NOT NULL AND hold_until <= now()
		  AND disposition IN ('auto_send', 'auto_close')
		ORDER BY hold_until
		LIMIT 25
	`
	rows, err := platform.DBPool.Query(ctx, q)
	if err != nil {
		log.Printf("[Autosend] sweep: %v", err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()

	for _, id := range ids {
		sendCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		sendDraftNow(sendCtx, id, "approved")
		cancel()
	}
}

// sendDraftNow claims a pending draft and sends its body. status is the
// decided-status to claim it under: "approved" for a reply, "asked" for a
// clarifying question, so the thread state machine and the digest keep telling
// the truth about which one went out.
//
// Re-reading the row here is what makes Hold, Edit, Ask and Skip a cancel:
// all four move the draft off 'pending' or clear its hold.
func sendDraftNow(ctx context.Context, draftID int64, status string) {
	draft, err := loadSupportDraft(ctx, draftID)
	if err != nil || draft == nil {
		log.Printf("[Autosend] draft %d gone at send time (err=%v)", draftID, err)
		return
	}
	if draft.Status != "pending" || strings.TrimSpace(draft.DraftBodyHTML) == "" {
		log.Printf("[Autosend] draft %d no longer sendable (status=%s)", draftID, draft.Status)
		return
	}
	if !autosendArmed(ctx) {
		log.Printf("[Autosend] draft %d not sent: autonomous sending is off or paused", draftID)
		return
	}
	if err := markDraftDecided(ctx, draftID, status, ""); err != nil {
		log.Printf("[Autosend] draft %d not claimed: %v", draftID, err)
		return
	}
	draft, _ = loadSupportDraft(ctx, draftID)
	if draft == nil {
		return
	}
	// A question never closes a ticket, whatever triage thought of the reply
	// it stands in for.
	if status == "asked" {
		draft.ShouldClose = false
	}
	if err := sendDraftReply(ctx, draft, draft.DraftBodyHTML); err != nil {
		log.Printf("[Autosend] send for ticket %s: %v", draft.TicketNumber, err)
		postToTicketThread(ctx, draft.TicketNumber,
			"⚠️ Auto-send failed: "+truncate(err.Error(), 300)+". The draft is still here.")
		return
	}
	if status == "asked" {
		applyAskStateToThread(ctx, draft)
		postToTicketThread(ctx, draft.TicketNumber, "❓ Asked, unattended — waiting on the user.")
	} else {
		applySendStateToThread(ctx, draft, draft.ShouldClose)
		postToTicketThread(ctx, draft.TicketNumber, "🤖 Sent, unattended — nobody intervened before the hold ran out.")
	}
	log.Printf("[Autosend] draft %d sent for ticket %s as %s", draftID, draft.TicketNumber, status)
}
