package support

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Support case database — support_cases + support_messages (REL-243)
// =============================================================================
//
// osTicket owns the tickets. This is the searchable copy the support bot
// reads: one row per ticket, one row per thread event. Every path that
// already sees an event writes here (ticket create on both submit paths,
// the osTicket follow-up webhook, draft create / send / skip) and the
// backfill in support_backfill.go fills in whatever happened elsewhere.

// SupportCase mirrors one support_cases row. Empty strings and zero
// times mean "unknown" on write and are never used to blank a stored
// value — see upsertSupportCase.
type SupportCase struct {
	TicketNumber      string     `json:"ticket_number"`
	UserEmail         string     `json:"-"`
	UserName          string     `json:"-"`
	ContactSource     string     `json:"-"`
	ContactObservedAt time.Time  `json:"-"`
	LogtoSub          string     `json:"-"`
	AccountSource     string     `json:"-"`
	Subject           string     `json:"subject"`
	Category          string     `json:"category,omitempty"`
	Priority          string     `json:"priority,omitempty"`
	Status            string     `json:"status"`
	StatusObservedAt  time.Time  `json:"-"`
	Summary           string     `json:"summary,omitempty"`
	AppVersion        string     `json:"app_version,omitempty"`
	OS                string     `json:"os,omitempty"`
	TierAtOpen        string     `json:"tier_at_open,omitempty"`
	LinearIssueKey    string     `json:"linear_issue_key,omitempty"`
	DiscordThreadID   string     `json:"discord_thread_id,omitempty"`
	OpenedAt          time.Time  `json:"opened_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	ClosedAt          *time.Time `json:"closed_at,omitempty"`
}

const (
	contactSourceAuthenticated   = "authenticated"
	contactSourcePublic          = "public"
	contactSourceOSTicket        = "osticket"
	contactSourceOSTicketWebhook = "osticket_webhook"
	contactSourceDraft           = "draft"
	accountSourceAuthenticated   = "authenticated"
)

// SupportMessage mirrors one support_messages row.
type SupportMessage struct {
	TicketNumber    string
	Kind            string // user | ai_draft | sent | note
	BodyHTML        string
	BodyText        string // derived from BodyHTML when empty
	AIDraftID       int64  // 0 = none
	OSTicketEntryID int64  // 0 = unknown
	CreatedAt       time.Time
}

// upsertSupportCase inserts the case or fills in what the stored row
// doesn't know yet. Descriptive fields (category, priority, summary,
// app_version, os, tier) are FIRST writer wins, so the nightly osTicket
// reconcile never overwrites what triage or the JWT told us at open time;
// subject and status are LAST writer wins, because osTicket is the
// authority for those and the reconcile is the newest source. Timestamps
// widen: opened_at only moves earlier, updated_at only later.
func upsertSupportCase(ctx context.Context, sc SupportCase) error {
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	hasContact := strings.TrimSpace(sc.UserEmail) != "" || strings.TrimSpace(sc.UserName) != ""
	if !hasContact {
		sc.ContactSource = ""
	}
	if strings.TrimSpace(sc.LogtoSub) == "" {
		sc.AccountSource = ""
	}
	var opened, updated, statusObserved, contactObserved *time.Time
	if !sc.OpenedAt.IsZero() {
		opened = &sc.OpenedAt
	}
	if !sc.UpdatedAt.IsZero() {
		updated = &sc.UpdatedAt
	}
	if !sc.StatusObservedAt.IsZero() {
		statusObserved = &sc.StatusObservedAt
	}
	if hasContact && !sc.ContactObservedAt.IsZero() {
		contactObserved = &sc.ContactObservedAt
	}
	const q = `
		INSERT INTO support_cases
			(ticket_number, user_email, logto_sub, subject, category, priority, status,
			 summary, app_version, os, tier_at_open, opened_at, updated_at, closed_at, status_observed_at,
			 user_name, contact_source, contact_observed_at, account_source)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, NULLIF($5,''), NULLIF($6,''),
			COALESCE(NULLIF($7,''), 'unknown'), NULLIF($8,''), NULLIF($9,''), NULLIF($10,''),
			NULLIF($11,''), COALESCE($12, now()), COALESCE($13, now()), $14, $15,
			NULLIF($16,''), NULLIF($17,''), $18, NULLIF($19,''))
		ON CONFLICT (ticket_number) DO UPDATE SET
			user_email   = CASE
				WHEN $18 IS NOT NULL AND $18 >= COALESCE(support_cases.contact_observed_at, '-infinity')
					THEN COALESCE(EXCLUDED.user_email, support_cases.user_email)
				WHEN support_cases.contact_observed_at IS NULL
					THEN COALESCE(support_cases.user_email, EXCLUDED.user_email)
				ELSE support_cases.user_email END,
			user_name    = CASE
				WHEN $18 IS NOT NULL AND $18 >= COALESCE(support_cases.contact_observed_at, '-infinity')
					THEN COALESCE(EXCLUDED.user_name, support_cases.user_name)
				WHEN support_cases.contact_observed_at IS NULL
					THEN COALESCE(support_cases.user_name, EXCLUDED.user_name)
				ELSE support_cases.user_name END,
			contact_source = CASE
				WHEN $18 IS NOT NULL AND (EXCLUDED.user_email IS NOT NULL OR EXCLUDED.user_name IS NOT NULL)
					AND $18 >= COALESCE(support_cases.contact_observed_at, '-infinity') THEN EXCLUDED.contact_source
				WHEN support_cases.contact_source IS NULL AND (EXCLUDED.user_email IS NOT NULL OR EXCLUDED.user_name IS NOT NULL)
					THEN EXCLUDED.contact_source ELSE support_cases.contact_source END,
			contact_observed_at = CASE
				WHEN $18 IS NOT NULL AND (EXCLUDED.user_email IS NOT NULL OR EXCLUDED.user_name IS NOT NULL)
					AND $18 >= COALESCE(support_cases.contact_observed_at, '-infinity') THEN $18
				ELSE support_cases.contact_observed_at END,
			logto_sub    = COALESCE(support_cases.logto_sub, EXCLUDED.logto_sub),
			account_source = CASE
				WHEN support_cases.logto_sub IS NULL AND EXCLUDED.logto_sub IS NOT NULL THEN EXCLUDED.account_source
				WHEN support_cases.logto_sub = EXCLUDED.logto_sub AND support_cases.account_source IS NULL
					AND EXCLUDED.account_source = 'authenticated' THEN EXCLUDED.account_source
				ELSE support_cases.account_source END,
			subject      = CASE WHEN EXCLUDED.subject <> '' THEN EXCLUDED.subject ELSE support_cases.subject END,
			category     = COALESCE(support_cases.category, EXCLUDED.category),
			priority     = COALESCE(support_cases.priority, EXCLUDED.priority),
			status       = CASE WHEN NULLIF($7,'') IS NOT NULL AND ($15 IS NULL
				OR $15 >= COALESCE(support_cases.status_observed_at, support_cases.closed_at, '-infinity'))
				THEN COALESCE(NULLIF($7,''), support_cases.status) ELSE support_cases.status END,
			summary      = COALESCE(support_cases.summary, EXCLUDED.summary),
			app_version  = COALESCE(support_cases.app_version, EXCLUDED.app_version),
			os           = COALESCE(support_cases.os, EXCLUDED.os),
			tier_at_open = COALESCE(support_cases.tier_at_open, EXCLUDED.tier_at_open),
			opened_at    = LEAST(support_cases.opened_at, EXCLUDED.opened_at),
			updated_at   = GREATEST(support_cases.updated_at, EXCLUDED.updated_at),
			closed_at    = CASE WHEN NULLIF($7,'') IS NOT NULL AND ($15 IS NULL
				OR $15 >= COALESCE(support_cases.status_observed_at, support_cases.closed_at, '-infinity'))
				THEN EXCLUDED.closed_at ELSE support_cases.closed_at END,
			status_observed_at = CASE WHEN $15 IS NOT NULL
				AND $15 >= COALESCE(support_cases.status_observed_at, support_cases.closed_at, '-infinity')
				THEN $15 ELSE support_cases.status_observed_at END
	`
	_, err := platform.DBPool.Exec(ctx, q,
		sc.TicketNumber, sc.UserEmail, sc.LogtoSub, sc.Subject, sc.Category,
		strings.ToLower(sc.Priority), sc.Status, sc.Summary, sc.AppVersion, sc.OS,
		sc.TierAtOpen, opened, updated, sc.ClosedAt, statusObserved,
		sc.UserName, sc.ContactSource, contactObserved, sc.AccountSource)
	if err != nil {
		return fmt.Errorf("upsertSupportCase %s: %w", sc.TicketNumber, err)
	}
	return nil
}

// applyTriageToCase overwrites the triage-owned fields on a case. The
// AI's latest read of a ticket beats both the user's pick and the osTicket
// topic, which is why this is not routed through the fill-only upsert.
func applyTriageToCase(ctx context.Context, ticketNumber string, t *TriageResult) {
	if platform.DBPool == nil || t == nil {
		return
	}
	const q = `
		UPDATE support_cases SET
			category   = COALESCE(NULLIF($2,''), category),
			priority   = COALESCE(NULLIF($3,''), priority),
			summary    = COALESCE(NULLIF($4,''), summary),
			updated_at = GREATEST(updated_at, now())
		WHERE ticket_number = $1
	`
	if _, err := platform.DBPool.Exec(ctx, q, ticketNumber, t.Category, strings.ToLower(t.Priority), t.Summary); err != nil {
		log.Printf("[Cases] applyTriageToCase %s: %v", ticketNumber, err)
	}
}

// recordSupportMessage appends one event to a case's timeline. Idempotent
// through the two partial unique indexes (osticket_entry_id, and
// ai_draft_id+kind): a second write of the same event is a no-op. Creates
// a bare case row first so a message for a ticket this API never saw
// created (IMAP-only tickets, legacy drafts) still lands.
func recordSupportMessage(ctx context.Context, m SupportMessage) error {
	if platform.DBPool == nil {
		return fmt.Errorf("DB not initialized")
	}
	if m.BodyText == "" {
		m.BodyText = strings.TrimSpace(htmlToPlain(m.BodyHTML))
	}
	var created *time.Time
	if !m.CreatedAt.IsZero() {
		created = &m.CreatedAt
	}
	if _, err := platform.DBPool.Exec(ctx,
		`INSERT INTO support_cases (ticket_number) VALUES ($1) ON CONFLICT DO NOTHING`, m.TicketNumber); err != nil {
		return fmt.Errorf("recordSupportMessage case %s: %w", m.TicketNumber, err)
	}
	const q = `
		INSERT INTO support_messages
			(ticket_number, kind, body_html, body_text, ai_draft_id, osticket_entry_id, created_at)
		VALUES ($1, $2, NULLIF($3,''), $4, NULLIF($5,0), NULLIF($6,0), COALESCE($7, now()))
		ON CONFLICT DO NOTHING
	`
	tag, err := platform.DBPool.Exec(ctx, q, m.TicketNumber, m.Kind, m.BodyHTML, m.BodyText,
		m.AIDraftID, m.OSTicketEntryID, created)
	if err != nil {
		return fmt.Errorf("recordSupportMessage %s/%s: %w", m.TicketNumber, m.Kind, err)
	}
	if tag.RowsAffected() > 0 {
		_, _ = platform.DBPool.Exec(ctx,
			`UPDATE support_cases SET updated_at = GREATEST(updated_at, COALESCE($2, now())) WHERE ticket_number = $1`,
			m.TicketNumber, created)
	}
	return nil
}

// setCaseStatus flips a case open/closed. Used by the send path when the
// approved reply also closes the ticket in osTicket.
func setCaseStatus(ctx context.Context, ticketNumber, status string) {
	if platform.DBPool == nil {
		return
	}
	const q = `
		UPDATE support_cases SET
			status     = $2,
			closed_at  = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END,
			status_observed_at = now(),
			updated_at = now()
		WHERE ticket_number = $1
	`
	if _, err := platform.DBPool.Exec(ctx, q, ticketNumber, status); err != nil {
		log.Printf("[Cases] setCaseStatus %s=%s: %v", ticketNumber, status, err)
	}
}

// caseFieldsFromDiagnostics pulls app version and OS out of the desktop's
// collect_diagnostics blob (`app.version`, `system.osName`, falling back
// to `app.platform`). Only these two leave the blob; the rest stays in the
// osTicket thread where it always was.
func caseFieldsFromDiagnostics(diag map[string]interface{}) (appVersion, osName string) {
	get := func(section, key string) string {
		s, _ := diag[section].(map[string]interface{})
		v, _ := s[key].(string)
		return strings.TrimSpace(v)
	}
	appVersion = get("app", "version")
	osName = get("system", "osName")
	if osName == "" {
		osName = get("app", "platform")
	}
	return appVersion, osName
}

// FetchRecentTicketSummaries returns the last 50 cases, newest first, as
// the dupe-detection context for triage. Reads support_cases; this
// replaced the Redis sliding window, which only ever held what this
// process had pushed and forgot everything on a Redis flush.
func FetchRecentTicketSummaries(ctx context.Context) []RecentTicketSummary {
	if platform.DBPool == nil {
		return nil
	}
	const q = `
		SELECT ticket_number, COALESCE(category, ''), COALESCE(summary, subject), opened_at
		FROM support_cases
		ORDER BY opened_at DESC
		LIMIT 50
	`
	rows, err := platform.DBPool.Query(ctx, q)
	if err != nil {
		log.Printf("[Cases] FetchRecentTicketSummaries: %v", err)
		return nil
	}
	defer rows.Close()
	var out []RecentTicketSummary
	for rows.Next() {
		var s RecentTicketSummary
		var opened time.Time
		if err := rows.Scan(&s.TicketNumber, &s.Category, &s.Summary, &opened); err != nil {
			continue
		}
		s.CreatedAt = opened.UTC().Format(time.RFC3339)
		out = append(out, s)
	}
	return out
}

// SimilarCase is one past ticket we actually answered: what the user wrote
// and what went out. Used as reference material in the drafting prompt
// (REL-244) — never as text to copy.
type SimilarCase struct {
	TicketNumber string
	Subject      string
	UserWrote    string
	WeSent       string
}

// FetchSimilarCases returns the best-matching past cases that we replied to,
// ranked by the same full-text search HandleSearchSupportCases exposes. The
// reply is the SENT body, so a draft the partner edited before sending shows
// up as the partner's words. Cases with no sent reply are skipped: an
// unanswered ticket is not a precedent.
func FetchSimilarCases(ctx context.Context, query, excludeTicket string, limit int) []SimilarCase {
	query = strings.TrimSpace(query)
	if platform.DBPool == nil || query == "" {
		return nil
	}
	if limit <= 0 || limit > 10 {
		limit = 3
	}
	const sql = `
		WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
		SELECT c.ticket_number, c.subject,
			COALESCE((SELECT m.body_text FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.kind = 'user'
				ORDER BY m.created_at, m.id LIMIT 1), ''),
			COALESCE((SELECT m.body_text FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.kind = 'sent'
				ORDER BY m.created_at DESC, m.id DESC LIMIT 1), '')
		FROM support_cases c, q
		WHERE c.ticket_number <> $2
		  AND EXISTS (SELECT 1 FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.kind = 'sent')
		  AND (c.search @@ q.tsq OR EXISTS (SELECT 1 FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.search @@ q.tsq))
		ORDER BY ts_rank(c.search, q.tsq) + COALESCE((
			SELECT max(ts_rank(m.search, q.tsq)) FROM support_messages m
			WHERE m.ticket_number = c.ticket_number), 0) DESC,
			c.updated_at DESC
		LIMIT $3
	`
	rows, err := platform.DBPool.Query(ctx, sql, query, excludeTicket, limit)
	if err != nil {
		log.Printf("[Cases] FetchSimilarCases: %v", err)
		return nil
	}
	defer rows.Close()
	var out []SimilarCase
	for rows.Next() {
		var s SimilarCase
		if err := rows.Scan(&s.TicketNumber, &s.Subject, &s.UserWrote, &s.WeSent); err != nil {
			continue
		}
		out = append(out, s)
	}
	return out
}

// FetchCaseThread returns the conversation on one ticket, oldest first:
// what the user wrote and what we sent. Drafts that were never sent and
// internal notes are left out — the follow-up prompt needs what the user
// has actually read.
func FetchCaseThread(ctx context.Context, ticketNumber string) []SupportMessage {
	if platform.DBPool == nil || ticketNumber == "" {
		return nil
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT kind, body_text, created_at
		FROM support_messages
		WHERE ticket_number = $1 AND kind IN ('user', 'sent')
		ORDER BY created_at, id`, ticketNumber)
	if err != nil {
		log.Printf("[Cases] FetchCaseThread %s: %v", ticketNumber, err)
		return nil
	}
	defer rows.Close()
	var out []SupportMessage
	for rows.Next() {
		m := SupportMessage{TicketNumber: ticketNumber}
		if err := rows.Scan(&m.Kind, &m.BodyText, &m.CreatedAt); err != nil {
			continue
		}
		out = append(out, m)
	}
	return out
}

// SearchSupportCases is Postgres full-text search over cases and their
// messages. An empty q lists by recency; otherwise results are ranked by
// the best match across subject/summary and any message body.
func SearchSupportCases(ctx context.Context, q, category, status string, limit int) ([]SupportCase, error) {
	if platform.DBPool == nil {
		return nil, fmt.Errorf("DB not initialized")
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	const sql = `
		WITH query AS (SELECT websearch_to_tsquery('english', $1) AS tsq)
		SELECT c.ticket_number, c.subject, COALESCE(c.category,''), COALESCE(c.priority,''), c.status,
			   COALESCE(c.summary,''), COALESCE(c.app_version,''), COALESCE(c.os,''),
			   COALESCE(c.tier_at_open,''), COALESCE(c.linear_issue_key,''),
			   COALESCE(c.discord_thread_id,''), c.opened_at, c.updated_at, c.closed_at
		FROM support_cases c, query
		WHERE ($2 = '' OR c.category = $2)
		  AND ($3 = '' OR c.status = $3)
		  AND ($1 = '' OR c.search @@ query.tsq OR EXISTS (
				SELECT 1 FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.search @@ query.tsq))
		ORDER BY
			CASE WHEN $1 = '' THEN 0 ELSE
				ts_rank(c.search, query.tsq) + COALESCE((
					SELECT max(ts_rank(m.search, query.tsq)) FROM support_messages m
					WHERE m.ticket_number = c.ticket_number), 0)
			END DESC,
			c.updated_at DESC
		LIMIT $4
	`
	rows, err := platform.DBPool.Query(ctx, sql, strings.TrimSpace(q), category, status, limit)
	if err != nil {
		return nil, fmt.Errorf("SearchSupportCases: %w", err)
	}
	defer rows.Close()
	out := []SupportCase{}
	for rows.Next() {
		var c SupportCase
		if err := rows.Scan(&c.TicketNumber, &c.Subject, &c.Category, &c.Priority, &c.Status,
			&c.Summary, &c.AppVersion, &c.OS, &c.TierAtOpen, &c.LinearIssueKey,
			&c.DiscordThreadID, &c.OpenedAt, &c.UpdatedAt, &c.ClosedAt); err != nil {
			return nil, fmt.Errorf("SearchSupportCases scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// HandleSearchSupportCases serves GET /internal/support/cases?q=&category=&status=&limit=.
// Server-to-server only: it is gated by the same shared secret the
// osTicket webhook uses (X-Scrollr-Webhook-Secret), which is the trust
// domain this data belongs to. Bodies are not returned — cases only.
func HandleSearchSupportCases(c *fiber.Ctx) error {
	expected := os.Getenv("SCROLLR_WEBHOOK_SECRET")
	provided := c.Get("X-Scrollr-Webhook-Secret")
	if expected == "" || provided == "" ||
		subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "error", Error: "unauthorized",
		})
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cases, err := SearchSupportCases(ctx, c.Query("q"), c.Query("category"), c.Query("status"), limit)
	if err != nil {
		log.Printf("[Cases] search: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "search failed",
		})
	}
	return c.JSON(fiber.Map{"count": len(cases), "cases": cases})
}
