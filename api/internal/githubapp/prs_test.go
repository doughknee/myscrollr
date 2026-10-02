package githubapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// prFake answers GitHub by exact request URI and counts every call.
type prFake struct {
	mu     sync.Mutex
	routes map[string]any
	calls  map[string]int
}

func (f *prFake) set(uri string, body any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.routes[uri] = body
}

func (f *prFake) total() (n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.calls {
		n += c
	}
	return n
}

func (f *prFake) count(prefix string) (n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for uri, c := range f.calls {
		if strings.HasPrefix(uri, prefix) {
			n += c
		}
	}
	return n
}

func setupPRs(t *testing.T) (*prFake, *miniredis.Miniredis) {
	t.Helper()
	f := &prFake{routes: map[string]any{}, calls: map[string]int{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.calls[r.RequestURI]++
		body, ok := f.routes[r.RequestURI]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("X-Ratelimit-Remaining", "4000")
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	prev := APIBase
	APIBase = srv.URL
	t.Cleanup(func() { APIBase = prev })
	mr, cleanup := testsupport.MiniRedis(t)
	t.Cleanup(cleanup)
	return f, mr
}

type m = map[string]any

func pull(n int, author, branch, sha string, extra m) m {
	p := m{
		"number": n, "title": fmt.Sprintf("PR %d", n), "html_url": fmt.Sprintf("https://github.com/o/r/pull/%d", n),
		"draft": false, "updated_at": "2026-10-02T08:00:00Z", "user": m{"login": author},
		"requested_reviewers": []m{}, "requested_teams": []m{}, "head": m{"ref": branch, "sha": sha},
	}
	for k, v := range extra {
		p[k] = v
	}
	return p
}

func run(name, branch, sha, status, conclusion, actor, updated string) m {
	r := m{"name": name, "status": status, "html_url": "https://github.com/o/r/actions/runs/1", "head_branch": branch,
		"head_sha": sha, "run_started_at": updated, "updated_at": updated, "actor": m{"login": actor},
		"head_commit": m{"message": "ship it"}}
	if conclusion != "" {
		r["conclusion"] = conclusion
	}
	return r
}

func runs(rs ...m) m { return m{"workflow_runs": rs} }

func review(user, state string) m { return m{"user": m{"login": user}, "state": state} }

func source(ns string) prSource {
	return prSource{ns: ns, login: "octo", token: "ghu_x", teams: func() map[string]bool { return userTeams(context.Background(), ns, "ghu_x") }}
}

// seedRepo: o/r with four PRs covering every rule.
func seedRepo(f *prFake) {
	f.set("/repos/o/r", m{"default_branch": "main"})
	f.set("/repos/o/r/pulls?state=open&per_page=50", []m{
		pull(1, "octo", "feat-a", "s1", nil), // yours: changes requested, a failing check
		pull(2, "bob", "fix-b", "s2", m{"requested_reviewers": []m{{"login": "Octo"}}}),
		pull(3, "bob", "fix-c", "s3", m{"requested_teams": []m{{"slug": "core"}}}),
		pull(4, "dave", "wip-d", "s4", m{"draft": true}),
	})
	f.set("/repos/o/r/actions/runs?per_page=20", runs(
		run("CI", "feat-a", "s1b", "in_progress", "", "octo", "2026-10-02T08:10:00Z"),
		run("Deploy", "main", "m2", "completed", "failure", "bob", "2026-10-02T08:05:00Z"),
		run("CI", "main", "m2", "completed", "success", "bob", "2026-10-02T08:04:00Z"),
		run("Deploy", "main", "m1", "completed", "success", "bob", "2026-10-02T07:00:00Z"),
	))
	f.set("/user/teams?per_page=100", []m{{"slug": "core", "organization": m{"login": "o"}}})
	f.set("/repos/o/r/pulls/1/reviews?per_page=100", []m{review("alice", "CHANGES_REQUESTED"), review("alice", "COMMENTED")})
	f.set("/repos/o/r/pulls/2/reviews?per_page=100", []m{review("carol", "CHANGES_REQUESTED"), review("carol", "APPROVED")})
	f.set("/repos/o/r/pulls/3/reviews?per_page=100", []m{})
	f.set("/repos/o/r/pulls/4/reviews?per_page=100", []m{})
	f.set("/repos/o/r/actions/runs?per_page=20&head_sha=s1", runs(
		run("CI", "feat-a", "s1", "completed", "failure", "octo", "2026-10-02T07:50:00Z"),
		run("Lint", "feat-a", "s1", "completed", "success", "octo", "2026-10-02T07:50:00Z")))
	f.set("/repos/o/r/actions/runs?per_page=20&head_sha=s2", runs(run("CI", "fix-b", "s2", "in_progress", "", "bob", "2026-10-02T08:00:00Z")))
	f.set("/repos/o/r/actions/runs?per_page=20&head_sha=s3", runs())
	f.set("/repos/o/r/actions/runs?per_page=20&head_sha=s4", runs(run("CI", "wip-d", "s4", "completed", "success", "dave", "2026-10-02T06:00:00Z")))
}

func TestPRsReviewsTeamsChecksAndDefaultBranch(t *testing.T) {
	f, _ := setupPRs(t)
	seedRepo(f)
	got, err := repoPRs(context.Background(), source("user:sub_prs"), "o/r")
	if err != nil || !got.Available || len(got.PRs) != 4 {
		t.Fatalf("repoPRs = %+v, %v", got, err)
	}
	type want struct {
		mine, requested bool
		review, checks  string
	}
	for i, w := range []want{
		{true, false, "changes_requested", "failing"},
		{false, true, "approved", "running"}, // a later approve after changes requested = approved
		{false, true, "none", "none"},        // requested through the "core" team
		{false, false, "none", "passing"},
	} {
		p := got.PRs[i]
		if p.IsMine != w.mine || p.ReviewRequested != w.requested || p.ReviewState != w.review || p.ChecksState != w.checks {
			t.Errorf("PR #%d = mine %v requested %v review %q checks %q, want %+v", p.Number, p.IsMine, p.ReviewRequested, p.ReviewState, p.ChecksState, w)
		}
	}
	if c := got.PRs[0].Checks; c != (Checks{Total: 2, Passed: 1, Failed: 1}) {
		t.Errorf("PR #1 checks = %+v", c)
	}
	if !got.PRs[3].Draft || got.PRs[0].HeadBranch != "feat-a" || got.PRs[0].HeadSHA != "s1" || got.PRs[1].Author != "bob" {
		t.Errorf("PR fields = %+v", got.PRs)
	}
	// Deploy's latest on main failed even though CI's latest passed.
	if d := got.DefaultCI; d == nil || d.State != "failing" || d.Workflow != "Deploy" || d.UpdatedAt != "2026-10-02T08:05:00Z" {
		t.Errorf("default_ci = %+v", got.DefaultCI)
	}
	if got.MineRunning != 1 || got.MineBranch != "feat-a" || got.MineSince != "2026-10-02T08:10:00Z" {
		t.Errorf("mine = %d %q %q", got.MineRunning, got.MineBranch, got.MineSince)
	}
	// Cached for 60 s: a second ask costs GitHub nothing.
	before := f.total()
	if _, err := repoPRs(context.Background(), source("user:sub_prs"), "o/r"); err != nil || f.total() != before {
		t.Errorf("second ask called GitHub %d times", f.total()-before)
	}
}

func TestReduceReviews(t *testing.T) {
	type rv = struct {
		User  ghLogin `json:"user"`
		State string  `json:"state"`
	}
	r := func(u, s string) rv { return rv{User: ghLogin{u}, State: s} }
	for _, c := range []struct {
		in   []rv
		want string
	}{
		{nil, "none"},
		{[]rv{r("a", "COMMENTED")}, "none"},
		{[]rv{r("a", "CHANGES_REQUESTED"), r("a", "APPROVED")}, "approved"},
		{[]rv{r("a", "APPROVED"), r("a", "CHANGES_REQUESTED")}, "changes_requested"},
		{[]rv{r("a", "CHANGES_REQUESTED"), r("a", "COMMENTED")}, "changes_requested"},
		{[]rv{r("a", "APPROVED"), r("b", "CHANGES_REQUESTED")}, "changes_requested"},
		{[]rv{r("a", "CHANGES_REQUESTED"), r("a", "DISMISSED")}, "none"},
	} {
		if got := reduceReviews(c.in); got != c.want {
			t.Errorf("reduceReviews(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestPRDetailCap: 25 open PRs cost 20 reviews and 20 checks calls; yours
// is always among them even when it is the oldest; the rest say unknown.
func TestPRDetailCap(t *testing.T) {
	f, _ := setupPRs(t)
	f.set("/repos/o/big", m{"default_branch": "main"})
	f.set("/repos/o/big/actions/runs?per_page=20", runs(run("CI", "main", "m", "completed", "success", "bob", "2026-10-02T08:00:00Z")))
	var pulls []m
	for n := 25; n >= 1; n-- { // newest first, as GitHub sends them
		author := "bob"
		if n == 1 {
			author = "octo"
		}
		sha := fmt.Sprintf("s%d", n)
		pulls = append(pulls, pull(n, author, "b", sha, nil))
		f.set(fmt.Sprintf("/repos/o/big/pulls/%d/reviews?per_page=100", n), []m{})
		f.set("/repos/o/big/actions/runs?per_page=20&head_sha="+sha, runs(run("CI", "b", sha, "completed", "success", author, "2026-10-02T07:00:00Z")))
	}
	f.set("/repos/o/big/pulls?state=open&per_page=50", pulls)

	got, err := repoPRs(context.Background(), source("user:sub_cap"), "o/big")
	if err != nil || len(got.PRs) != 25 {
		t.Fatalf("repoPRs: %d PRs, %v", len(got.PRs), err)
	}
	if n := f.count("/repos/o/big/actions/runs?per_page=20&head_sha="); n != 20 {
		t.Errorf("checks calls = %d, want 20", n)
	}
	if n := f.count("/repos/o/big/pulls/"); n != 20 {
		t.Errorf("reviews calls = %d, want 20", n)
	}
	unknown := 0
	for _, p := range got.PRs {
		if p.ChecksState == "unknown" {
			unknown++
		}
		if p.IsMine && p.ChecksState != "passing" {
			t.Errorf("your PR #%d was left out of the details", p.Number)
		}
	}
	if unknown != 5 {
		t.Errorf("unknown = %d, want 5", unknown)
	}
}

// TestPRBudget is the arithmetic for a heavy user: five repos with three
// open PRs each, polled by the ticker and the app every 30 s for an hour.
// First refresh 9 calls a repo (repo, pulls, runs, 3 reviews, 3 checks),
// then 2 a repo a minute (pulls, runs): 45 + 59 x 10 = 635.
func TestPRBudget(t *testing.T) {
	f, mr := setupPRs(t)
	repos := []string{"o/a", "o/b", "o/c", "o/d", "o/e"}
	for _, r := range repos {
		f.set("/repos/"+r, m{"default_branch": "main"})
		f.set("/repos/"+r+"/actions/runs?per_page=20", runs(run("CI", "main", "m", "completed", "success", "bob", "2026-10-02T08:00:00Z")))
		var pulls []m
		for n := 1; n <= 3; n++ {
			sha := fmt.Sprintf("%s-%d", strings.ReplaceAll(r, "/", ""), n)
			pulls = append(pulls, pull(n, "bob", "b", sha, nil))
			f.set(fmt.Sprintf("/repos/%s/pulls/%d/reviews?per_page=100", r, n), []m{review("carol", "APPROVED")})
			f.set("/repos/"+r+"/actions/runs?per_page=20&head_sha="+sha, runs(run("CI", "b", sha, "completed", "success", "bob", "2026-10-02T07:00:00Z")))
		}
		f.set("/repos/"+r+"/pulls?state=open&per_page=50", pulls)
	}
	ctx := context.Background()
	for step := 0; step < 120; step++ { // 120 x 30 s = 1 h
		for poller := 0; poller < 2; poller++ {
			for _, r := range repos {
				if got, err := repoPRs(ctx, source("user:sub_budget"), r); err != nil || !got.Available {
					t.Fatalf("repoPRs %s: %+v %v", r, got, err)
				}
			}
		}
		mr.FastForward(30 * time.Second)
	}
	calls := f.total()
	t.Logf("GitHub calls in one hour: %d (5 repos x 3 PRs, 2 pollers, 30 s cadence, 60 s cache)", calls)
	if calls > 1500 {
		t.Fatalf("calls = %d, want <= 1500", calls)
	}
	if calls != 635 {
		t.Errorf("calls = %d, want exactly 635", calls)
	}
}

// TestPRsRerunRefetchesChecks: a settled commit's checks are cached until
// the recent runs show that commit again with a newer update (a re-run).
func TestPRsRerunRefetchesChecks(t *testing.T) {
	f, mr := setupPRs(t)
	seedRepo(f)
	ctx := context.Background()
	if _, err := repoPRs(ctx, source("user:sub_rerun"), "o/r"); err != nil {
		t.Fatal(err)
	}
	const s4 = "/repos/o/r/actions/runs?per_page=20&head_sha=s4"
	mr.FastForward(prsTTL + time.Second)
	_, _ = repoPRs(ctx, source("user:sub_rerun"), "o/r")
	if n := f.count(s4); n != 1 {
		t.Fatalf("settled checks fetched %d times, want 1", n)
	}
	f.set("/repos/o/r/actions/runs?per_page=20", runs(run("CI", "wip-d", "s4", "in_progress", "", "dave", "2026-10-02T09:00:00Z")))
	f.set(s4, runs(run("CI", "wip-d", "s4", "in_progress", "", "dave", "2026-10-02T09:00:00Z")))
	mr.FastForward(prsTTL + time.Second)
	got, _ := repoPRs(ctx, source("user:sub_rerun"), "o/r")
	if n := f.count(s4); n != 2 || got.PRs[3].ChecksState != "running" {
		t.Errorf("after a re-run: %d fetches, state %q", n, got.PRs[3].ChecksState)
	}
}

// ── Integration: real Postgres (CI) ───────────────────────────────

func prsApp() *fiber.App {
	app := fiber.New()
	app.Get("/github/prs", func(c *fiber.Ctx) error {
		c.Locals("user_id", c.Get("X-Test-Sub"))
		return c.Next()
	}, HandlePRs)
	return app
}

func TestPRsUnconnectedAsksToConnect(t *testing.T) {
	f, _, _ := setupDB(t)
	out := decode[PRsResponse](t, do(t, prsApp(), "GET", "/github/prs?repos=o/a", "sub_nobody"))
	if out.Connected || !out.Connect || out.Repos == nil || len(out.Repos) != 0 {
		t.Errorf("response = %+v, want connect:true and []", out)
	}
	if f.calls() != 0 {
		t.Errorf("an unconnected account reached GitHub")
	}
}

func TestPRsConnected(t *testing.T) {
	_, _, _ = setupDB(t)
	seedConnection(t, "sub_prs_db", "ghu_x", 28800)
	f, _ := setupPRs(t)
	seedRepo(f)
	out := decode[PRsResponse](t, do(t, prsApp(), "GET", "/github/prs?repos=o/r", "sub_prs_db"))
	if !out.Connected || out.Login != "octo" || len(out.Repos) != 1 || len(out.Repos[0].PRs) != 4 {
		t.Errorf("response = %+v", out)
	}
}
