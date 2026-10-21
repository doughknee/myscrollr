package admin

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func TestSignupStaleSnapshotReturnsBeforeBackgroundScanFinishes(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	key := "scrollr:admin:signup_analytics:desktop:7"
	retained := analyticsReport("desktop", 7)
	raw, _ := json.Marshal(retained)
	platform.Rdb.Set(context.Background(), key+":retained", raw, time.Hour)
	previous := fetchSignupAnalytics
	release := make(chan struct{})
	fetchSignupAnalytics = func(context.Context, string, int, time.Time) (accounts.SignupAnalytics, error) {
		<-release
		fresh := retained
		fresh.GeneratedAt = time.Now().UTC().Format(time.RFC3339)
		return fresh, nil
	}
	defer func() { fetchSignupAnalytics = previous }()
	started := time.Now()
	got, hit, err := cachedSignupAnalytics(context.Background(), "desktop", 7)
	if err != nil || !hit || !got.Stale || !got.Refreshing || got.GeneratedAt != retained.GeneratedAt {
		close(release)
		t.Fatalf("stale read=%+v hit=%v err=%v", got, hit, err)
	}
	if time.Since(started) > 200*time.Millisecond {
		t.Error("stale response waited for scan")
	}
	finished := refreshSignupAnalytics("desktop", 7, false)
	close(release)
	<-finished
	got, _, err = cachedSignupAnalytics(context.Background(), "desktop", 7)
	if err != nil || got.Stale || got.Refreshing || !got.Available {
		t.Fatalf("fresh read=%+v err=%v", got, err)
	}
}

func TestSignupColdHTTPReturnsPendingAndThenCompletedSnapshot(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	previous, wait := fetchSignupAnalytics, signupInteractiveWait
	signupInteractiveWait = 20 * time.Millisecond
	release := make(chan struct{})
	fetchSignupAnalytics = func(context.Context, string, int, time.Time) (accounts.SignupAnalytics, error) {
		<-release
		return analyticsReport("desktop", 30), nil
	}
	defer func() { fetchSignupAnalytics, signupInteractiveWait = previous, wait }()
	app := fiber.New()
	app.Get("/admin/analytics", HandleGetAnalytics)
	start := time.Now()
	response, err := app.Test(httptest.NewRequest("GET", "/admin/analytics?application=desktop&days=30", nil))
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	var pending accounts.SignupAnalytics
	json.NewDecoder(response.Body).Decode(&pending)
	response.Body.Close()
	if response.StatusCode != 200 || pending.Available || !pending.Refreshing || time.Since(start) > 300*time.Millisecond {
		t.Errorf("cold HTTP did not return promptly: %+v", pending)
	}
	finished := refreshSignupAnalytics("desktop", 30, false)
	close(release)
	<-finished
	got, hit, err := cachedSignupAnalytics(context.Background(), "desktop", 30)
	if err != nil || !hit || !got.Available || got.Refreshing {
		t.Fatalf("completed=%+v hit=%v err=%v", got, hit, err)
	}
}

func TestSignupWarmerRefreshesAllApplicationsAndWindows(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	previous := fetchSignupAnalytics
	fetchSignupAnalytics = func(_ context.Context, application string, days int, _ time.Time) (accounts.SignupAnalytics, error) {
		return analyticsReport(application, days), nil
	}
	defer func() { fetchSignupAnalytics = previous }()
	if err := refreshSignupNow(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, app := range []string{"desktop", "website"} {
		for _, days := range []int{7, 30} {
			got, hit, err := cachedSignupAnalytics(context.Background(), app, days)
			if err != nil || !hit || !got.Available {
				t.Fatalf("%s/%d not warm", app, days)
			}
		}
	}
}

func TestSignupBackgroundResultRemainsReadableWithoutRedis(t *testing.T) {
	previousRedis, previousFetch := platform.Rdb, fetchSignupAnalytics
	platform.Rdb = nil
	signupLocalCache.Clear()
	defer func() {
		platform.Rdb, fetchSignupAnalytics = previousRedis, previousFetch
		signupLocalCache.Clear()
	}()
	calls := 0
	fetchSignupAnalytics = func(_ context.Context, app string, days int, _ time.Time) (accounts.SignupAnalytics, error) {
		calls++
		return analyticsReport(app, days), nil
	}
	if result := <-refreshSignupAnalytics("desktop", 7, true); result.Err != nil {
		t.Fatal(result.Err)
	}
	got, hit, err := cachedSignupAnalytics(context.Background(), "desktop", 7)
	if err != nil || !hit || !got.Available || calls != 1 {
		t.Fatalf("completed local snapshot lost: %+v hit=%v calls=%d err=%v", got, hit, calls, err)
	}
}
