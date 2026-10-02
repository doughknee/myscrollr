package githubapp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// fakeGitHub stands in for github.com (token endpoint) and api.github.com.
type fakeGitHub struct {
	mu          sync.Mutex
	valid       map[string]bool // access tokens GitHub accepts
	refreshOK   bool
	exhausted   bool // answer runs with a spent rate limit
	repoCount   int  // repos /user/repos lists (SCROLLR-307)
	listCalls   int
	runsCalls   int
	runsTokens  []string
	tokenGrants []string // grant_type of each token call ("" = code exchange)
	revoked     []string
}

func (f *fakeGitHub) handler(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/login/oauth/access_token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_secret") != "test-secret" {
			t.Errorf("token call without the client secret")
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		grant := r.Form.Get("grant_type")
		f.tokenGrants = append(f.tokenGrants, grant)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case grant == "refresh_token" && f.refreshOK:
			f.valid["ghu_refreshed"] = true
			_, _ = io.WriteString(w, `{"access_token":"ghu_refreshed","refresh_token":"ghr_refreshed","expires_in":28800,"refresh_token_expires_in":15897600}`)
		case grant == "refresh_token":
			_, _ = io.WriteString(w, `{"error":"bad_refresh_token"}`)
		case r.Form.Get("code") == "good-code":
			f.valid["ghu_first"] = true
			_, _ = io.WriteString(w, `{"access_token":"ghu_first","refresh_token":"ghr_first","expires_in":28800,"refresh_token_expires_in":15897600}`)
		default:
			_, _ = io.WriteString(w, `{"error":"bad_verification_code"}`)
		}
	})
	mux.HandleFunc("/user", func(w http.ResponseWriter, r *http.Request) {
		if !f.accepts(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = io.WriteString(w, `{"login":"octo","id":42}`)
	})
	mux.HandleFunc("/repos/", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.runsCalls++
		f.runsTokens = append(f.runsTokens, strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		exhausted := f.exhausted
		f.mu.Unlock()
		if r.Header.Get("Authorization") != "" && !f.accepts(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if exhausted {
			w.Header().Set("X-Ratelimit-Remaining", "0")
			w.Header().Set("X-Ratelimit-Reset", strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10))
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("X-Ratelimit-Remaining", "59")
		switch {
		case strings.Contains(r.URL.Path, "/quiet"): // Actions never ran
			_, _ = io.WriteString(w, `{"total_count":0,"workflow_runs":[]}`)
			return
		case strings.Contains(r.URL.Path, "/old"): // last run months ago
			_, _ = io.WriteString(w, `{"total_count":1,"workflow_runs":[{"name":"CI","status":"completed","conclusion":"success",
				"run_started_at":"2026-06-01T00:00:00Z","updated_at":"2026-06-01T00:05:00Z"}]}`)
			return
		}
		_, _ = io.WriteString(w, `{"total_count":1,"workflow_runs":[{"name":"CI","status":"completed","conclusion":"success",
			"html_url":"https://github.com/o/r/actions/runs/1","head_branch":"main","run_started_at":"2026-10-02T08:00:00Z",
			"updated_at":"2026-10-02T08:05:00Z","head_commit":{"message":"fix: the thing"}}]}`)
	})
	// The user's repos, every third one active (o/rNN), old (o/oldNN) or
	// without Actions (o/quietNN); pushed an hour apart, sent oldest first
	// so the handler's own ordering is what decides which 30 get checked.
	mux.HandleFunc("/user/repos", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.listCalls++
		n := f.repoCount
		f.mu.Unlock()
		if !f.accepts(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if q := r.URL.Query(); q.Get("sort") != "pushed" || q.Get("per_page") != "100" ||
			q.Get("affiliation") != "owner,collaborator,organization_member" {
			t.Errorf("repos query = %s", r.URL.RawQuery)
		}
		repos := make([]map[string]any, 0, n)
		for i := n - 1; i >= 0; i-- {
			repos = append(repos, map[string]any{
				"full_name":      fakeRepoName(i),
				"private":        i%2 == 0,
				"pushed_at":      fakeNow.Add(-time.Duration(i+1) * time.Hour).Format(time.RFC3339),
				"default_branch": "main",
			})
		}
		_ = json.NewEncoder(w).Encode(repos)
	})
	mux.HandleFunc("/applications/", func(w http.ResponseWriter, r *http.Request) {
		if user, pass, ok := r.BasicAuth(); !ok || user != "Iv-test" || pass != "test-secret" {
			t.Errorf("revoke without app basic auth")
		}
		var body struct {
			AccessToken string `json:"access_token"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.revoked = append(f.revoked, body.AccessToken)
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

// fakeNow is the clock the repo tests pin: the fake's "recent" run
// (2026-10-02T08:00Z) is inside the 30-day window, "old" is not.
var fakeNow = time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)

func fakeRepoName(i int) string {
	return fmt.Sprintf("o/%s%02d", []string{"r", "old", "quiet"}[i%3], i)
}

func (f *fakeGitHub) accepts(r *http.Request) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.valid[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
}

func (f *fakeGitHub) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runsCalls
}

// setup points the package at a fake GitHub and a fresh miniredis, and
// returns a Fiber app with the routes as server.go mounts them (auth stubbed
// to the X-Test-Sub header).
func setup(t *testing.T) (*fakeGitHub, *miniredis.Miniredis, *fiber.App) {
	t.Helper()
	f := &fakeGitHub{valid: map[string]bool{}}
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	prevWeb, prevAPI := WebBase, APIBase
	WebBase, APIBase = srv.URL, srv.URL
	t.Cleanup(func() { WebBase, APIBase = prevWeb, prevAPI })

	mr, cleanup := testsupport.MiniRedis(t)
	t.Cleanup(cleanup)

	t.Setenv("GITHUB_APP_CLIENT_ID", "Iv-test")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "test-secret")
	t.Setenv("GITHUB_APP_CALLBACK_URL", "http://localhost:18080/github/callback")
	t.Setenv("FRONTEND_URL", "https://web.test")
	t.Setenv("ENCRYPTION_KEY", "test-encryption-key")

	app := fiber.New()
	auth := func(c *fiber.Ctx) error {
		c.Locals("user_id", c.Get("X-Test-Sub"))
		return c.Next()
	}
	app.Get("/github/connect", auth, HandleConnect)
	app.Get("/github/callback", HandleCallback)
	app.Get("/github/status", auth, HandleStatus)
	app.Delete("/github/connection", auth, HandleDisconnect)
	app.Get("/github/runs", auth, HandleRuns)
	app.Get("/github/repos", auth, HandleRepos)
	return f, mr, app
}

func do(t *testing.T, app *fiber.App, method, target, sub string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	if sub != "" {
		req.Header.Set("X-Test-Sub", sub)
	}
	resp, err := app.Test(req, 10_000)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	return resp
}

func decode[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return v
}

// connectState runs /github/connect and returns the state it minted.
func connectState(t *testing.T, app *fiber.App, sub string) string {
	t.Helper()
	resp := do(t, app, "GET", "/github/connect", sub)
	if resp.StatusCode != 200 {
		t.Fatalf("connect: HTTP %d", resp.StatusCode)
	}
	u, err := url.Parse(decode[struct{ URL string }](t, resp).URL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("state")
}

// ── Unit: no database ─────────────────────────────────────────────

func TestConnectBuildsAuthorizeURLAndSingleUseState(t *testing.T) {
	_, mr, app := setup(t)
	resp := do(t, app, "GET", "/github/connect", "sub_connect")
	body := decode[struct{ URL string }](t, resp)
	u, err := url.Parse(body.URL)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Path != "/login/oauth/authorize" || q.Get("client_id") != "Iv-test" ||
		q.Get("redirect_uri") != "http://localhost:18080/github/callback" || len(q.Get("state")) != 64 {
		t.Fatalf("authorize URL = %s", body.URL)
	}
	if q.Has("scope") {
		t.Errorf("a GitHub App's permissions are fixed; no scope expected")
	}
	key := keyState + q.Get("state")
	if got, _ := mr.Get(key); got != "sub_connect" {
		t.Errorf("state maps to %q, want sub_connect", got)
	}
	if ttl := mr.TTL(key); ttl <= 0 || ttl > 10*time.Minute {
		t.Errorf("state TTL = %v, want (0, 10m]", ttl)
	}
}

func TestCallbackRejectsUnknownState(t *testing.T) {
	f, _, app := setup(t)
	resp := do(t, app, "GET", "/github/callback?code=good-code&state=forged", "")
	if loc := resp.Header.Get("Location"); loc != "https://web.test/account?github=error" {
		t.Errorf("redirect = %q", loc)
	}
	if len(f.tokenGrants) != 0 {
		t.Errorf("a forged state reached GitHub's token endpoint")
	}
}

func TestRunsRejectsMalformedRepo(t *testing.T) {
	_, _, app := setup(t)
	for _, q := range []string{"../etc", "a/b/c", "a", "a/..", "a%2Fb/c"} {
		if resp := do(t, app, "GET", "/github/runs?repos="+q, "sub_x"); resp.StatusCode != 400 {
			t.Errorf("repos=%s: HTTP %d, want 400", q, resp.StatusCode)
		}
	}
}

// TestRateLimitBudget is the acceptance arithmetic: five repos, polled by
// the ticker and the app page every 30 s for an hour, cost one GitHub call
// per repo per 60 s cache window — 300 calls, under the 400 bound.
func TestRateLimitBudget(t *testing.T) {
	f, mr, _ := setup(t)
	f.valid["ghu_first"] = true
	token := func() (string, error) { return "ghu_first", nil }
	repos := []string{"o/a", "o/b", "o/c", "o/d", "o/e"}
	ctx := context.Background()
	for step := 0; step < 120; step++ { // 120 x 30 s = 1 h
		for poller := 0; poller < 2; poller++ {
			for _, repo := range repos {
				if r, err := answer(ctx, userNS("sub_budget"), repo, userRunsTTL, token); err != nil || !r.Available {
					t.Fatalf("answer %s: %+v %v", repo, r, err)
				}
			}
		}
		mr.FastForward(30 * time.Second)
	}
	calls := f.calls()
	t.Logf("GitHub calls in one hour: %d (5 repos, 2 pollers, 30 s cadence, 60 s cache)", calls)
	if calls > 400 {
		t.Fatalf("calls = %d, want <= 400", calls)
	}
	if calls != 300 {
		t.Errorf("calls = %d, want exactly 300 (one per repo per minute)", calls)
	}
}

// TestPublicFallbackHonoursReset: once GitHub says the shared budget is
// spent, nothing calls it again before the reset, and repos already seen
// keep their last answer marked stale.
func TestPublicFallbackHonoursReset(t *testing.T) {
	f, mr, _ := setup(t)
	ctx := context.Background()
	anon := func() (string, error) { return "", nil }

	first, _ := answer(ctx, nsPublic, "o/seen", publicRunsTTL, anon)
	if !first.Available || first.Stale {
		t.Fatalf("first answer = %+v", first)
	}
	mr.FastForward(publicRunsTTL + time.Second)

	f.mu.Lock()
	f.exhausted = true
	f.mu.Unlock()
	got, _ := answer(ctx, nsPublic, "o/seen", publicRunsTTL, anon)
	if !got.Available || !got.Stale || got.Conclusion != "success" {
		t.Errorf("rate-limited answer = %+v, want the last good run marked stale", got)
	}
	before := f.calls()
	other, _ := answer(ctx, nsPublic, "o/never-seen", publicRunsTTL, anon)
	if f.calls() != before {
		t.Errorf("called GitHub while the budget was spent")
	}
	if other.Available || !other.Stale {
		t.Errorf("unseen repo while limited = %+v", other)
	}
	if ttl := mr.TTL(keyLimited + nsPublic); ttl < 9*time.Minute {
		t.Errorf("limit held for %v, want until GitHub's reset (~10m)", ttl)
	}
}

// ── Integration: real Postgres (CI) ───────────────────────────────

func setupDB(t *testing.T) (*fakeGitHub, *miniredis.Miniredis, *fiber.App) {
	t.Helper()
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	f, mr, app := setup(t)
	testsupport.MustExec(t, `TRUNCATE github_connections`)
	return f, mr, app
}

func seedConnection(t *testing.T, sub, access string, expiresIn int) {
	t.Helper()
	tok := tokenResponse{AccessToken: access, RefreshToken: "ghr_first", ExpiresIn: expiresIn, RefreshTokenExpiresIn: 15897600}
	if err := saveTokens(context.Background(), sub, "octo", 42, tok); err != nil {
		t.Fatal(err)
	}
}

func rowStatus(t *testing.T, sub string) (status, access string) {
	t.Helper()
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT status, access_token FROM github_connections WHERE logto_sub = $1`, sub).Scan(&status, &access); err != nil {
		t.Fatalf("read row: %v", err)
	}
	return status, access
}

func TestCallbackStoresEncryptedTokens(t *testing.T) {
	_, mr, app := setupDB(t)
	state := connectState(t, app, "sub_cb")

	resp := do(t, app, "GET", "/github/callback?code=good-code&state="+state, "")
	if loc := resp.Header.Get("Location"); loc != "https://web.test/account?github=connected" {
		t.Fatalf("redirect = %q", loc)
	}
	if mr.Exists(keyState + state) {
		t.Errorf("state survived its use")
	}
	status, access := rowStatus(t, "sub_cb")
	if status != "ok" || strings.Contains(access, "ghu_") {
		t.Errorf("row status=%q access stored in the clear=%v", status, strings.Contains(access, "ghu_"))
	}
	if plain, err := platform.Decrypt(access); err != nil || plain != "ghu_first" {
		t.Errorf("stored token decrypts to %q, %v", plain, err)
	}

	st := decode[StatusResponse](t, do(t, app, "GET", "/github/status", "sub_cb"))
	if !st.Connected || st.Login != "octo" || st.Since == "" {
		t.Errorf("status = %+v", st)
	}
	// The state is single-use: a replay goes nowhere.
	if loc := do(t, app, "GET", "/github/callback?code=good-code&state="+state, "").Header.Get("Location"); !strings.HasSuffix(loc, "github=error") {
		t.Errorf("replayed state redirect = %q", loc)
	}
}

func TestRunsRefreshesTokenNearExpiry(t *testing.T) {
	f, _, app := setupDB(t)
	f.refreshOK = true
	seedConnection(t, "sub_refresh", "ghu_first", 120) // expires in 2 min < 5 min skew

	out := decode[RunsResponse](t, do(t, app, "GET", "/github/runs?repos=o/private", "sub_refresh"))
	if !out.Connected || out.Login != "octo" || len(out.Runs) != 1 || !out.Runs[0].Available {
		t.Fatalf("runs = %+v", out)
	}
	if r := out.Runs[0]; r.Conclusion != "success" || r.CommitMessage != "fix: the thing" || r.HeadBranch != "main" {
		t.Errorf("run fields = %+v", r)
	}
	if len(f.tokenGrants) != 1 || f.tokenGrants[0] != "refresh_token" {
		t.Errorf("token calls = %v, want one refresh", f.tokenGrants)
	}
	if len(f.runsTokens) != 1 || f.runsTokens[0] != "ghu_refreshed" {
		t.Errorf("runs called with %v, want the refreshed token", f.runsTokens)
	}
	_, access := rowStatus(t, "sub_refresh")
	if plain, _ := platform.Decrypt(access); plain != "ghu_refreshed" {
		t.Errorf("stored token after refresh = %q", plain)
	}
}

func TestRunsMarksBrokenWhenGitHubRefusesTokenAndRefresh(t *testing.T) {
	f, _, app := setupDB(t)
	f.refreshOK = false
	seedConnection(t, "sub_broken", "ghu_revoked", 28800) // not near expiry; GitHub 401s it

	out := decode[RunsResponse](t, do(t, app, "GET", "/github/runs?repos=o/public", "sub_broken"))
	if out.Connected || !out.Connect || out.Reason == "" {
		t.Errorf("response = %+v, want connected:false connect:true with a reason", out)
	}
	// The public fallback still answers, so the widget does not go blank.
	if len(out.Runs) != 1 || !out.Runs[0].Available {
		t.Errorf("fallback runs = %+v", out.Runs)
	}
	if len(f.tokenGrants) != 1 || f.tokenGrants[0] != "refresh_token" {
		t.Errorf("token calls = %v, want one refresh attempt before giving up", f.tokenGrants)
	}
	if status, _ := rowStatus(t, "sub_broken"); status != "broken" {
		t.Errorf("status = %q, want broken", status)
	}
	h, err := ReadHealth(context.Background())
	if err != nil || h.Connections != 1 || h.Broken != 1 {
		t.Errorf("health = %+v, %v", h, err)
	}
	if st := decode[StatusResponse](t, do(t, app, "GET", "/github/status", "sub_broken")); st.Connected || st.Reason == "" {
		t.Errorf("status = %+v", st)
	}
}

func TestRunsUnconnectedUsesPublicFallback(t *testing.T) {
	f, _, app := setupDB(t)
	out := decode[RunsResponse](t, do(t, app, "GET", "/github/runs?repos=o/a,o/b", "sub_none"))
	if out.Connected || !out.Connect || len(out.Runs) != 2 || !out.Runs[0].Available {
		t.Errorf("response = %+v", out)
	}
	for _, tok := range f.runsTokens {
		if tok != "" {
			t.Errorf("fallback sent a token: %q", tok)
		}
	}
}

func TestDisconnectRevokesAndDeletes(t *testing.T) {
	f, mr, app := setupDB(t)
	f.valid["ghu_first"] = true
	seedConnection(t, "sub_bye", "ghu_first", 28800)
	do(t, app, "GET", "/github/runs?repos=o/private", "sub_bye") // populate the cache
	if len(mr.Keys()) == 0 {
		t.Fatal("expected cached runs")
	}

	if resp := do(t, app, "DELETE", "/github/connection", "sub_bye"); resp.StatusCode != 200 {
		t.Fatalf("disconnect: HTTP %d", resp.StatusCode)
	}
	if len(f.revoked) != 1 || f.revoked[0] != "ghu_first" {
		t.Errorf("revoked = %v", f.revoked)
	}
	var n int
	_ = platform.DBPool.QueryRow(context.Background(), `SELECT count(*) FROM github_connections`).Scan(&n)
	if n != 0 {
		t.Errorf("rows after disconnect = %d", n)
	}
	for _, k := range mr.Keys() {
		if strings.Contains(k, "sub_bye") {
			t.Errorf("cache survived disconnect: %s", k)
		}
	}
}

// ── Your repos (SCROLLR-307) ──────────────────────────────────────

func pinClock(t *testing.T) {
	t.Helper()
	prev := now
	now = func() time.Time { return fakeNow }
	t.Cleanup(func() { now = prev })
}

// TestReposListCapAndCache: 40 repos cost 31 GitHub calls (the list + the
// 30 most recently pushed), the rest are inactive without a call, and the
// answer is cached for ten minutes per account.
func TestReposListCapAndCache(t *testing.T) {
	f, mr, app := setupDB(t)
	pinClock(t)
	f.valid["ghu_first"] = true
	f.repoCount = 40
	seedConnection(t, "sub_repos", "ghu_first", 28800)

	resp := do(t, app, "GET", "/github/repos", "sub_repos")
	if resp.StatusCode != 200 {
		t.Fatalf("repos: HTTP %d", resp.StatusCode)
	}
	out := decode[ReposResponse](t, resp)
	if !out.Connected || out.Login != "octo" || out.Stale || len(out.Repos) != 40 {
		t.Fatalf("response = connected:%v login:%q stale:%v repos:%d", out.Connected, out.Login, out.Stale, len(out.Repos))
	}
	if f.listCalls != 1 || f.calls() != maxActiveChecks {
		t.Errorf("calls = %d list + %d runs, want 1 + 30", f.listCalls, f.calls())
	}
	t.Logf("GitHub calls for 40 repos: %d (cap 31)", f.listCalls+f.calls())
	for i, r := range out.Repos {
		checked := i < maxActiveChecks
		if r.FullName != fakeRepoName(i) {
			t.Fatalf("repos[%d] = %s, want %s (most recently pushed first)", i, r.FullName, fakeRepoName(i))
		}
		if want := checked && i%3 == 0; r.Active != want {
			t.Errorf("%s active = %v, want %v", r.FullName, r.Active, want)
		}
		if want := checked && i%3 != 2; (r.LastRunAt != "") != want {
			t.Errorf("%s last_run_at = %q", r.FullName, r.LastRunAt)
		}
		if r.Private != (i%2 == 0) || r.DefaultBranch != "main" || r.PushedAt == "" {
			t.Errorf("%s fields = %+v", r.FullName, r)
		}
	}

	do(t, app, "GET", "/github/repos", "sub_repos")
	if f.listCalls != 1 || f.calls() != maxActiveChecks {
		t.Errorf("a cached answer called GitHub: %d list + %d runs", f.listCalls, f.calls())
	}
	mr.FastForward(reposTTL + time.Second)
	do(t, app, "GET", "/github/repos", "sub_repos")
	if f.listCalls != 2 || f.calls() != 2*maxActiveChecks {
		t.Errorf("after 10 min: %d list + %d runs, want 2 + 60", f.listCalls, f.calls())
	}
}

func TestReposNotConnectedIs409(t *testing.T) {
	f, _, app := setupDB(t)
	resp := do(t, app, "GET", "/github/repos", "sub_nobody")
	if resp.StatusCode != fiber.StatusConflict {
		t.Fatalf("HTTP %d, want 409", resp.StatusCode)
	}
	if out := decode[ReposResponse](t, resp); !out.Connect || out.Connected || out.Repos == nil {
		t.Errorf("body = %+v", out)
	}
	if f.listCalls != 0 {
		t.Errorf("called GitHub for an unconnected account")
	}
}

func TestReposMarksBrokenWhenGitHubRefuses(t *testing.T) {
	f, _, app := setupDB(t)
	pinClock(t)
	f.repoCount = 3
	seedConnection(t, "sub_repos_broken", "ghu_revoked", 28800)

	resp := do(t, app, "GET", "/github/repos", "sub_repos_broken")
	if resp.StatusCode != fiber.StatusConflict {
		t.Fatalf("HTTP %d, want 409", resp.StatusCode)
	}
	if out := decode[ReposResponse](t, resp); !out.Connect || out.Reason == "" {
		t.Errorf("body = %+v", out)
	}
	if len(f.tokenGrants) != 1 || f.tokenGrants[0] != "refresh_token" {
		t.Errorf("token calls = %v, want one refresh attempt", f.tokenGrants)
	}
	if status, _ := rowStatus(t, "sub_repos_broken"); status != "broken" {
		t.Errorf("status = %q, want broken", status)
	}
}
