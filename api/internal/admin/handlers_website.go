package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

// Website visitors and pageviews from PostHog (SCROLLR-210).
//
// The website sends `$pageview` for public routes only (account, admin,
// callback, invite, support and profile routes are excluded at capture) with
// a path, a domain-only referrer and validated utm values. Nothing here
// widens that. A visitor is a PostHog person: a browser profile, merged with
// the account pseudonym on sign-in — not guaranteed to be one human.

const (
	websiteCacheTTL = 5 * time.Minute
	websiteCacheKey = "scrollr:admin:website:"
)

var (
	postHogQuery = accounts.PostHogQuery
	websiteGroup singleflight.Group
	websiteNow   = time.Now
)

// websiteCollectionStart is when website capture went live; earlier windows
// are partial. Overridable so a project reset does not need a deploy.
func websiteCollectionStart() time.Time {
	if raw := os.Getenv("POSTHOG_COLLECTION_STARTED_AT"); raw != "" {
		if t, err := time.Parse(time.RFC3339, raw); err == nil {
			return t.UTC()
		}
	}
	return time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
}

type BreakdownRow struct {
	Key       string `json:"key"`
	Pageviews int    `json:"pageviews"`
	Visitors  int    `json:"visitors"`
}

type WebsiteResponse struct {
	GeneratedAt   string   `json:"generated_at"`
	Period        Window   `json:"period"`
	Previous      *Window  `json:"previous"`
	Available     bool     `json:"available"`
	Note          string   `json:"note,omitempty"`
	Coverage      Coverage `json:"coverage"`
	StaffExcluded bool     `json:"staff_excluded"`

	Visitors  Metric   `json:"visitors"`
	Pageviews Metric   `json:"pageviews"`
	Downloads Metric   `json:"downloads"`
	Signups   Metric   `json:"signups"`
	Curve     []Bucket `json:"curve"`
	// VisitorsCurve is unique visitors per bucket; those do not add up to
	// the period total and the page must not sum them.
	VisitorsCurve []Bucket       `json:"visitors_curve"`
	CurveStep     string         `json:"curve_step"`
	TopPaths      []BreakdownRow `json:"top_paths"`
	TopReferrers  []BreakdownRow `json:"top_referrers"`
	TopCampaigns  []BreakdownRow `json:"top_campaigns"`
	DownloadsByOS []BreakdownRow `json:"downloads_by_os"`
	// BreakdownNote is set when a breakdown query failed; that table is
	// null rather than empty, and the response is not cached.
	BreakdownNote string `json:"breakdown_note,omitempty"`
	Definition    string `json:"definition"`
	Cached        bool   `json:"cached"`
}

// HandleGetWebsite - GET /admin/website?period=
func HandleGetWebsite(c *fiber.Ctx) error {
	now := websiteNow().UTC()
	period, err := ParsePeriod(c.Query("period"), now)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, cached := cachedWebsite(ctx, period, now)
	out.Cached = cached
	out.StaffExcluded = ExcludeStaff(ctx)
	return c.JSON(out)
}

// cachedWebsite keys the cache by period and by the minute of the cutoff, so
// a page refreshed within five minutes reuses the same PostHog answer.
func cachedWebsite(ctx context.Context, period Period, now time.Time) (WebsiteResponse, bool) {
	key := websiteCacheKey + string(period.Key) + ":" + now.Truncate(5*time.Minute).Format("200601021504")
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, key).Bytes(); err == nil {
			var out WebsiteResponse
			if json.Unmarshal(raw, &out) == nil {
				return out, true
			}
		}
	}
	r := websiteGroup.DoChan(key, func() (any, error) {
		qctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		out := loadWebsite(qctx, period, now)
		if out.Available && out.BreakdownNote == "" && platform.Rdb != nil {
			if raw, err := json.Marshal(out); err == nil {
				_ = platform.Rdb.Set(context.Background(), key, raw, websiteCacheTTL).Err()
			}
		}
		return out, nil
	})
	select {
	case <-ctx.Done():
		return websiteUnavailable(period, now, "Timed out waiting for PostHog."), false
	case res := <-r:
		return res.Val.(WebsiteResponse), false
	}
}

func websiteUnavailable(period Period, now time.Time, note string) WebsiteResponse {
	out := WebsiteResponse{
		GeneratedAt: now.Format(time.RFC3339), Period: period.Window(), Note: note,
		Curve: []Bucket{}, VisitorsCurve: []Bucket{}, TopPaths: []BreakdownRow{}, TopReferrers: []BreakdownRow{},
		TopCampaigns: []BreakdownRow{}, DownloadsByOS: []BreakdownRow{},
		Definition: websiteDefinition,
	}
	if prev, ok := period.Previous(); ok {
		w := prev.Window()
		out.Previous = &w
	}
	out.Coverage = CoverageFor(period, websiteCollectionStart(), "Website capture started with the PostHog rollout; public routes only, consent rules unchanged.")
	m := Metric{Note: note}
	out.Visitors, out.Pageviews, out.Downloads, out.Signups = m, m, m, m
	return out
}

const websiteDefinition = "A visitor is a PostHog person: one browser profile, merged with the account pseudonym on sign-in. It is not guaranteed to be one human across browsers or devices. Only public pages are measured, only where analytics is on, and never for identified staff."

// websiteFilter keeps internal traffic out where the data carries the flag.
// Website pageviews have no flag (identified staff are suppressed at
// capture), so this is a no-op for them and a real filter for desktop rows.
const websiteFilter = " AND (properties.is_internal IS NULL OR properties.is_internal = false)"

func loadWebsite(ctx context.Context, period Period, now time.Time) WebsiteResponse {
	out := websiteUnavailable(period, now, "")
	if !accounts.PostHogQueryConfigured() {
		out.Note = "PostHog reads are not configured on this API (POSTHOG_QUERY_API_KEY)."
		m := Metric{Note: out.Note}
		out.Visitors, out.Pageviews, out.Downloads, out.Signups = m, m, m, m
		return out
	}
	from := websiteCollectionStart()
	start := EffectiveStart(period, from)
	end := period.End

	count := func(w Period) (pageviews, visitors, downloads, signups float64, err error) {
		s := EffectiveStart(w, from)
		rows, err := postHogQuery(ctx, fmt.Sprintf(`
			SELECT countIf(event = '$pageview'),
			       uniqIf(person_id, event = '$pageview'),
			       countIf(event = 'download_selected'),
			       countIf(event = 'signup_completed')
			  FROM events
			 WHERE properties.surface = 'website' AND timestamp >= %s AND timestamp < %s%s`,
			accounts.HogQLTime(s), accounts.HogQLTime(w.End), websiteFilter))
		if err != nil {
			return 0, 0, 0, 0, err
		}
		if len(rows) == 0 || len(rows[0]) < 4 {
			return 0, 0, 0, 0, nil
		}
		return num(rows[0][0]), num(rows[0][1]), num(rows[0][2]), num(rows[0][3]), nil
	}
	pv, vis, dl, su, err := count(period)
	if err != nil {
		log.Printf("[Admin] website totals: %v", err)
		return websiteUnavailable(period, now, "PostHog could not be read: "+err.Error())
	}
	var ppv, pvis, pdl, psu float64
	if prev, ok := period.Previous(); ok {
		ppv, pvis, pdl, psu, err = count(prev)
		if err != nil {
			log.Printf("[Admin] website previous totals: %v", err)
			return websiteUnavailable(period, now, "PostHog could not be read: "+err.Error())
		}
	}
	out.Available = true
	out.Note = ""
	out.Pageviews = Metric{Value: pv, Available: true, Comparison: Compare(pv, ppv, period, from)}
	out.Visitors = Metric{Value: vis, Available: true, Comparison: Compare(vis, pvis, period, from)}
	out.Downloads = Metric{Value: dl, Available: true, Comparison: Compare(dl, pdl, period, from), Note: "Clicks on a download button, by platform. Not installs."}
	out.Signups = Metric{Value: su, Available: true, Comparison: Compare(su, psu, period, from), Note: "Verified website signups reported to PostHog. The registered-account total comes from Logto, not from here."}

	step := BucketStep(period, from)
	out.CurveStep = step.String()
	out.Curve = Buckets(start, end, step)
	out.VisitorsCurve = Buckets(start, end, step)
	if len(out.Curve) > 0 {
		rows, err := postHogQuery(ctx, fmt.Sprintf(`
			SELECT intDiv(toUnixTimestamp(timestamp) - %d, %d) AS b, count(), uniq(person_id)
			  FROM events
			 WHERE event = '$pageview' AND properties.surface = 'website'
			   AND timestamp >= %s AND timestamp < %s%s
			 GROUP BY b ORDER BY b`,
			start.Unix(), int64(step.Seconds()), accounts.HogQLTime(start), accounts.HogQLTime(end), websiteFilter))
		if err != nil {
			// A flat zero chart next to real totals would read as "no
			// traffic"; the report is unavailable instead, and not cached.
			log.Printf("[Admin] website curve: %v", err)
			return websiteUnavailable(period, now, "PostHog could not be read: "+err.Error())
		} else {
			for _, r := range rows {
				if len(r) < 3 {
					continue
				}
				if i := int(num(r[0])); i >= 0 && i < len(out.Curve) {
					out.Curve[i].Value = num(r[1])
					out.VisitorsCurve[i].Value = num(r[2])
				}
			}
		}
	}

	breakdown := func(property, event string) []BreakdownRow {
		rows, err := postHogQuery(ctx, fmt.Sprintf(`
			SELECT %s AS k, count(), uniq(person_id)
			  FROM events
			 WHERE event = '%s' AND properties.surface = 'website'
			   AND timestamp >= %s AND timestamp < %s AND %s IS NOT NULL AND %s <> ''%s
			 GROUP BY k ORDER BY count() DESC LIMIT 10`,
			property, event, accounts.HogQLTime(start), accounts.HogQLTime(end), property, property, websiteFilter))
		if err != nil {
			// nil, not an empty table: the UI shows the note instead of
			// "no rows", and the response is not cached.
			log.Printf("[Admin] website breakdown %s: %v", property, err)
			out.BreakdownNote = "One or more breakdowns could not be read from PostHog: " + err.Error()
			return nil
		}
		out := make([]BreakdownRow, 0, len(rows))
		for _, r := range rows {
			if len(r) < 3 {
				continue
			}
			key, _ := r[0].(string)
			out = append(out, BreakdownRow{Key: key, Pageviews: int(num(r[1])), Visitors: int(num(r[2]))})
		}
		return out
	}
	out.TopPaths = breakdown("properties.path", "$pageview")
	out.TopReferrers = breakdown("properties.$referring_domain", "$pageview")
	out.TopCampaigns = breakdown("properties.utm_campaign", "$pageview")
	out.DownloadsByOS = breakdown("properties.platform", "download_selected")
	return out
}

// num reads a HogQL number, which arrives as JSON float or as a string for
// large integers.
func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	case json.Number:
		f, _ := x.Float64()
		return f
	}
	return 0
}
