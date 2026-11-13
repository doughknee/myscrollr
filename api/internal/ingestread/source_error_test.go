package ingestread

import (
	"context"
	"github.com/gofiber/fiber/v2"
	"net/http/httptest"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RB-5: a source whose read fails is reported as failed and contributes no
// key, instead of an empty list that looks like "no data".
func TestLocalDashboardOmitsUnreadableSource(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	real := platform.DBPool
	pool, err := pgxpool.New(context.Background(), real.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	platform.DBPool = pool
	defer func() { platform.DBPool = real }()

	out, failed := LocalDashboard(context.Background(), "t444-user", map[string]bool{"finance": true, "sports": true, "rss": true})
	if len(failed) != 3 {
		t.Fatalf("failed = %v, want all three sources", failed)
	}
	if len(out) != 0 {
		t.Fatalf("unreadable sources leaked keys: %v", out)
	}
}

// UD-7: a failed read of the user's leagues is a 500 and is not cached, not
// the empty shape the desktop shows as "No leagues configured yet".
func TestGetSportsUnreadableLeaguesIs500AndUncached(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	real := platform.DBPool
	pool, err := pgxpool.New(context.Background(), real.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	platform.DBPool = pool
	defer func() { platform.DBPool = real }()

	app := fiber.New()
	app.Get("/sports", func(c *fiber.Ctx) error {
		c.Locals("user_id", "t444-user")
		return c.Next()
	}, handleGetSports)
	resp, err := app.Test(httptest.NewRequest("GET", "/sports", nil))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("got %d, want 500", resp.StatusCode)
	}
	if len(mr.Keys()) != 0 {
		t.Fatalf("failed read was cached: %v", mr.Keys())
	}
}
