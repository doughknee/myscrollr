package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func productAnalyticsTestApp() *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		if sub := c.Get("X-Test-Sub"); sub != "" {
			c.Locals("user_id", sub)
		}
		return c.Next()
	})
	app.Get("/consent", HandleGetProductAnalyticsConsent)
	app.Put("/consent", HandleSetProductAnalyticsConsent)
	app.Post("/activity", HandleRecordProductActivity)
	return app
}

func analyticsRequest(t *testing.T, app *fiber.App, method, path, sub, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sub != "" {
		req.Header.Set("X-Test-Sub", sub)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func resetProductAnalytics(t *testing.T) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	if _, err := platform.DBPool.Exec(context.Background(),
		`TRUNCATE product_analytics_enrollments CASCADE`); err != nil {
		t.Fatal(err)
	}
}

func TestProductAnalyticsConsentDefaultsOffAndIsIdempotent(t *testing.T) {
	resetProductAnalytics(t)
	app := productAnalyticsTestApp()
	const sub = "consent-user"

	resp := analyticsRequest(t, app, http.MethodGet, "/consent", sub, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("default consent status = %d", resp.StatusCode)
	}
	var got ProductAnalyticsConsent
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Enabled {
		t.Fatal("consent defaulted on")
	}

	for range 2 {
		resp = analyticsRequest(t, app, http.MethodPut, "/consent", sub, `{"enabled":true}`)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("enable status = %d", resp.StatusCode)
		}
	}
	var count int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM product_analytics_enrollments WHERE logto_sub = $1`, sub).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("enrollment rows = %d, want 1", count)
	}
}

func TestProductAnalyticsConsentCannotReenablePendingOrPurgedAccount(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "deleting-consent-user"
	for _, status := range []string{"pending", "purged"} {
		t.Run(status, func(t *testing.T) {
			testsupport.MustExec(t, `
				INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
				VALUES ($1, now() - interval '31 days', now() - interval '1 day', $2)
				ON CONFLICT (logto_sub) DO UPDATE SET status = EXCLUDED.status`, sub, status)

			if err := setProductAnalyticsConsent(context.Background(), sub, true); !errors.Is(err, errAccountDeleting) {
				t.Fatalf("enable with %s deletion status error = %v, want errAccountDeleting", status, err)
			}
			var count int
			if err := platform.DBPool.QueryRow(context.Background(),
				`SELECT count(*) FROM product_analytics_enrollments WHERE logto_sub = $1`, sub).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("enrollment rows with %s deletion status = %d, want 0", status, count)
			}
		})
	}
}

func TestProductAnalyticsEnableSerializesWithAccountPurge(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "purge-race-consent-user"
	testsupport.MustExec(t, `
		INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
		VALUES ($1, now() - interval '31 days', now() - interval '1 day', 'pending')
		ON CONFLICT (logto_sub) DO UPDATE SET status = 'pending'`, sub)

	tx, err := platform.DBPool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if err := lockAccountMutation(context.Background(), tx, sub); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- setProductAnalyticsConsent(context.Background(), sub, true) }()
	select {
	case err := <-done:
		t.Fatalf("consent update escaped purge lock: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := tx.Exec(context.Background(),
		`UPDATE user_deletion_requests SET status = 'purged', purged_at = now() WHERE logto_sub = $1`, sub); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := <-done; !errors.Is(err, errAccountDeleting) {
		t.Fatalf("enable after purge error = %v, want errAccountDeleting", err)
	}
	var count int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM product_analytics_enrollments WHERE logto_sub = $1`, sub).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("enrollment rows after purge race = %d, want 0", count)
	}
}

func TestProductAnalyticsRejectsMalformedOrExpandedPayloads(t *testing.T) {
	resetProductAnalytics(t)
	app := productAnalyticsTestApp()
	const sub = "validation-user"

	for _, tc := range []struct {
		path, body string
	}{
		{"/consent", `{}`},
		{"/consent", `{"enabled":true,"user_id":"spoof"}`},
		{"/activity", `{}`},
		{"/activity", `{"categories":["sports"],"day":"2020-01-01"}`},
		{"/activity", `{"categories":["stocks"]}`},
		{"/activity", `{"categories":["sports","sports"]}`},
	} {
		method := http.MethodPost
		if tc.path == "/consent" {
			method = http.MethodPut
		}
		resp := analyticsRequest(t, app, method, tc.path, sub, tc.body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s %s status = %d, want 400", tc.path, tc.body, resp.StatusCode)
		}
	}

	resp := analyticsRequest(t, app, http.MethodPost, "/activity", "", `{"categories":["sports"]}`)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing identity status = %d, want 401", resp.StatusCode)
	}
}

func TestProductActivityUsesServerUTCDayAndUnionsDuplicateDelivery(t *testing.T) {
	resetProductAnalytics(t)
	app := productAnalyticsTestApp()
	const sub = "daily-user"
	previousNow := productAnalyticsNow
	productAnalyticsNow = func() time.Time {
		return time.Date(2026, 9, 11, 0, 1, 0, 0, time.FixedZone("west", -5*60*60))
	}
	t.Cleanup(func() { productAnalyticsNow = previousNow })

	analyticsRequest(t, app, http.MethodPut, "/consent", sub, `{"enabled":true}`)
	for _, body := range []string{
		`{"categories":["sports","news"]}`,
		`{"categories":["markets","utilities"]}`,
	} {
		resp := analyticsRequest(t, app, http.MethodPost, "/activity", sub, body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("activity status = %d", resp.StatusCode)
		}
	}

	var day time.Time
	var sports, markets, news, utilities bool
	if err := platform.DBPool.QueryRow(context.Background(), `
		SELECT day, sports, markets, news, utilities
		  FROM product_activity_daily WHERE logto_sub = $1`, sub).
		Scan(&day, &sports, &markets, &news, &utilities); err != nil {
		t.Fatal(err)
	}
	if day.Format("2006-01-02") != "2026-09-11" || !sports || !markets || !news || !utilities {
		t.Fatalf("daily row = %s %v/%v/%v/%v", day, sports, markets, news, utilities)
	}
}

func TestProductAnalyticsOptOutCannotLeaveInflightFacts(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "race-user"
	if err := setProductAnalyticsConsent(context.Background(), sub, true); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_ = recordProductActivity(context.Background(), sub, []string{"sports"}, time.Now())
	}()
	go func() {
		defer wg.Done()
		_ = setProductAnalyticsConsent(context.Background(), sub, false)
	}()
	wg.Wait()

	var facts int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM product_activity_daily WHERE logto_sub = $1`, sub).Scan(&facts); err != nil {
		t.Fatal(err)
	}
	if facts != 0 {
		t.Fatalf("facts after opt-out race = %d, want 0", facts)
	}
}

func TestProductActivityRecordsOnlyExactRetentionDays(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "retention-user"
	if err := setProductAnalyticsConsent(context.Background(), sub, true); err != nil {
		t.Fatal(err)
	}
	first := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	for _, offset := range []int{0, 2, 7, 30} {
		if err := recordProductActivity(context.Background(), sub, []string{"sports"}, first.AddDate(0, 0, offset)); err != nil {
			t.Fatal(err)
		}
	}
	var d1, d7, d30 *bool
	if err := platform.DBPool.QueryRow(context.Background(), `
		SELECT retained_d1, retained_d7, retained_d30
		  FROM product_analytics_enrollments WHERE logto_sub = $1`, sub).
		Scan(&d1, &d7, &d30); err != nil {
		t.Fatal(err)
	}
	if d1 != nil || d7 == nil || !*d7 || d30 == nil || !*d30 {
		t.Fatalf("retention flags d1=%v d7=%v d30=%v", d1, d7, d30)
	}
}

func TestProductAnalyticsExportFailsInsteadOfClaimingDisabledOnReadError(t *testing.T) {
	resetProductAnalytics(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := loadProductAnalyticsExport(ctx, "export-user"); err == nil {
		t.Fatal("canceled analytics export read returned no error")
	}
}
