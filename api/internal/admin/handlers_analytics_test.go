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
