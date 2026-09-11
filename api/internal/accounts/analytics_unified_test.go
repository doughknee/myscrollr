package accounts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestUsageConsentControlsBothCollectorsAndPreservesOptOut(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "unified-consent-user"
	app := productAnalyticsTestApp()
	previous := postHogLogtoUser
	postHogLogtoUser = func(string) (*LogtoUser, error) { return &LogtoUser{}, nil }
	t.Cleanup(func() { postHogLogtoUser = previous })
	for _, decision := range []string{"enabled", "declined"} {
		if decision == "enabled" {
			analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
		} else {
			analyticsRequest(t, app, http.MethodPut, "/posthog-consent", sub, `{"decision":"declined"}`)
		}
		resp := analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
		var got PostHogConsent
		if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		var enrolled bool
		if err := platform.DBPool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM product_analytics_enrollments WHERE logto_sub=$1)`, sub).Scan(&enrolled); err != nil {
			t.Fatal(err)
		}
		if got.Decision != decision || enrolled != (decision == "enabled") {
			t.Fatalf("decision=%s enrolled=%v, want %s for both collectors", got.Decision, enrolled, decision)
		}
	}
}

// Explicit opt-in only. Uses a scratch database and a synthetic internal account;
// credentials stay in the environment and the destination is checked separately.
func TestLivePostHogDesktopDelivery(t *testing.T) {
	key := os.Getenv("SCROLLR_QA_POSTHOG_KEY")
	if key == "" {
		t.Skip("live PostHog verification not requested")
	}
	resetProductAnalytics(t)
	const sub = "scrollr-release-analytics-qa"
	for name, value := range map[string]string{"POSTHOG_CAPTURE_ENABLED": "true", "POSTHOG_PROJECT_KEY": key, "POSTHOG_PROJECT_ID": "qa", "POSTHOG_PERSONAL_API_KEY": "unused", "POSTHOG_DISTINCT_ID_SALT": "scrollr-synthetic-release-qa-20260911", "POSTHOG_HOST": "https://us.i.posthog.com", "POSTHOG_API_HOST": "https://example.test", "POSTHOG_EXCLUDED_LOGTO_SUBS": sub} {
		t.Setenv(name, value)
	}
	app := productAnalyticsTestApp()
	call := func(method, path, body string, want int) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("X-Test-Sub", sub)
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req, 5000)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s %s returned %d, want %d", method, path, resp.StatusCode, want)
		}
	}
	call(http.MethodGet, "/posthog-consent", "", 200)
	call(http.MethodPost, "/posthog-event", `{"event":"desktop_app_opened"}`, 202)
	call(http.MethodPost, "/posthog-event", `{"event":"desktop_presence"}`, 202)
	var delivered int
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT count(*) FROM posthog_analytics_events WHERE logto_sub=$1 AND delivered`, sub).Scan(&delivered); err != nil {
		t.Fatal(err)
	}
	if delivered != 2 {
		t.Fatalf("delivered mirror rows=%d, want 2", delivered)
	}
	t.Setenv("POSTHOG_API_HOST", "") // No deletion of this deliberate verification evidence.
	call(http.MethodPut, "/posthog-consent", `{"decision":"declined"}`, 200)
	t.Setenv("POSTHOG_API_HOST", "https://example.test")
	call(http.MethodPost, "/posthog-event", `{"event":"desktop_feature_configured","feature":"sports"}`, 204)
	var rows int
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT count(*) FROM posthog_analytics_events WHERE logto_sub=$1`, sub).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 2 {
		t.Fatal("opt-out allowed another event")
	}
}

func TestLegacyAnalyticsOptOutSurvivesUpgrade(t *testing.T) {
	resetProductAnalytics(t)
	app := productAnalyticsTestApp()
	analyticsRequest(t, app, http.MethodPut, "/consent", "legacy-optout", `{"enabled":false}`)
	resp := analyticsRequest(t, app, http.MethodGet, "/posthog-consent", "legacy-optout", "")
	var consent PostHogConsent
	if err := json.NewDecoder(resp.Body).Decode(&consent); err != nil {
		t.Fatal(err)
	}
	if consent.Decision != "declined" {
		t.Fatalf("legacy opt-out became %s after upgrade", consent.Decision)
	}
}

func TestInternalDesktopUsageArrivesOnceAndStopsAfterOptOut(t *testing.T) {
	resetProductAnalytics(t)
	const sub = "internal-analytics-test"
	testsupport.MustExec(t, `INSERT INTO admin_users (email,logto_sub) VALUES ('internal-analytics@example.test',$1)`, sub)
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM admin_users WHERE logto_sub=$1`, sub) })
	var deliveries atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Event      string         `json:"event"`
			Properties map[string]any `json:"properties"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if payload.Properties["is_internal"] != true || payload.Properties["$geoip_disable"] != true || payload.Properties["distinct_id"] == sub {
			t.Errorf("missing internal/privacy protections: %#v", payload.Properties)
		}
		deliveries.Add(1)
		w.WriteHeader(200)
	}))
	defer server.Close()
	// The public handler requires TLS configuration; capture uses this TLS test receiver.
	tls := httptest.NewTLSServer(server.Config.Handler)
	defer tls.Close()
	previousTransport := http.DefaultTransport
	http.DefaultTransport = tls.Client().Transport
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	for name, value := range map[string]string{"POSTHOG_CAPTURE_ENABLED": "true", "POSTHOG_PROJECT_KEY": "test-project", "POSTHOG_PROJECT_ID": "test-project", "POSTHOG_PERSONAL_API_KEY": "test-personal", "POSTHOG_DISTINCT_ID_SALT": "test-salt", "POSTHOG_HOST": tls.URL, "POSTHOG_API_HOST": "https://example.test"} {
		t.Setenv(name, value)
	}
	app := productAnalyticsTestApp()
	resp := analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
	var consent PostHogConsent
	if err := json.NewDecoder(resp.Body).Decode(&consent); err != nil {
		t.Fatal(err)
	}
	if consent.Decision != "enabled" {
		t.Fatalf("internal default=%s, want enabled", consent.Decision)
	}
	var enrolled bool
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM product_analytics_enrollments WHERE logto_sub=$1)`, sub).Scan(&enrolled); err != nil {
		t.Fatal(err)
	}
	if enrolled {
		t.Fatal("internal account entered first-party customer metrics")
	}
	for i := 0; i < 2; i++ {
		analyticsRequest(t, app, http.MethodPost, "/posthog-event", sub, `{"event":"desktop_presence"}`)
	}
	if deliveries.Load() != 1 {
		t.Fatalf("deliveries=%d, want one daily event", deliveries.Load())
	}
	// Disable vendor deletion for this test; opt-out itself must still stop both collectors.
	t.Setenv("POSTHOG_API_HOST", "")
	analyticsRequest(t, app, http.MethodPut, "/posthog-consent", sub, `{"decision":"declined"}`)
	t.Setenv("POSTHOG_API_HOST", "https://example.test")
	analyticsRequest(t, app, http.MethodPost, "/posthog-event", sub, `{"event":"desktop_app_opened"}`)
	if deliveries.Load() != 1 {
		t.Fatal("opted-out account emitted an event")
	}
}
