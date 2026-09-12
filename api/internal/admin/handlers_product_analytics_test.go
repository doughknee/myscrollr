package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func resetAdminProductAnalytics(t *testing.T) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	if _, err := platform.DBPool.Exec(context.Background(),
		`TRUNCATE product_analytics_enrollments CASCADE`); err != nil {
		t.Fatal(err)
	}
}

func TestProductAnalyticsAggregateUsesMatureExactDayCohorts(t *testing.T) {
	resetAdminProductAnalytics(t)
	for _, row := range []struct {
		sub, first  string
		d1, d7, d30 any
	}{
		{"d1-return", "2026-09-09", true, nil, nil},
		{"d7-return", "2026-09-03", nil, true, nil},
		{"d30-return", "2026-08-11", nil, nil, true},
		{"immature", "2026-09-10", nil, nil, nil},
		{"d1-miss", "2026-09-09", nil, nil, nil},
		{"enrolled-only", "", nil, nil, nil},
	} {
		if row.first == "" {
			testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments (logto_sub, enrolled_at) VALUES ($1, '2026-08-01')`, row.sub)
			continue
		}
		testsupport.MustExec(t, `
			INSERT INTO product_analytics_enrollments
				(logto_sub, enrolled_at, first_active_day, retained_d1, retained_d7, retained_d30)
			VALUES ($1, '2026-08-01', $2, $3, $4, $5)`, row.sub, row.first, row.d1, row.d7, row.d30)
	}
	for _, fact := range []struct {
		sub, day, category string
	}{
		{"d1-return", "2026-09-09", "sports"}, {"d1-return", "2026-09-10", "sports"},
		{"d7-return", "2026-09-03", "markets"}, {"d7-return", "2026-09-10", "markets"},
		{"d30-return", "2026-08-11", "news"}, {"d30-return", "2026-09-10", "news"},
		{"immature", "2026-09-10", "utilities"}, {"d1-miss", "2026-09-09", "fantasy"},
	} {
		testsupport.MustExec(t, `INSERT INTO product_activity_daily (logto_sub, day, `+fact.category+`) VALUES ($1, $2, true)`, fact.sub, fact.day)
	}

	previousNow := productAnalyticsReportNow
	productAnalyticsReportNow = func() time.Time { return time.Date(2026, 9, 10, 18, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { productAnalyticsReportNow = previousNow })

	app := fiber.New()
	app.Get("/admin/product-analytics", HandleGetProductAnalytics)
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/product-analytics?days=7", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var got ProductAnalyticsResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.EnrolledAccounts != 6 || got.Activity.DAU != 4 || got.Activity.WAU != 5 || got.Activity.MAU != 5 {
		t.Fatalf("population/activity = %d %+v", got.EnrolledAccounts, got.Activity)
	}
	if got.Retention.D1.Eligible != 4 || got.Retention.D1.Returned != 1 || got.Retention.D1.Rate != 0.25 {
		t.Fatalf("D1 = %+v", got.Retention.D1)
	}
	if got.Retention.D7.Eligible != 2 || got.Retention.D7.Returned != 1 || got.Retention.D7.Rate != 0.5 {
		t.Fatalf("D7 = %+v", got.Retention.D7)
	}
	if got.Retention.D30.Eligible != 1 || got.Retention.D30.Returned != 1 || got.Retention.D30.Rate != 1 {
		t.Fatalf("D30 = %+v", got.Retention.D30)
	}
	if got.Activation.FirstObserved != 3 {
		t.Fatalf("first observed in 7d = %d, want 3", got.Activation.FirstObserved)
	}
	if len(got.Features) != 6 || got.Features[0].Category != "sports" || got.Features[0].Accounts != 1 || got.Features[0].Share != 0.2 {
		t.Fatalf("features = %+v", got.Features)
	}
}

func TestProductAnalyticsAggregateMarksImmatureDenominatorUnavailable(t *testing.T) {
	resetAdminProductAnalytics(t)
	testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments (logto_sub, first_active_day) VALUES ('new', DATE '2026-09-10')`)
	previousNow := productAnalyticsReportNow
	productAnalyticsReportNow = func() time.Time { return time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC) }
	t.Cleanup(func() { productAnalyticsReportNow = previousNow })

	report, err := loadProductAnalytics(context.Background(), 7, productAnalyticsReportNow(), false)
	if err != nil {
		t.Fatal(err)
	}
	if report.Retention.D1.Available || report.Retention.D1.Eligible != 0 {
		t.Fatalf("immature D1 = %+v", report.Retention.D1)
	}
}

func TestProductAnalyticsAggregateValidatesWindow(t *testing.T) {
	app := fiber.New()
	app.Get("/admin/product-analytics", HandleGetProductAnalytics)
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/product-analytics?days=90", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}
