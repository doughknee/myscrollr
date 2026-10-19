package accounts

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"golang.org/x/sync/errgroup"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Logto Management API — the dashboard stats endpoints
// =============================================================================
//
// Logto already computes account growth and activity, with each figure's
// change against the previous period, and a daily-active series about a month
// deep. Reading it costs three requests and no storage: no aggregation table,
// no nightly rollup, no cron. That is the whole reason to prefer these over
// walking /api/users and counting rows ourselves (REL-269).
//
// ⚠️ SECURITY: /api/dashboard/* sits one path segment away from
// /api/connectors, whose response body returns every connector's
// configuration INCLUDING API TOKENS IN PLAINTEXT. It is not a dashboard data
// source under any circumstance. Nothing in this codebase calls it, and
// nothing should start.

// LogtoTrend is a count together with Logto's own change against the previous
// comparable period. The delta is the point: 85 monthly actives says little,
// 85 up from 35 says the product is growing.
type LogtoTrend struct {
	Count int `json:"count"`
	Delta int `json:"delta"`
}

// LogtoDayCount is one point on the daily-active curve. Date is "2006-01-02".
type LogtoDayCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// LogtoStats is everything the three dashboard endpoints report.
//
// Total replaces the total-number header trick REL-265 used: same number, from
// an endpoint that exists to answer exactly this.
type LogtoStats struct {
	Total    int
	NewToday LogtoTrend
	New7d    LogtoTrend
	DAU      LogtoTrend
	WAU      LogtoTrend
	MAU      LogtoTrend
	DauCurve []LogtoDayCount
}

// FetchLogtoStats reads the three dashboard endpoints concurrently, so a cold
// read costs one Logto round trip instead of three (SCROLLR-326).
//
// Any one failing fails the whole read — a half-filled growth tile is worse
// than one that says Logto is down.
func FetchLogtoStats() (LogtoStats, error) {
	var (
		total struct {
			TotalUserCount int `json:"totalUserCount"`
		}
		fresh struct {
			Today     LogtoTrend `json:"today"`
			Last7Days LogtoTrend `json:"last7Days"`
		}
		active struct {
			DAU      LogtoTrend      `json:"dau"`
			WAU      LogtoTrend      `json:"wau"`
			MAU      LogtoTrend      `json:"mau"`
			DauCurve []LogtoDayCount `json:"dauCurve"`
		}
	)

	var g errgroup.Group
	g.Go(func() error { return logtoGetJSON("/api/dashboard/users/total", &total) })
	g.Go(func() error { return logtoGetJSON("/api/dashboard/users/new", &fresh) })
	g.Go(func() error { return logtoGetJSON("/api/dashboard/users/active", &active) })
	if err := g.Wait(); err != nil {
		return LogtoStats{}, err
	}

	return LogtoStats{
		Total:    total.TotalUserCount,
		NewToday: fresh.Today,
		New7d:    fresh.Last7Days,
		DAU:      active.DAU,
		WAU:      active.WAU,
		MAU:      active.MAU,
		DauCurve: active.DauCurve,
	}, nil
}

// logtoGetJSON GETs a Management API path with the M2M token and decodes the
// body into out. path starts with a slash.
func logtoGetJSON(path string, out any) error {
	cfg := getM2MConfig()
	if cfg.Endpoint == "" {
		return fmt.Errorf("LOGTO_ENDPOINT not set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	req, err := http.NewRequest("GET", cfg.Endpoint+path, nil)
	if err != nil {
		return fmt.Errorf("create %s request: %w", path, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%s request failed: %w", path, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned %d: %s", path, resp.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}
