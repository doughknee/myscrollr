package admin

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/events"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// The Overview is the "everything about Scrollr in one spot" page. Its hard
// rule: a tile shows a number we actually have, or it says it cannot be
// measured. It never estimates and then presents the estimate as a
// measurement.
//
// The number people always want here is active installs. Optional analytics
// use account or browser pseudonyms, not an install identifier, so installs
// are NOT measurable and the tile points at downloads instead.

// logtoStats is the tile's seam onto Logto, so the tests can drive both the
// healthy path and the unreachable path without a network.
var logtoStats = accounts.FetchLogtoStats

const (
	logtoStatsCacheKey = "scrollr:admin:logto_stats"
	logtoStatsCacheTTL = 5 * time.Minute
)

// Measured wraps a number with whether it means what its label says. When
// Available is false the client renders Note instead of Value.
//
// An alias rather than a declaration since REL-263: the support console needs
// the same promise for its hold countdown, and both packages reaching for one
// type beats two that agree by coincidence. The JSON is identical.
type Measured = platform.Measured

type OverviewResponse struct {
	GeneratedAt  string        `json:"generated_at"`
	Accounts     AccountsTile  `json:"accounts"`
	Active       ActiveTile    `json:"active"`
	Plans        PlansTile     `json:"plans"`
	Downloads    DownloadsTile `json:"downloads"`
	Installs     Measured      `json:"installs"`
	ConnectedNow ConnectedTile `json:"connected_now"`
	Demand       DemandTile    `json:"demand"`
	Ingest       []IngestRow   `json:"ingest"`
}

// AccountsTile carries two counts because they answer two questions.
//
// Total is accounts, read from Logto, which is the system of record for them.
// SetUp is rows in user_preferences - the row written the first time the app
// saves a preference - so it is how many of those accounts ever got far enough
// into the product to configure anything. This tile used to report SetUp as
// Total: 100 against 183 real accounts, a 46% undercount on the number most
// likely to be quoted (REL-265).
//
// The gap between them is the point. It is 83 people who created an account
// and never set the app up, and it dwarfs everything else on the funnel.
//
// Source is "logto" normally and "local" when Logto could not be reached; in
// the local case Total falls back to SetUp and Note says why. A smaller number
// presented without that label is the bug this tile was rebuilt to fix.
//
// The signup counts are Logto's own, each with the change against the
// previous comparable period. REL-269 swapped them in for a walk over every
// account's createdAt: same facts, one request, and a delta we could not have
// computed without storing yesterday's answer somewhere.
type AccountsTile struct {
	Total    int    `json:"total"`
	SetUp    int    `json:"set_up"`
	Source   string `json:"source"`
	Note     string `json:"note,omitempty"`
	NewToday Trend  `json:"new_today"`
	New7d    Trend  `json:"new_7d"`
}

// Trend is a figure with the change Logto reports against the previous
// comparable period. Available is false when Logto could not be reached, and
// then neither number may be rendered - the same promise Measured makes, with
// a second field, since a delta of 0 is as much a claim as a count of 0.
type Trend struct {
	Value     int    `json:"value"`
	Delta     int    `json:"delta"`
	Available bool   `json:"available"`
	Note      string `json:"note,omitempty"`
}

// ActiveTile is who actually used Scrollr, which is a different question from
// how many accounts exist - and the only one of the two that can go down.
//
// Curve is Logto's daily-active series, about a month deep. It is theirs, not
// ours: no aggregation table, no rollup job, no cron. If Logto ever stops
// serving it the chart disappears rather than being reconstructed from
// something that only resembles it.
type ActiveTile struct {
	DAU   Trend        `json:"dau"`
	WAU   Trend        `json:"wau"`
	MAU   Trend        `json:"mau"`
	Curve []DailyCount `json:"curve"`
	Note  string       `json:"note,omitempty"`
}

type DailyCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

// PlansTile is the mix from stripe_customers, and Paying is the count that
// matters. It excludes plan = 'free': production carries three active Stripe
// rows and one of them is on the free plan, so a bare row count reads 3 when
// two people are actually paying (REL-265).
//
// There is no Free field. Free is every account that is not paying, and the
// account total lives on the accounts tile - deriving it there beats keeping a
// second count here that could disagree with it.
type PlansTile struct {
	Paying int       `json:"paying"`
	Rows   []PlanRow `json:"rows"`
}

type PlanRow struct {
	Plan     string `json:"plan"`
	Status   string `json:"status"`
	Lifetime bool   `json:"lifetime"`
	Count    int    `json:"count"`
}

// ConnectedTile carries Replicas alongside Count on purpose: the count is a
// sum over the replicas that reported, and a reader who cannot see how many
// reported cannot tell a real dip from half the fleet going quiet.
type ConnectedTile struct {
	Count    int `json:"count"`
	Replicas int `json:"replicas"`
}

type DemandTile struct {
	CatalogRequests []CatalogRequestRow `json:"catalog_requests"`
	BusinessLeads   int                 `json:"business_leads"`
	LeadsUnreplied  int                 `json:"leads_unreplied"`
}

type CatalogRequestRow struct {
	Query  string `json:"query"`
	People int    `json:"people"`
}

// IngestRow answers "is this content still arriving". AgeSeconds is how long
// ago the freshest row in the table was written.
type IngestRow struct {
	Table      string `json:"table"`
	LastUpdate string `json:"last_update,omitempty"`
	AgeSeconds int    `json:"age_seconds"`
	HasData    bool   `json:"has_data"`
}

// HandleGetOverview - GET /admin/overview
//
// Every section is independent, so they run concurrently and a failure in one
// leaves the rest of the page intact: a broken tile must not blank the page
// that tells you what is broken.
func HandleGetOverview(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), overviewTimeout)
	defer cancel()

	out := OverviewResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Installs: Measured{
			Available: false,
			Note: "Not measurable. Optional analytics use no install identifier - " +
				"nothing reports back that a given " +
				"install exists or is running. Downloads per release is the honest proxy.",
		},
	}

	var wg sync.WaitGroup
	run := func(name string, fn func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Admin] overview section %s panicked: %v", name, r)
				}
			}()
			fn()
		}()
	}

	// Accounts and Active come from the same cached Logto read, so they run
	// as one section rather than racing for the same three round trips.
	run("logto", func() {
		stats, err := cachedLogtoStats(ctx)
		out.Accounts = accountsTile(ctx, stats, err)
		out.Active = activeTile(stats, err)
	})
	run("plans", func() { out.Plans = plansTile(ctx) })
	run("downloads", func() { out.Downloads = downloadsTile(ctx) })
	run("demand", func() { out.Demand = demandTile(ctx) })
	run("ingest", func() { out.Ingest = ingestRows(ctx) })
	run("connected", func() {
		count, replicas := events.FleetClientCount(ctx)
		out.ConnectedNow = ConnectedTile{Count: count, Replicas: replicas}
	})

	wg.Wait()
	return c.JSON(out)
}

// cachedLogtoStats reads the growth figures through Redis. They are a
// dashboard's numbers, not per-request data: without the cache every Overview
// load - and every refresh of it - would cost three upstream round trips to
// tell the reader the same thing.
//
// There is deliberately no stale-copy fallback like the downloads tile's. A
// download count that is fifteen minutes old is still a download count; "2
// people were active today" from an hour ago is a different claim than it
// looks. When Logto is unreachable the tiles say so.
func cachedLogtoStats(ctx context.Context) (accounts.LogtoStats, error) {
	var s accounts.LogtoStats
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, logtoStatsCacheKey).Result(); err == nil && raw != "" {
			if json.Unmarshal([]byte(raw), &s) == nil {
				return s, nil
			}
		}
	}

	s, err := logtoStats()
	if err != nil {
		return accounts.LogtoStats{}, err
	}

	if platform.Rdb != nil {
		if raw, err := json.Marshal(s); err == nil {
			_ = platform.Rdb.Set(ctx, logtoStatsCacheKey, raw, logtoStatsCacheTTL).Err()
		}
	}
	return s, nil
}

// logtoDownNote is the one sentence both tiles use when the read failed. It
// says which number is missing and why, and never a number in its place.
const logtoDownNote = "Logto is unreachable, so this is not measurable right now."

func accountsTile(ctx context.Context, stats accounts.LogtoStats, err error) AccountsTile {
	var t AccountsTile

	if dbErr := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_preferences`).Scan(&t.SetUp); dbErr != nil {
		log.Printf("[Admin] accounts set-up count: %v", dbErr)
	}

	if err != nil {
		// Degrade loudly. The local number is real, but it is not the account
		// count, and the tile says which one the reader is looking at.
		log.Printf("[Admin] accounts tile logto: %v", err)
		t.Total, t.Source = t.SetUp, "local"
		t.Note = "Logto is unreachable, so this is not the account count. It " +
			"is how many accounts have set the app up, which is fewer."
		t.NewToday = Trend{Note: "Signup counts come from Logto, which is unreachable."}
		t.New7d = t.NewToday
		return t
	}

	t.Total, t.Source = stats.Total, "logto"
	t.NewToday = Trend{Value: stats.NewToday.Count, Delta: stats.NewToday.Delta, Available: true}
	t.New7d = Trend{Value: stats.New7d.Count, Delta: stats.New7d.Delta, Available: true}
	return t
}

func activeTile(stats accounts.LogtoStats, err error) ActiveTile {
	if err != nil {
		return ActiveTile{Note: logtoDownNote}
	}

	t := ActiveTile{
		DAU: Trend{Value: stats.DAU.Count, Delta: stats.DAU.Delta, Available: true},
		WAU: Trend{Value: stats.WAU.Count, Delta: stats.WAU.Delta, Available: true},
		MAU: Trend{Value: stats.MAU.Count, Delta: stats.MAU.Delta, Available: true},
	}
	for _, p := range stats.DauCurve {
		t.Curve = append(t.Curve, DailyCount{Day: p.Date, Count: p.Count})
	}
	return t
}

func plansTile(ctx context.Context) PlansTile {
	var t PlansTile
	rows, err := platform.DBPool.Query(ctx, `
		SELECT plan, status, lifetime, count(*)
		  FROM stripe_customers
		 GROUP BY 1, 2, 3
		 ORDER BY 4 DESC`)
	if err != nil {
		log.Printf("[Admin] plans tile: %v", err)
	} else {
		for rows.Next() {
			var r PlanRow
			if err := rows.Scan(&r.Plan, &r.Status, &r.Lifetime, &r.Count); err == nil {
				t.Rows = append(t.Rows, r)
			}
		}
		rows.Close()
	}

	// A free-plan row in stripe_customers is somebody who reached checkout
	// and did not pay. Counting the table would call them a customer.
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FROM stripe_customers
		 WHERE plan <> 'free' AND status IN ('active', 'trialing', 'past_due')`).
		Scan(&t.Paying); err != nil {
		log.Printf("[Admin] plans paying count: %v", err)
	}
	return t
}

func demandTile(ctx context.Context) DemandTile {
	var t DemandTile
	rows, err := platform.DBPool.Query(ctx, `
		SELECT query, count(*) FROM catalog_requests
		 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`)
	if err != nil {
		log.Printf("[Admin] catalog requests: %v", err)
	} else {
		for rows.Next() {
			var r CatalogRequestRow
			if err := rows.Scan(&r.Query, &r.People); err == nil {
				t.CatalogRequests = append(t.CatalogRequests, r)
			}
		}
		rows.Close()
	}

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE replied_at IS NULL)
		  FROM business_leads`).Scan(&t.BusinessLeads, &t.LeadsUnreplied); err != nil {
		log.Printf("[Admin] business leads: %v", err)
	}
	return t
}

// ingestTables are the content tables whose freshness says whether the
// product still has anything to show, paired with the column that carries
// each one's write time. They do NOT agree: the finance ingester writes
// last_updated (channels/finance/service/src/database.rs), so assuming
// updated_at everywhere made trades error into the log and report "empty"
// while the finance widget was fine (SCROLLR-214). TestIngestColumnsExist
// keeps these pairs honest.
var ingestTables = []struct{ Table, Column string }{
	{"games", "updated_at"},
	{"trades", "last_updated"},
	{"markets", "updated_at"},
	{"rss_items", "updated_at"},
}

func ingestRows(ctx context.Context) []IngestRow {
	out := make([]IngestRow, 0, len(ingestTables))
	for _, t := range ingestTables {
		table := t.Table
		row := IngestRow{Table: table}
		var last *time.Time
		// Table and column come from the constant slice above, never from input.
		if err := platform.DBPool.QueryRow(ctx,
			"SELECT max("+t.Column+") FROM "+table).Scan(&last); err != nil {
			log.Printf("[Admin] ingest %s: %v", table, err)
			out = append(out, row)
			continue
		}
		if last != nil {
			row.HasData = true
			row.LastUpdate = last.UTC().Format(time.RFC3339)
			row.AgeSeconds = int(time.Since(*last).Seconds())
		}
		out = append(out, row)
	}
	return out
}
