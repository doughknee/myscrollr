package admin

import (
	"context"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// Desktop presence for the staff console (SCROLLR-210).
//
// Two endpoints: the live strip, read straight from Redis, and the historical
// desktop-usage report, read from the hourly aggregates the check-in handler
// writes. Definitions are in docs/analytics/ADMIN_DASHBOARD.md and are
// repeated in the JSON so the page never has to paraphrase them.

var desktopReportNow = time.Now

const (
	presenceDefinition = "Active means the desktop app is running and reported within the last 90 seconds. It is presence, not attention. One account on several computers is one user; screens add across computers."
	presenceCoverage   = "Only desktop builds with the presence reporter (1.6.7 and later) appear here. Older builds still count in the legacy recently-seen figure."
	tickerDefinition   = "With ticker(s) means at least one ticker window is shown on a computer whose session is not locked and whose display is not asleep. Idle input never disqualifies: Scrollr is watched, not typed at."
)

// ── Live ─────────────────────────────────────────────────────────────────────

type PresenceLiveResponse struct {
	GeneratedAt   string `json:"generated_at"`
	Available     bool   `json:"available"`
	Note          string `json:"note,omitempty"`
	Headline      string `json:"headline"`
	StaffExcluded bool   `json:"staff_excluded"`
	accounts.PresenceHeadline
	CheckInSeconds int `json:"check_in_seconds"`
	ExpirySeconds  int `json:"expiry_seconds"`
	// LegacyRecentPresence is the 15-minute PostHog presence window every
	// build since 1.6.6 reports into. It counts accounts, not sessions, and
	// says nothing about tickers or screens.
	LegacyRecentPresence Measured `json:"legacy_recent_presence"`
	Definition           string   `json:"definition"`
	TickerDefinition     string   `json:"ticker_definition"`
	Coverage             string   `json:"coverage"`
}

// HandleGetPresenceLive - GET /admin/presence/live
func HandleGetPresenceLive(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	now := desktopReportNow().UTC()
	out := PresenceLiveResponse{
		GeneratedAt: now.Format(time.RFC3339), StaffExcluded: ExcludeStaff(ctx),
		CheckInSeconds: 30, ExpirySeconds: int(accounts.PresenceExpiry.Seconds()),
		Definition: presenceDefinition, TickerDefinition: tickerDefinition, Coverage: presenceCoverage,
		LegacyRecentPresence: platform.Unmeasured("Redis is unavailable."),
	}
	sessions, err := accounts.LivePresenceSessions(ctx, now)
	if err != nil {
		log.Printf("[Admin] presence live: %v", err)
		out.Note = "Live presence is unavailable right now (Redis could not be read)."
		out.Headline = "unavailable"
		return c.JSON(out)
	}
	out.PresenceHeadline = accounts.SummarizePresence(sessions, out.StaffExcluded)
	out.Available = true
	out.Headline = presenceHeadline(out.ActiveUsers, out.TickerUsers, out.Screens)
	if platform.Rdb != nil {
		cutoff := now.Add(-15 * time.Minute).Unix()
		if count, err := platform.Rdb.ZCount(ctx, "posthog:recent-presence", strconv.FormatInt(cutoff, 10), "+inf").Result(); err == nil {
			out.LegacyRecentPresence = platform.Measured{Value: int(count), Available: true,
				Note: "Customer accounts seen by any desktop build in the last 15 minutes (legacy PostHog presence). Staff are never in this figure."}
		}
	}
	return c.JSON(out)
}

// presenceHeadline is the exact strip format the Overview shows.
func presenceHeadline(users, tickerUsers, screens int) string {
	return fmt.Sprintf("%d active users · %d with ticker(s) · %d screens", users, tickerUsers, screens)
}

// ── Historical ───────────────────────────────────────────────────────────────

type FilterOption struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

type DesktopFilters struct {
	OS      []FilterOption `json:"os"`
	Version []FilterOption `json:"version"`
	Plan    []FilterOption `json:"plan"`
	Applied struct {
		OS      string `json:"os,omitempty"`
		Version string `json:"version,omitempty"`
		Plan    string `json:"plan,omitempty"`
	} `json:"applied"`
	Note string `json:"note,omitempty"`
}

type PeakConcurrency struct {
	Users             int    `json:"users"`
	TickerUsers       int    `json:"ticker_users"`
	Screens           int    `json:"screens"`
	At                string `json:"at,omitempty"`
	ResolutionSeconds int    `json:"resolution_seconds"`
	Available         bool   `json:"available"`
	Note              string `json:"note,omitempty"`
}

type ScreensBucket struct {
	Screens  string `json:"screens"`
	Sessions int    `json:"sessions"`
	Users    int    `json:"users"`
}

type PresenceRetention struct {
	Definition string          `json:"definition"`
	D1         RetentionMetric `json:"d1"`
	D7         RetentionMetric `json:"d7"`
	D30        RetentionMetric `json:"d30"`
}

type WidgetRow struct {
	WidgetType  string     `json:"widget_type"`
	Name        string     `json:"name"`
	Category    string     `json:"category"`
	Users       int        `json:"users"`
	Share       float64    `json:"share"`
	UserHours   float64    `json:"user_hours"`
	ScreenHours float64    `json:"screen_hours"`
	RepeatUsers *int       `json:"repeat_users"`
	Added       int        `json:"added"`
	Removed     int        `json:"removed"`
	Configured  int        `json:"configured"`
	Enabled     int        `json:"enabled"`
	Comparison  Comparison `json:"comparison"`
}

type CategoryRow struct {
	Category    string  `json:"category"`
	Users       int     `json:"users"`
	Share       float64 `json:"share"`
	UserHours   float64 `json:"user_hours"`
	ScreenHours float64 `json:"screen_hours"`
	Widgets     int     `json:"widgets"`
}

type WidgetsReport struct {
	MeasuredTickerUsers int           `json:"measured_ticker_users"`
	Rows                []WidgetRow   `json:"rows"`
	Categories          []CategoryRow `json:"categories"`
	RepeatNote          string        `json:"repeat_note"`
	// ChangesAvailable is false under an OS or version filter: add/remove
	// facts carry neither, so the added/removed columns are not filtered
	// figures and are not shown.
	ChangesAvailable bool   `json:"changes_available"`
	ChangesNote      string `json:"changes_note"`
	Definition       string `json:"definition"`
}

type DesktopUsageResponse struct {
	GeneratedAt   string         `json:"generated_at"`
	Period        Window         `json:"period"`
	Previous      *Window        `json:"previous"`
	StaffExcluded bool           `json:"staff_excluded"`
	Coverage      Coverage       `json:"coverage"`
	Filters       DesktopFilters `json:"filters"`

	UniqueUsers     Metric            `json:"unique_users"`
	UserHours       Metric            `json:"user_hours"`
	TickerUserHours Metric            `json:"ticker_user_hours"`
	ScreenHours     Metric            `json:"screen_hours"`
	Peak            PeakConcurrency   `json:"peak"`
	ScreensPerUser  []ScreensBucket   `json:"screens_per_user"`
	UsersCurve      []Bucket          `json:"users_curve"`
	CurveStep       string            `json:"curve_step"`
	Retention       PresenceRetention `json:"retention"`
	Widgets         WidgetsReport     `json:"widgets"`
	// Legacy is the 30-second ticker-visibility series that predates
	// presence. It is a different measurement and is never merged.
	Legacy     *ProductAnalyticsResponse `json:"legacy"`
	LegacyNote string                    `json:"legacy_note"`
	Definition string                    `json:"definition"`
}

// desktopFilter is the WHERE-clause state for one request.
type desktopFilter struct {
	excludeStaff bool
	os, version  string
	plan         string
}

// where builds the shared predicate for a table aliased t. plan joins the
// CURRENT stripe row; 'free' matches accounts with no paid row.
func (f desktopFilter) where(start, end time.Time, args *[]any, withSession bool) string {
	*args = append(*args, start, end)
	conds := []string{fmt.Sprintf("t.hour >= $%d AND t.hour < $%d", len(*args)-1, len(*args))}
	if f.excludeStaff {
		conds = append(conds, "t.internal = false")
	}
	if withSession {
		if f.os != "" {
			*args = append(*args, f.os)
			conds = append(conds, fmt.Sprintf("t.os = $%d", len(*args)))
		}
		if f.version != "" {
			*args = append(*args, f.version)
			conds = append(conds, fmt.Sprintf("t.app_version = $%d", len(*args)))
		}
	}
	if f.plan != "" {
		*args = append(*args, f.plan)
		conds = append(conds, fmt.Sprintf(
			`coalesce((SELECT CASE WHEN s.lifetime THEN 'lifetime' ELSE s.plan END FROM stripe_customers s WHERE s.logto_sub = t.logto_sub), 'free') = $%d`,
			len(*args)))
	}
	return strings.Join(conds, " AND ")
}

// perComputer is true when an OS or version filter is on: those live on the
// session rows, so account-level dedup is not available and hours are per
// computer. The response says so.
func (f desktopFilter) perComputer() bool { return f.os != "" || f.version != "" }

// HandleGetDesktopUsage - GET /admin/desktop-usage?period=&os=&version=&plan=
func HandleGetDesktopUsage(c *fiber.Ctx) error {
	now := desktopReportNow().UTC()
	period, err := ParsePeriod(c.Query("period"), now)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	f := desktopFilter{excludeStaff: ExcludeStaff(ctx), os: c.Query("os"), version: c.Query("version"), plan: c.Query("plan")}
	if len(f.os) > 16 || len(f.version) > 32 || len(f.plan) > 32 {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "filter values are too long"})
	}
	out, err := loadDesktopUsage(ctx, period, f, now)
	if err != nil {
		log.Printf("[Admin] desktop usage: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Status: "error", Error: "Desktop usage is unavailable."})
	}
	return c.JSON(out)
}

func loadDesktopUsage(ctx context.Context, period Period, f desktopFilter, now time.Time) (DesktopUsageResponse, error) {
	out := DesktopUsageResponse{
		GeneratedAt: now.Format(time.RFC3339), Period: period.Window(), StaffExcluded: f.excludeStaff,
		Definition:     presenceDefinition + " " + tickerDefinition,
		LegacyNote:     "Legacy series: an account counted on a UTC day once a ticker was visible with an enabled widget for 30 continuous seconds. It is a different measurement from presence and is shown separately.",
		ScreensPerUser: []ScreensBucket{}, UsersCurve: []Bucket{},
	}
	if prev, ok := period.Previous(); ok {
		w := prev.Window()
		out.Previous = &w
	}
	out.Filters.Applied.OS, out.Filters.Applied.Version, out.Filters.Applied.Plan = f.os, f.version, f.plan
	if f.perComputer() {
		out.Filters.Note = "With an OS or version filter, hours and users are per computer: a person running two builds is counted under each."
	}

	// Coverage: when did presence start being written at all.
	var coverageFrom *time.Time
	if err := platform.DBPool.QueryRow(ctx, `SELECT min(hour) FROM presence_account_hourly`).Scan(&coverageFrom); err != nil {
		return out, err
	}
	from := time.Time{}
	if coverageFrom != nil {
		from = coverageFrom.UTC()
	}
	out.Coverage = CoverageFor(period, from, presenceCoverage)
	if coverageFrom == nil {
		out.Coverage.Note = "No desktop build has reported presence yet. " + presenceCoverage
	}
	start := EffectiveStart(period, from)
	end := period.End
	if start.IsZero() {
		start = end // nothing to read; every query below is empty
	}

	// Filter options: what the window actually holds.
	if err := loadDesktopFilterOptions(ctx, &out.Filters, f, start, end); err != nil {
		return out, err
	}

	// Headline metrics for this window and the previous one.
	cur, err := desktopTotals(ctx, f, start, end)
	if err != nil {
		return out, err
	}
	var prevTotals desktopTotalsRow
	if prev, ok := period.Previous(); ok {
		prevTotals, err = desktopTotals(ctx, f, prev.Start, prev.End)
		if err != nil {
			return out, err
		}
	}
	metric := func(v, pv float64) Metric {
		return Metric{Value: v, Available: coverageFrom != nil, Comparison: Compare(v, pv, period, from)}
	}
	out.UniqueUsers = metric(float64(cur.users), float64(prevTotals.users))
	out.UserHours = metric(hours(cur.running), hours(prevTotals.running))
	out.TickerUserHours = metric(hours(cur.ticker), hours(prevTotals.ticker))
	out.ScreenHours = metric(hours(cur.screen), hours(prevTotals.screen))
	if coverageFrom == nil {
		note := "Not measured yet."
		out.UniqueUsers.Note, out.UserHours.Note, out.TickerUserHours.Note, out.ScreenHours.Note = note, note, note, note
	}

	// Peak concurrency from the minute samples. The sampler always counts
	// customers only, so the toggle cannot bring staff back into this one
	// figure; the note says so whenever the rest of the report includes them.
	out.Peak = PeakConcurrency{ResolutionSeconds: 60, Note: "1-minute samples of the live index; a burst shorter than a minute can fall between samples."}
	if !f.excludeStaff {
		out.Peak.Note += " Samples are taken without staff, so this peak is customers only whatever the setting."
	}
	if !f.perComputer() && f.plan == "" {
		var users, tickerUsers, screens *int
		var at *time.Time
		if err := platform.DBPool.QueryRow(ctx, `
			SELECT max(users), max(ticker_users), max(screens),
			       (SELECT minute FROM presence_concurrency_minute
			         WHERE minute >= $1 AND minute < $2 ORDER BY users DESC, minute DESC LIMIT 1)
			  FROM presence_concurrency_minute WHERE minute >= $1 AND minute < $2`, start, end).
			Scan(&users, &tickerUsers, &screens, &at); err != nil {
			return out, err
		}
		if users != nil {
			out.Peak.Users, out.Peak.TickerUsers, out.Peak.Screens, out.Peak.Available = *users, *tickerUsers, *screens, true
			if at != nil {
				out.Peak.At = at.UTC().Format(time.RFC3339)
			}
		} else {
			out.Peak.Note = "No samples in this window."
		}
	} else {
		out.Peak.Note = "Peak concurrency is sampled for all customers together; it cannot be filtered by plan, OS or version."
	}

	// Single vs multi-screen: sessions by their busiest hour, users by the
	// most screens any one of their sessions showed.
	if err := loadScreensDistribution(ctx, &out, f, start, end); err != nil {
		return out, err
	}

	// Users per bucket, never expanding the window.
	step := BucketStep(period, from)
	out.CurveStep = step.String()
	out.UsersCurve = Buckets(start, end, step)
	if len(out.UsersCurve) > 0 {
		if err := fillUsersCurve(ctx, out.UsersCurve, f, start, end, step); err != nil {
			return out, err
		}
	}

	if err := loadPresenceRetention(ctx, &out.Retention, f, now); err != nil {
		return out, err
	}
	if err := loadWidgetsReport(ctx, &out.Widgets, period, f, start, end, from); err != nil {
		return out, err
	}

	// Legacy series, for continuity. Its own fixed calendar windows.
	legacyDays := 7
	if period.Key == Period30d || period.Lifetime() {
		legacyDays = 30
	}
	legacy, err := loadProductAnalytics(ctx, legacyDays, now, f.excludeStaff)
	if err != nil {
		log.Printf("[Admin] legacy product analytics: %v", err)
	} else {
		out.Legacy = &legacy
	}
	return out, nil
}

func hours(seconds int64) float64 { return math.Round(float64(seconds)/36) / 100 }

type desktopTotalsRow struct {
	users                   int
	running, ticker, screen int64
}

func desktopTotals(ctx context.Context, f desktopFilter, start, end time.Time) (desktopTotalsRow, error) {
	var r desktopTotalsRow
	var args []any
	if f.perComputer() {
		where := f.where(start, end, &args, true)
		err := platform.DBPool.QueryRow(ctx, `
			SELECT count(DISTINCT t.logto_sub), coalesce(sum(t.running_seconds),0), coalesce(sum(t.ticker_seconds),0), coalesce(sum(t.screen_seconds),0)
			  FROM presence_session_hourly t WHERE `+where, args...).
			Scan(&r.users, &r.running, &r.ticker, &r.screen)
		return r, err
	}
	where := f.where(start, end, &args, false)
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT t.logto_sub), coalesce(sum(t.running_seconds),0), coalesce(sum(t.ticker_seconds),0)
		  FROM presence_account_hourly t WHERE `+where, args...).
		Scan(&r.users, &r.running, &r.ticker); err != nil {
		return r, err
	}
	args = nil
	where = f.where(start, end, &args, true)
	err := platform.DBPool.QueryRow(ctx, `
		SELECT coalesce(sum(t.screen_seconds),0) FROM presence_session_hourly t WHERE `+where, args...).
		Scan(&r.screen)
	return r, err
}

func loadDesktopFilterOptions(ctx context.Context, filters *DesktopFilters, f desktopFilter, start, end time.Time) error {
	filters.OS, filters.Version, filters.Plan = []FilterOption{}, []FilterOption{}, []FilterOption{}
	base := desktopFilter{excludeStaff: f.excludeStaff}
	for _, dim := range []struct {
		col  string
		into *[]FilterOption
	}{{"t.os", &filters.OS}, {"t.app_version", &filters.Version}} {
		var args []any
		where := base.where(start, end, &args, false)
		rows, err := platform.DBPool.Query(ctx, `
			SELECT `+dim.col+`, count(DISTINCT t.logto_sub) FROM presence_session_hourly t
			 WHERE `+where+` GROUP BY 1 ORDER BY 2 DESC, 1`, args...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var o FilterOption
			if err := rows.Scan(&o.Value, &o.Count); err != nil {
				rows.Close()
				return err
			}
			*dim.into = append(*dim.into, o)
		}
		rows.Close()
	}
	var args []any
	where := base.where(start, end, &args, false)
	rows, err := platform.DBPool.Query(ctx, `
		SELECT coalesce((SELECT CASE WHEN s.lifetime THEN 'lifetime' ELSE s.plan END FROM stripe_customers s WHERE s.logto_sub = t.logto_sub), 'free'),
		       count(DISTINCT t.logto_sub)
		  FROM presence_account_hourly t WHERE `+where+` GROUP BY 1 ORDER BY 2 DESC, 1`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var o FilterOption
		if err := rows.Scan(&o.Value, &o.Count); err != nil {
			return err
		}
		filters.Plan = append(filters.Plan, o)
	}
	return rows.Err()
}

func loadScreensDistribution(ctx context.Context, out *DesktopUsageResponse, f desktopFilter, start, end time.Time) error {
	var args []any
	where := f.where(start, end, &args, true)
	rows, err := platform.DBPool.Query(ctx, `
		SELECT t.logto_sub, t.session_id, max(t.max_shown_screens)
		  FROM presence_session_hourly t WHERE `+where+` GROUP BY 1, 2`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	sessions := map[string]int{"0": 0, "1": 0, "2+": 0}
	userMax := map[string]int{}
	for rows.Next() {
		var sub, session string
		var screens int
		if err := rows.Scan(&sub, &session, &screens); err != nil {
			return err
		}
		sessions[screensBucket(screens)]++
		if screens > userMax[sub] {
			userMax[sub] = screens
		}
	}
	users := map[string]int{"0": 0, "1": 0, "2+": 0}
	for _, n := range userMax {
		users[screensBucket(n)]++
	}
	for _, k := range []string{"0", "1", "2+"} {
		out.ScreensPerUser = append(out.ScreensPerUser, ScreensBucket{Screens: k, Sessions: sessions[k], Users: users[k]})
	}
	return rows.Err()
}

func screensBucket(n int) string {
	switch {
	case n <= 0:
		return "0"
	case n == 1:
		return "1"
	default:
		return "2+"
	}
}

func fillUsersCurve(ctx context.Context, buckets []Bucket, f desktopFilter, start, end time.Time, step time.Duration) error {
	table := "presence_account_hourly"
	withSession := false
	if f.perComputer() {
		table, withSession = "presence_session_hourly", true
	}
	var args []any
	where := f.where(start, end, &args, withSession)
	args = append(args, step.Seconds())
	rows, err := platform.DBPool.Query(ctx, `
		SELECT floor(extract(epoch FROM (t.hour - $1)) / $`+strconv.Itoa(len(args))+`)::int, count(DISTINCT t.logto_sub)
		  FROM `+table+` t WHERE `+where+` GROUP BY 1`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var idx, n int
		if err := rows.Scan(&idx, &n); err != nil {
			return err
		}
		if idx >= 0 && idx < len(buckets) {
			buckets[idx].Value = float64(n)
		}
	}
	return rows.Err()
}

// loadPresenceRetention: cohorts by first observed presence day, returning on
// exactly day N. A cohort is eligible only when its return day is a complete,
// retained day: yesterday or earlier, and inside the 90-day hourly history.
// The prune cuts at an hour boundary 90 days back, so the day it lands on can
// be half gone; the first day guaranteed whole is 89 days back.
func loadPresenceRetention(ctx context.Context, r *PresenceRetention, f desktopFilter, now time.Time) error {
	r.Definition = "Cohort = first day an account reported presence (not signup). Returned = reported presence on exactly that day + N. Immature cohorts are unavailable, not zero."
	today := now.Truncate(24 * time.Hour)
	oldest := today.AddDate(0, 0, -89)
	for _, m := range []struct {
		n    int
		into *RetentionMetric
	}{{1, &r.D1}, {7, &r.D7}, {30, &r.D30}} {
		m.into.Day = m.n
		staff := ""
		if f.excludeStaff {
			staff = " AND a.internal = false"
		}
		if err := platform.DBPool.QueryRow(ctx, `
			SELECT count(*),
			       count(*) FILTER (WHERE EXISTS (
			           SELECT 1 FROM presence_account_hourly h
			            WHERE h.logto_sub = a.logto_sub
			              AND h.hour >= ((a.first_seen_day + $1::int)::timestamp AT TIME ZONE 'UTC')
			              AND h.hour <  ((a.first_seen_day + $1::int + 1)::timestamp AT TIME ZONE 'UTC')))
			  FROM presence_accounts a
			 WHERE a.first_seen_day + $1::int <= $2::date - 1
			   AND a.first_seen_day + $1::int >= $3::date`+staff, m.n, today, oldest).
			Scan(&m.into.Eligible, &m.into.Returned); err != nil {
			return err
		}
		m.into.Available = m.into.Eligible > 0
		if m.into.Available {
			m.into.Rate = float64(m.into.Returned) / float64(m.into.Eligible)
		} else {
			m.into.Note = "No cohort is old enough to observe this exact return day yet."
		}
	}
	return nil
}

type widgetAgg struct {
	users       map[string]struct{}
	days        map[string]map[string]struct{} // sub -> days
	userSeconds int64
	screenSecs  int64
}

func loadWidgetsReport(ctx context.Context, w *WidgetsReport, period Period, f desktopFilter, start, end time.Time, coverageFrom time.Time) error {
	w.Rows, w.Categories = []WidgetRow{}, []CategoryRow{}
	w.Definition = "Displayed means the widget type was rendered on a shown ticker screen. A widget waiting its turn in rotation, or enabled with nothing to show, is not displayed."
	w.ChangesAvailable = !f.perComputer()
	w.ChangesNote = "Additions and removals are the real add/remove actions on catalog widgets for accounts with usage analytics on. Local utilities (clock, weather) are added in the app's own preferences and are not counted."
	if !w.ChangesAvailable {
		w.ChangesNote = "Additions and removals carry no OS or version, so they cannot be filtered by computer; clear the OS and version filters to see them."
	}
	w.RepeatNote = "Repeat users were displayed the widget on two or more UTC days; only offered for windows of a week or more."

	// Denominator: measured ticker users in the window.
	var args []any
	where := f.where(start, end, &args, f.perComputer())
	table := "presence_account_hourly"
	if f.perComputer() {
		table = "presence_session_hourly"
	}
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT t.logto_sub) FROM `+table+` t WHERE `+where+` AND t.ticker_seconds > 0`, args...).
		Scan(&w.MeasuredTickerUsers); err != nil {
		return err
	}

	aggs, err := widgetAggregates(ctx, f, start, end)
	if err != nil {
		return err
	}
	var prevUsers map[string]int
	if prev, ok := period.Previous(); ok {
		prevAggs, err := widgetAggregates(ctx, f, prev.Start, prev.End)
		if err != nil {
			return err
		}
		prevUsers = map[string]int{}
		for k, a := range prevAggs {
			prevUsers[k] = len(a.users)
		}
	}
	changes, err := widgetChanges(ctx, f, start, end)
	if err != nil {
		return err
	}
	configured, enabled, err := widgetConfigured(ctx, f)
	if err != nil {
		return err
	}

	offerRepeat := !period.Lifetime() && period.Length() >= 7*24*time.Hour || period.Lifetime()
	types := map[string]struct{}{}
	for k := range aggs {
		types[k] = struct{}{}
	}
	for k := range changes {
		types[k] = struct{}{}
	}
	for k := range configured {
		types[k] = struct{}{}
	}
	cats := map[string]*struct {
		users   map[string]struct{}
		userSec int64
		scrSec  int64
		widgets int
	}{}
	for wt := range types {
		def, ok := platform.WidgetByID(wt)
		if !ok {
			continue
		}
		row := WidgetRow{WidgetType: wt, Name: def.Name, Category: def.Category}
		if a, ok := aggs[wt]; ok {
			row.Users = len(a.users)
			row.UserHours = hours(a.userSeconds)
			row.ScreenHours = hours(a.screenSecs)
			if offerRepeat {
				n := 0
				for _, days := range a.days {
					if len(days) >= 2 {
						n++
					}
				}
				row.RepeatUsers = &n
			}
		}
		if w.MeasuredTickerUsers > 0 {
			row.Share = float64(row.Users) / float64(w.MeasuredTickerUsers)
		}
		row.Added, row.Removed = changes[wt].added, changes[wt].removed
		row.Configured, row.Enabled = configured[wt], enabled[wt]
		if prevUsers != nil {
			row.Comparison = Compare(float64(row.Users), float64(prevUsers[wt]), period, coverageFrom)
		} else {
			row.Comparison = Compare(0, 0, period, coverageFrom)
		}
		w.Rows = append(w.Rows, row)

		c := cats[def.Category]
		if c == nil {
			c = &struct {
				users   map[string]struct{}
				userSec int64
				scrSec  int64
				widgets int
			}{users: map[string]struct{}{}}
			cats[def.Category] = c
		}
		c.widgets++
		if a, ok := aggs[wt]; ok {
			for u := range a.users {
				c.users[u] = struct{}{}
			}
			c.userSec += a.userSeconds
			c.scrSec += a.screenSecs
		}
	}
	sort.Slice(w.Rows, func(i, j int) bool {
		if w.Rows[i].Users != w.Rows[j].Users {
			return w.Rows[i].Users > w.Rows[j].Users
		}
		if w.Rows[i].UserHours != w.Rows[j].UserHours {
			return w.Rows[i].UserHours > w.Rows[j].UserHours
		}
		return w.Rows[i].WidgetType < w.Rows[j].WidgetType
	})
	for name, c := range cats {
		row := CategoryRow{Category: name, Users: len(c.users), UserHours: hours(c.userSec), ScreenHours: hours(c.scrSec), Widgets: c.widgets}
		if w.MeasuredTickerUsers > 0 {
			row.Share = float64(row.Users) / float64(w.MeasuredTickerUsers)
		}
		w.Categories = append(w.Categories, row)
	}
	sort.Slice(w.Categories, func(i, j int) bool {
		if w.Categories[i].Users != w.Categories[j].Users {
			return w.Categories[i].Users > w.Categories[j].Users
		}
		return w.Categories[i].Category < w.Categories[j].Category
	})
	return nil
}

// widgetAggregates reads per-type users, user-seconds (account-level, deduped
// across screens and computers) and screen-seconds (per screen) plus the
// days each user was displayed the type.
func widgetAggregates(ctx context.Context, f desktopFilter, start, end time.Time) (map[string]*widgetAgg, error) {
	out := map[string]*widgetAgg{}
	get := func(wt string) *widgetAgg {
		a := out[wt]
		if a == nil {
			a = &widgetAgg{users: map[string]struct{}{}, days: map[string]map[string]struct{}{}}
			out[wt] = a
		}
		return a
	}
	if f.perComputer() {
		// Session rows carry os/version; user time is then per computer.
		var args []any
		where := f.where(start, end, &args, true)
		rows, err := platform.DBPool.Query(ctx, `
			SELECT w.widget_type, w.logto_sub, (w.hour AT TIME ZONE 'UTC')::date, sum(w.screen_seconds)
			  FROM presence_widget_hourly w
			  JOIN presence_session_hourly t ON t.logto_sub = w.logto_sub AND t.session_id = w.session_id AND t.hour = w.hour
			 WHERE `+where+` GROUP BY 1, 2, 3`, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var wt, sub string
			var day time.Time
			var secs int64
			if err := rows.Scan(&wt, &sub, &day, &secs); err != nil {
				return nil, err
			}
			a := get(wt)
			a.users[sub] = struct{}{}
			if a.days[sub] == nil {
				a.days[sub] = map[string]struct{}{}
			}
			a.days[sub][day.Format("2006-01-02")] = struct{}{}
			a.userSeconds += secs
			a.screenSecs += secs
		}
		return out, rows.Err()
	}
	var args []any
	where := f.where(start, end, &args, false)
	rows, err := platform.DBPool.Query(ctx, `
		SELECT t.widget_type, t.logto_sub, (t.hour AT TIME ZONE 'UTC')::date, sum(t.user_seconds)
		  FROM presence_widget_account_hourly t WHERE `+where+` GROUP BY 1, 2, 3`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var wt, sub string
		var day time.Time
		var secs int64
		if err := rows.Scan(&wt, &sub, &day, &secs); err != nil {
			rows.Close()
			return nil, err
		}
		a := get(wt)
		a.users[sub] = struct{}{}
		if a.days[sub] == nil {
			a.days[sub] = map[string]struct{}{}
		}
		a.days[sub][day.Format("2006-01-02")] = struct{}{}
		a.userSeconds += secs
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	args = nil
	where = f.where(start, end, &args, false)
	rows, err = platform.DBPool.Query(ctx, `
		SELECT t.widget_type, sum(t.screen_seconds) FROM presence_widget_hourly t WHERE `+where+` GROUP BY 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var wt string
		var secs int64
		if err := rows.Scan(&wt, &secs); err != nil {
			return nil, err
		}
		get(wt).screenSecs = secs
	}
	return out, rows.Err()
}

type widgetChange struct{ added, removed int }

// widgetChanges counts explicit add/remove facts. The rows carry the account
// (so the plan filter applies, through the same current-plan lookup as the
// hourly rows) but no OS or version, so under a per-computer filter the
// caller reports them as unavailable rather than unfiltered.
func widgetChanges(ctx context.Context, f desktopFilter, start, end time.Time) (map[string]widgetChange, error) {
	out := map[string]widgetChange{}
	if f.perComputer() {
		return out, nil
	}
	args := []any{start, end}
	where := ""
	if f.excludeStaff {
		where += " AND internal = false"
	}
	if f.plan != "" {
		args = append(args, f.plan)
		where += fmt.Sprintf(
			` AND coalesce((SELECT CASE WHEN s.lifetime THEN 'lifetime' ELSE s.plan END FROM stripe_customers s WHERE s.logto_sub = presence_widget_changes.logto_sub), 'free') = $%d`,
			len(args))
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT widget_type, change, count(*) FROM presence_widget_changes
		 WHERE at >= $1 AND at < $2`+where+` GROUP BY 1, 2`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var wt, change string
		var n int
		if err := rows.Scan(&wt, &change, &n); err != nil {
			return nil, err
		}
		c := out[wt]
		if change == "added" {
			c.added = n
		} else {
			c.removed = n
		}
		out[wt] = c
	}
	return out, rows.Err()
}

// widgetConfigured is the current snapshot of user_widgets: configured (a row
// exists) and enabled (enabled AND ticker_enabled). These are all accounts,
// not only measured ones; staff are excluded by the admin list when asked.
func widgetConfigured(ctx context.Context, f desktopFilter) (configured, enabled map[string]int, err error) {
	configured, enabled = map[string]int{}, map[string]int{}
	staff := ""
	if f.excludeStaff {
		staff = " WHERE NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.logto_sub = w.logto_sub)"
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT w.widget_type, count(*), count(*) FILTER (WHERE w.enabled AND w.ticker_enabled)
		  FROM user_widgets w`+staff+` GROUP BY 1`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var wt string
		var c, e int
		if err := rows.Scan(&wt, &c, &e); err != nil {
			return nil, nil, err
		}
		configured[wt], enabled[wt] = c, e
	}
	return configured, enabled, rows.Err()
}
