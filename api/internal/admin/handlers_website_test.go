package admin

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func stubPostHog(t *testing.T, fn func(query string) ([][]any, error)) *[]string {
	t.Helper()
	t.Setenv("POSTHOG_QUERY_API_KEY", "phx_test")
	t.Setenv("POSTHOG_PROJECT_ID", "1")
	t.Setenv("POSTHOG_API_HOST", "https://example.test")
	var queries []string
	prev := postHogQuery
	postHogQuery = func(_ context.Context, query string) ([][]any, error) {
		queries = append(queries, query)
		return fn(query)
	}
	t.Cleanup(func() { postHogQuery = prev })
	return &queries
}

func TestWebsiteReportBoundsEveryQueryAndMapsBuckets(t *testing.T) {
	now := time.Date(2026, 9, 18, 15, 45, 0, 0, time.UTC)
	t.Setenv("POSTHOG_COLLECTION_STARTED_AT", "2026-09-11T00:00:00Z")
	period, _ := ParsePeriod("7d", now)
	calls := 0
	queries := stubPostHog(t, func(q string) ([][]any, error) {
		calls++
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
	if calls < 6 {
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
