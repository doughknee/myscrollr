package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/redis/go-redis/v9"
)

func stubPostHog(t *testing.T, fn func(query string) ([][]any, error)) *[]string {
	t.Helper()
	t.Setenv("POSTHOG_QUERY_API_KEY", "phx_test")
	t.Setenv("POSTHOG_PROJECT_ID", "1")
	t.Setenv("POSTHOG_API_HOST", "https://example.test")
	var queries []string
	var mu sync.Mutex
	prev := postHogQuery
	postHogQuery = func(_ context.Context, query string) ([][]any, error) {
		mu.Lock()
		queries = append(queries, query)
		mu.Unlock()
		return fn(query)
	}
	t.Cleanup(func() { postHogQuery = prev })
	return &queries
}

func TestWebsiteReportBoundsEveryQueryAndMapsBuckets(t *testing.T) {
	now := time.Date(2026, 9, 18, 15, 45, 0, 0, time.UTC)
	t.Setenv("POSTHOG_COLLECTION_STARTED_AT", "2026-09-11T00:00:00Z")
	period, _ := ParsePeriod("7d", now)
	var calls int32
	queries := stubPostHog(t, func(q string) ([][]any, error) {
		atomic.AddInt32(&calls, 1)
		switch {
		case strings.Contains(q, "countIf(event = '$pageview')"):
			if strings.Contains(q, "toDateTime('2026-09-04 15:45:00', 'UTC')") {
				// previous window (Sep 4 – Sep 11) — starts before coverage.
				return [][]any{{float64(10), float64(4), float64(1), float64(0)}}, nil
			}
			return [][]any{{float64(120), float64(45), float64(6), float64(2)}}, nil
		case strings.Contains(q, "intDiv("):
			return [][]any{{float64(0), float64(30), float64(12)}, {float64(6), float64(90), float64(40)}, {float64(9), float64(999), float64(999)}}, nil
		case strings.Contains(q, "properties.path"):
			return [][]any{{"/", float64(80), float64(40)}, {"/download", float64(20), float64(15)}}, nil
		default:
			return [][]any{}, nil
		}
	})
	out := loadWebsite(context.Background(), period, now)
	if !out.Available || out.Pageviews.Value != 120 || out.Visitors.Value != 45 || out.Downloads.Value != 6 || out.Signups.Value != 2 {
		t.Fatalf("totals = %+v", out)
	}
	// The previous window starts before collection began: no comparison.
	if out.Pageviews.Comparison.Comparable || out.Pageviews.Comparison.Previous != nil {
		t.Fatalf("comparison must be refused with partial history: %+v", out.Pageviews.Comparison)
	}
	if len(out.Curve) != 7 || out.Curve[0].Value != 30 || out.Curve[6].Value != 90 || out.VisitorsCurve[6].Value != 40 {
		t.Fatalf("curve = %+v visitors %+v", out.Curve, out.VisitorsCurve)
	}
	if out.TopPaths[0].Key != "/" || out.TopPaths[1].Visitors != 15 {
		t.Fatalf("paths = %+v", out.TopPaths)
	}
	cutoffQueries := 0
	for _, q := range *queries {
		if !strings.Contains(q, "timestamp >= toDateTime(") || !strings.Contains(q, "timestamp < toDateTime(") {
			t.Fatalf("query without both half-open bounds: %s", q)
		}
		if strings.Contains(q, "timestamp < toDateTime('2026-09-18 15:45:00', 'UTC')") {
			cutoffQueries++
		}
		if !strings.Contains(q, "is_internal") || !strings.Contains(q, "properties.surface = 'website'") {
			t.Fatalf("query without the internal/website filters: %s", q)
		}
	}
	// Everything but the previous-window totals ends at the report cutoff.
	if cutoffQueries != len(*queries)-1 {
		t.Fatalf("%d of %d queries end at the cutoff", cutoffQueries, len(*queries))
	}
	if !out.Coverage.Partial && period.Start.Before(websiteCollectionStart()) {
		t.Fatalf("coverage = %+v, want partial for a window that starts before collection", out.Coverage)
	}
	if calls := atomic.LoadInt32(&calls); calls < 6 {
		t.Fatalf("expected totals ×2, curve and breakdowns, got %d calls", calls)
	}
}

func TestWebsiteReportIsUnavailableWithoutAKeyOrOnError(t *testing.T) {
	now := time.Date(2026, 9, 18, 15, 45, 0, 0, time.UTC)
	period, _ := ParsePeriod("24h", now)
	t.Setenv("POSTHOG_QUERY_API_KEY", "")
	out := loadWebsite(context.Background(), period, now)
	if out.Available || out.Visitors.Available || !strings.Contains(out.Note, "POSTHOG_QUERY_API_KEY") {
		t.Fatalf("unconfigured = %+v", out)
	}
	stubPostHog(t, func(string) ([][]any, error) { return nil, errors.New("status 401") })
	out = loadWebsite(context.Background(), period, now)
	if out.Available || out.Pageviews.Available || !strings.Contains(out.Note, "401") {
		t.Fatalf("error = %+v", out)
	}
	if out.Curve == nil || out.TopPaths == nil {
		t.Fatal("unavailable report must still serialise empty arrays")
	}
}

// A near-expiry report is served as-is and refreshed exactly once in the
// background, however many readers arrive at once; the refreshed entry carries
// a new generated_at.
func TestCachedWebsiteRefreshesNearExpiryOnce(t *testing.T) {
	mr := miniredis.RunT(t)
	prevRdb := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { platform.Rdb = prevRdb })

	now := time.Now().UTC().Truncate(time.Second)
	prevNow := websiteNow
	websiteNow = func() time.Time { return now }
	t.Cleanup(func() { websiteNow = prevNow })

	var totalsCalls int32
	stubPostHog(t, func(q string) ([][]any, error) {
		time.Sleep(50 * time.Millisecond)
		if strings.Contains(q, "countIf(event = '$pageview')") {
			atomic.AddInt32(&totalsCalls, 1)
			return [][]any{{float64(2), float64(1), float64(0), float64(0)}}, nil
		}
		return [][]any{}, nil
	})

	period, _ := ParsePeriod("24h", now)
	old := websiteUnavailable(period, now.Add(-websiteRefreshAfter-time.Second), "")
	old.Available = true
	old.Pageviews = Metric{Value: 1, Available: true}
	raw, _ := json.Marshal(old)
	key := websiteCacheKey + string(period.Key)
	platform.Rdb.Set(context.Background(), key, raw, websiteCacheTTL)

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, cached := cachedWebsite(context.Background(), period, now)
			if !cached || out.Pageviews.Value != 1 {
				t.Errorf("reader should get the cached entry at once, got %+v cached=%v", out.Pageviews, cached)
			}
		}()
	}
	wg.Wait()

	deadline := time.Now().Add(3 * time.Second)
	var got WebsiteResponse
	for time.Now().Before(deadline) {
		b, _ := platform.Rdb.Get(context.Background(), key).Bytes()
		if json.Unmarshal(b, &got) == nil && got.Pageviews.Value == 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if n := atomic.LoadInt32(&totalsCalls); n != 2 { // current + previous window, one refresh
		t.Fatalf("want exactly 1 background refresh (2 totals queries), got %d queries", n)
	}
	if got.Pageviews.Value != 2 || got.GeneratedAt != now.Format(time.RFC3339) {
		t.Fatalf("entry not refreshed with a new generated_at: %+v", got.GeneratedAt)
	}
}
