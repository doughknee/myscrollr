package admin

import (
	"context"
	"log"
	"sort"
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
// The number people always want here is active installs. There is no
// telemetry or analytics anywhere in this API - a standing decision, not an
// oversight - so installs are NOT measurable, and the Installs tile exists
// purely to say so and point at downloads instead.

// listAllLogtoUsers is the tile's seam onto Logto, so the tests can drive
// both the healthy path and the unreachable path without a network.
var listAllLogtoUsers = accounts.ListAllLogtoUsers

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
	Plans        PlansTile     `json:"plans"`
	Downloads    DownloadsTile `json:"downloads"`
	Installs     Measured      `json:"installs"`
	ConnectedNow ConnectedTile `json:"connected_now"`
	Support      SupportTile   `json:"support"`
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
// The signup series comes from Logto's per-account createdAt, so "new this
// week" is a fact about signups rather than about when a local column was
// added. That retires the old untracked/tracking-since apparatus.
type AccountsTile struct {
	Total  int          `json:"total"`
	SetUp  int          `json:"set_up"`
	Source string       `json:"source"`
	Note   string       `json:"note,omitempty"`
	New7d  Measured     `json:"new_7d"`
	New30d Measured     `json:"new_30d"`
	Daily  []DailyCount `json:"daily"`
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

	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_preferences`).Scan(&t.SetUp); err != nil {
		log.Printf("[Admin] accounts set-up count: %v", err)
	}

	users, total, err := listAllLogtoUsers()
	if err != nil {
		// Degrade loudly. The local number is real, but it is not the account
		// count, and the tile says which one the reader is looking at.
		log.Printf("[Admin] accounts tile logto: %v", err)
		t.Total, t.Source = t.SetUp, "local"
		t.Note = "Logto is unreachable, so this is not the account count. It " +
			"is how many accounts have set the app up, which is fewer."
		note := "Signup dates come from Logto, which is unreachable."
		t.New7d = Measured{Available: false, Note: note}
		t.New30d = Measured{Available: false, Note: note}
		return t
	}

	t.Total, t.Source = total, "logto"
	t.New7d.Available, t.New30d.Available = true, true

	now := time.Now()
	week, month := now.AddDate(0, 0, -7), now.AddDate(0, 0, -30)
	daily := make(map[string]int, 30)
	for _, u := range users {
		if u.CreatedAt <= 0 {
			continue
		}
		created := time.UnixMilli(u.CreatedAt)
		if created.After(week) {
			t.New7d.Value++
		}
		if created.After(month) {
			t.New30d.Value++
			daily[created.UTC().Format("2006-01-02")]++
		}
	}

	days := make([]string, 0, len(daily))
	for day := range daily {
		days = append(days, day)
	}
	sort.Strings(days)
	for _, day := range days {
		t.Daily = append(t.Daily, DailyCount{Day: day, Count: daily[day]})
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
