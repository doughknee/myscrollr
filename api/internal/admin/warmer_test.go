package admin

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/redis/go-redis/v9"
)

func warmerRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr := miniredis.RunT(t)
	prev := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { platform.Rdb = prev })
	return mr
}

func TestWarmOnceSingleRunnerAcrossReplicas(t *testing.T) {
	warmerRedis(t)
	var runs int32
	j := warmJob{"t", time.Minute, func(context.Context) error { atomic.AddInt32(&runs, 1); return nil }}
	// Two replicas tick together: only one runs.
	warmOnce(context.Background(), j)
	warmOnce(context.Background(), j)
	if runs != 1 {
		t.Fatalf("runs = %d, want 1", runs)
	}
}

func TestWarmOnceRunsAgainAfterLeaseExpires(t *testing.T) {
	mr := warmerRedis(t)
	var runs int32
	j := warmJob{"t", time.Minute, func(context.Context) error { atomic.AddInt32(&runs, 1); return nil }}
	warmOnce(context.Background(), j)
	mr.FastForward(time.Minute)
	warmOnce(context.Background(), j)
	if runs != 2 {
		t.Fatalf("runs = %d, want 2", runs)
	}
}

func TestWarmerKillSwitch(t *testing.T) {
	warmerRedis(t)
	t.Setenv("ADMIN_WARMER", "off")
	var runs int32
	warmOnce(context.Background(), warmJob{"t", time.Minute, func(context.Context) error { atomic.AddInt32(&runs, 1); return nil }})
	if runs != 0 {
		t.Fatal("job ran with kill switch on")
	}
	if warmerEnabled() {
		t.Fatal("warmerEnabled true with ADMIN_WARMER=off")
	}
}

func TestRefreshJobsFillEveryKey(t *testing.T) {
	mr := warmerRedis(t)
	t.Setenv("LOGTO_EXTENSION_APP_ID", "desktop-app")
	// Logto side.
	prevList, prevStats := listAllLogtoAccounts, logtoStats
	listAllLogtoAccounts = func() ([]accounts.LogtoAccount, int, bool, error) { return nil, 0, false, nil }
	logtoStats = func() (accounts.LogtoStats, error) { return accounts.LogtoStats{Total: 7}, nil }
	t.Cleanup(func() { listAllLogtoAccounts, logtoStats = prevList, prevStats })
	if err := refreshLogtoNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{logtoAccountsCacheKey, logtoStatsCacheKey} {
		if !mr.Exists(k) {
			t.Fatalf("%s not warmed", k)
		}
	}
	// Website side.
	stubPostHog(t, func(string) ([][]any, error) { return [][]any{{float64(1), float64(1), float64(0), float64(0)}}, nil })
	if err := refreshWebsiteNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, k := range websiteWarmKeys {
		key := websiteCacheKey + string(k)
		if !mr.Exists(key) {
			t.Fatalf("%s not warmed", key)
		}
		var out WebsiteResponse
		raw, _ := mr.Get(key)
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			t.Fatal(err)
		}
		g, _ := time.Parse(time.RFC3339, out.GeneratedAt)
		if d := time.Since(g); d > time.Minute || d < -time.Minute {
			t.Fatalf("%s generated_at %v not fresh", key, out.GeneratedAt)
		}
	}
}

func TestRefreshLogtoReportsFailure(t *testing.T) {
	warmerRedis(t)
	t.Setenv("LOGTO_EXTENSION_APP_ID", "desktop-app")
	prevList, prevStats := listAllLogtoAccounts, logtoStats
	listAllLogtoAccounts = func() ([]accounts.LogtoAccount, int, bool, error) { return nil, 0, false, errors.New("down") }
	logtoStats = func() (accounts.LogtoStats, error) { return accounts.LogtoStats{}, nil }
	t.Cleanup(func() { listAllLogtoAccounts, logtoStats = prevList, prevStats })
	if err := refreshLogtoNow(context.Background()); err == nil {
		t.Fatal("want error")
	}
}
