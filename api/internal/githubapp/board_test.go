package githubapp

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

// The GitHub widget v2's core (SCROLLR-312): /github/workflows and /github/board.

func pinNow(t *testing.T) {
	t.Helper()
	prev := now
	now = func() time.Time { return fakeNow } // 2026-10-02T12:00Z
	t.Cleanup(func() { now = prev })
}

func wfRun(id int64, name, status, conclusion, created string) m {
	r := run(name, "main", "m-"+name, status, conclusion, "bob", created)
	r["workflow_id"] = id
	r["created_at"] = created
	r["html_url"] = fmt.Sprintf("https://github.com/o/r/actions/runs/%d", id)
	return r
}

func withCommit(r m, actor, msg string) m {
	r["actor"], r["head_commit"] = m{"login": actor}, m{"message": msg}
	return r
}

func issue(n int, title, created string, isPR bool) m {
	i := m{"number": n, "title": title, "html_url": fmt.Sprintf("https://github.com/o/r/issues/%d", n), "created_at": created}
	if isPR {
		i["pull_request"] = m{"url": "x"}
	}
	return i
}

const (
	druns    = "/repos/o/r/actions/runs?branch=main&per_page=50"
	wflist   = "/repos/o/r/actions/workflows?per_page=100"
	issuesNw = "/repos/o/r/issues?state=open&sort=created&direction=desc&per_page=30"
	issuesMe = issuesNw + "&assignee=octo"
)

// seedBoard: o/r (the PR fixture) with four workflows. test passes and
// deploy fails on main this morning, lint last ran two months ago, docs was
// disabled; "Release" ran under a run-name ("v1.2") so only its id names it.
func seedBoard(f *prFake) {
	seedRepo(f)
	f.set(wflist, m{"workflows": []m{
		{"id": 1, "name": "test", "path": ".github/workflows/test.yml", "state": "active"},
		{"id": 2, "name": "deploy", "path": ".github/workflows/deploy.yml", "state": "active"},
		{"id": 3, "name": "lint", "path": ".github/workflows/lint.yml", "state": "active"},
		{"id": 4, "name": "docs", "path": ".github/workflows/docs.yml", "state": "disabled_manually"},
		{"id": 5, "name": "Release", "path": ".github/workflows/release.yml", "state": "active"},
	}})
	f.set(druns, runs(
		withCommit(wfRun(2, "deploy", "completed", "failure", "2026-10-02T11:48:00Z"), "octo", "fix: hold the budget\n\nlong body"),
		wfRun(1, "test", "in_progress", "", "2026-10-02T11:57:00Z"),
		wfRun(1, "test", "completed", "success", "2026-10-02T10:00:00Z"),
		wfRun(5, "v1.2", "completed", "success", "2026-09-30T10:00:00Z"),
		wfRun(2, "deploy", "completed", "success", "2026-10-01T10:00:00Z"),
		wfRun(3, "lint", "completed", "success", "2026-08-01T10:00:00Z"),
	))
	f.set(issuesNw, []m{
		issue(30, "Fresh bug", "2026-10-02T09:00:00Z", false),
		issue(29, "A PR in disguise", "2026-10-02T08:00:00Z", true),
		issue(28, "Yesterday morning", "2026-10-01T08:00:00Z", false),
	})
	f.set(issuesMe, []m{issue(12, "Old but mine", "2026-07-01T08:00:00Z", false)})
}

func TestWorkflowsListAndRanRecently(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	src := source("user:sub_wf")
	list, _, err := workflowList(context.Background(), src, "o/r")
	if err != nil {
		t.Fatal(err)
	}
	runs, _, _ := branchRuns(context.Background(), src, "o/r", "main")
	got := listWorkflows(list, runs)
	want := []Workflow{
		{Name: "test", Path: ".github/workflows/test.yml", Last: "running", LastAt: "2026-10-02T11:57:00Z", RanRecently: true},
		{Name: "deploy", Path: ".github/workflows/deploy.yml", Last: "failing", LastAt: "2026-10-02T11:48:00Z", RanRecently: true},
		{Name: "lint", Path: ".github/workflows/lint.yml", Last: "passing", LastAt: "2026-08-01T10:00:00Z", RanRecently: false},
		{Name: "Release", Path: ".github/workflows/release.yml", Last: "passing", LastAt: "2026-09-30T10:00:00Z", RanRecently: true},
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("workflows =\n %+v\nwant\n %+v", got, want)
	}
}

func TestBoardGroupsRunsByWorkflowFromOneCall(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	ctx := context.Background()

	// Default (null): the three that ran in the last 30 days, in the list's order.
	got, err := boardRepo(ctx, source("user:sub_b1"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "off"})
	if err != nil || !got.Available {
		t.Fatalf("board = %+v, %v", got, err)
	}
	names := []string{}
	for _, w := range got.Workflows {
		names = append(names, w.Name+":"+w.State)
	}
	if strings.Join(names, ",") != "test:running,deploy:failing,Release:passing" {
		t.Errorf("default workflows = %v", names)
	}
	if d := got.Workflows[1]; d.At != "2026-10-02T11:48:00Z" || d.URL != "https://github.com/o/r/actions/runs/2" {
		t.Errorf("deploy = %+v", d)
	}
	// The cell names what broke it: the commit's first line, and you when you pushed it.
	if d := got.Workflows[1]; d.Commit != "fix: hold the budget" || d.Actor != "octo" || !d.ByYou {
		t.Errorf("deploy commit = %+v", d)
	}
	if w := got.Workflows[0]; w.Actor != "bob" || w.ByYou {
		t.Errorf("test actor = %+v", w)
	}
	if got.PRs != nil || got.Issues != nil {
		t.Errorf("off modes answered: %+v %+v", got.PRs, got.Issues)
	}
	if n := f.count("/repos/o/r/actions/runs?branch="); n != 1 {
		t.Errorf("runs calls = %d, want 1 (grouped, not per workflow)", n)
	}

	// Chosen, in the chosen order; a name with no run says none; [] is none at all.
	got, _ = boardRepo(ctx, source("user:sub_b1"), BoardRequestRepo{Repo: "o/r", Workflows: []string{"lint", "deploy", "gone"}, PRs: "off", Issues: "off"})
	if len(got.Workflows) != 3 || got.Workflows[0].State != "passing" || got.Workflows[1].State != "failing" || got.Workflows[2].State != "none" {
		t.Errorf("chosen = %+v", got.Workflows)
	}
	got, _ = boardRepo(ctx, source("user:sub_b1"), BoardRequestRepo{Repo: "o/r", Workflows: []string{}, PRs: "off", Issues: "off"})
	if len(got.Workflows) != 0 {
		t.Errorf("[] = %+v", got.Workflows)
	}
	if n := f.count("/repos/o/r/actions/runs?branch="); n != 1 {
		t.Errorf("runs calls after two more asks = %d, want 1 (cached 60 s)", n)
	}
}

func TestBoardPRModes(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	ctx := context.Background()
	// seedRepo: #1 yours with changes requested, #2 review asked of you,
	// #3 asked of your team, #4 someone else's draft.
	mine, _ := boardRepo(ctx, source("user:sub_p"), BoardRequestRepo{Repo: "o/r", PRs: "mine", Issues: "off"})
	if p := mine.PRs; p == nil || p.Count != 3 || p.NeedsYou != 3 || len(p.Items) != 3 {
		t.Fatalf("mine = %+v", mine.PRs)
	}
	all, _ := boardRepo(ctx, source("user:sub_p"), BoardRequestRepo{Repo: "o/r", PRs: "all", Issues: "off"})
	if p := all.PRs; p == nil || p.Count != 4 || p.NeedsYou != 3 || p.Items[3].Number != 4 {
		t.Fatalf("all = %+v", all.PRs)
	}
}

func TestBoardIssueModes(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	ctx := context.Background()
	nw, _ := boardRepo(ctx, source("user:sub_i"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "new"})
	// The PR in the issues list is dropped; yesterday morning is past 24 h.
	if is := nw.Issues; is == nil || is.Count != 1 || is.Items[0].Number != 30 || is.Items[0].URL != "https://github.com/o/r/issues/30" {
		t.Fatalf("new = %+v", nw.Issues)
	}
	me, _ := boardRepo(ctx, source("user:sub_i"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "assigned"})
	if is := me.Issues; is == nil || is.Count != 1 || is.Items[0].Number != 12 || is.Error != "" {
		t.Fatalf("assigned = %+v", me.Issues)
	}
}

// TestBoardIssuesPermission: until the app has Issues: read, GitHub answers
// 403 without a spent rate limit; the board says so instead of failing.
func TestBoardIssuesPermission(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	f.set(issuesMe, http.StatusForbidden)
	got, err := boardRepo(context.Background(), source("user:sub_perm"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "assigned"})
	if err != nil || got.Issues == nil || got.Issues.Error != "permission" || got.Issues.Count != 0 || !got.Available || len(got.Workflows) == 0 {
		t.Fatalf("board = %+v %+v, %v", got, got.Issues, err)
	}
}

// TestBoardHeadChecksAnyCI: a third-party check failing on the default
// branch's head (a Vercel status, a check run of another app) is on the
// board under its own name; Actions' own check runs are not (they are the
// workflows). Before Checks/Statuses are approved (403): none, no error.
func TestBoardHeadChecksAnyCI(t *testing.T) {
	pinNow(t)
	f, _ := setupPRs(t)
	seedBoard(f)
	f.set("/repos/o/r/commits/main/check-runs?per_page=100", m{"check_runs": []m{
		checkRun("deploy / ship", "completed", "failure", "github-actions"),
		checkRun("sonar", "completed", "failure", "sonarcloud"),
		checkRun("codecov", "completed", "success", "codecov"),
	}})
	f.set("/repos/o/r/commits/main/status", m{"statuses": []m{commitStatus("vercel", "failure"), commitStatus("netlify", "success")}})
	got, err := boardRepo(context.Background(), source("user:sub_head"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "off"})
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, c := range got.Checks {
		names = append(names, c.Name+":"+c.State)
	}
	if strings.Join(names, ",") != "sonar:failing,vercel:failing" || got.Checks[1].URL != "https://vercel.com/o/r/vercel" || got.Checks[1].At != "2026-10-02T11:57:00Z" {
		t.Errorf("checks = %+v", got.Checks)
	}

	f2, _ := setupPRs(t)
	seedBoard(f2)
	f2.set("/repos/o/r/commits/main/check-runs?per_page=100", http.StatusForbidden)
	f2.set("/repos/o/r/commits/main/status", http.StatusForbidden)
	got, err = boardRepo(context.Background(), source("user:sub_head403"), BoardRequestRepo{Repo: "o/r", PRs: "off", Issues: "off"})
	if err != nil || !got.Available || len(got.Checks) != 0 || len(got.Workflows) != 3 {
		t.Errorf("403 = %+v, %v", got, err)
	}
}

// TestBoardBudget is the arithmetic for a heavy user: five repos, every
// default workflow, PRs "mine" with three open PRs each, issues "assigned",
// polled by the ticker and the app every 30 s for an hour. The /github/prs
// part is TestPRBudget's 650; on top, per repo: the workflow list once
// every 10 min (6), the default branch's runs once a minute (60), its
// head's check runs and statuses once a minute (120), the issues once a
// minute (60): 650 + 5 x 246 = 1,880.
func TestBoardBudget(t *testing.T) {
	pinNow(t)
	f, mr := setupPRs(t)
	repos := []string{"o/a", "o/b", "o/c", "o/d", "o/e"}
	for _, r := range repos {
		f.set("/repos/"+r, m{"default_branch": "main"})
		f.set("/repos/"+r+"/actions/runs?per_page=20", runs(run("CI", "main", "m", "completed", "success", "bob", "2026-10-02T08:00:00Z")))
		f.set("/repos/"+r+"/actions/workflows?per_page=100", m{"workflows": []m{{"id": 1, "name": "CI", "path": "ci.yml", "state": "active"}}})
		f.set("/repos/"+r+"/actions/runs?branch=main&per_page=50", runs(wfRun(1, "CI", "completed", "success", "2026-10-02T08:00:00Z")))
		f.set("/repos/"+r+"/issues?state=open&sort=created&direction=desc&per_page=30&assignee=octo", []m{issue(1, "mine", "2026-10-02T08:00:00Z", false)})
		var pulls []m
		for n := 1; n <= 3; n++ {
			sha := fmt.Sprintf("%s-%d", strings.ReplaceAll(r, "/", ""), n)
			pulls = append(pulls, pull(n, "bob", "b", sha, nil))
			f.set(fmt.Sprintf("/repos/%s/pulls/%d/reviews?per_page=100", r, n), []m{review("carol", "APPROVED")})
			seedChecks(f, r, sha)
		}
		f.set("/repos/"+r+"/pulls?state=open&per_page=50", pulls)
		seedChecks(f, r, "main")
	}
	ctx := context.Background()
	for step := 0; step < 120; step++ { // 120 x 30 s = 1 h
		for poller := 0; poller < 2; poller++ {
			for _, r := range repos {
				got, err := boardRepo(ctx, source("user:sub_board_budget"), BoardRequestRepo{Repo: r, PRs: "mine", Issues: "assigned"})
				if err != nil || !got.Available || len(got.Workflows) != 1 || got.Issues.Count != 1 {
					t.Fatalf("board %s: %+v %v", r, got, err)
				}
			}
		}
		mr.FastForward(30 * time.Second)
	}
	calls := f.total()
	t.Logf("GitHub calls in one hour: %d (5 repos, PRs mine, issues assigned, 2 pollers, 30 s cadence)", calls)
	if calls != 1880 {
		t.Errorf("calls = %d, want exactly 1880", calls)
	}
}

// ── Handlers ─────────────────────────────────────────────────────

func boardApp() *fiber.App {
	app := fiber.New()
	auth := func(c *fiber.Ctx) error {
		c.Locals("user_id", c.Get("X-Test-Sub"))
		return c.Next()
	}
	app.Post("/github/board", auth, HandleBoard)
	app.Get("/github/workflows", auth, HandleWorkflows)
	return app
}

func post(t *testing.T, app *fiber.App, body, sub string) *http.Response {
	t.Helper()
	req := httptest.NewRequest("POST", "/github/board", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Sub", sub)
	resp, err := app.Test(req, 10_000)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestBoardRejectsBadInput(t *testing.T) {
	for _, body := range []string{
		`{"repos":[{"repo":"not a repo"}]}`,
		`{"repos":[{"repo":"o/../r"}]}`,
		`{"repos":[{"repo":"o/r","prs":"some"}]}`,
		`{"repos":[{"repo":"o/r","issues":"closed"}]}`,
		`not json`,
	} {
		if resp := post(t, boardApp(), body, "sub_bad"); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: HTTP %d, want 400", body, resp.StatusCode)
		}
	}
	if resp := do(t, boardApp(), "GET", "/github/workflows?repo=nope", "sub_bad"); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("workflows ?repo=nope: HTTP %d", resp.StatusCode)
	}
}

// ── Integration: real Postgres (CI) ───────────────────────────────

func TestBoardConnectedAndNot(t *testing.T) {
	_, _, _ = setupDB(t)
	pinNow(t)
	seedConnection(t, "sub_board_db", "ghu_x", 28800)
	f, _ := setupPRs(t)
	seedBoard(f)

	out := decode[BoardResponse](t, post(t, boardApp(), `{"repos":[{"repo":"o/r"}]}`, "sub_nobody"))
	if out.Connected || !out.Connect || out.Repos == nil || len(out.Repos) != 0 {
		t.Errorf("unconnected = %+v", out)
	}
	out = decode[BoardResponse](t, post(t, boardApp(), `{"repos":[{"repo":"o/r","issues":"new"}]}`, "sub_board_db"))
	if !out.Connected || out.Login != "octo" || len(out.Repos) != 1 {
		t.Fatalf("connected = %+v", out)
	}
	r := out.Repos[0]
	if len(r.Workflows) != 3 || r.PRs == nil || r.PRs.NeedsYou != 3 || r.Issues == nil || r.Issues.Count != 1 {
		t.Errorf("repo = %+v prs %+v issues %+v", r, r.PRs, r.Issues)
	}
	wf := decode[WorkflowsResponse](t, do(t, boardApp(), "GET", "/github/workflows?repo=o/r", "sub_board_db"))
	if !wf.Connected || !wf.Available || wf.DefaultBranch != "main" || len(wf.Workflows) != 4 {
		t.Errorf("workflows = %+v", wf)
	}
}
