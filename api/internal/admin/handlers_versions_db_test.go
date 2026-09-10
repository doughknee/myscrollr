package admin

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// The whole path, end to end and against a real database: requests go through
// the middleware, the counters flush, and the page reads them back.
//
// It exists to hold two claims that are only true if the storage actually
// behaves as designed, and that a unit test on the in-memory buffer cannot
// prove:
//
//  1. The table gains rows per DAY, not per request. 1,200 requests here
//     become three rows.
//  2. An endpoint returning 500 shows up as error rate against the build that
//     called it — the thing that turns a vague report into a targeted one.
func TestUsageCountersRoundTrip(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	if _, err := platform.DBPool.Exec(ctx, `DELETE FROM api_usage_daily`); err != nil {
		t.Fatalf("clear counters: %v", err)
	}

	app := fiber.New()
	app.Use(platform.RecordUsage)
	app.Get("/dashboard", func(c *fiber.Ctx) error { return c.SendString("ok") })
	app.Get("/broken", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "boom"})
	})

	drive := func(path, ua string, n int) {
		t.Helper()
		for i := 0; i < n; i++ {
			req := httptest.NewRequest("GET", path, nil)
			req.Header.Set("User-Agent", ua)
			if _, err := app.Test(req); err != nil {
				t.Fatalf("%s: %v", path, err)
			}
		}
	}

	// A healthy fleet on the current build, and a smaller unhappy one on the
	// build people are complaining about.
	drive("/dashboard", "Scrollr/1.6.1 (windows)", 900)
	drive("/dashboard", "Scrollr/1.5.0 (windows)", 200)
	drive("/broken", "Scrollr/1.5.0 (windows)", 100)

	platform.FlushUsage(ctx)

	// (1) Aggregated, not accumulated.
	var rows, total int64
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*), coalesce(sum(requests), 0) FROM api_usage_daily`).Scan(&rows, &total); err != nil {
		t.Fatalf("count counters: %v", err)
	}
	if total != 1200 {
		t.Errorf("counters total %d requests, want 1200", total)
	}
	if rows != 3 {
		t.Errorf("1200 requests produced %d rows, want 3 — the table must grow per day, not per request", rows)
	}

	// A second flush of the same traffic adds to the same rows rather than
	// inserting new ones. This is what lets every replica flush its own
	// buffer into one shared count.
	drive("/dashboard", "Scrollr/1.6.1 (windows)", 100)
	platform.FlushUsage(ctx)
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*), coalesce(sum(requests), 0) FROM api_usage_daily`).Scan(&rows, &total); err != nil {
		t.Fatalf("recount counters: %v", err)
	}
	if rows != 3 || total != 1300 {
		t.Errorf("after a second flush: %d rows / %d requests, want 3 / 1300", rows, total)
	}

	// (2) The page reads it back, and the 500s land on 1.5.0.
	aggs := readAggs(t, ctx)
	res := buildVersionsResponse(aggs, 30)

	if res.CurrentRelease != "1.6.1" {
		t.Fatalf("current release = %q, want 1.6.1", res.CurrentRelease)
	}
	if !closeTo(res.CurrentShare, 1000.0/1300.0) {
		t.Errorf("current share = %v, want ~0.769", res.CurrentShare)
	}
	newest := findVersion(t, res, "1.6.1")
	if newest.ServerErrors != 0 || !closeTo(newest.ErrorRate, 0) {
		t.Errorf("1.6.1 = %+v, want a clean build", newest)
	}
	old := findVersion(t, res, "1.5.0")
	if old.ServerErrors != 100 || !closeTo(old.ErrorRate, 100.0/300.0) {
		t.Errorf("1.5.0 = %+v, want 100 server errors at a ~0.33 rate", old)
	}

	// And nothing personal reached the table. The unit test asserts this on
	// the in-memory key; this asserts it on what was actually written.
	stored, err := platform.DBPool.Query(ctx,
		`SELECT app_version, platform, endpoint, status_class FROM api_usage_daily`)
	if err != nil {
		t.Fatalf("read counters: %v", err)
	}
	defer stored.Close()
	for stored.Next() {
		var v, p, e, s string
		if err := stored.Scan(&v, &p, &e, &s); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if e != "/dashboard" && e != "/broken" {
			t.Errorf("stored endpoint %q is not a registered route pattern", e)
		}
		if v != "1.6.1" && v != "1.5.0" {
			t.Errorf("stored app_version %q was not one of the two builds driven", v)
		}
	}
}

func readAggs(t *testing.T, ctx context.Context) []usageAgg {
	t.Helper()
	rows, err := platform.DBPool.Query(ctx,
		`SELECT app_version, platform, status_class, SUM(requests)
		   FROM api_usage_daily GROUP BY app_version, platform, status_class`)
	if err != nil {
		t.Fatalf("aggregate counters: %v", err)
	}
	defer rows.Close()
	var out []usageAgg
	for rows.Next() {
		var a usageAgg
		if err := rows.Scan(&a.version, &a.platform, &a.statusClass, &a.requests); err != nil {
			t.Fatalf("scan agg: %v", err)
		}
		out = append(out, a)
	}
	return out
}
