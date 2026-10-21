package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	var queriesMu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oidc/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "test-token", "expires_in": 3600})
		case "/api/logs":
			queriesMu.Lock()
			queries = append(queries, r.URL.RawQuery)
			queriesMu.Unlock()
			if status != http.StatusOK {
				w.WriteHeader(status)
				_, _ = w.Write([]byte(responseBody))
				return
			}
			page := 1
			_, _ = fmt.Sscanf(r.URL.Query().Get("page"), "%d", &page)
			out := []map[string]any{}
			for _, e := range pages[page] {
				if k := r.URL.Query().Get("logKey"); k == "" || e["key"] == k {
					out = append(out, e)
				}
			}
			_ = json.NewEncoder(w).Encode(out)
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
	return func() []string {
		queriesMu.Lock()
		defer queriesMu.Unlock()
		return append([]string(nil), queries...)
	}
}

func TestFetchSignupAnalyticsCountsEventsWithoutInventingAttempts(t *testing.T) {
	now := time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC)
	stamp := now.Add(-time.Hour).UnixMilli()
	previousPageSize, previousMaxPages := analyticsPageSize, analyticsMaxPages
	analyticsPageSize, analyticsMaxPages = 2, 3
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })

	queries := withAnalyticsLogto(t, map[int][]map[string]any{
		1: {
			analyticsLog("start", "Interaction.Register.Create", "Success", "", stamp),
			analyticsLog("retry-1", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Error", "verification_code_invalid", stamp),
			analyticsLog("same-ms", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Success", "", stamp),
			analyticsLog("social", "Interaction.Register.Verification.Social.Submit", "Success", "", stamp),
		},
		2: {
			analyticsLog("retry-1", "Interaction.Register.Verification.EmailVerificationCode.Submit", "Error", "verification_code_invalid", stamp),
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
	for _, q := range queries() {
		if !strings.Contains(q, "applicationId=web-app") || !strings.Contains(q, "page_size=2") || !strings.Contains(q, "logKey=Interaction.Register") {
			t.Fatalf("query %q must filter by application and logKey", q)
		}
	}
	if len(queries()) != len(signupStageKeys)+1 { // email-submit fills page 1 and needs page 2
		t.Fatalf("queries = %d, want one per stage key plus one second page for the full email-submit page", len(queries()))
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
	analyticsPageSize, analyticsMaxPages = 1, 1
	t.Cleanup(func() { analyticsPageSize, analyticsMaxPages = previousPageSize, previousMaxPages })
	withAnalyticsLogto(t, map[int][]map[string]any{
		1: {analyticsLog("one", "Interaction.Register.Create", "Success", "", now.UnixMilli()), analyticsLog("", "Interaction.Register.Submit", "Success", "", now.UnixMilli())},
	}, http.StatusOK, "")

	report, err := FetchSignupAnalytics(context.Background(), "website", 30, now)
	if err != nil {
		t.Fatalf("FetchSignupAnalytics: %v", err)
	}
	if report.Coverage.Status != "partial" {
		t.Fatalf("coverage = %+v, want bounded partial scan", report.Coverage)
	}
	if !strings.Contains(report.Coverage.Note, "page limit") || !strings.Contains(report.Coverage.Note, "Malformed") {
		t.Fatalf("coverage note = %q, want every partial reason", report.Coverage.Note)
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
	if len(queries()) != len(signupStageKeys) || !strings.Contains(queries()[0], "applicationId=desktop-app") {
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

// TestUserReturnedWeek1IgnoresContinuousHourlyRefreshesAcrossMidnight covers
// the acceptance case: a session that just keeps silently refreshing its
// token every hour, including across a UTC day boundary, never has a gap
// wide enough to "start a session", so none of it counts as a return even
// though several of the refreshes land on UTC day 1.
func TestUserReturnedWeek1IgnoresContinuousHourlyRefreshesAcrossMidnight(t *testing.T) {
	signupDay := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	login := signupDay.Add(10 * time.Hour) // day 0, the signup-flow exchange
	entries := []map[string]any{
		analyticsLog("login", "ExchangeTokenBy.AuthorizationCode", "Success", "", login.UnixMilli()),
	}
	// Hourly refreshes from day 0 through day 1, crossing UTC midnight; every
	// gap is exactly 1h, never 3h.
	for i := 1; i <= 20; i++ {
		ts := login.Add(time.Duration(i) * time.Hour)
		entries = append(entries, analyticsLog(fmt.Sprintf("r%d", i), "ExchangeTokenBy.RefreshToken", "Success", "", ts.UnixMilli()))
	}
	withAnalyticsLogto(t, map[int][]map[string]any{1: entries}, http.StatusOK, "")

	returned, err := UserReturnedWeek1(context.Background(), "user-1", signupDay)
	if err != nil {
		t.Fatal(err)
	}
	if returned {
		t.Fatal("continuous hourly refreshes across midnight must not count as a return")
	}
}

// TestUserReturnedWeek1CountsRelaunchAfterThreeHourGapOnDayThree covers the
// other acceptance case: a real relaunch (a gap of at least 3h since the
// previous exchange) landing on UTC day 3 counts.
func TestUserReturnedWeek1CountsRelaunchAfterThreeHourGapOnDayThree(t *testing.T) {
	signupDay := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	login := signupDay.Add(10 * time.Hour)
	relaunch := signupDay.AddDate(0, 0, 3).Add(9 * time.Hour) // day 3, well past a 3h gap
	entries := []map[string]any{
		analyticsLog("login", "ExchangeTokenBy.AuthorizationCode", "Success", "", login.UnixMilli()),
		analyticsLog("relaunch", "ExchangeTokenBy.RefreshToken", "Success", "", relaunch.UnixMilli()),
	}
	withAnalyticsLogto(t, map[int][]map[string]any{1: entries}, http.StatusOK, "")

	returned, err := UserReturnedWeek1(context.Background(), "user-1", signupDay)
	if err != nil {
		t.Fatal(err)
	}
	if !returned {
		t.Fatal("a relaunch after a 3h gap on day 3 must count as a return")
	}
}

// TestUserReturnedWeek1IgnoresExchangesOutsideTheDayOneToSevenWindow covers
// day 0 (signup day itself) and day 8+ never counting, even with a wide gap.
func TestUserReturnedWeek1IgnoresExchangesOutsideTheDayOneToSevenWindow(t *testing.T) {
	signupDay := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	dayZero := signupDay.Add(20 * time.Hour)
	dayEight := signupDay.AddDate(0, 0, 8).Add(time.Hour)
	entries := []map[string]any{
		analyticsLog("day0", "ExchangeTokenBy.AuthorizationCode", "Success", "", dayZero.UnixMilli()),
		analyticsLog("day8", "ExchangeTokenBy.RefreshToken", "Success", "", dayEight.UnixMilli()),
	}
	withAnalyticsLogto(t, map[int][]map[string]any{1: entries}, http.StatusOK, "")

	returned, err := UserReturnedWeek1(context.Background(), "user-1", signupDay)
	if err != nil {
		t.Fatal(err)
	}
	if returned {
		t.Fatal("an exchange on day 0 or day 8+ must not count as a return")
	}
}

func TestFetchSignupAnalyticsStopsWaitingForTokenWhenContextExpires(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oidc/token" {
			t.Fatalf("unexpected Logto path %s", r.URL.Path)
		}
		time.Sleep(100 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "late-token", "expires_in": 3600})
	}))
	t.Cleanup(server.Close)
	t.Setenv("LOGTO_ENDPOINT", server.URL)
	t.Setenv("LOGTO_M2M_APP_ID", "m2m")
	t.Setenv("LOGTO_M2M_APP_SECRET", "secret")
	t.Setenv("LOGTO_WEB_APP_ID", "web-app")
	ResetM2MTokenCache()
	t.Cleanup(ResetM2MTokenCache)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := FetchSignupAnalytics(ctx, "website", 7, time.Now())
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("error = %v, want context deadline exceeded", err)
	}
	if elapsed := time.Since(started); elapsed > 200*time.Millisecond {
		t.Fatalf("analytics token wait took %v, want bounded response", elapsed)
	}
}

// TestUserReturnedWeek1QueriesEachExchangeKeyWithLogKey pins the prod fix
// (SCROLLR-322): the unfiltered per-user audit query timed out, the logKey
// filtered one does not, so every request must carry a logKey.
func TestUserReturnedWeek1QueriesEachExchangeKeyWithLogKey(t *testing.T) {
	signupDay := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	entries := []map[string]any{
		analyticsLog("login", "ExchangeTokenBy.AuthorizationCode", "Success", "", signupDay.Add(10*time.Hour).UnixMilli()),
		analyticsLog("noise", "SignIn", "Success", "", signupDay.AddDate(0, 0, 2).UnixMilli()),
		analyticsLog("relaunch", "ExchangeTokenBy.RefreshToken", "Success", "", signupDay.AddDate(0, 0, 3).UnixMilli()),
	}
	queries := withAnalyticsLogto(t, map[int][]map[string]any{1: entries}, http.StatusOK, "")

	returned, err := UserReturnedWeek1(context.Background(), "user-1", signupDay)
	if err != nil || !returned {
		t.Fatalf("returned = %v, err = %v, want true", returned, err)
	}
	got := queries()
	if len(got) != 2 {
		t.Fatalf("queries = %v, want one per exchange key", got)
	}
	for _, q := range got {
		if !strings.Contains(q, "logKey=ExchangeTokenBy.") {
			t.Fatalf("query %q has no logKey filter", q)
		}
	}
}
