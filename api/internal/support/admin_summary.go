package support

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Support workload for the Overview and the Analytics › Support view
// =============================================================================
//
// The three buckets are the queue's own classification (queueState.group),
// computed over the WHOLE table rather than the page's 500-row ceiling. Every
// ticket lands in exactly one bucket; paying customers are an overlay on top,
// never a fourth bucket. Trends use only retained timestamps: opened_at,
// closed_at and message times. What they cannot support is said, not
// estimated silently. (SCROLLR-210)

var summaryNow = time.Now

// BucketCount is one status bucket with its paying-customer overlay.
type BucketCount struct {
	Total  int `json:"total"`
	Paying int `json:"paying"`
}

type SupportSummaryResponse struct {
	GeneratedAt string           `json:"generated_at"`
	Period      platform.Window  `json:"period"`
	Previous    *platform.Window `json:"previous"`

	// Current status, whole queue.
	NeedsAttention     BucketCount `json:"needs_attention"`
	WaitingOnCustomer  BucketCount `json:"waiting_on_customer"`
	Completed          BucketCount `json:"completed"`
	CompletedClosed    int         `json:"completed_closed"`
	CompletedDismissed int         `json:"completed_dismissed"`
	Total              BucketCount `json:"total"`
	// OldestNeedsAttention is the oldest customer message still waiting.
	OldestNeedsAttention platform.Measured `json:"oldest_needs_attention_hours"`
	OldestTicket         string            `json:"oldest_ticket,omitempty"`
	AutoSend             AutoSendState     `json:"autosend"`
	PayingNote           string            `json:"paying_note"`
	Definitions          map[string]string `json:"definitions"`

	// Trends for the selected window.
	Created        platform.Metric   `json:"created"`
	CompletedIn    platform.Metric   `json:"completed_in_period"`
	CreatedCurve   []platform.Bucket `json:"created_curve"`
	CompletedCurve []platform.Bucket `json:"completed_curve"`
	BacklogCurve   []platform.Bucket `json:"backlog_curve"`
	CurveStep      string            `json:"curve_step"`
	// Response and completion times, for tickets in the window that have
	// the timestamps to support them. Hours.
	FirstResponseMedianHours platform.Metric `json:"first_response_median_hours"`
	CompletionMedianHours    platform.Metric `json:"completion_median_hours"`
	// PayingCreated is how many of the window's new tickets came from a
	// verified paying account.
	PayingCreated int               `json:"paying_created"`
	Coverage      platform.Coverage `json:"coverage"`
	HistoryNote   string            `json:"history_note"`
}

// HandleAdminSupportSummary - GET /admin/support/summary?period=
func HandleAdminSupportSummary(c *fiber.Ctx) error {
	if platform.DBPool == nil {
		return adminSupportError(c, "The support database is not reachable from this API instance.")
	}
	now := summaryNow().UTC()
	period, err := platform.ParsePeriod(c.Query("period"), now)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := loadSupportSummary(ctx, period, now)
	if err != nil {
		log.Printf("[AdminSupport] summary: %v", err)
		return adminSupportError(c, "Could not read the support summary.")
	}
	return c.JSON(out)
}

func loadSupportSummary(ctx context.Context, period platform.Period, now time.Time) (SupportSummaryResponse, error) {
	out := SupportSummaryResponse{
		GeneratedAt: now.Format(time.RFC3339), Period: period.Window(),
		OldestNeedsAttention: platform.Unmeasured("Nothing is waiting on a person."),
		Definitions: map[string]string{
			"needs_attention":     "New requests, customer replies nobody has answered, pending or failed drafts: work for a person or the bot.",
			"waiting_on_customer": "A reply or a question went out and nothing newer has come back.",
			"completed":           "Closed in osTicket, or dismissed (a draft skipped as needing no reply). Both are shown separately in the queue.",
			"paying":              "Overlay, not a bucket: tickets from a verified signed-in account with a current paid plan (including lifetime). Contacts matched only by email are unknown and never assumed paying.",
		},
		CreatedCurve: []platform.Bucket{}, CompletedCurve: []platform.Bucket{}, BacklogCurve: []platform.Bucket{},
		HistoryNote: "Trends use retained timestamps only: opened, closed and message times. Reopenings, past bucket membership and backfilled close dates (which carry the osTicket sync time) are not reconstructable, so the backlog line is an estimate.",
	}
	if prev, ok := period.Previous(); ok {
		w := prev.Window()
		out.Previous = &w
	}

	out.AutoSend = autoSendState(ctx)
	rows, _, err := loadQueueRows(ctx, 0, out.AutoSend, now)
	if err != nil {
		return out, err
	}
	var oldest *time.Time
	for _, r := range rows {
		bucket := &out.NeedsAttention
		switch r.Group {
		case queueWaiting:
			bucket = &out.WaitingOnCustomer
		case queueHandled:
			bucket = &out.Completed
			if r.Status == "closed" {
				out.CompletedClosed++
			} else {
				out.CompletedDismissed++
			}
		}
		bucket.Total++
		out.Total.Total++
		if r.Paying {
			bucket.Paying++
			out.Total.Paying++
		}
		if r.Group == queueNeedsYou && r.LastUserMessageAt != nil && (oldest == nil || r.LastUserMessageAt.Before(*oldest)) {
			oldest = r.LastUserMessageAt
			out.OldestTicket = r.TicketNumber
		}
	}
	if oldest != nil {
		out.OldestNeedsAttention = platform.Measured{Value: int(now.Sub(*oldest).Hours()), Available: true}
	} else if out.NeedsAttention.Total > 0 {
		// Backfilled cases and draft-only cases can need a person without
		// carrying a customer message to measure the wait from.
		out.OldestNeedsAttention = platform.Unmeasured(fmt.Sprintf("%d tickets need attention, but none has a customer message on record to measure the wait from.", out.NeedsAttention.Total))
	}
	accounts := queueAccounts(ctx)
	out.PayingNote = payingSectionNote(accounts, out.Total.Paying)
	if out.Total.Paying > 0 {
		out.PayingNote = ""
	}
	// ── Trends ────────────────────────────────────────────────────────────
	var coverageFrom *time.Time
	if err := platform.DBPool.QueryRow(ctx, `SELECT min(opened_at) FROM support_cases`).Scan(&coverageFrom); err != nil {
		return out, err
	}
	from := time.Time{}
	if coverageFrom != nil {
		from = coverageFrom.UTC()
	}
	out.Coverage = platform.CoverageFor(period, from, "Cases are retained since the support database was backfilled from osTicket; closed dates on backfilled cases carry the sync time, not the real close.")
	start := platform.EffectiveStart(period, from)
	end := period.End
	if start.IsZero() {
		return out, nil
	}

	countBetween := func(column string, s, e time.Time) (float64, error) {
		var n int
		err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM support_cases WHERE `+column+` >= $1 AND `+column+` < $2`, s, e).Scan(&n)
		return float64(n), err
	}
	created, err := countBetween("opened_at", start, end)
	if err != nil {
		return out, err
	}
	completed, err := countBetween("closed_at", start, end)
	if err != nil {
		return out, err
	}
	var prevCreated, prevCompleted float64
	if prev, ok := period.Previous(); ok {
		if prevCreated, err = countBetween("opened_at", prev.Start, prev.End); err != nil {
			return out, err
		}
		if prevCompleted, err = countBetween("closed_at", prev.Start, prev.End); err != nil {
			return out, err
		}
	}
	out.Created = platform.Metric{Value: created, Available: true, Comparison: platform.Compare(created, prevCreated, period, from)}
	out.CompletedIn = platform.Metric{Value: completed, Available: true, Comparison: platform.Compare(completed, prevCompleted, period, from),
		Note: "Tickets with a close date in the window. Dismissed drafts do not carry a close date and are not counted here."}

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FROM support_cases c
		  JOIN stripe_customers s ON s.logto_sub = c.logto_sub AND c.account_source = 'authenticated'
		 WHERE c.opened_at >= $1 AND c.opened_at < $2
		   AND `+billing.PayingWhere, start, end).Scan(&out.PayingCreated); err != nil {
		return out, err
	}

	step := platform.BucketStep(period, from)
	out.CurveStep = step.String()
	out.CreatedCurve = platform.Buckets(start, end, step)
	out.CompletedCurve = platform.Buckets(start, end, step)
	out.BacklogCurve = platform.Buckets(start, end, step)
	for _, curve := range []struct {
		column  string
		buckets []platform.Bucket
	}{{"opened_at", out.CreatedCurve}, {"closed_at", out.CompletedCurve}} {
		if len(curve.buckets) == 0 {
			continue
		}
		rows, err := platform.DBPool.Query(ctx, `
			SELECT floor(extract(epoch FROM (`+curve.column+` - $1)) / $3)::int, count(*)
			  FROM support_cases WHERE `+curve.column+` >= $1 AND `+curve.column+` < $2 GROUP BY 1`, start, end, step.Seconds())
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var idx, n int
			if err := rows.Scan(&idx, &n); err != nil {
				rows.Close()
				return out, err
			}
			if idx >= 0 && idx < len(curve.buckets) {
				curve.buckets[idx].Value = float64(n)
			}
		}
		rows.Close()
	}
	// Backlog at each bucket end: opened before it, not closed before it.
	// An estimate — reopenings and 'unknown' statuses cannot be placed.
	for i := range out.BacklogCurve {
		at, err := time.Parse(time.RFC3339, out.BacklogCurve[i].End)
		if err != nil {
			continue
		}
		var n int
		if err := platform.DBPool.QueryRow(ctx, `
			SELECT count(*) FROM support_cases
			 WHERE opened_at < $1 AND (closed_at IS NULL OR closed_at >= $1) AND status <> 'unknown'`, at).Scan(&n); err != nil {
			return out, err
		}
		out.BacklogCurve[i].Value = float64(n)
	}

	// Median first response: first 'sent' after the first 'user' message, for
	// tickets opened in the window that have both.
	firstResponse, err := medianHours(ctx, `
		SELECT extract(epoch FROM (s.first_sent - u.first_user)) / 3600
		  FROM support_cases c
		  JOIN LATERAL (SELECT min(created_at) AS first_user FROM support_messages m WHERE m.ticket_number = c.ticket_number AND m.kind = 'user') u ON true
		  JOIN LATERAL (SELECT min(created_at) AS first_sent FROM support_messages m WHERE m.ticket_number = c.ticket_number AND m.kind = 'sent' AND m.created_at >= u.first_user) s ON true
		 WHERE c.opened_at >= $1 AND c.opened_at < $2 AND u.first_user IS NOT NULL AND s.first_sent IS NOT NULL`, start, end)
	if err != nil {
		return out, err
	}
	out.FirstResponseMedianHours = firstResponse
	if !firstResponse.Available {
		out.FirstResponseMedianHours.Note = "No ticket opened in this window has both a customer message and a reply on record."
	} else {
		out.FirstResponseMedianHours.Note = "Median hours from the first customer message to the first reply, over tickets opened in the window that have both on record."
	}
	completion, err := medianHours(ctx, `
		SELECT extract(epoch FROM (closed_at - opened_at)) / 3600 FROM support_cases
		 WHERE closed_at >= $1 AND closed_at < $2 AND closed_at > opened_at`, start, end)
	if err != nil {
		return out, err
	}
	out.CompletionMedianHours = completion
	if !completion.Available {
		out.CompletionMedianHours.Note = "No ticket was closed in this window."
	} else {
		out.CompletionMedianHours.Note = "Median hours from opened to closed, over tickets closed in the window. Backfilled cases carry the osTicket sync time as their close."
	}
	return out, nil
}

// medianHours runs a query returning one float column and reports its
// median as a Metric with the sample count in the note.
func medianHours(ctx context.Context, query string, args ...any) (platform.Metric, error) {
	rows, err := platform.DBPool.Query(ctx, query, args...)
	if err != nil {
		return platform.Metric{}, err
	}
	defer rows.Close()
	var values []float64
	for rows.Next() {
		var v float64
		if err := rows.Scan(&v); err != nil {
			return platform.Metric{}, err
		}
		values = append(values, v)
	}
	if err := rows.Err(); err != nil {
		return platform.Metric{}, err
	}
	if len(values) == 0 {
		return platform.Metric{Comparison: platform.Comparison{Note: "No samples."}}, nil
	}
	sort.Float64s(values)
	mid := len(values) / 2
	median := values[mid]
	if len(values)%2 == 0 {
		median = (values[mid-1] + values[mid]) / 2
	}
	return platform.Metric{Value: math.Round(median*10) / 10, Available: true,
		Comparison: platform.Comparison{Note: "n=" + strconv.Itoa(len(values))}}, nil
}
