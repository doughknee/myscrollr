package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func analyticsLog(id, key, result, code string, createdAt int64) map[string]any {
	payload := map[string]any{
		"key":           key,
		"result":        result,
		"applicationId": "web-app",
		"sessionId":     "private-session",
		"ip":            "203.0.113.10",
		"userAgent":     "private-agent",
		"params":        map[string]any{"email": "private@example.test", "token": "private-token"},
	}
	if code != "" {
		payload["error"] = map[string]any{"code": code, "message": "private free text"}
	}
	return map[string]any{
		"tenantId":  "tenant",
		"id":        id,
		"key":       key,
		"payload":   payload,
		"createdAt": createdAt,
	}
}

func withAnalyticsLogto(t *testing.T, pages map[int][]map[string]any, status int, responseBody string) func() []string {
	t.Helper()
	var queries []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oidc/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "test-token", "expires_in": 3600})
		case "/api/logs":
			queries = append(queries, r.URL.RawQuery)
			if status != http.StatusOK {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(responseBody))
				return
			}
			page := 1
			_, _ = fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
			_ = json.NewEncoder(w).Encode(pages[page])
		default:
			t.Fatalf("unexpected Logto path %s", r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("LOGTO_ENDPOINT", server.URL)
	t.Setenv("LOGTO_M2M_APP_ID", "m2m")
	t.Setenv("LOGTO_M2M_APP_SECRET", "secret")
	t.Setenv("LOGTO_WEB_APP_ID", "web-app")
	ResetM2MTokenCache()
	t.Cleanup(ResetM2MTokenCache)
	return func() []string { return queries }
}

func TestFetchSignupAnalyticsCountsEventsWithoutInventingAttempts(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	stamp := now.Add(-time.Hour).UnixMilli()
	previousPageSize, previousMaxPages := analyticsPageSize, analyticsMaxPages
	analyticsPageSize, analyticsMaxPages = 3, 3
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })

	queries := withAnalyticsLogto(t, map[int][]map[string]any{
		1: {
			analyticsLog("start", "Interaction.Register.Create", "Success", "", stamp),
			analyticsLog("retry-1", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Error", "verification_code_invalid", stamp),
			analyticsLog("same-ms", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Success", "", stamp),
		},
		2: {
			analyticsLog("retry-1", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Error", "verification_code_invalid", stamp),
			analyticsLog("social", "Interaction.Register.Verification.Social.Submit", "Success", "", stamp),
		},
	}, http.StatusOK, "")

	report, err := FetchSignupAnalytics(context.Background(), "website", 7, now)
	if err != nil {
		t.Fatalf("FetchSignupAnalytics: %v", err)
	}
	if report.Measurement != "events" || report.AttemptConversion.Available {
		t.Fatalf("measurement/conversion = %q/%+v, want event counts and unavailable conversion", report.Measurement, report.AttemptConversion)
	}
	if report.Coverage.Status != "unknown" || report.Coverage.UniqueLogs != 4 {
		t.Fatalf("coverage = %+v, want four deduplicated logs with unknown retention/order coverage", report.Coverage)
	}
	if got := report.Stages["email_code_verified"]; got.Events != 2 || got.Errors != 1 {
		t.Fatalf("email stage = %+v, want two events (one retry error)", got)
	}
	if got := report.Stages["social_verified"]; got.Events != 1 || got.Errors != 0 {
		t.Fatalf("social stage = %+v", got)
	}
	if len(report.ErrorReasons) != 1 || report.ErrorReasons[0].Reason != "verification_code" || report.ErrorReasons[0].Count != 1 {
		t.Fatalf("safe reasons = %+v", report.ErrorReasons)
	}
	if len(queries()) != 2 || !strings.Contains(queries()[0], "applicationId=web-app") || !strings.Contains(queries()[0], "page_size=3") {
		t.Fatalf("queries = %v", queries())
	}
	raw, _ := json.Marshal(report)
	for _, secret := range []string{"private@example.test", "private-token", "private-session", "203.0.113.10", "private-agent", "private free text", "verification_code_invalid"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("response leaked %q: %s", secret, raw)
		}
	}
}

func TestFetchSignupAnalyticsMarksBoundedScanPartial(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	previousPageSize, previousMaxPages := analyticsPageSize, analyticsMaxPages
	analyticsPageSize, analyticsMaxPages = 1, 2
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })
	withAnalyticsLogto(t, map[int][]map[string]any{
		1: {analyticsLog("one", "Interaction.Register.Create", "Success", "", now.UnixMilli())},
		2: {analyticsLog("two", "Interaction.Register.Submit", "Success", "", now.UnixMilli())},
	}, http.StatusOK, "")

	report, err := FetchSignupAnalytics(context.Background(), "website", 30, now)
	if err != nil {
		t.Fatalf("FetchSignupAnalytics: %v", err)
	}
	if report.Coverage.Status != "partial" || report.Coverage.Pages != 2 {
		t.Fatalf("coverage = %+v, want bounded partial scan", report.Coverage)
	}
}

func TestFetchSignupAnalyticsSkipsMissingIDsAndMarksPartial(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	previousPageSize, previousMaxPages := analyticsPageSize, analyticsMaxPages
	analyticsPageSize, analyticsMaxPages = 5, 2
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })
	withAnalyticsLogto(t, map[int][]map[string]any{
		1: {analyticsLog("", "Interaction.Register.Submit", "Success", "", now.UnixMilli())},
	}, http.StatusOK, "")

	report, err := FetchSignupAnalytics(context.Background(), "website", 7, now)
	if err != nil {
		t.Fatalf("FetchSignupAnalytics: %v", err)
	}
	if report.Coverage.Status != "partial" || report.Coverage.UniqueLogs != 0 || report.Stages["submitted"].Events != 0 {
		t.Fatalf("report = %+v, malformed row must not become a count", report)
	}
}

func TestFetchSignupAnalyticsUsesInclusiveWindowAndDesktopApplication(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	cutoff := now.AddDate(0, 0, -7)
	previousPageSize, previousMaxPages := analyticsPageSize, analyticsMaxPages
	analyticsPageSize, analyticsMaxPages = 10, 2
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })
	queries := withAnalyticsLogto(t, map[int][]map[string]any{
		1: {
			analyticsLog("boundary", "Interaction.Register.Submit", "Success", "", cutoff.UnixMilli()),
			analyticsLog("inside", "Interaction.Register.Submit", "Success", "", now.Add(-time.Hour).UnixMilli()),
			analyticsLog("old", "Interaction.Register.Submit", "Success", "", cutoff.Add(-time.Millisecond).UnixMilli()),
			analyticsLog("future", "Interaction.Register.Submit", "Success", "", now.Add(time.Millisecond).UnixMilli()),
		},
	}, http.StatusOK, "")
	t.Setenv("LOGTO_EXTENSION_APP_ID", "desktop-app")

	report, err := FetchSignupAnalytics(context.Background(), "desktop", 7, now)
	if err != nil {
		t.Fatal(err)
	}
	if got := report.Stages["submitted"].Events; got != 2 {
		t.Fatalf("submitted events = %d, want boundary and in-window rows only", got)
	}
	if len(queries()) != 1 || !strings.Contains(queries()[0], "applicationId=desktop-app") {
		t.Fatalf("desktop query = %v", queries())
	}
}

func TestFetchSignupAnalyticsErrorNeverEchoesUpstreamBody(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	withAnalyticsLogto(t, nil, http.StatusBadGateway, `{"email":"private@example.test","token":"private-token"}`)

	_, err := FetchSignupAnalytics(context.Background(), "website", 7, now)
	if err == nil {
		t.Fatal("FetchSignupAnalytics returned no error")
	}
	if strings.Contains(err.Error(), "private@example.test") || strings.Contains(err.Error(), "private-token") {
		t.Fatalf("error leaked upstream body: %v", err)
	}
}

func TestFetchSignupAnalyticsReturnsEmptyReasonArray(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	previousPageSize := analyticsPageSize
	analyticsPageSize = 10
	t.Cleanup(func() { analyticsPageSize = previousPageSize })
	withAnalyticsLogto(t, map[int][]map[string]any{1: {}}, http.StatusOK, "")

	report, err := FetchSignupAnalytics(context.Background(), "website", 7, now)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(report)
	if !strings.Contains(string(raw), `"error_reasons":[]`) {
		t.Fatalf("empty reasons must be an array for the UI, got %s", raw)
	}
}
