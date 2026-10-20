package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"sync"
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
	// A read that finds the entry older than this serves it and refreshes in
	// the background; a report takes seconds, so this leaves slack before the TTL.
	websiteRefreshAfter = 4 * time.Minute
	websiteCacheKey     = "scrollr:admin:website:"
)

var (
	postHogQuery = accounts.PostHogQuery
	websiteGroup singleflight.Group
	websiteNow   = time.Now
	// Periods kept warm when any one of them has a cold miss. ~8 queries each,
	// at most once per entry lifetime: far under PostHog's query limits.
	websiteWarmKeys = []platform.PeriodKey{platform.Period24h, platform.Period7d, platform.Period30d}
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

// cachedWebsite serves the stored report for a period and refreshes it in the
// background once it is past websiteRefreshAfter, so a visit almost never waits
// on PostHog (SCROLLR-330). The entry carries its own generated_at, so a served
// report shows its real age; Redis expires it at the hard TTL and nothing older
// is ever served. Only a cold miss pays the upstream inside the request.
func cachedWebsite(ctx context.Context, period Period, now time.Time) (WebsiteResponse, bool) {
	key := websiteCacheKey + string(period.Key)
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, key).Bytes(); err == nil {
			var out WebsiteResponse
			if json.Unmarshal(raw, &out) == nil {
				if t, err := time.Parse(time.RFC3339, out.GeneratedAt); err == nil {
					if websiteNow().Sub(t) > websiteRefreshAfter {
						go refreshWebsite(period.Key)
					}
					return out, true
				}
			}
		}
	}
	r := websiteGroup.DoChan(key, func() (any, error) {
		return fetchAndStoreWebsite(period, now), nil
	})
	select {
	case <-ctx.Done():
		return websiteUnavailable(period, now, "Timed out waiting for PostHog."), false
	case res := <-r:
		out := res.Val.(WebsiteResponse)
		if out.Available {
			go warmWebsite(period.Key)
		}
		return out, false
	}
}

func fetchAndStoreWebsite(period Period, now time.Time) WebsiteResponse {
	qctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out := loadWebsite(qctx, period, now)
	if out.Available && out.BreakdownNote == "" && platform.Rdb != nil {
		if raw, err := json.Marshal(out); err == nil {
			_ = platform.Rdb.Set(context.Background(), websiteCacheKey+string(period.Key), raw, websiteCacheTTL).Err()
		}
	}
	return out
}

// refreshWebsite re-reads PostHog off the request path. In-process callers
// share one flight; the Redis lock keeps other replicas from also refreshing.
func refreshWebsite(key platform.PeriodKey) {
	cacheKey := websiteCacheKey + string(key)
	websiteGroup.Do(cacheKey, func() (any, error) {
		if platform.Rdb != nil {
			ok, err := platform.Rdb.SetNX(context.Background(), cacheKey+":refreshing", 1, 30*time.Second).Result()
			if err != nil || !ok {
				return nil, nil
			}
		}
		now := websiteNow().UTC()
		period, err := ParsePeriod(string(key), now)
		if err != nil {
			return nil, nil
		}
		if out := fetchAndStoreWebsite(period, now); !out.Available {
			log.Printf("[Admin] website background refresh %s: %s", key, out.Note)
		}
		return nil, nil
	})
}

// warmWebsite fills the other common periods that have no entry, one at a
// time (PostHog caps concurrent queries), so the next period tab is warm too.
func warmWebsite(except platform.PeriodKey) {
	if platform.Rdb == nil {
		return
	}
	for _, k := range websiteWarmKeys {
		if k == except {
			continue
		}
		if n, err := platform.Rdb.Exists(context.Background(), websiteCacheKey+string(k)).Result(); err == nil && n == 0 {
			refreshWebsite(k)
		}
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

	// PostHog allows only a few concurrent queries per project; three at a
	// time cuts the report from the sum of its queries to about a third.
	sem := make(chan struct{}, 3)
	var wg sync.WaitGroup
	run := func(f func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			f()
		}()
	}

	type totals struct {
		pv, vis, dl, su float64
		err             error
	}
	count := func(w Period) (t totals) {
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
			t.err = err
		} else if len(rows) > 0 && len(rows[0]) >= 4 {
			t.pv, t.vis, t.dl, t.su = num(rows[0][0]), num(rows[0][1]), num(rows[0][2]), num(rows[0][3])
		}
		return t
	}
	var cur, prevT totals
	run(func() { cur = count(period) })
	if prev, ok := period.Previous(); ok {
		run(func() { prevT = count(prev) })
	}

	step := BucketStep(period, from)
	out.CurveStep = step.String()
	out.Curve = Buckets(start, end, step)
	out.VisitorsCurve = Buckets(start, end, step)
	var curveRows [][]any
	var curveErr error
	if len(out.Curve) > 0 {
		run(func() {
			curveRows, curveErr = postHogQuery(ctx, fmt.Sprintf(`
				SELECT intDiv(toUnixTimestamp(timestamp) - %d, %d) AS b, count(), uniq(person_id)
				  FROM events
				 WHERE event = '$pageview' AND properties.surface = 'website'
				   AND timestamp >= %s AND timestamp < %s%s
				 GROUP BY b ORDER BY b`,
				start.Unix(), int64(step.Seconds()), accounts.HogQLTime(start), accounts.HogQLTime(end), websiteFilter))
		})
	}

	type breakdown struct {
		property, event string
		rows            []BreakdownRow
		err             error
	}
	breakdowns := []*breakdown{
		{property: "properties.path", event: "$pageview"},
		{property: "properties.$referring_domain", event: "$pageview"},
		{property: "properties.utm_campaign", event: "$pageview"},
		{property: "properties.platform", event: "download_selected"},
	}
	for _, b := range breakdowns {
		run(func() {
			rows, err := postHogQuery(ctx, fmt.Sprintf(`
			SELECT %s AS k, count(), uniq(person_id)
			  FROM events
			 WHERE event = '%s' AND properties.surface = 'website'
			   AND timestamp >= %s AND timestamp < %s AND %s IS NOT NULL AND %s <> ''%s
			 GROUP BY k ORDER BY count() DESC LIMIT 10`,
				b.property, b.event, accounts.HogQLTime(start), accounts.HogQLTime(end), b.property, b.property, websiteFilter))
			if err != nil {
				b.err = err
				return
			}
			b.rows = make([]BreakdownRow, 0, len(rows))
			for _, r := range rows {
				if len(r) < 3 {
					continue
				}
				key, _ := r[0].(string)
				b.rows = append(b.rows, BreakdownRow{Key: key, Pageviews: int(num(r[1])), Visitors: int(num(r[2]))})
			}
		})
	}
	wg.Wait()

	if cur.err != nil {
		log.Printf("[Admin] website totals: %v", cur.err)
		return websiteUnavailable(period, now, "PostHog could not be read: "+cur.err.Error())
	}
	if prevT.err != nil {
		log.Printf("[Admin] website previous totals: %v", prevT.err)
		return websiteUnavailable(period, now, "PostHog could not be read: "+prevT.err.Error())
	}
	// A flat zero chart next to real totals would read as "no traffic"; the
	// report is unavailable instead, and not cached.
	if curveErr != nil {
		log.Printf("[Admin] website curve: %v", curveErr)
		return websiteUnavailable(period, now, "PostHog could not be read: "+curveErr.Error())
	}

	pv, vis, dl, su := cur.pv, cur.vis, cur.dl, cur.su
	ppv, pvis, pdl, psu := prevT.pv, prevT.vis, prevT.dl, prevT.su
	out.Available = true
	out.Note = ""
	out.Pageviews = Metric{Value: pv, Available: true, Comparison: Compare(pv, ppv, period, from)}
	out.Visitors = Metric{Value: vis, Available: true, Comparison: Compare(vis, pvis, period, from)}
	out.Downloads = Metric{Value: dl, Available: true, Comparison: Compare(dl, pdl, period, from), Note: "Clicks on a download button, by platform. Not installs."}
	out.Signups = Metric{Value: su, Available: true, Comparison: Compare(su, psu, period, from), Note: "Verified website signups reported to PostHog. The registered-account total comes from Logto, not from here."}

	for _, r := range curveRows {
		if len(r) < 3 {
			continue
		}
		if i := int(num(r[0])); i >= 0 && i < len(out.Curve) {
			out.Curve[i].Value = num(r[1])
			out.VisitorsCurve[i].Value = num(r[2])
		}
	}

	// A failed breakdown is nil, not an empty table: the UI shows the note
	// instead of "no rows", and the response is not cached.
	for _, b := range breakdowns {
		if b.err != nil {
			log.Printf("[Admin] website breakdown %s: %v", b.property, b.err)
			out.BreakdownNote = "One or more breakdowns could not be read from PostHog: " + b.err.Error()
		}
	}
	out.TopPaths, out.TopReferrers, out.TopCampaigns, out.DownloadsByOS = breakdowns[0].rows, breakdowns[1].rows, breakdowns[2].rows, breakdowns[3].rows
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
