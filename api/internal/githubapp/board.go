package githubapp

// The GitHub widget v2 (SCROLLR-312): one bar cell per repo, and each repo
// watches what the user chose: some of its workflows, its pull requests
// (none, the ones that need you, all open), its issues (none, assigned to
// you, opened in the last 24 h). Connected accounts only.
//
// GET /github/workflows lists a repo's workflows for the picker and its
// defaults. POST /github/board answers every tracked repo in one request.
//
// Budget (TestBoardBudget): per repo per 60 s refresh, steady state, six
// calls: the default branch's 50 latest runs (grouped by workflow, so the
// number of watched workflows costs nothing), its head's check runs and
// commit statuses (any CI, not only Actions), with PRs on the two calls
// /github/prs makes (open pulls, recent runs), and with issues on one
// issues call. The workflow list is cached 10 min, the default branch 24 h,
// PR details as /github/prs caches them. Five repos with everything on,
// polled for an hour: 1,880 calls of the user's 5,000/h.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

const (
	workflowsTTL   = 10 * time.Minute
	boardTTL       = 60 * time.Second
	branchRunsLen  = 50
	newIssueWindow = 24 * time.Hour
	issuesLen      = 30
	maxWorkflows   = 50
	searchLen      = 20
	shippedWindow  = 24 * time.Hour
)

// ── Wire shapes ──────────────────────────────────────────────────

// Workflow is one of a repo's workflows, as the widget's checklist shows it.
type Workflow struct {
	Name string `json:"name"`
	Path string `json:"path"`
	// passing | failing | running | none: its latest run on the default branch.
	Last   string `json:"last"`
	LastAt string `json:"last_at,omitempty"`
	// A run on the default branch in the last 30 days: ticked by default.
	RanRecently bool `json:"ran_recently"`
}

// WorkflowsResponse is GET /github/workflows.
type WorkflowsResponse struct {
	Connected     bool       `json:"connected"`
	Connect       bool       `json:"connect,omitempty"`
	Reason        string     `json:"reason,omitempty"`
	Available     bool       `json:"available"`
	DefaultBranch string     `json:"default_branch,omitempty"`
	Workflows     []Workflow `json:"workflows"`
	Stale         bool       `json:"stale,omitempty"`
}

// BoardRequestRepo is one tracked repo and what it watches.
type BoardRequestRepo struct {
	Repo string `json:"repo"`
	// Workflow names. Absent (null): the ones that ran on the default branch
	// in the last 30 days. Empty: none.
	Workflows []string `json:"workflows"`
	PRs       string   `json:"prs"`    // off | mine | all (default mine)
	Issues    string   `json:"issues"` // off | assigned | new (default off)
}

// BoardWorkflow is the latest run of one watched workflow on the default branch.
type BoardWorkflow struct {
	Name  string `json:"name"`
	State string `json:"state"` // passing | failing | running | none
	At    string `json:"at,omitempty"`
	URL   string `json:"url,omitempty"`
	// The run's commit (first line) and who pushed it; ByYou when that is the
	// connected login. Empty for checks from other CI.
	Commit string `json:"commit,omitempty"`
	Actor  string `json:"actor,omitempty"`
	ByYou  bool   `json:"by_you,omitempty"`
}

// BoardPRs: mine lists the PRs that need you; all lists every open PR.
type BoardPRs struct {
	Count    int  `json:"count"`
	NeedsYou int  `json:"needs_you"`
	Items    []PR `json:"items"`
}

// BoardIssue is one open issue.
type BoardIssue struct {
	Number    int    `json:"number"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	CreatedAt string `json:"created_at"`
}

// BoardIssues: error "permission" when the app may not read issues yet.
type BoardIssues struct {
	Count int          `json:"count"`
	Items []BoardIssue `json:"items"`
	Error string       `json:"error,omitempty"`
}

// BoardRepo is one repo's cell.
type BoardRepo struct {
	Repo      string          `json:"repo"`
	Available bool            `json:"available"`
	Stale     bool            `json:"stale,omitempty"`
	Workflows []BoardWorkflow `json:"workflows"`
	// Failing checks on the default branch's head from other CI (Vercel, …).
	Checks []BoardWorkflow `json:"checks"`
	PRs    *BoardPRs       `json:"prs,omitempty"`
	Issues *BoardIssues    `json:"issues,omitempty"`
}

// BoardItem is one pull request from GitHub search: a queue entry or one
// that shipped.
type BoardItem struct {
	Repo   string `json:"repo"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Author string `json:"author"`
	Mine   bool   `json:"mine,omitempty"`
	// review (asked of you or your team) | changes (yours, changes
	// requested) | checks (yours, failing) | merged
	Kind string `json:"kind"`
	// Last updated (queue) or merged (shipped).
	At string `json:"at,omitempty"`
}

// BoardResponse is POST /github/board.
type BoardResponse struct {
	Connected bool        `json:"connected"`
	Connect   bool        `json:"connect,omitempty"`
	Login     string      `json:"login,omitempty"`
	Reason    string      `json:"reason,omitempty"`
	Repos     []BoardRepo `json:"repos"`
	// Open PRs that need you in every repo the app can see (the page's fill).
	Queue []BoardItem `json:"queue"`
	// PRs merged in the tracked repos in the last 24 h.
	Shipped []BoardItem `json:"shipped"`
}

// ── Cache ────────────────────────────────────────────────────────

// cached answers kind:repo from its fresh copy, else calls fetch and keeps
// the answer for ttl and as the last good one for 24 h. While the budget is
// spent, or the call hits the limit, it serves the last good answer with
// stale = true. Every key sits under keyPR, so forgetUser drops them.
func cached[T any](ctx context.Context, ns, kind, repo string, ttl time.Duration, fetch func() (T, error)) (v T, stale bool, err error) {
	fresh, last := prKey(ns, kind, repo), prKey(ns, kind+"-last", repo)
	if cacheJSON(ctx, fresh, &v) {
		return v, false, nil
	}
	if platform.Rdb.Exists(ctx, keyLimited+ns).Val() > 0 {
		cacheJSON(ctx, last, &v)
		return v, true, nil
	}
	v, err = fetch()
	if errors.Is(err, errLimited) {
		var l T
		cacheJSON(ctx, last, &l)
		return l, true, nil
	}
	if err != nil {
		return v, false, err
	}
	storeJSON(ctx, fresh, v, ttl)
	storeJSON(ctx, last, v, lastGoodTTL)
	return v, false, nil
}

// ── GitHub reads ─────────────────────────────────────────────────

type ghWorkflow struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path"`
	State string `json:"state"`
}

// workflowList is the repo's active workflows (10 min). No Actions: none.
func workflowList(ctx context.Context, src prSource, repo string) ([]ghWorkflow, bool, error) {
	return cached(ctx, src.ns, "wflist", repo, workflowsTTL, func() ([]ghWorkflow, error) {
		var body struct {
			Workflows []ghWorkflow `json:"workflows"`
		}
		status, err := getJSON(ctx, src.ns, "/repos/"+repo+"/actions/workflows?per_page=100", src.token, &body)
		if err != nil {
			return nil, err
		}
		out := []ghWorkflow{}
		if status == http.StatusOK {
			for _, w := range body.Workflows {
				if w.State == "active" {
					out = append(out, w)
				}
			}
		}
		return out, nil
	})
}

// branchRuns is the default branch's 50 latest runs, newest first (60 s).
// ponytail: a workflow whose latest run is older than the 50 most recent
// reads "none"; per-workflow calls would cost one each per refresh.
func branchRuns(ctx context.Context, src prSource, repo, branch string) ([]ghRun, bool, error) {
	return cached(ctx, src.ns, "druns", repo, boardTTL, func() ([]ghRun, error) {
		var body ghRuns
		path := fmt.Sprintf("/repos/%s/actions/runs?branch=%s&per_page=%d", repo, url.QueryEscape(branch), branchRunsLen)
		status, err := getJSON(ctx, src.ns, path, src.token, &body)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK || body.WorkflowRuns == nil {
			return []ghRun{}, nil
		}
		return body.WorkflowRuns, nil
	})
}

// issueList is one issues call per mode (60 s): new = the 30 newest open,
// assigned = the 30 newest open assigned to the login. Pull requests are
// dropped (GitHub's issues list carries them). A 403 that is not the rate
// limit is the app lacking Issues: read.
func issueList(ctx context.Context, src prSource, repo, mode string) (BoardIssues, bool, error) {
	return cached(ctx, src.ns, "issues-"+mode, repo, boardTTL, func() (BoardIssues, error) {
		path := fmt.Sprintf("/repos/%s/issues?state=open&sort=created&direction=desc&per_page=%d", repo, issuesLen)
		if mode == "assigned" {
			// The created-desc list alone would miss an older issue assigned to you.
			path += "&assignee=" + url.QueryEscape(src.login)
		}
		var body []struct {
			Number      int    `json:"number"`
			Title       string `json:"title"`
			HTMLURL     string `json:"html_url"`
			CreatedAt   string `json:"created_at"`
			PullRequest *struct {
				URL string `json:"url"`
			} `json:"pull_request"`
		}
		status, err := getJSON(ctx, src.ns, path, src.token, &body)
		out := BoardIssues{Items: []BoardIssue{}}
		switch {
		case err != nil:
			return out, err
		case status == http.StatusForbidden:
			out.Error = "permission"
			return out, nil
		case status != http.StatusOK:
			return out, nil // issues turned off on the repo (410), or gone
		}
		for _, i := range body {
			if i.PullRequest == nil {
				out.Items = append(out.Items, BoardIssue{Number: i.Number, Title: i.Title, URL: i.HTMLURL, CreatedAt: i.CreatedAt})
			}
		}
		return out, nil
	})
}

// headChecks is the default branch head's failing checks from any CI but
// Actions (its runs are the workflows already): other apps' check runs and
// commit statuses, two calls (60 s). Neither permission yet: none.
func headChecks(ctx context.Context, src prSource, repo, branch string) ([]BoardWorkflow, bool, error) {
	return cached(ctx, src.ns, "headchecks", repo, boardTTL, func() ([]BoardWorkflow, error) {
		runs, _, err := commitChecks(ctx, src, repo, branch)
		if err != nil {
			return nil, err
		}
		statuses, err := commitStatuses(ctx, src, repo, branch)
		if err != nil {
			return nil, err
		}
		out := []BoardWorkflow{}
		for _, r := range append(runs, statuses...) {
			if r.Actor.Login != "github-actions" && runFailed(r) {
				out = append(out, BoardWorkflow{Name: r.Name, State: "failing", At: r.UpdatedAt, URL: r.HTMLURL})
			}
		}
		return out, nil
	})
}

// ── Search: the review queue and what shipped (SCROLLR-312, F1/F3) ─

// searchPath is one search for pull requests, most recently updated first.
func searchPath(q string) string {
	return "/search/issues?" + url.Values{"q": {q}, "sort": {"updated"}, "order": {"desc"}, "per_page": {strconv.Itoa(searchLen)}}.Encode()
}

// repoOf: "https://api.github.com/repos/o/r" → "o/r".
func repoOf(apiURL string) string {
	parts := strings.Split(strings.TrimRight(apiURL, "/"), "/")
	if len(parts) < 2 {
		return ""
	}
	return parts[len(parts)-2] + "/" + parts[len(parts)-1]
}

// searchPRs is one search call. Anything but 200 (a 422 for a query GitHub
// will not run) answers nothing rather than failing the board.
func searchPRs(ctx context.Context, src prSource, q, kind string) ([]BoardItem, error) {
	var body struct {
		Items []struct {
			Number        int     `json:"number"`
			Title         string  `json:"title"`
			HTMLURL       string  `json:"html_url"`
			RepositoryURL string  `json:"repository_url"`
			UpdatedAt     string  `json:"updated_at"`
			User          ghLogin `json:"user"`
			PullRequest   *struct {
				MergedAt *string `json:"merged_at"`
			} `json:"pull_request"`
		} `json:"items"`
	}
	status, err := getJSON(ctx, src.ns, searchPath(q), src.token, &body)
	if err != nil {
		return nil, err
	}
	out := []BoardItem{}
	if status != http.StatusOK {
		return out, nil
	}
	for _, i := range body.Items {
		at := i.UpdatedAt
		if kind == "merged" && i.PullRequest != nil && deref(i.PullRequest.MergedAt) != "" {
			at = deref(i.PullRequest.MergedAt)
		}
		out = append(out, BoardItem{
			Repo: repoOf(i.RepositoryURL), Number: i.Number, Title: i.Title, URL: i.HTMLURL,
			Author: i.User.Login, Mine: src.login != "" && strings.EqualFold(i.User.Login, src.login),
			Kind: kind, At: at,
		})
	}
	return out, nil
}

// reviewQueue is three searches across every repo the app can see (60 s):
// reviews asked of you, then yours with changes requested, then yours with
// failing checks. A PR in two lists is kept once, in the first.
func reviewQueue(ctx context.Context, src prSource) ([]BoardItem, bool, error) {
	return cached(ctx, src.ns, "queue", "@me", boardTTL, func() ([]BoardItem, error) {
		out := []BoardItem{}
		seen := map[string]bool{}
		for _, s := range [...]struct{ q, kind string }{
			{"is:pr is:open archived:false review-requested:@me", "review"},
			{"is:pr is:open archived:false author:@me review:changes_requested", "changes"},
			{"is:pr is:open archived:false author:@me status:failure", "checks"},
		} {
			items, err := searchPRs(ctx, src, s.q, s.kind)
			if err != nil {
				return nil, err
			}
			for _, it := range items {
				if !seen[it.URL] {
					seen[it.URL] = true
					out = append(out, it)
				}
			}
		}
		return out, nil
	})
}

// shippedPRs is one search (60 s): the PRs merged in the tracked repos in
// the last 24 h.
func shippedPRs(ctx context.Context, src prSource, repos []string) ([]BoardItem, bool, error) {
	if len(repos) == 0 {
		return []BoardItem{}, false, nil
	}
	sorted := slices.Sorted(slices.Values(repos))
	return cached(ctx, src.ns, "shipped", strings.Join(sorted, ","), boardTTL, func() ([]BoardItem, error) {
		q := "is:pr is:merged merged:>=" + now().Add(-shippedWindow).UTC().Format(time.RFC3339)
		for _, r := range sorted {
			q += " repo:" + r
		}
		return searchPRs(ctx, src, q, "merged")
	})
}

// ── Reductions (pure) ────────────────────────────────────────────

func runState(r ghRun) string {
	switch {
	case runRunning(r):
		return "running"
	case runFailed(r):
		return "failing"
	case runPassed(r):
		return "passing"
	}
	return "none"
}

// runAt: when a running run started, else when it last changed.
func runAt(r ghRun) string {
	if runRunning(r) {
		if s := deref(r.RunStartedAt); s != "" {
			return s
		}
	}
	return r.UpdatedAt
}

// latestByWorkflow keys each workflow's newest run (runs come newest first)
// by its name in the workflow list; a run of a workflow the list does not
// name (deleted, disabled) goes by the run's own name.
func latestByWorkflow(runs []ghRun, list []ghWorkflow) map[string]ghRun {
	names := map[int64]string{}
	for _, w := range list {
		names[w.ID] = w.Name
	}
	out := map[string]ghRun{}
	for _, r := range runs {
		name, ok := names[r.WorkflowID]
		if !ok {
			name = r.Name
		}
		if _, seen := out[name]; !seen {
			out[name] = r
		}
	}
	return out
}

func ranRecently(r ghRun) bool {
	at := r.CreatedAt
	if at == "" {
		at = r.UpdatedAt
	}
	t, err := time.Parse(time.RFC3339, at)
	return err == nil && t.After(now().Add(-activeWindow))
}

// listWorkflows is the checklist: every active workflow with its last result.
func listWorkflows(list []ghWorkflow, runs []ghRun) []Workflow {
	latest := latestByWorkflow(runs, list)
	out := make([]Workflow, 0, len(list))
	for _, w := range list {
		wf := Workflow{Name: w.Name, Path: w.Path, Last: "none"}
		if r, ok := latest[w.Name]; ok {
			wf.Last, wf.LastAt, wf.RanRecently = runState(r), runAt(r), ranRecently(r)
		}
		out = append(out, wf)
	}
	return out
}

// boardWorkflows: the chosen workflows' latest runs, in the chosen order;
// nil chosen = the ones that ran in the last 30 days, in the list's order.
// A chosen workflow with no run in the window says "none".
func boardWorkflows(chosen []string, list []ghWorkflow, runs []ghRun, login string) []BoardWorkflow {
	latest := latestByWorkflow(runs, list)
	if chosen == nil {
		chosen = []string{}
		for _, w := range listWorkflows(list, runs) {
			if w.RanRecently {
				chosen = append(chosen, w.Name)
			}
		}
	}
	out := make([]BoardWorkflow, 0, len(chosen))
	for _, name := range chosen {
		bw := BoardWorkflow{Name: name, State: "none"}
		if r, ok := latest[name]; ok {
			bw.State, bw.At, bw.URL = runState(r), runAt(r), r.HTMLURL
			bw.Actor, bw.ByYou = r.Actor.Login, login != "" && strings.EqualFold(r.Actor.Login, login)
			if r.HeadCommit != nil {
				bw.Commit, _, _ = strings.Cut(r.HeadCommit.Message, "\n")
			}
		}
		out = append(out, bw)
	}
	return out
}

// needsYouPR is 308's rule: a review asked of you (or your team), or yours
// with changes requested or failing checks.
func needsYouPR(p PR) bool {
	return p.ReviewRequested || (p.IsMine && (p.ReviewState == "changes_requested" || p.ChecksState == "failing"))
}

// boardPRs: mine = the PRs that need you; all = every open PR, those first.
func boardPRs(mode string, prs []PR) *BoardPRs {
	out := &BoardPRs{Items: []PR{}}
	var rest []PR
	for _, p := range prs {
		if needsYouPR(p) {
			out.Items = append(out.Items, p)
		} else if mode == "all" {
			rest = append(rest, p)
		}
	}
	out.NeedsYou = len(out.Items)
	out.Items = append(out.Items, rest...)
	out.Count = len(out.Items)
	return out
}

// boardIssues keeps, for new, the issues opened in the last 24 h.
func boardIssues(mode string, all BoardIssues) *BoardIssues {
	out := &BoardIssues{Items: []BoardIssue{}, Error: all.Error}
	cutoff := now().Add(-newIssueWindow)
	for _, i := range all.Items {
		if mode == "new" {
			t, err := time.Parse(time.RFC3339, i.CreatedAt)
			if err != nil || !t.After(cutoff) {
				continue
			}
		}
		out.Items = append(out.Items, i)
	}
	out.Count = len(out.Items)
	return out
}

// ── One repo ─────────────────────────────────────────────────────

// boardRepo answers one repo. errUnauthorized asks the caller to refresh.
func boardRepo(ctx context.Context, src prSource, req BoardRequestRepo) (BoardRepo, error) {
	out := BoardRepo{Repo: req.Repo, Workflows: []BoardWorkflow{}, Checks: []BoardWorkflow{}}
	branch, found, err := repoBranch(ctx, src, req.Repo)
	if errors.Is(err, errLimited) {
		out.Stale = true
		return out, nil
	}
	if !found {
		return out, err
	}
	out.Available = true

	list, s1, err := workflowList(ctx, src, req.Repo)
	if err != nil {
		return out, err
	}
	runs, s2, err := branchRuns(ctx, src, req.Repo, branch)
	if err != nil {
		return out, err
	}
	checks, s3, err := headChecks(ctx, src, req.Repo, branch)
	if err != nil {
		return out, err
	}
	out.Stale = s1 || s2 || s3
	out.Workflows = boardWorkflows(req.Workflows, list, runs, src.login)
	out.Checks = checks

	if req.PRs != "off" {
		p, err := repoPRs(ctx, src, req.Repo)
		if err != nil {
			return out, err
		}
		out.Stale = out.Stale || p.Stale
		out.PRs = boardPRs(req.PRs, p.PRs)
	}
	if req.Issues != "off" {
		is, s, err := issueList(ctx, src, req.Repo, req.Issues)
		if err != nil {
			return out, err
		}
		out.Stale = out.Stale || s
		out.Issues = boardIssues(req.Issues, is)
	}
	return out, nil
}

// ── Handlers ─────────────────────────────────────────────────────

// connectedSource loads the account's working connection; nil means offer
// Connect, with brokenReason when GitHub stopped accepting it.
func connectedSource(ctx context.Context, sub string) (*connection, string) {
	conn, err := loadConnection(ctx, sub)
	if err != nil {
		log.Printf("[GitHub] board: %v", err)
	}
	switch {
	case conn == nil:
		return nil, ""
	case conn.Status != "ok":
		return nil, brokenReason
	}
	return conn, ""
}

// eachRepo runs fn per repo with the user's token, refreshing it once on a
// 401; a refused refresh marks the connection broken (broken = true).
func eachRepo[T any](ctx context.Context, conn *connection, n int, fn func(i int, src prSource) (T, error), fallback func(i int) T) (res []T, broken bool) {
	token, refresh := userTokens(ctx, conn)
	ns := userNS(conn.Sub)
	var teams map[string]bool
	src := func() (prSource, error) {
		tok, err := token()
		return prSource{ns: ns, login: conn.Login, token: tok, teams: func() map[string]bool {
			if teams == nil {
				teams = userTeams(ctx, ns, tok)
			}
			return teams
		}}, err
	}
	res = make([]T, 0, n)
	for i := 0; i < n; i++ {
		s, err := src()
		var r T
		if err == nil {
			r, err = fn(i, s)
		}
		if errors.Is(err, errUnauthorized) {
			if err = refresh(); err == nil {
				if s, err = src(); err == nil {
					r, err = fn(i, s)
				}
			}
		}
		if errors.Is(err, errUnauthorized) || errors.Is(err, errRefreshRefused) {
			markBroken(ctx, conn.Sub, err.Error())
			return nil, true
		}
		if err != nil {
			log.Printf("[GitHub] board: %v", err)
			r = fallback(i)
		}
		res = append(res, r)
	}
	return res, false
}

// markAnyOK records that GitHub answered when any repo came back.
func markAnyOK[T any](ctx context.Context, conn *connection, res []T, ok func(T) bool) {
	for _, r := range res {
		if ok(r) {
			markOK(ctx, conn.Sub)
			return
		}
	}
}

// HandleWorkflows - GET /github/workflows?repo=owner/name (JWT). The
// widget's checklist and its defaults, cached 10 min.
func HandleWorkflows(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	repo := strings.TrimSpace(strings.Clone(c.Query("repo")))
	if !repoRE.MatchString(repo) || strings.Contains(repo, "..") {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "repo must be owner/repo"})
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	out := WorkflowsResponse{Workflows: []Workflow{}}
	conn, reason := connectedSource(ctx, sub)
	if conn == nil {
		out.Connect, out.Reason = true, reason
		return c.JSON(out)
	}
	res, broken := eachRepo(ctx, conn, 1, func(_ int, src prSource) (WorkflowsResponse, error) {
		w, stale, err := cached(ctx, src.ns, "workflows", repo, workflowsTTL, func() (WorkflowsResponse, error) {
			w := WorkflowsResponse{Workflows: []Workflow{}}
			branch, found, err := repoBranch(ctx, src, repo)
			if !found {
				return w, err
			}
			list, _, err := workflowList(ctx, src, repo)
			if err != nil {
				return w, err
			}
			runs, _, err := branchRuns(ctx, src, repo, branch)
			if err != nil {
				return w, err
			}
			w.Available, w.DefaultBranch, w.Workflows = true, branch, listWorkflows(list, runs)
			return w, nil
		})
		w.Stale = stale
		if w.Workflows == nil {
			w.Workflows = []Workflow{}
		}
		return w, err
	}, func(int) WorkflowsResponse { return WorkflowsResponse{Workflows: []Workflow{}} })
	if broken {
		out.Connect, out.Reason = true, brokenReason
		return c.JSON(out)
	}
	out = res[0]
	out.Connected = true
	return c.JSON(out)
}

// HandleBoard - POST /github/board (JWT) with {repos:[{repo, workflows, prs,
// issues}]}. Connected accounts only; anyone else gets connect:true.
func HandleBoard(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	var body struct {
		Repos []BoardRequestRepo `json:"repos"`
	}
	bad := func(why string) error {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: why})
	}
	if err := c.BodyParser(&body); err != nil {
		return bad("body must be {repos:[…]}")
	}
	reqs := body.Repos
	if len(reqs) > maxRepos {
		reqs = reqs[:maxRepos]
	}
	for i := range reqs {
		r := &reqs[i]
		if !repoRE.MatchString(r.Repo) || strings.Contains(r.Repo, "..") {
			return bad("repo must be owner/repo")
		}
		if r.PRs == "" {
			r.PRs = "mine"
		}
		if r.Issues == "" {
			r.Issues = "off"
		}
		if (r.PRs != "off" && r.PRs != "mine" && r.PRs != "all") || (r.Issues != "off" && r.Issues != "assigned" && r.Issues != "new") {
			return bad("prs is off|mine|all, issues is off|assigned|new")
		}
		if len(r.Workflows) > maxWorkflows {
			r.Workflows = r.Workflows[:maxWorkflows]
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	out := BoardResponse{Repos: []BoardRepo{}, Queue: []BoardItem{}, Shipped: []BoardItem{}}
	conn, reason := connectedSource(ctx, sub)
	if conn == nil {
		out.Connect, out.Reason = true, reason
		return c.JSON(out)
	}
	res, broken := eachRepo(ctx, conn, len(reqs), func(i int, src prSource) (BoardRepo, error) {
		return boardRepo(ctx, src, reqs[i])
	}, func(i int) BoardRepo {
		return BoardRepo{Repo: reqs[i].Repo, Workflows: []BoardWorkflow{}, Checks: []BoardWorkflow{}}
	})
	if broken {
		out.Connect, out.Reason = true, brokenReason
		return c.JSON(out)
	}
	// The page's fill (SCROLLR-312): the review queue everywhere, and what
	// shipped in the tracked repos. A failure answers none, never the board.
	names := make([]string, len(reqs))
	for i, r := range reqs {
		names[i] = r.Repo
	}
	type fill struct{ queue, shipped []BoardItem }
	extra, broken := eachRepo(ctx, conn, 1, func(_ int, src prSource) (fill, error) {
		q, _, err := reviewQueue(ctx, src)
		if err != nil {
			return fill{}, err
		}
		s, _, err := shippedPRs(ctx, src, names)
		return fill{q, s}, err
	}, func(int) fill { return fill{} })
	if broken {
		out.Connect, out.Reason = true, brokenReason
		return c.JSON(out)
	}
	if extra[0].queue != nil {
		out.Queue = extra[0].queue
	}
	if extra[0].shipped != nil {
		out.Shipped = extra[0].shipped
	}
	markAnyOK(ctx, conn, res, func(r BoardRepo) bool { return r.Available })
	out.Connected, out.Login, out.Repos = true, conn.Login, res
	return c.JSON(out)
}
