package accounts

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

func TestSplitByHourCutsAtUTCBoundaries(t *testing.T) {
	from := time.Date(2026, 9, 11, 10, 59, 50, 0, time.UTC)
	to := from.Add(30 * time.Second)
	got := splitByHour(from, to)
	if len(got) != 2 || got[0].Seconds != 10 || got[1].Seconds != 20 ||
		got[0].Hour.Hour() != 10 || got[1].Hour.Hour() != 11 {
		t.Fatalf("split = %+v", got)
	}
	if n := len(splitByHour(to, from)); n != 0 {
		t.Fatalf("reversed interval produced %d slices", n)
	}
	// Exactly on the boundary: one slice in the new hour, nothing in the old.
	on := time.Date(2026, 9, 11, 11, 0, 0, 0, time.UTC)
	if got := splitByHour(on, on.Add(30*time.Second)); len(got) != 1 || got[0].Hour.Hour() != 11 || got[0].Seconds != 30 {
		t.Fatalf("boundary split = %+v", got)
	}
}

func TestPresenceValidationClosesTheVocabulary(t *testing.T) {
	base := func() presenceCheckIn {
		return presenceCheckIn{
			SessionID: "0123456789abcdef", Seq: 1, Session: "unlocked", Input: "recent",
			Display: "awake", Ticker: "shown",
			Screens: []PresenceScreen{{Screen: "ticker", Shown: true, Widgets: []string{"sports_nfl", "news_bbc", "sports_nfl", "AAPL", "https://feed.example/rss", "clock"}}},
		}
	}
	req := base()
	if err := validatePresence(&req); err != nil {
		t.Fatalf("valid check-in rejected: %v", err)
	}
	// Only catalog ids survive, deduplicated and sorted; a symbol or a feed
	// URL smuggled in as a "widget" is dropped, never stored.
	got := req.Screens[0].Widgets
	if len(got) != 3 || got[0] != "clock" || got[1] != "news_bbc" || got[2] != "sports_nfl" {
		t.Fatalf("widgets = %v, want [clock news_bbc sports_nfl]", got)
	}
	bad := map[string]func(*presenceCheckIn){
		"short session id":  func(r *presenceCheckIn) { r.SessionID = "abc" },
		"session id chars":  func(r *presenceCheckIn) { r.SessionID = "0123456789abcdef!" },
		"negative seq":      func(r *presenceCheckIn) { r.Seq = -1 },
		"unknown session":   func(r *presenceCheckIn) { r.Session = "asleep" },
		"unknown input":     func(r *presenceCheckIn) { r.Input = "typing" },
		"unknown display":   func(r *presenceCheckIn) { r.Display = "off" },
		"unknown ticker":    func(r *presenceCheckIn) { r.Ticker = "on" },
		"bad screen label":  func(r *presenceCheckIn) { r.Screens[0].Screen = "main" },
		"duplicate screens": func(r *presenceCheckIn) { r.Screens = append(r.Screens, PresenceScreen{Screen: "ticker"}) },
	}
	for name, mutate := range bad {
		r := base()
		mutate(&r)
		if err := validatePresence(&r); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	// Unknown fields are refused by the strict decoder, like every other
	// analytics body.
	var r presenceCheckIn
	if err := decodeStrict([]byte(`{"session_id":"0123456789abcdef","seq":1,"session":"unlocked","input":"recent","display":"awake","ticker":"shown","hostname":"x"}`), &r); err == nil {
		t.Fatal("unknown field accepted")
	}
}

func TestSummarizePresenceDeduplicatesUsersAndAddsScreens(t *testing.T) {
	shown := func(sub, session string, screens int, widgets ...string) PresenceLive {
		p := PresenceLive{Sub: sub, SessionID: session, Session: "unlocked", Input: "recent", Display: "awake", Ticker: "shown", OS: "windows", AppVersion: "1.6.7"}
		for i := 0; i < screens; i++ {
			p.Screens = append(p.Screens, PresenceScreen{Screen: "ticker", Shown: true, Widgets: widgets})
		}
		return p
	}
	locked := shown("bob", "s3", 1, "sports_nfl")
	locked.Session = "locked"
	hidden := shown("dan", "s5", 0)
	hidden.Ticker = "hidden"
	staff := shown("staff", "s6", 1, "clock")
	staff.Internal = true
	sessions := []PresenceLive{
		shown("alice", "s1", 2, "sports_nfl"), // two screens on one computer
		shown("alice", "s2", 1, "news_bbc"),   // her second computer
		locked,                                // running, but a locked screen shows nothing
		shown("carol", "s4", 1),               // ticker window shown, nothing rendering
		hidden,
		staff,
	}
	h := SummarizePresence(sessions, true)
	if h.ActiveUsers != 4 || h.TickerUsers != 2 || h.Screens != 4 || h.Sessions != 5 {
		t.Fatalf("headline = %+v", h)
	}
	if h.ScreensPerUser["2+"] != 1 || h.ScreensPerUser["1"] != 1 || h.ScreensPerUser["0"] != 2 {
		t.Fatalf("screens per user = %v", h.ScreensPerUser)
	}
	if h.TickerState["shown"] != 3 || h.TickerState["hidden"] != 2 || h.SessionState["locked"] != 1 {
		t.Fatalf("states = ticker %v session %v", h.TickerState, h.SessionState)
	}
	if all := SummarizePresence(sessions, false); all.ActiveUsers != 5 || all.Sessions != 6 {
		t.Fatalf("with staff = %+v", all)
	}
	if w := locked.ShownWidgets(); len(w) != 0 {
		t.Fatalf("locked session shows widgets: %v", w)
	}
}

// ── Real database ────────────────────────────────────────────────────────────

func presenceTestApp() *fiber.App {
	app := productAnalyticsTestApp()
	app.Post("/presence", HandlePresenceCheckIn)
	return app
}

func enrollForPresence(t *testing.T, sub string) {
	t.Helper()
	testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments (logto_sub) VALUES ($1) ON CONFLICT DO NOTHING`, sub)
}

func checkIn(t *testing.T, sub, session string, seq int64, at time.Time, mutate func(*presenceCheckIn)) bool {
	t.Helper()
	req := presenceCheckIn{
		SessionID: session, Seq: seq, Session: "unlocked", Input: "recent", Display: "awake", Ticker: "shown",
		Screens: []PresenceScreen{{Screen: "ticker", Shown: true, Widgets: []string{"sports_nfl"}}},
	}
	if mutate != nil {
		mutate(&req)
	}
	recorded, err := recordPresence(context.Background(), sub, req, "1.6.7", "windows", at)
	if err != nil {
		t.Fatalf("check-in %s/%s seq %d: %v", sub, session, seq, err)
	}
	return recorded
}

func sumSeconds(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n *int
	if err := platform.DBPool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	if n == nil {
		return 0
	}
	return *n
}

func resetPresence(t *testing.T) {
	t.Helper()
	resetProductAnalytics(t)
	if platform.Rdb == nil {
		t.Skip("redis unavailable")
	}
	platform.Rdb.FlushAll(context.Background())
}

func TestPresenceCreditsOverlapOncePerAccountAndScreensSeparately(t *testing.T) {
	resetPresence(t)
	const sub = "presence-two-computers"
	enrollForPresence(t, sub)
	t0 := time.Date(2026, 9, 11, 14, 0, 0, 0, time.UTC)

	// Computer A: one screen, NFL. Computer B, starting ten seconds later:
	// one screen, NFL + BBC. Both report twice, thirty seconds apart.
	checkIn(t, sub, "computerAcomputerA", 1, t0, nil)
	checkIn(t, sub, "computerBcomputerB", 1, t0.Add(10*time.Second), func(r *presenceCheckIn) {
		r.Screens[0].Widgets = []string{"sports_nfl", "news_bbc"}
	})
	checkIn(t, sub, "computerAcomputerA", 2, t0.Add(30*time.Second), nil)
	checkIn(t, sub, "computerBcomputerB", 2, t0.Add(40*time.Second), func(r *presenceCheckIn) {
		r.Screens[0].Widgets = []string{"sports_nfl", "news_bbc"}
	})

	// Per computer: 30 s each of running, ticker and screen time.
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_session_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("session running seconds = %d, want 60", got)
	}
	if got := sumSeconds(t, `SELECT sum(screen_seconds) FROM presence_session_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("screen seconds = %d, want 60 (each screen counts)", got)
	}
	// Per account: the union [t0, t0+40) is 40 s, not 60.
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 40 {
		t.Fatalf("account running seconds = %d, want 40 (overlap counted once)", got)
	}
	if got := sumSeconds(t, `SELECT sum(ticker_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 40 {
		t.Fatalf("account ticker seconds = %d, want 40", got)
	}
	// NFL was on both computers: 40 s of user time, 60 s of screen time.
	if got := sumSeconds(t, `SELECT sum(user_seconds) FROM presence_widget_account_hourly WHERE logto_sub=$1 AND widget_type='sports_nfl'`, sub); got != 40 {
		t.Fatalf("nfl user seconds = %d, want 40", got)
	}
	if got := sumSeconds(t, `SELECT sum(screen_seconds) FROM presence_widget_hourly WHERE logto_sub=$1 AND widget_type='sports_nfl'`, sub); got != 60 {
		t.Fatalf("nfl screen seconds = %d, want 60", got)
	}
	// BBC was only on computer B: 30 s either way.
	if got := sumSeconds(t, `SELECT sum(user_seconds) FROM presence_widget_account_hourly WHERE logto_sub=$1 AND widget_type='news_bbc'`, sub); got != 30 {
		t.Fatalf("bbc user seconds = %d, want 30", got)
	}
	var firstSeen time.Time
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT first_seen_day FROM presence_accounts WHERE logto_sub=$1`, sub).Scan(&firstSeen); err != nil || firstSeen.Format("2006-01-02") != "2026-09-11" {
		t.Fatalf("first_seen_day = %v err=%v", firstSeen, err)
	}

	// Live: one user, two computers, two shown screens.
	sessions, err := LivePresenceSessions(context.Background(), t0.Add(45*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	h := SummarizePresence(sessions, true)
	if h.ActiveUsers != 1 || h.Sessions != 2 || h.Screens != 2 || h.TickerUsers != 1 {
		t.Fatalf("live headline = %+v", h)
	}
}

func TestPresenceUsesStateAtIntervalStartAndBridgesNoGaps(t *testing.T) {
	resetPresence(t)
	const sub = "presence-transitions"
	enrollForPresence(t, sub)
	t0 := time.Date(2026, 9, 11, 15, 0, 0, 0, time.UTC)

	// shown → locked → unlocked, thirty seconds apart.
	checkIn(t, sub, "sessionXsessionX", 1, t0, nil)
	checkIn(t, sub, "sessionXsessionX", 2, t0.Add(30*time.Second), func(r *presenceCheckIn) { r.Session = "locked" })
	checkIn(t, sub, "sessionXsessionX", 3, t0.Add(60*time.Second), nil)
	// The state that held during [t0+30, t0+60) was locked: no ticker credit.
	if got := sumSeconds(t, `SELECT sum(ticker_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 30 {
		t.Fatalf("ticker seconds = %d, want 30 (locked interval contributes none)", got)
	}
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("running seconds = %d, want 60 (locked still counts as running)", got)
	}

	// A 5-minute silence (sleep, crash, lost network) is not bridged.
	checkIn(t, sub, "sessionXsessionX", 4, t0.Add(6*time.Minute), nil)
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("running seconds after gap = %d, want 60 (gap credits nothing)", got)
	}
	// Reporting resumes normally after the gap.
	checkIn(t, sub, "sessionXsessionX", 5, t0.Add(6*time.Minute+30*time.Second), nil)
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 90 {
		t.Fatalf("running seconds after resume = %d, want 90", got)
	}

	// An idle input state changes nothing: Scrollr is watched, not typed at.
	checkIn(t, sub, "sessionXsessionX", 6, t0.Add(7*time.Minute), func(r *presenceCheckIn) { r.Input = "idle" })
	checkIn(t, sub, "sessionXsessionX", 7, t0.Add(7*time.Minute+30*time.Second), func(r *presenceCheckIn) { r.Input = "idle" })
	// [6:30, 7:00) was shown and [7:00, 7:30) was shown-but-idle: both count.
	if got := sumSeconds(t, `SELECT sum(ticker_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 120 {
		t.Fatalf("ticker seconds with idle input = %d, want 120", got)
	}

	// A display that is asleep shows nothing, though the app keeps running:
	// [7:30, 8:00) still counts (state at its start was awake), [8:00, 8:30)
	// does not.
	checkIn(t, sub, "sessionXsessionX", 8, t0.Add(8*time.Minute), func(r *presenceCheckIn) { r.Display = "asleep" })
	checkIn(t, sub, "sessionXsessionX", 9, t0.Add(8*time.Minute+30*time.Second), func(r *presenceCheckIn) { r.Display = "asleep" })
	if got := sumSeconds(t, `SELECT sum(ticker_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 150 {
		t.Fatalf("ticker seconds with display asleep = %d, want 150", got)
	}
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 210 {
		t.Fatalf("running seconds = %d, want 210", got)
	}
}

func TestPresenceSplitsAtHourBoundariesAndKeepsStaleCheckInsOut(t *testing.T) {
	resetPresence(t)
	const sub = "presence-hours"
	enrollForPresence(t, sub)
	t0 := time.Date(2026, 9, 11, 16, 59, 50, 0, time.UTC)
	checkIn(t, sub, "sessionYsessionY", 1, t0, nil)
	checkIn(t, sub, "sessionYsessionY", 2, t0.Add(30*time.Second), nil)
	if got := sumSeconds(t, `SELECT running_seconds FROM presence_account_hourly WHERE logto_sub=$1 AND hour=$2`, sub, t0.Truncate(time.Hour)); got != 10 {
		t.Fatalf("hour 16 = %d, want 10", got)
	}
	if got := sumSeconds(t, `SELECT running_seconds FROM presence_account_hourly WHERE logto_sub=$1 AND hour=$2`, sub, t0.Truncate(time.Hour).Add(time.Hour)); got != 20 {
		t.Fatalf("hour 17 = %d, want 20", got)
	}

	// A replayed or out-of-order check-in is ignored and cannot overwrite
	// the newer state on record.
	if recorded := checkIn(t, sub, "sessionYsessionY", 1, t0.Add(45*time.Second), func(r *presenceCheckIn) { r.Session = "locked" }); recorded {
		t.Fatal("stale seq was recorded")
	}
	sessions, err := LivePresenceSessions(context.Background(), t0.Add(50*time.Second))
	if err != nil || len(sessions) != 1 || sessions[0].Seq != 2 || sessions[0].Session != "unlocked" {
		t.Fatalf("live after stale check-in = %+v err=%v", sessions, err)
	}

	// Ended: the final interval is credited and the session disappears.
	checkIn(t, sub, "sessionYsessionY", 3, t0.Add(60*time.Second), func(r *presenceCheckIn) { r.Ended = true })
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("running after end = %d, want 60", got)
	}
	sessions, _ = LivePresenceSessions(context.Background(), t0.Add(61*time.Second))
	if len(sessions) != 0 {
		t.Fatalf("ended session still live: %+v", sessions)
	}
	// A tick that was in flight when the app quit arrives after `ended`:
	// the tombstone's seq rejects it, so the dead session is not resurrected
	// and nothing more is credited.
	if recorded := checkIn(t, sub, "sessionYsessionY", 2, t0.Add(62*time.Second), nil); recorded {
		t.Fatal("late tick after ended was recorded")
	}
	if s, _ := LivePresenceSessions(context.Background(), t0.Add(63*time.Second)); len(s) != 0 {
		t.Fatalf("late tick resurrected the ended session: %+v", s)
	}
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("running after late tick = %d, want 60", got)
	}
	// Resume within the expiry (suspend → resume) starts a fresh interval:
	// the seq moves on, the session is live again, the gap is not credited.
	if recorded := checkIn(t, sub, "sessionYsessionY", 4, t0.Add(80*time.Second), nil); !recorded {
		t.Fatal("resume after ended was not recorded")
	}
	if s, _ := LivePresenceSessions(context.Background(), t0.Add(81*time.Second)); len(s) != 1 || s[0].Seq != 4 {
		t.Fatalf("resumed session not live: %+v", s)
	}
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_account_hourly WHERE logto_sub=$1`, sub); got != 60 {
		t.Fatalf("resume credited the suspended gap: %d, want 60", got)
	}
	checkIn(t, sub, "sessionYsessionY", 5, t0.Add(110*time.Second), func(r *presenceCheckIn) { r.Ended = true })
	// Expiry: a session that stops reporting drops out after 90 s.
	checkIn(t, sub, "sessionZsessionZ", 1, t0.Add(2*time.Minute), nil)
	if s, _ := LivePresenceSessions(context.Background(), t0.Add(2*time.Minute+89*time.Second)); len(s) != 1 {
		t.Fatalf("session expired early: %+v", s)
	}
	if s, _ := LivePresenceSessions(context.Background(), t0.Add(2*time.Minute+91*time.Second)); len(s) != 0 {
		t.Fatalf("session did not expire: %+v", s)
	}
}

func TestPresenceRequiresEnrollmentAndOptOutRemovesEverything(t *testing.T) {
	resetPresence(t)
	app := presenceTestApp()
	const sub = "presence-consent"
	body := `{"session_id":"sessionQsessionQ","seq":1,"session":"unlocked","input":"recent","display":"awake","ticker":"shown","screens":[{"screen":"ticker","shown":true,"widgets":["sports_nfl"]}]}`

	// Not enrolled: nothing is stored and the desktop is told nothing more.
	resp := analyticsRequest(t, app, http.MethodPost, "/presence", sub, body)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 for an account without usage analytics", resp.StatusCode)
	}
	if s, _ := LivePresenceSessions(context.Background(), time.Now()); len(s) != 0 {
		t.Fatalf("unenrolled account went live: %+v", s)
	}
	resp = analyticsRequest(t, app, http.MethodPost, "/presence", sub, `{"session_id":"x","seq":1}`)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed check-in status = %d, want 400", resp.StatusCode)
	}
	resp = analyticsRequest(t, app, http.MethodPost, "/presence", "", body)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d, want 401", resp.StatusCode)
	}

	// Enrolled through the real consent path, then two check-ins.
	analyticsRequest(t, app, http.MethodGet, "/posthog-consent", sub, "")
	if resp := analyticsRequest(t, app, http.MethodPost, "/presence", sub, body); resp.StatusCode != http.StatusOK {
		t.Fatalf("enrolled check-in status = %d, want 200", resp.StatusCode)
	}
	t0 := time.Now().UTC()
	checkIn(t, sub, "sessionQsessionQ", 2, t0.Add(30*time.Second), nil)
	if got := sumSeconds(t, `SELECT sum(running_seconds) FROM presence_session_hourly WHERE logto_sub=$1`, sub); got <= 0 {
		t.Fatalf("nothing credited after enrolment: %d", got)
	}

	// Opting out cascades every presence row and drops the live session.
	analyticsRequest(t, app, http.MethodPut, "/posthog-consent", sub, `{"decision":"declined"}`)
	for _, table := range []string{"presence_session_hourly", "presence_account_hourly", "presence_widget_hourly", "presence_widget_account_hourly", "presence_watermarks", "presence_accounts"} {
		if n := sumSeconds(t, `SELECT count(*) FROM `+table+` WHERE logto_sub=$1`, sub); n != 0 {
			t.Errorf("%s still holds %d rows after opt-out", table, n)
		}
	}
	if s, _ := LivePresenceSessions(context.Background(), time.Now()); len(s) != 0 {
		t.Fatalf("live session survived opt-out: %+v", s)
	}
	// And a check-in after opting out is refused again.
	if resp := analyticsRequest(t, app, http.MethodPost, "/presence", sub, body); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("post-opt-out status = %d, want 204", resp.StatusCode)
	}
}

// Staff is the admin_users table, not a stored flag: an account that was
// enrolled as a customer and later made staff is internal from its next
// check-in, with no consent re-read in between.
func TestPresenceMarksAdminTableMembersInternalAtCheckIn(t *testing.T) {
	resetPresence(t)
	const sub = "presence-late-staff"
	enrollForPresence(t, sub)
	testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'late-staff@example.test'`)
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM admin_users WHERE email = 'late-staff@example.test'`) })
	t0 := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	checkIn(t, sub, "sessionSsessionS", 1, t0, nil)
	checkIn(t, sub, "sessionSsessionS", 2, t0.Add(30*time.Second), nil)
	var internal bool
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT internal FROM presence_account_hourly WHERE logto_sub = $1`, sub).Scan(&internal); err != nil || internal {
		t.Fatalf("customer hour internal=%v err=%v", internal, err)
	}
	testsupport.MustExec(t, `INSERT INTO admin_users (email, logto_sub) VALUES ('late-staff@example.test', $1)`, sub)
	checkIn(t, sub, "sessionSsessionS", 3, t0.Add(60*time.Second), nil)
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT internal FROM presence_accounts WHERE logto_sub = $1`, sub).Scan(&internal); err != nil || !internal {
		t.Fatalf("after pinning: presence_accounts internal=%v err=%v", internal, err)
	}
	sessions, _ := LivePresenceSessions(context.Background(), t0.Add(61*time.Second))
	if len(sessions) != 1 || !sessions[0].Internal {
		t.Fatalf("live session not internal after pinning: %+v", sessions)
	}
}

// The account export carries every presence table the check-ins wrote.
func TestExportIncludesPresenceHistory(t *testing.T) {
	resetPresence(t)
	const sub = "presence-export"
	enrollForPresence(t, sub)
	t0 := time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)
	checkIn(t, sub, "sessionEsessionE", 1, t0, nil)
	checkIn(t, sub, "sessionEsessionE", 2, t0.Add(30*time.Second), nil)
	testsupport.MustExec(t, `INSERT INTO presence_widget_changes (logto_sub, widget_type, change, at) VALUES ($1, 'sports_nfl', 'added', $2)`, sub, t0)

	app := newDeletionTestApp(sub)
	resp, err := app.Test(httptest.NewRequest("GET", "/users/me/export", nil))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("export: status %d err %v", resp.StatusCode, err)
	}
	defer resp.Body.Close()
	var archive struct {
		ProductAnalytics struct {
			Presence struct {
				FirstSeenDay  string           `json:"first_seen_day"`
				Hourly        []map[string]any `json:"hourly"`
				WidgetHourly  []map[string]any `json:"widget_hourly"`
				WidgetChanges []map[string]any `json:"widget_changes"`
			} `json:"presence"`
		} `json:"product_analytics"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&archive); err != nil {
		t.Fatal(err)
	}
	p := archive.ProductAnalytics.Presence
	if p.FirstSeenDay != "2026-09-11" || len(p.Hourly) != 1 || p.Hourly[0]["running_seconds"] != float64(30) ||
		len(p.WidgetHourly) != 1 || p.WidgetHourly[0]["widget_type"] != "sports_nfl" || len(p.WidgetChanges) != 1 {
		t.Fatalf("presence export = %+v", p)
	}
}

func TestPresenceSampleKeepsTheMaximumAcrossReplicas(t *testing.T) {
	resetPresence(t)
	const sub = "presence-sample"
	enrollForPresence(t, sub)
	t0 := time.Date(2026, 9, 11, 18, 0, 5, 0, time.UTC)
	checkIn(t, sub, "sessionSsessionS", 1, t0, nil)
	samplePresence(context.Background(), t0)
	var users, screens int
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT users, screens FROM presence_concurrency_minute WHERE minute=$1`, t0.Truncate(time.Minute)).Scan(&users, &screens); err != nil || users != 1 || screens != 1 {
		t.Fatalf("sample = %d/%d err=%v", users, screens, err)
	}
	// A second replica sampling the same minute after the session ended
	// must not lower the recorded peak.
	checkIn(t, sub, "sessionSsessionS", 2, t0.Add(20*time.Second), func(r *presenceCheckIn) { r.Ended = true })
	samplePresence(context.Background(), t0.Add(30*time.Second))
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT users FROM presence_concurrency_minute WHERE minute=$1`, t0.Truncate(time.Minute)).Scan(&users); err != nil || users != 1 {
		t.Fatalf("peak lowered: users=%d err=%v", users, err)
	}
	// Staff never enter the sample: the peak is a customer number.
	testsupport.MustExec(t, `UPDATE product_analytics_enrollments SET internal = true WHERE logto_sub=$1`, sub)
	checkIn(t, sub, "sessionTsessionT", 1, t0.Add(2*time.Minute), nil)
	samplePresence(context.Background(), t0.Add(2*time.Minute+5*time.Second))
	if err := platform.DBPool.QueryRow(context.Background(), `SELECT users FROM presence_concurrency_minute WHERE minute=$1`, t0.Add(2*time.Minute).Truncate(time.Minute)).Scan(&users); err != nil || users != 0 {
		t.Fatalf("staff counted in sample: users=%d err=%v", users, err)
	}
}
