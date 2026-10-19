package admin

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/redis/go-redis/v9"
)

// A near-expiry entry is served as-is and refreshed exactly once in the
// background, however many readers arrive at once.
func TestCachedLogtoStatsRefreshesNearExpiryOnce(t *testing.T) {
	mr := miniredis.RunT(t)
	prevRdb, prevStats := platform.Rdb, logtoStats
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	var calls int32
	logtoStats = func() (accounts.LogtoStats, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(100 * time.Millisecond)
		return accounts.LogtoStats{Total: 2}, nil
	}
	t.Cleanup(func() { platform.Rdb, logtoStats = prevRdb, prevStats })

	old := logtoStatsEntry{
		GeneratedAt: time.Now().UTC().Add(-logtoStatsRefreshAfter - time.Second),
		Stats:       accounts.LogtoStats{Total: 1},
	}
	raw, _ := json.Marshal(old)
	platform.Rdb.Set(context.Background(), logtoStatsCacheKey, raw, logtoStatsCacheTTL)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := cachedLogtoStats(context.Background())
			if err != nil || s.Total != 1 {
				t.Errorf("reader should get the cached entry, got %+v %v", s, err)
			}
		}()
	}
	wg.Wait()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		var e logtoStatsEntry
		got, _ := platform.Rdb.Get(context.Background(), logtoStatsCacheKey).Result()
		if json.Unmarshal([]byte(got), &e) == nil && e.Stats.Total == 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Fatalf("want exactly 1 background refresh, got %d", n)
	}
	got, _ := platform.Rdb.Get(context.Background(), logtoStatsCacheKey).Result()
	var e logtoStatsEntry
	if err := json.Unmarshal([]byte(got), &e); err != nil || e.Stats.Total != 2 || time.Since(e.GeneratedAt) > time.Minute {
		t.Fatalf("entry not refreshed with a fresh generated_at: %s", got)
	}
}
