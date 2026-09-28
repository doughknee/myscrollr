package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func analyticsReport(application string, days int) accounts.SignupAnalytics {
	return accounts.SignupAnalytics{
		Application: application,
		WindowDays:  days,
		GeneratedAt: "2026-09-10T12:00:00Z",
		Measurement: "events",
		Stages: map[string]accounts.SignupStageMetrics{
			"started": {Events: 3, Errors: 1},
		},
		Coverage: accounts.SignupCoverage{Status: "unknown", Retention: "unknown"},
	}
}

func TestHandleGetAnalyticsValidatesSelectors(t *testing.T) {
	app := fiber.New()
	app.Get("/admin/analytics", HandleGetAnalytics)

	for _, path := range []string{
		"/admin/analytics?application=mobile",
		"/admin/analytics?days=14",
	} {
		resp, err := app.Test(httptest.NewRequest(http.MethodGet, path, nil))
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s status = %d, want 400", path, resp.StatusCode)
		}
	}
}

func TestHandleGetAnalyticsReturnsUnavailableWithoutLeakingUpstreamError(t *testing.T) {
	previous := fetchSignupAnalytics
	fetchSignupAnalytics = func(context.Context, string, int, time.Time) (accounts.SignupAnalytics, error) {
		return accounts.SignupAnalytics{}, errors.New("private@example.test private-token")
	}
	t.Cleanup(func() { fetchSignupAnalytics = previous })
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	app := fiber.New()
	app.Get("/admin/analytics", HandleGetAnalytics)
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/analytics?application=website&days=7", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if body["error"] != "Signup analytics are unavailable." {
		t.Fatalf("error = %q", body["error"])
	}
}

func TestCachedSignupAnalyticsSeparatesKeysAndReusesAggregate(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	previous := fetchSignupAnalytics
	var calls atomic.Int32
	fetchSignupAnalytics = func(_ context.Context, application string, days int, _ time.Time) (accounts.SignupAnalytics, error) {
		calls.Add(1)
		return analyticsReport(application, days), nil
	}
	t.Cleanup(func() { fetchSignupAnalytics = previous })

	ctx := context.Background()
	first, firstHit, err := cachedSignupAnalytics(ctx, "website", 7)
	if err != nil {
		t.Fatal(err)
	}
	second, secondHit, err := cachedSignupAnalytics(ctx, "website", 7)
	if err != nil {
		t.Fatal(err)
	}
	_, _, _ = cachedSignupAnalytics(ctx, "desktop", 7)
	_, _, _ = cachedSignupAnalytics(ctx, "website", 30)

	if firstHit || !secondHit || first.Application != second.Application {
		t.Fatalf("cache hit flags/data = %v/%v %+v/%+v", firstHit, secondHit, first, second)
	}
	if calls.Load() != 3 {
		t.Fatalf("fetch calls = %d, want one per app/window key", calls.Load())
	}
}

func TestCachedSignupAnalyticsCoalescesConcurrentColdReads(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	previous := fetchSignupAnalytics
	var calls atomic.Int32
	release := make(chan struct{})
	fetchSignupAnalytics = func(_ context.Context, application string, days int, _ time.Time) (accounts.SignupAnalytics, error) {
		calls.Add(1)
		<-release
		return analyticsReport(application, days), nil
	}
	t.Cleanup(func() { fetchSignupAnalytics = previous })

	var wg sync.WaitGroup
	wg.Add(2)
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			defer wg.Done()
			_, _, err := cachedSignupAnalytics(context.Background(), "website", 7)
			errs <- err
		}()
	}
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	close(release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("concurrent cold reads fetched %d times, want 1", calls.Load())
	}
}

func TestHandleGetAnalyticsTimesOutStalledColdRead(t *testing.T) {
	previousFetch := fetchSignupAnalytics
	previousTimeout := signupAnalyticsTimeout
	signupAnalyticsTimeout = 20 * time.Millisecond
	fetchSignupAnalytics = func(ctx context.Context, _ string, _ int, _ time.Time) (accounts.SignupAnalytics, error) {
		<-ctx.Done()
		return accounts.SignupAnalytics{}, ctx.Err()
	}
	t.Cleanup(func() {
		fetchSignupAnalytics = previousFetch
		signupAnalyticsTimeout = previousTimeout
	})
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	app := fiber.New()
	app.Get("/admin/analytics", HandleGetAnalytics)
	started := time.Now()
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/analytics?application=website&days=30", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if elapsed := time.Since(started); elapsed > 200*time.Millisecond {
		t.Fatalf("handler took %v, want bounded response", elapsed)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", resp.StatusCode)
	}
}

// TestRecentCompleteWeeksTilesMondaySundayExcludingTheCurrentWeek pins the
// week-1-return cohort boundaries: fixed Monday-Sunday UTC weeks, most
// recent first, never including the still-accumulating current week.
func TestRecentCompleteWeeksTilesMondaySundayExcludingTheCurrentWeek(t *testing.T) {
	now := time.Date(2026, 9, 28, 15, 0, 0, 0, time.UTC) // a Monday
	weeks := recentCompleteWeeks(now, 4)
	want := []cohortWeek{
		{Start: time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 9, 6, 0, 0, 0, 0, time.UTC)},
		{Start: time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 9, 13, 0, 0, 0, 0, time.UTC)},
		{Start: time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 9, 20, 0, 0, 0, 0, time.UTC)},
		{Start: time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC), End: time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)},
	}
	if len(weeks) != len(want) {
		t.Fatalf("weeks = %d, want %d", len(weeks), len(want))
	}
	for i, w := range weeks {
		if !w.Start.Equal(want[i].Start) || !w.End.Equal(want[i].End) {
			t.Fatalf("weeks[%d] = %+v, want %+v", i, w, want[i])
		}
	}
}

// TestLoadWeek1ReturnExcludesStaffAndTestSubsAndMarksImmatureCohortUnavailable
// is the acceptance test: a staff sub never counts (and is never even asked
// about a return), and a cohort younger than 7 days renders as unavailable
// rather than 0.
func TestLoadWeek1ReturnExcludesStaffAndTestSubsAndMarksImmatureCohortUnavailable(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, time.UTC) // a Monday
	resetAdmins(t, "week1-staff@example.com")
	testsupport.MustExec(t, `UPDATE admin_users SET logto_sub = 'staff-sub' WHERE email = 'week1-staff@example.com'`)
	t.Setenv("POSTHOG_EXCLUDED_LOGTO_SUBS", "test-sub")
	t.Setenv("LOGTO_EXTENSION_APP_ID", "desktop-app")

	ms := func(at time.Time) int64 { return at.UnixMilli() }
	withLogtoAccounts(t, 5, false,
		// Sep 21-27 week: younger than 7 days as of "now" (Sep 28) — immature.
		accounts.LogtoAccount{ID: "immature-a", ApplicationID: "desktop-app", CreatedAt: ms(time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC))},
		// Sep 14-20 week: exactly matured as of "now".
		accounts.LogtoAccount{ID: "user-a", ApplicationID: "desktop-app", CreatedAt: ms(time.Date(2026, 9, 15, 10, 0, 0, 0, time.UTC))},
		accounts.LogtoAccount{ID: "user-b", ApplicationID: "desktop-app", CreatedAt: ms(time.Date(2026, 9, 16, 10, 0, 0, 0, time.UTC))},
		accounts.LogtoAccount{ID: "staff-sub", ApplicationID: "desktop-app", CreatedAt: ms(time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC))},
		accounts.LogtoAccount{ID: "test-sub", ApplicationID: "desktop-app", CreatedAt: ms(time.Date(2026, 9, 16, 11, 0, 0, 0, time.UTC))},
	)

	var checkedExcluded bool
	previous := userReturnedWeek1
	userReturnedWeek1 = func(_ context.Context, userID string, _ time.Time) (bool, error) {
		if userID == "staff-sub" || userID == "test-sub" {
			checkedExcluded = true
		}
		return userID == "user-a", nil
	}
	t.Cleanup(func() { userReturnedWeek1 = previous })

	report, err := loadWeek1Return(context.Background(), now)
	if err != nil {
		t.Fatalf("loadWeek1Return: %v", err)
	}
	if checkedExcluded {
		t.Fatal("a staff or test sub must never be checked for a return")
	}
	if len(report.Cohorts) != 4 {
		t.Fatalf("cohorts = %d, want 4", len(report.Cohorts))
	}

	immature := report.Cohorts[3]
	if immature.WeekStart != "2026-09-21" || immature.Mature || immature.Signups != 1 {
		t.Fatalf("immature cohort = %+v", immature)
	}
	if immature.RatePct != nil {
		t.Fatalf("immature cohort rate = %v, want unavailable not 0", *immature.RatePct)
	}

	mature := report.Cohorts[2]
	if mature.WeekStart != "2026-09-14" || !mature.Mature {
		t.Fatalf("mature cohort = %+v", mature)
	}
	if mature.Signups != 2 || mature.Returned != 1 {
		t.Fatalf("mature cohort staff/test exclusion = %+v, want signups=2 returned=1", mature)
	}
	if mature.RatePct == nil || *mature.RatePct != 50 {
		t.Fatalf("mature cohort rate = %v, want 50", mature.RatePct)
	}
}

func TestCachedSignupAnalyticsStopsWaitingWhenCallerCancels(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	previous := fetchSignupAnalytics
	release := make(chan struct{})
	called := make(chan struct{}, 1)
	fetchSignupAnalytics = func(_ context.Context, _ string, _ int, _ time.Time) (accounts.SignupAnalytics, error) {
		called <- struct{}{}
		<-release
		return analyticsReport("website", 7), nil
	}
	t.Cleanup(func() { fetchSignupAnalytics = previous })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	_, _, err := cachedSignupAnalytics(ctx, "website", 7)
	close(release)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context canceled", err)
	}
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("canceled cache wait took %v", elapsed)
	}
	select {
	case <-called:
		t.Fatal("canceled caller started a cold fetch")
	case <-time.After(20 * time.Millisecond):
	}
}
