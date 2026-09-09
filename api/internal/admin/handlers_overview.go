package admin

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/events"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// The Overview is the "everything about Scrollr in one spot" page. Its hard
// rule: a tile shows a number we actually have, or it says it cannot be
// measured. It never estimates and then presents the estimate as a
// measurement.
//
// The number people always want here is active installs. There is no
// telemetry or analytics anywhere in this API - a standing decision, not an
// oversight - so installs are NOT measurable, and the Installs tile exists
// purely to say so and point at downloads instead.

// Measured wraps a number with whether it means what its label says. When
// Available is false the client renders Note instead of Value.
type Measured struct {
	Value     int    `json:"value"`
	Available bool   `json:"available"`
	Note      string `json:"note,omitempty"`
}

type OverviewResponse struct {
	GeneratedAt  string        `json:"generated_at"`
	Accounts     AccountsTile  `json:"accounts"`
	Plans        PlansTile     `json:"plans"`
	Downloads    DownloadsTile `json:"downloads"`
	Installs     Measured      `json:"installs"`
	ConnectedNow ConnectedTile `json:"connected_now"`
	Support      SupportTile   `json:"support"`
	Demand       DemandTile    `json:"demand"`
	Ingest       []IngestRow   `json:"ingest"`
}

// AccountsTile counts rows in user_preferences - the row created the first
// time an account reads its preferences, and therefore the account itself.
//
// created_at was only added in migration 000016 and deliberately not
// backfilled, so accounts that predate it have no signup date. Untracked is
// how many, and TrackingSince is when the honest series starts.
type AccountsTile struct {
	Total         int          `json:"total"`
	New7d         Measured     `json:"new_7d"`
	New30d        Measured     `json:"new_30d"`
	Untracked     int          `json:"untracked"`
	TrackingSince string       `json:"tracking_since,omitempty"`
	Daily         []DailyCount `json:"daily"`
}

type DailyCount struct {
	Day   string `json:"day"`
	Count int    `json:"count"`
}

// PlansTile is the mix from stripe_customers. Accounts with no Stripe row
// have never started a checkout, so they are free - counted here rather than
// dropped, or the mix would not add up to the account total.
type PlansTile struct {
	Free int       `json:"free"`
	Rows []PlanRow `json:"rows"`
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

type SupportTile struct {
	OpenCases        int    `json:"open_cases"`
	PendingDrafts    int    `json:"pending_drafts"`
	AutoSent30d      int    `json:"auto_sent_30d"`
	Intervened30d    int    `json:"intervened_30d"`
	OldestOpenHours  int    `json:"oldest_open_hours"`
	OldestOpenTicket string `json:"oldest_open_ticket,omitempty"`
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
			Note: "Not measurable. Scrollr ships no telemetry or analytics, by " +
				"decision - nothing reports back that an install exists or is " +
				"running. Downloads per release is the honest proxy.",
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

	run("accounts", func() { out.Accounts = accountsTile(ctx) })
	run("plans", func() { out.Plans = plansTile(ctx) })
	run("downloads", func() { out.Downloads = downloadsTile(ctx) })
	run("support", func() { out.Support = supportTile(ctx) })
	run("demand", func() { out.Demand = demandTile(ctx) })
	run("ingest", func() { out.Ingest = ingestRows(ctx) })
	run("connected", func() {
		count, replicas := events.FleetClientCount(ctx)
		out.ConnectedNow = ConnectedTile{Count: count, Replicas: replicas}
	})

	wg.Wait()
	return c.JSON(out)
}

func accountsTile(ctx context.Context) AccountsTile {
	var t AccountsTile
	var since *time.Time
	err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE created_at IS NULL),
		       count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
		       count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
		       min(created_at)
		  FROM user_preferences`).
		Scan(&t.Total, &t.Untracked, &t.New7d.Value, &t.New30d.Value, &since)
	if err != nil {
		log.Printf("[Admin] accounts tile: %v", err)
		return t
	}

	// The windows only mean anything once tracking has been running. Before
	// the first dated row exists, "0 new this week" would read as a fact about
	// signups when it is only a fact about the column's age.
	if since == nil {
		note := "No signup dates recorded yet - tracking began with this release."
		t.New7d = Measured{Available: false, Note: note}
		t.New30d = Measured{Available: false, Note: note}
		return t
	}
	t.TrackingSince = since.UTC().Format(time.RFC3339)
	t.New7d.Available, t.New30d.Available = true, true

	rows, err := platform.DBPool.Query(ctx, `
		SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD'), count(*)
		  FROM user_preferences
		 WHERE created_at >= now() - interval '30 days'
		 GROUP BY 1 ORDER BY 1`)
	if err != nil {
		log.Printf("[Admin] accounts daily: %v", err)
		return t
	}
	defer rows.Close()
	for rows.Next() {
		var d DailyCount
		if err := rows.Scan(&d.Day, &d.Count); err == nil {
			t.Daily = append(t.Daily, d)
		}
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

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FROM user_preferences p
		 WHERE NOT EXISTS (SELECT 1 FROM stripe_customers s WHERE s.logto_sub = p.logto_sub)`).
		Scan(&t.Free); err != nil {
		log.Printf("[Admin] plans free count: %v", err)
	}
	return t
}

func supportTile(ctx context.Context) SupportTile {
	var t SupportTile
	var oldest *time.Time
	var ticket *string

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE status <> 'closed'),
		       min(opened_at) FILTER (WHERE status <> 'closed'),
		       (SELECT ticket_number FROM support_cases
		         WHERE status <> 'closed' ORDER BY opened_at LIMIT 1)
		  FROM support_cases`).Scan(&t.OpenCases, &oldest, &ticket); err != nil {
		log.Printf("[Admin] support cases: %v", err)
	}
	if oldest != nil {
		t.OldestOpenHours = int(time.Since(*oldest).Hours())
	}
	if ticket != nil {
		t.OldestOpenTicket = *ticket
	}

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE status = 'pending'),
		       count(*) FILTER (WHERE status = 'sent'
		                          AND disposition = 'auto_send'
		                          AND created_at >= now() - interval '30 days'),
		       count(*) FILTER (WHERE intervened
		                          AND created_at >= now() - interval '30 days')
		  FROM support_drafts`).
		Scan(&t.PendingDrafts, &t.AutoSent30d, &t.Intervened30d); err != nil {
		log.Printf("[Admin] support drafts: %v", err)
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
// product still has anything to show. All four carry updated_at.
var ingestTables = []string{"games", "trades", "markets", "rss_items"}

func ingestRows(ctx context.Context) []IngestRow {
	out := make([]IngestRow, 0, len(ingestTables))
	for _, table := range ingestTables {
		row := IngestRow{Table: table}
		var last *time.Time
		// The table name comes from the constant slice above, never from input.
		if err := platform.DBPool.QueryRow(ctx,
			"SELECT max(updated_at) FROM "+table).Scan(&last); err != nil {
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
