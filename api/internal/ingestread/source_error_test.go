package ingestread

import (
	"context"
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
