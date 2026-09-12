package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// The desktop-usage report is read from the hourly aggregates the check-in
// handler writes (tested in accounts/presence_test.go). These tests seed those
// tables directly and pin the arithmetic the page shows.

func resetPresenceTables(t *testing.T) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	for _, table := range []string{"presence_concurrency_minute", "presence_widget_changes", "presence_widget_account_hourly",
		"presence_widget_hourly", "presence_watermarks", "presence_account_hourly", "presence_session_hourly", "presence_accounts",
		"product_activity_daily", "product_analytics_enrollments", "user_widgets", "stripe_customers", "admin_settings"} {
		testsupport.MustExec(t, `DELETE FROM `+table)
	}
	testsupport.MustExec(t, `DELETE FROM admin_users WHERE email LIKE 'desktop-test-%'`)
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM admin_users WHERE email LIKE 'desktop-test-%'`) })
	if platform.Rdb != nil {
		platform.Rdb.FlushAll(context.Background())
	}
}

func enroll(t *testing.T, sub string, internal bool, firstSeen string) {
	t.Helper()
	testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments (logto_sub, internal) VALUES ($1, $2)`, sub, internal)
	testsupport.MustExec(t, `INSERT INTO presence_accounts (logto_sub, first_seen_day, internal) VALUES ($1, $2, $3)`, sub, firstSeen, internal)
}

// hourly seeds one account-level and one session-level hour of presence.
func hourly(t *testing.T, sub, session, os, version string, internal bool, hour time.Time, running, ticker, screen, screens int) {
	t.Helper()
	testsupport.MustExec(t, `
		INSERT INTO presence_account_hourly (logto_sub, hour, internal, running_seconds, ticker_seconds)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (logto_sub, hour) DO UPDATE SET running_seconds = presence_account_hourly.running_seconds + EXCLUDED.running_seconds,
			ticker_seconds = presence_account_hourly.ticker_seconds + EXCLUDED.ticker_seconds`,
		sub, hour, internal, running, ticker)
	testsupport.MustExec(t, `
		INSERT INTO presence_session_hourly (logto_sub, session_id, hour, os, app_version, internal, running_seconds, ticker_seconds, screen_seconds, max_shown_screens)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		sub, session, hour, os, version, internal, running, ticker, screen, screens)
}

func widgetHour(t *testing.T, sub, session, widget string, internal bool, hour time.Time, userSecs, screenSecs int) {
	t.Helper()
	testsupport.MustExec(t, `
		INSERT INTO presence_widget_account_hourly (logto_sub, hour, widget_type, internal, user_seconds) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (logto_sub, hour, widget_type) DO UPDATE SET user_seconds = presence_widget_account_hourly.user_seconds + EXCLUDED.user_seconds`,
		sub, hour, widget, internal, userSecs)
	testsupport.MustExec(t, `
		INSERT INTO presence_widget_hourly (logto_sub, session_id, screen, hour, widget_type, internal, screen_seconds) VALUES ($1, $2, 'ticker', $3, $4, $5, $6)
		ON CONFLICT (logto_sub, session_id, screen, hour, widget_type) DO UPDATE SET screen_seconds = presence_widget_hourly.screen_seconds + EXCLUDED.screen_seconds`,
		sub, session, hour, widget, internal, screenSecs)
}

func TestDesktopUsageCountsUsersOnceAndScreensSeparately(t *testing.T) {
	resetPresenceTables(t)
	now := time.Date(2026, 9, 11, 20, 30, 0, 0, time.UTC)
	period, _ := ParsePeriod("7d", now)
	prevNow := desktopReportNow
	desktopReportNow = func() time.Time { return now }
	t.Cleanup(func() { desktopReportNow = prevNow })

	// alice: two computers in the same hour (3600 s each on session rows,
	// 3600 s once on the account row), two screens on computer A.
	enroll(t, "alice", false, "2026-09-09")
	h := now.Add(-2 * time.Hour).Truncate(time.Hour)
	hourly(t, "alice", "compA", "windows", "1.6.7", false, h, 3600, 3600, 7200, 2)
	testsupport.MustExec(t, `INSERT INTO presence_session_hourly (logto_sub, session_id, hour, os, app_version, running_seconds, ticker_seconds, screen_seconds, max_shown_screens)
		VALUES ('alice', 'compB', $1, 'macos', '1.6.7', 3600, 3600, 3600, 1)`, h)
	widgetHour(t, "alice", "compA", "sports_nfl", false, h, 3600, 7200)
	widgetHour(t, "alice", "compB", "sports_nfl", false, h, 0, 3600)
	// bob: one computer, half an hour, ticker never shown (locked), yesterday too.
	enroll(t, "bob", false, "2026-09-10")
	hourly(t, "bob", "compC", "windows", "1.6.6", false, h, 1800, 0, 0, 0)
	hourly(t, "bob", "compC", "windows", "1.6.6", false, h.Add(-24*time.Hour), 600, 600, 600, 1)
	widgetHour(t, "bob", "compC", "news_bbc", false, h.Add(-24*time.Hour), 600, 600)
	// staff: flagged internal, must vanish under the default setting.
	enroll(t, "staff", true, "2026-09-10")
	hourly(t, "staff", "compS", "linux", "1.6.7", true, h, 3600, 3600, 3600, 1)
	widgetHour(t, "staff", "compS", "clock", true, h, 3600, 3600)
	// A row from the previous period, for the comparison.
	enroll(t, "carol", false, "2026-09-01")
	hourly(t, "carol", "compD", "windows", "1.6.7", false, now.Add(-9*24*time.Hour), 3600, 3600, 3600, 1)
	// A row outside both windows must not count anywhere.
	hourly(t, "carol", "compD", "windows", "1.6.7", false, now.Add(-20*24*time.Hour), 3600, 3600, 3600, 1)
	// Peak samples and widget changes.
	testsupport.MustExec(t, `INSERT INTO presence_concurrency_minute (minute, users, ticker_users, screens) VALUES ($1, 2, 1, 3), ($2, 1, 1, 1)`, h.Add(10*time.Minute), h.Add(11*time.Minute))
	testsupport.MustExec(t, `INSERT INTO presence_widget_changes (logto_sub, widget_type, change, internal, at) VALUES ('alice', 'sports_nfl', 'added', false, $1), ('bob', 'news_bbc', 'removed', false, $1), ('staff', 'clock', 'added', true, $1)`, h)
	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub, widget_type, enabled, ticker_enabled) VALUES ('alice', 'sports_nfl', true, true), ('bob', 'sports_nfl', true, false), ('bob', 'news_bbc', true, true)`)

	out, err := loadDesktopUsage(context.Background(), period, desktopFilter{excludeStaff: true}, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.UniqueUsers.Value != 2 || !out.UniqueUsers.Available {
		t.Fatalf("unique users = %+v, want 2 (alice, bob; staff excluded; carol outside)", out.UniqueUsers)
	}
	// alice 1 h once (two computers), bob 0.5 h + 10 min = 1.6667 h total.
	if out.UserHours.Value != 1.67 {
		t.Fatalf("user hours = %v, want 1.67", out.UserHours.Value)
	}
	if out.TickerUserHours.Value != 1.17 {
		t.Fatalf("ticker user hours = %v, want 1.17 (alice 1 h + bob 10 min)", out.TickerUserHours.Value)
	}
	// Screens add: alice 2 h + 1 h, bob 10 min = 3.1667 h.
	if out.ScreenHours.Value != 3.17 {
		t.Fatalf("screen hours = %v, want 3.17", out.ScreenHours.Value)
	}
	// Previous period had carol only: comparison against 1 user.
	if !out.UniqueUsers.Comparison.Comparable || *out.UniqueUsers.Comparison.Previous != 1 || *out.UniqueUsers.Comparison.Delta != 1 {
		t.Fatalf("comparison = %+v", out.UniqueUsers.Comparison)
	}
	if !out.Peak.Available || out.Peak.Users != 2 || out.Peak.Screens != 3 || out.Peak.ResolutionSeconds != 60 {
		t.Fatalf("peak = %+v", out.Peak)
	}
	screens := map[string]ScreensBucket{}
	for _, b := range out.ScreensPerUser {
		screens[b.Screens] = b
	}
	// alice's computer A showed two screens (2+), computer B one; bob's one
	// computer showed one screen yesterday and none today → its busiest hour
	// is 1. Users take the most any of their computers showed.
	if screens["2+"].Users != 1 || screens["1"].Users != 1 || screens["0"].Users != 0 || screens["2+"].Sessions != 1 || screens["1"].Sessions != 2 {
		t.Fatalf("screens per user = %+v", out.ScreensPerUser)
	}
	// Seven daily buckets aligned to the window start; alice and bob today,
	// bob yesterday; nothing outside.
	if len(out.UsersCurve) != 7 || out.UsersCurve[0].Start != period.Start.Format(time.RFC3339) {
		t.Fatalf("curve = %+v", out.UsersCurve)
	}
	if out.UsersCurve[6].Value != 2 || out.UsersCurve[5].Value != 1 || out.UsersCurve[0].Value != 0 {
		t.Fatalf("curve values = %+v", out.UsersCurve)
	}

	// Widgets: NFL two users? No — alice only (bob has it configured, never
	// displayed). BBC: bob. Staff's clock is hidden.
	rows := map[string]WidgetRow{}
	for _, r := range out.Widgets.Rows {
		rows[r.WidgetType] = r
	}
	if _, ok := rows["clock"]; ok {
		t.Fatal("staff widget row leaked")
	}
	nfl := rows["sports_nfl"]
	if nfl.Users != 1 || nfl.UserHours != 1 || nfl.ScreenHours != 3 || nfl.Added != 1 || nfl.Configured != 2 || nfl.Enabled != 1 || nfl.Name == "" {
		t.Fatalf("nfl row = %+v", nfl)
	}
	if nfl.RepeatUsers == nil || *nfl.RepeatUsers != 0 {
		t.Fatalf("nfl repeat users = %v, want 0", nfl.RepeatUsers)
	}
	bbc := rows["news_bbc"]
	if bbc.Users != 1 || bbc.Removed != 1 || bbc.UserHours != 0.17 {
		t.Fatalf("bbc row = %+v", bbc)
	}
	// Share is of measured ticker users (alice and bob both had ticker time).
	if out.Widgets.MeasuredTickerUsers != 2 || nfl.Share != 0.5 {
		t.Fatalf("measured ticker users = %d share = %v", out.Widgets.MeasuredTickerUsers, nfl.Share)
	}
	if len(out.Widgets.Categories) == 0 || out.Widgets.Categories[0].Category == "" {
		t.Fatalf("categories = %+v", out.Widgets.Categories)
	}
	// Filter options describe the window: two OS values, two versions, plan free.
	if len(out.Filters.OS) != 2 || len(out.Filters.Version) != 2 || len(out.Filters.Plan) != 1 || out.Filters.Plan[0].Value != "free" {
		t.Fatalf("filters = %+v", out.Filters)
	}
	if !out.StaffExcluded || out.Legacy == nil {
		t.Fatalf("staff_excluded=%v legacy=%v", out.StaffExcluded, out.Legacy != nil)
	}

	// With the setting off, staff come back in.
	all, err := loadDesktopUsage(context.Background(), period, desktopFilter{excludeStaff: false}, now)
	if err != nil {
		t.Fatal(err)
	}
	if all.UniqueUsers.Value != 3 || all.StaffExcluded {
		t.Fatalf("with staff = %+v", all.UniqueUsers)
	}

	// An OS filter is per computer: alice's mac hour counts once here, and
	// the response says hours are per computer.
	mac, err := loadDesktopUsage(context.Background(), period, desktopFilter{excludeStaff: true, os: "macos"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if mac.UniqueUsers.Value != 1 || mac.UserHours.Value != 1 || !strings.Contains(mac.Filters.Note, "per computer") || mac.Peak.Available {
		t.Fatalf("mac filter = users %v hours %v note %q peak %+v", mac.UniqueUsers.Value, mac.UserHours.Value, mac.Filters.Note, mac.Peak)
	}
}

func TestDesktopUsageRetentionUsesMatureCohortsOnly(t *testing.T) {
	resetPresenceTables(t)
	now := time.Date(2026, 9, 11, 9, 0, 0, 0, time.UTC)
	// d1: first seen Sep 9, returned Sep 10 → eligible, returned.
	enroll(t, "d1-yes", false, "2026-09-09")
	hourly(t, "d1-yes", "s", "windows", "1.6.7", false, time.Date(2026, 9, 10, 3, 0, 0, 0, time.UTC), 600, 600, 600, 1)
	// d1-no: first seen Sep 9, nothing on Sep 10.
	enroll(t, "d1-no", false, "2026-09-09")
	// Immature: first seen yesterday; its day-1 is today, not complete.
	enroll(t, "immature", false, "2026-09-10")
	hourly(t, "immature", "s", "windows", "1.6.7", false, time.Date(2026, 9, 11, 1, 0, 0, 0, time.UTC), 600, 600, 600, 1)
	// d7: first seen Sep 3, returned exactly Sep 10.
	enroll(t, "d7-yes", false, "2026-09-03")
	hourly(t, "d7-yes", "s", "windows", "1.6.7", false, time.Date(2026, 9, 10, 23, 0, 0, 0, time.UTC), 600, 600, 600, 1)

	var r PresenceRetention
	if err := loadPresenceRetention(context.Background(), &r, desktopFilter{excludeStaff: true}, now); err != nil {
		t.Fatal(err)
	}
	if !r.D1.Available || r.D1.Eligible != 3 || r.D1.Returned != 1 {
		t.Fatalf("d1 = %+v (want eligible d1-yes, d1-no, d7-yes; returned d1-yes)", r.D1)
	}
	if !r.D7.Available || r.D7.Eligible != 1 || r.D7.Returned != 1 {
		t.Fatalf("d7 = %+v", r.D7)
	}
	if r.D30.Available || r.D30.Note == "" {
		t.Fatalf("d30 must be unavailable with no cohort old enough: %+v", r.D30)
	}
}

func TestDesktopUsageSaysNothingWasMeasuredWhenEmpty(t *testing.T) {
	resetPresenceTables(t)
	now := time.Date(2026, 9, 11, 9, 0, 0, 0, time.UTC)
	period, _ := ParsePeriod("30d", now)
	out, err := loadDesktopUsage(context.Background(), period, desktopFilter{excludeStaff: true}, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.UniqueUsers.Available || out.UserHours.Available || out.Coverage.From != nil || !strings.Contains(out.Coverage.Note, "No desktop build") {
		t.Fatalf("empty report = users %+v coverage %+v", out.UniqueUsers, out.Coverage)
	}
	if out.Peak.Available {
		t.Fatalf("empty peak = %+v", out.Peak)
	}
	for _, b := range out.UsersCurve {
		if b.Value != 0 {
			t.Fatalf("empty curve carries a value: %+v", b)
		}
	}
	if out.Widgets.Rows == nil || out.ScreensPerUser == nil {
		t.Fatal("empty slices must serialise as [] not null")
	}
}

func TestPresenceLiveHeadlineFormat(t *testing.T) {
	if got := presenceHeadline(12, 7, 9); got != "12 active users · 7 with ticker(s) · 9 screens" {
		t.Fatalf("headline = %q", got)
	}
}

func TestSettingsGateAndRoundTrip(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	testsupport.MustExec(t, `DELETE FROM admin_settings`)
	resetAdmins(t, "settings-admin@example.com")
	testsupport.MustExec(t, `UPDATE admin_users SET logto_sub = 'sub-settings' WHERE email = 'settings-admin@example.com'`)

	app := fiber.New()
	app.Get("/admin/settings", stubAuth("sub-settings"), RequireAdmin, HandleGetSettings)
	app.Put("/admin/settings", stubAuth("sub-settings"), RequireAdmin, HandlePutSettings)
	denied := fiber.New()
	denied.Get("/admin/settings", stubAuth("sub-nobody"), RequireAdmin, HandleGetSettings)

	if status, _ := do(t, denied, http.MethodGet, "/admin/settings", ""); status != http.StatusForbidden {
		t.Fatalf("non-admin status = %d, want 403", status)
	}
	status, body := do(t, app, http.MethodGet, "/admin/settings", "")
	if status != http.StatusOK || !strings.Contains(body, `"value":true`) || !strings.Contains(body, `"default":true`) {
		t.Fatalf("default settings = %d %s", status, body)
	}
	if !ExcludeStaff(context.Background()) {
		t.Fatal("ExcludeStaff must default to true")
	}
	status, body = do(t, app, http.MethodPut, "/admin/settings", `{"exclude_staff_from_analytics": false}`)
	if status != http.StatusOK || !strings.Contains(body, `"value":false`) || !strings.Contains(body, `"updated_by":"settings-admin@example.com"`) {
		t.Fatalf("save = %d %s", status, body)
	}
	if ExcludeStaff(context.Background()) {
		t.Fatal("ExcludeStaff must read the saved value")
	}
	if status, _ := do(t, app, http.MethodPut, "/admin/settings", `{"share_everything": true}`); status != http.StatusBadRequest {
		t.Fatalf("unknown key status = %d, want 400", status)
	}
	if status, _ := do(t, app, http.MethodPut, "/admin/settings", `nope`); status != http.StatusBadRequest {
		t.Fatalf("malformed status = %d, want 400", status)
	}
}

func TestDesktopUsageHandlerValidatesPeriod(t *testing.T) {
	app := fiber.New()
	app.Get("/admin/desktop-usage", HandleGetDesktopUsage)
	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/desktop-usage?period=14d", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	var body platform.ErrorResponse
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if !strings.Contains(body.Error, "24h") {
		t.Fatalf("error = %q", body.Error)
	}
}
