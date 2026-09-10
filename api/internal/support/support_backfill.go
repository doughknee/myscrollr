package support

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Backfill + nightly reconcile from the osTicket plugin's read endpoints
// =============================================================================
//
// GET /api/tickets.json?status=all&topic=all and GET /api/tickets/{n}.json
// (scripts/osticket-plugin/api.list.php). The API key is IP-bound to the
// cluster egress, so this only runs from inside the cluster: the
// cmd/support-backfill binary via k8s/jobs/support-backfill.yaml for the
// one-off, and StartSupportCaseReconciler in-process every night.
//
// Two passes, in this order:
//
//  1. linkDrafts — every support_drafts row becomes its case (fill-only)
//     plus an ai_draft message, a sent message when it went out (the
//     edited body when there was one) and a note when it was skipped.
//     Follow-up drafts also record the user message they answer, keyed on
//     the osTicket entry id the webhook gave them.
//  2. syncFromOSTicket — every ticket's thread entries. An entry whose id
//     we already hold is skipped; otherwise it CLAIMS the oldest message of
//     the same kind on that ticket that has no entry id yet (the live paths
//     don't know the entry id at ticket-create time, and pre-existing
//     drafts never did), and only inserts when nothing is left to claim.
//
// Run it twice and the counts don't move — that's the idempotency test.

// BackfillStats is what a run reports.
type BackfillStats struct {
	Tickets  int `json:"tickets"`
	Cases    int `json:"cases"`
	Messages int `json:"messages"`
	Drafts   int `json:"drafts"`
	Errors   int `json:"errors"`
}

type osTicketListResponse struct {
	Count   int `json:"count"`
	Tickets []struct {
		Number string `json:"number"`
	} `json:"tickets"`
}

type osTicketDetail struct {
	Number      string  `json:"number"`
	Subject     string  `json:"subject"`
	Topic       *string `json:"topic"`
	Status      *string `json:"status"`
	StatusState *string `json:"status_state"`
	Priority    string  `json:"priority"`
	Created     *string `json:"created"`
	Updated     *string `json:"updated"`
	Closed      *bool   `json:"closed"`
	UserEmail   string  `json:"user_email"`
	Thread      []struct {
		ID        int64   `json:"id"`
		Type      string  `json:"type"`
		Created   *string `json:"created"`
		BodyPlain string  `json:"body_plain"`
	} `json:"thread"`
}

// BackfillFromOSTicket runs both passes. A zero `since` walks every
// ticket; otherwise only tickets osTicket updated since then.
func BackfillFromOSTicket(ctx context.Context, since time.Time) (BackfillStats, error) {
	var st BackfillStats
	if platform.DBPool == nil {
		return st, fmt.Errorf("DB not initialized")
	}
	st.Drafts, st.Errors = linkDrafts(ctx)

	q := url.Values{"status": {"all"}, "topic": {"all"}, "limit": {"100"}}
	if !since.IsZero() {
		q.Set("since", since.UTC().Format(time.RFC3339))
	}
	// ponytail: the plugin's list endpoint caps at 100 and has no offset;
	// page with ?since= by last `updated` when the ticket count passes 100.
	status, body, err := osTicketRequest(ctx, "GET", "/api/tickets.json?"+q.Encode(), nil)
	if err != nil {
		return st, fmt.Errorf("list tickets (status %d): %w", status, err)
	}
	var list osTicketListResponse
	if err := json.Unmarshal(body, &list); err != nil {
		return st, fmt.Errorf("decode ticket list: %w", err)
	}
	for _, t := range list.Tickets {
		st.Tickets++
		if err := syncTicket(ctx, t.Number, &st); err != nil {
			st.Errors++
			log.Printf("[Backfill] ticket %s: %v", t.Number, err)
		}
	}
	// Discord threads the live path created before cases existed.
	_, _ = platform.DBPool.Exec(ctx, `
		UPDATE support_cases c SET discord_thread_id = t.discord_thread_id
		FROM support_ticket_threads t
		WHERE t.ticket_number = c.ticket_number AND c.discord_thread_id IS NULL`)
	return st, nil
}

// linkDrafts is pass 1. Returns (drafts seen, errors).
func linkDrafts(ctx context.Context) (int, int) {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT id, ticket_number, user_email, original_subject,
			   COALESCE(user_message_html,''), draft_body_html, COALESCE(edited_body_html,''),
			   COALESCE(ai_summary,''), COALESCE(ai_category,''), COALESCE(ai_priority,''),
			   status, COALESCE(osticket_thread_entry_id,0), decided_at, sent_at, created_at
		FROM support_drafts ORDER BY created_at, id`)
	if err != nil {
		log.Printf("[Backfill] read drafts: %v", err)
		return 0, 1
	}
	defer rows.Close()
	var n, errs int
	for rows.Next() {
		var d SupportDraft
		var summary, category, priority string
		if err := rows.Scan(&d.ID, &d.TicketNumber, &d.UserEmail, &d.OriginalSubject,
			&d.UserMessageHTML, &d.DraftBodyHTML, &d.EditedBodyHTML, &summary, &category, &priority,
			&d.Status, &d.OSTicketThreadEntryID, &d.DecidedAt, &d.SentAt, &d.CreatedAt); err != nil {
			errs++
			continue
		}
		n++
		if err := upsertSupportCase(ctx, SupportCase{
			TicketNumber: d.TicketNumber, UserEmail: d.UserEmail, Subject: d.OriginalSubject,
			Category: category, Priority: priority, Summary: summary,
			OpenedAt: d.CreatedAt, UpdatedAt: d.CreatedAt,
		}); err != nil {
			errs++
			log.Printf("[Backfill] %v", err)
			continue
		}
		// Only follow-up drafts know their entry id; an opening message
		// without one has no idempotency key here, so the thread walk in
		// syncTicket records it instead.
		if d.UserMessageHTML != "" && d.OSTicketThreadEntryID > 0 {
			errs += logged(recordSupportMessage(ctx, SupportMessage{
				TicketNumber: d.TicketNumber, Kind: "user", BodyHTML: d.UserMessageHTML,
				OSTicketEntryID: d.OSTicketThreadEntryID, CreatedAt: d.CreatedAt,
			}))
		}
		errs += logged(recordSupportMessage(ctx, SupportMessage{
			TicketNumber: d.TicketNumber, Kind: "ai_draft", BodyHTML: d.DraftBodyHTML,
			AIDraftID: d.ID, CreatedAt: d.CreatedAt,
		}))
		switch d.Status {
		case "sent", "approved", "edited":
			body := d.DraftBodyHTML
			if d.EditedBodyHTML != "" {
				body = d.EditedBodyHTML
			}
			at := d.CreatedAt
			if d.DecidedAt != nil {
				at = *d.DecidedAt
			}
			if d.SentAt != nil {
				at = *d.SentAt
			}
			errs += logged(recordSupportMessage(ctx, SupportMessage{
				TicketNumber: d.TicketNumber, Kind: "sent", BodyHTML: body, AIDraftID: d.ID, CreatedAt: at,
			}))
		case "skipped":
			at := d.CreatedAt
			if d.DecidedAt != nil {
				at = *d.DecidedAt
			}
			errs += logged(recordSupportMessage(ctx, SupportMessage{
				TicketNumber: d.TicketNumber, Kind: "note", BodyText: "AI draft skipped", AIDraftID: d.ID, CreatedAt: at,
			}))
		}
	}
	return n, errs
}

func logged(err error) int {
	if err != nil {
		log.Printf("[Backfill] %v", err)
		return 1
	}
	return 0
}

// syncTicket is pass 2 for one ticket.
func syncTicket(ctx context.Context, number string, st *BackfillStats) error {
	status, body, err := osTicketRequest(ctx, "GET", "/api/tickets/"+url.PathEscape(number)+".json", nil)
	if err != nil {
		return fmt.Errorf("detail (status %d): %w", status, err)
	}
	var d osTicketDetail
	if err := json.Unmarshal(body, &d); err != nil {
		return fmt.Errorf("decode detail: %w", err)
	}
	caseStatus, statusKnown := importedCaseStatus(d)
	sc := SupportCase{
		TicketNumber: number, UserEmail: d.UserEmail, Subject: d.Subject,
		Category: categoryFromTopic(d.Topic), Priority: d.Priority, Status: caseStatus,
		OpenedAt: parseISO(d.Created), UpdatedAt: parseISO(d.Updated),
	}
	if statusKnown && !sc.UpdatedAt.IsZero() {
		sc.StatusObservedAt = sc.UpdatedAt
	} else {
		sc.Status = ""
	}
	if sc.Status == "closed" {
		closed := sc.UpdatedAt
		if closed.IsZero() {
			closed = time.Now()
		}
		sc.ClosedAt = &closed
	}
	if err := upsertSupportCase(ctx, sc); err != nil {
		return err
	}
	st.Cases++

	kinds := map[string]string{"M": "user", "R": "sent", "N": "note"}
	for _, e := range d.Thread {
		kind, ok := kinds[e.Type]
		if !ok || e.ID == 0 {
			continue
		}
		// Claim the oldest unlinked message of this kind on the ticket;
		// thread entries arrive in id order, so the zip lines up.
		tag, err := platform.DBPool.Exec(ctx, `
			UPDATE support_messages SET osticket_entry_id = $3
			WHERE id = (SELECT id FROM support_messages
						WHERE ticket_number = $1 AND kind = $2 AND osticket_entry_id IS NULL
						ORDER BY created_at, id LIMIT 1)
			  AND NOT EXISTS (SELECT 1 FROM support_messages WHERE osticket_entry_id = $3)`,
			number, kind, e.ID)
		if err != nil {
			return fmt.Errorf("claim entry %d: %w", e.ID, err)
		}
		if tag.RowsAffected() > 0 {
			st.Messages++
			continue
		}
		if err := recordSupportMessage(ctx, SupportMessage{
			TicketNumber: number, Kind: kind, BodyText: strings.TrimSpace(e.BodyPlain),
			OSTicketEntryID: e.ID, CreatedAt: parseISO(e.Created),
		}); err != nil {
			return err
		}
		st.Messages++
	}
	return nil
}

func importedCaseStatus(d osTicketDetail) (string, bool) {
	if d.Closed == nil || d.StatusState == nil {
		return "", false
	}
	state := strings.ToLower(strings.TrimSpace(*d.StatusState))
	closedState := state == "closed" || state == "archived" || state == "deleted"
	if state != "open" && !closedState || *d.Closed != closedState {
		return "", false
	}
	if closedState {
		return "closed", true
	}
	return "open", true
}

// categoryFromTopic maps an osTicket help-topic name onto the category
// vocabulary the submit form uses.
func categoryFromTopic(topic *string) string {
	if topic == nil {
		return ""
	}
	t := strings.ToLower(*topic)
	for _, c := range []string{"bug", "feature", "feedback", "billing", "account", "widget"} {
		if strings.Contains(t, c) {
			return c
		}
	}
	if strings.Contains(t, "channel") {
		return "widget"
	}
	return strings.TrimSpace(t)
}

func parseISO(s *string) time.Time {
	if s == nil {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// StartSupportCaseReconciler re-syncs tickets osTicket updated in the
// last 48 h, once a day, so status changes and replies made inside
// osTicket's own UI reach the case DB. Redis-locked so one replica runs
// it. No-op when osTicket isn't configured.
func StartSupportCaseReconciler(ctx context.Context) {
	if os.Getenv("OSTICKET_URL") == "" || os.Getenv("OSTICKET_API_KEY") == "" {
		return
	}
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if platform.Rdb != nil {
					locked, err := platform.Rdb.SetNX(ctx, "support:reconcile:lock", "1", 12*time.Hour).Result()
					if err != nil || !locked {
						continue
					}
				}
				runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
				st, err := BackfillFromOSTicket(runCtx, time.Now().Add(-48*time.Hour))
				cancel()
				log.Printf("[Cases] nightly reconcile: %+v err=%v", st, err)
			}
		}
	}()
	log.Println("[Cases] nightly osTicket reconcile started (24h interval, 48h window)")
}
