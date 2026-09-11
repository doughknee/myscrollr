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

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

func productAnalyticsTestApp() *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		if sub := c.Get("X-Test-Sub"); sub != "" {
			c.Locals("user_id", sub)
		}
		if email := c.Get("X-Test-Email"); email != "" {
			c.Locals("user_email", email)
		}
		return c.Next()
	})
	app.Get("/consent", HandleGetProductAnalyticsConsent)
	app.Put("/consent", HandleSetProductAnalyticsConsent)
	app.Post("/activity", HandleRecordProductActivity)
	app.Get("/posthog-consent", HandleGetPostHogConsent)
	app.Put("/posthog-consent", HandleSetPostHogConsent)
	app.Post("/posthog-event", HandlePostHogDesktopEvent)
	app.Post("/verify-website-signup", HandleVerifyRecentWebsiteSignup)
	return app
}

func TestPostHogDesktopEventAllowlist(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		ok   bool
	}{
		{"opened", `{"event":"desktop_app_opened"}`, true},
		{"running", `{"event":"desktop_app_running"}`, true},
		{"feature", `{"event":"desktop_feature_configured","feature":"sports"}`, true},
		{"unknown event", `{"event":"clicked_everything"}`, false},
		{"content", `{"event":"desktop_feature_configured","feature":"AAPL"}`, false},
		{"expanded", `{"event":"desktop_app_opened","url":"https://private.example"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodePostHogDesktopEvent([]byte(tc.body))
			if (err == nil) != tc.ok {
				t.Fatalf("decode error = %v, ok=%v", err, tc.ok)
			}
		})
	}
}

func TestPostHogConsentCannotReenableDeletingAccount(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "deleting-posthog-user"
	testsupport.MustExec(t, `DELETE FROM posthog_analytics_consents WHERE logto_sub = $1`, sub)
	testsupport.MustExec(t, `
		INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
		VALUES ($1, now(), now() + interval '30 days', 'pending')
		ON CONFLICT (logto_sub) DO UPDATE SET status = 'pending'`, sub)
	if _, err := setPostHogConsent(context.Background(), sub, "enabled"); !errors.Is(err, errAccountDeleting) {
		t.Fatalf("enable during account deletion error = %v, want errAccountDeleting", err)
	}
}

func TestPostHogDeclineStaysPendingWithoutDeletionCredentials(t *testing.T) {
	resetProductAnalytics(t)
	for _, name := range []string{"POSTHOG_PROJECT_ID", "POSTHOG_PERSONAL_API_KEY", "POSTHOG_DISTINCT_ID_SALT"} {
		t.Setenv(name, "")
	}
	status, err := setPostHogConsent(context.Background(), "posthog-pending-user", "declined")
	if err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("deletion status = %q, want pending", status)
	}
	if _, err := setPostHogConsent(context.Background(), "posthog-pending-user", "enabled"); !errors.Is(err, errPostHogDeletionPending) {
		t.Fatalf("re-enable error = %v, want errPostHogDeletionPending", err)
	}
}

func TestPostHogPresenceRequiresCaptureAndDeclineRemovesIt(t *testing.T) {
	resetProductAnalytics(t)
	mr := miniredis.RunT(t)
	previous := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = platform.Rdb.Close()
		platform.Rdb = previous
	})
	t.Setenv("POSTHOG_CAPTURE_ENABLED", "false")
	const sub = "posthog-presence-user"
	if _, err := setPostHogConsent(context.Background(), sub, "enabled"); err != nil {
		t.Fatal(err)
	}
	app := productAnalyticsTestApp()
	resp := analyticsRequest(t, app, http.MethodPost, "/posthog-event", sub, `{"event":"desktop_presence"}`)
	if resp.StatusCode != http.StatusNoContent || mr.Exists("posthog:recent-presence") {
		t.Fatalf("disabled capture status=%d presence=%v, want 204 and no presence", resp.StatusCode, mr.Exists("posthog:recent-presence"))
	}
	recordRecentPresence(sub)
	if !mr.Exists("posthog:recent-presence") {
		t.Fatal("test presence was not recorded")
	}
	resp = analyticsRequest(t, app, http.MethodPut, "/posthog-consent", sub, `{"decision":"declined"}`)
	if resp.StatusCode != http.StatusOK || mr.Exists("posthog:recent-presence") {
		t.Fatalf("decline status=%d presence=%v, want 200 and no presence", resp.StatusCode, mr.Exists("posthog:recent-presence"))
	}
}

func TestPostHogDesktopEventsExcludeStaffAndConfiguredTestUsers(t *testing.T) {
	resetProductAnalytics(t)
	mr := miniredis.RunT(t)
	previous := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = platform.Rdb.Close()
		platform.Rdb = previous
	})
	t.Setenv("POSTHOG_CAPTURE_ENABLED", "true")
	t.Setenv("POSTHOG_PROJECT_KEY", "project-key")
	t.Setenv("POSTHOG_PROJECT_ID", "project-id")
	t.Setenv("POSTHOG_PERSONAL_API_KEY", "personal-key")
	t.Setenv("POSTHOG_DISTINCT_ID_SALT", "salt")
	t.Setenv("POSTHOG_HOST", "https://example.test")
	t.Setenv("POSTHOG_API_HOST", "https://example.test")
	t.Setenv("POSTHOG_EXCLUDED_LOGTO_SUBS", "test-user")
	testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'staff-desktop@example.test'`)
	testsupport.MustExec(t, `INSERT INTO admin_users (email) VALUES ('staff-desktop@example.test')`)
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'staff-desktop@example.test'`) })
	previousLogto := postHogLogtoUser
	postHogLogtoUser = func(sub string) (*LogtoUser, error) {
		email := sub + "@example.test"
		if sub == "staff-user" {
			email = "staff-desktop@example.test"
		}
		return &LogtoUser{ID: sub, PrimaryEmail: email}, nil
	}
	previousCapture := postHogCaptureDesktopEvent
	captureCalls := 0
	postHogCaptureDesktopEvent = func(string, postHogDesktopEvent) error {
		captureCalls++
		return nil
	}
	t.Cleanup(func() {
		postHogLogtoUser = previousLogto
		postHogCaptureDesktopEvent = previousCapture
	})
	app := productAnalyticsTestApp()
	for _, sub := range []string{"staff-user", "test-user"} {
		if _, err := setPostHogConsent(context.Background(), sub, "enabled"); err != nil {
			t.Fatal(err)
		}
		email := ""
		if sub == "staff-user" {
			email = "staff-desktop@example.test"
		}
		resp := analyticsRequestWithEmail(t, app, http.MethodPost, "/posthog-event", sub, email, `{"event":"desktop_app_opened"}`)
		if resp.StatusCode != http.StatusNoContent || mr.Exists("posthog:recent-presence") {
			t.Fatalf("excluded actor %q status=%d presence=%v, want 204 and no presence", sub, resp.StatusCode, mr.Exists("posthog:recent-presence"))
		}
	}
	if captureCalls != 0 {
		t.Fatalf("vendor capture calls = %d, want 0", captureCalls)
	}
	var mirrors int
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT count(*) FROM posthog_analytics_events`).Scan(&mirrors); err != nil {
		t.Fatal(err)
	}
	if mirrors != 0 {
		t.Fatalf("local event mirrors = %d, want 0", mirrors)
	}
}

func TestPostHogExportIncludesAccountLinkedEvents(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "posthog-export-user"
	if _, err := setPostHogConsent(context.Background(), sub, "enabled"); err != nil {
		t.Fatal(err)
	}
	testsupport.MustExec(t, `
		INSERT INTO posthog_analytics_events
			(insert_id, logto_sub, event, feature, app_version, occurred_at, delivered)
		VALUES ('export-event', $1, 'desktop_feature_configured', 'sports', '1.2.3', NOW(), TRUE)`, sub)
	exported, err := loadPostHogAnalyticsExport(context.Background(), sub)
	if err != nil {
		t.Fatal(err)
	}
	events := exported["events"].([]map[string]any)
	if len(events) != 1 || events[0]["event"] != "desktop_feature_configured" || events[0]["delivered"] != true {
		t.Fatalf("events = %#v", events)
	}
}

func TestRecentWebsiteSignupRequiresFreshMatchingLogtoAccount(t *testing.T) {
	t.Setenv("LOGTO_WEB_APP_ID", "website-app")
	now := time.Date(2026, time.September, 10, 12, 0, 0, 0, time.UTC)
	user := LogtoUser{ApplicationID: "website-app", CreatedAt: now.Add(-time.Minute).UnixMilli()}
	if !recentWebsiteSignup(user, now) {
		t.Fatal("fresh website account was not verified")
	}
	user.ApplicationID = "desktop-app"
	if recentWebsiteSignup(user, now) {
		t.Fatal("desktop account was accepted as a website signup")
	}
	user.ApplicationID = "website-app"
	user.CreatedAt = now.Add(-16 * time.Minute).UnixMilli()
	if recentWebsiteSignup(user, now) {
		t.Fatal("old account was accepted as a new signup")
	}
}

func TestWebsiteAnalyticsContextReturnsOnlyEligiblePseudonym(t *testing.T) {
	resetProductAnalytics(t)
	t.Setenv("LOGTO_WEB_APP_ID", "website-app")
	t.Setenv("POSTHOG_DISTINCT_ID_SALT", "test-salt")
	t.Setenv("POSTHOG_EXCLUDED_LOGTO_SUBS", "test-user")
	previous := postHogLogtoUser
	postHogLogtoUser = func(sub string) (*LogtoUser, error) {
		email := sub + "@example.test"
		if sub == "staff-user" {
			email = "staff-posthog@example.test"
		}
		return &LogtoUser{ID: sub, PrimaryEmail: email, ApplicationID: "website-app", CreatedAt: time.Now().Add(-time.Minute).UnixMilli()}, nil
	}
	t.Cleanup(func() { postHogLogtoUser = previous })
	testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'staff-posthog@example.test'`)
	testsupport.MustExec(t, `INSERT INTO admin_users (email) VALUES ('staff-posthog@example.test')`)
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'staff-posthog@example.test'`) })

	app := productAnalyticsTestApp()
	for _, sub := range []string{"staff-user", "test-user"} {
		resp := analyticsRequest(t, app, http.MethodPost, "/verify-website-signup", sub, "")
		var result struct {
			Eligible   bool   `json:"eligible"`
			Verified   bool   `json:"verified"`
			DistinctID string `json:"analytics_distinct_id"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if result.Eligible || result.Verified || result.DistinctID != "" {
			t.Fatalf("excluded actor %q received analytics context: %#v", sub, result)
		}
	}
	resp := analyticsRequest(t, app, http.MethodPost, "/verify-website-signup", "customer-user", "")
	var result struct {
		Eligible   bool   `json:"eligible"`
		Verified   bool   `json:"verified"`
		DistinctID string `json:"analytics_distinct_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if !result.Eligible || !result.Verified || result.DistinctID != postHogDistinctID("customer-user") {
		t.Fatalf("customer analytics context = %#v", result)
	}
}

func TestPostHogConsentDefaultsOnAndPreservesDecline(t *testing.T) {
	resetProductAnalytics(t)
	t.Setenv("POSTHOG_EXCLUDED_LOGTO_SUBS", "excluded-user")
	previous := postHogLogtoUser
	postHogLogtoUser = func(sub string) (*LogtoUser, error) {
		return &LogtoUser{ID: sub, PrimaryEmail: sub + "@example.test"}, nil
	}
	t.Cleanup(func() { postHogLogtoUser = previous })
	app := productAnalyticsTestApp()
	const sub = "default-on-user"

	resp := analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
	var got PostHogConsent
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Decision != "enabled" {
		t.Fatalf("default decision = %q, want enabled", got.Decision)
	}

	resp = analyticsRequest(t, app, http.MethodPut, "/posthog-consent", sub, `{"decision":"declined"}`)
	resp = analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Decision != "declined" {
		t.Fatalf("saved decision = %q, want declined", got.Decision)
	}

	resp = analyticsRequest(t, app, http.MethodGet, "/posthog-consent", "excluded-user", "")
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Decision != "declined" {
		t.Fatalf("excluded decision = %q, want declined", got.Decision)
	}
}

func analyticsRequest(t *testing.T, app *fiber.App, method, path, sub, body string) *http.Response {
	return analyticsRequestWithEmail(t, app, method, path, sub, "", body)
}

func analyticsRequestWithEmail(t *testing.T, app *fiber.App, method, path, sub, email, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sub != "" {
		req.Header.Set("X-Test-Sub", sub)
	}
	if email != "" {
		req.Header.Set("X-Test-Email", email)
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
	if _, err := platform.DBPool.Exec(context.Background(),
		`TRUNCATE posthog_analytics_consents CASCADE`); err != nil {
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
