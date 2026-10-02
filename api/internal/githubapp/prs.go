package githubapp

// Pull requests for the GitHub widget's edge chip (SCROLLR-308): what needs
// you, whether the default branch is broken, and whether CI is running on
// your branches. Connected accounts only; the user's own token and budget.
//
// A PR's checks are its head commit's check runs plus its commit statuses
// (any CI, SCROLLR-312); an install that has not approved Checks: read yet
// gets its Actions runs instead.
//
// Budget (TestPRBudget): per repo per 60 s refresh, steady state, two calls
// (open pulls, the 20 most recent runs). Everything slower-moving is cached
// on a key that changes when it does: the default branch (24 h), a PR's
// reviews (its updated_at), a commit's settled checks (its sha plus the
// latest run update the recent list shows for it, so an Actions re-run
// refetches; ponytail: another CI's re-run of the same commit shows within
// the hour), the user's teams (1 h, only when a PR asks a team). Five repos
// polled for an hour cost 650 calls; the 5,000/h user budget has room.
// ponytail: a commit whose checks are still running is refetched on every
// refresh, so 20 PRs all running at once cost 20 calls a minute while they
// run. The rate-limit hold below serves the last answer if that ever bites.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/errgroup"
)

const (
	prsTTL        = 60 * time.Second
	prDetailTTL   = time.Hour
	branchTTL     = 24 * time.Hour
	teamsTTL      = time.Hour
	maxPRDetails  = 20 // PRs per repo whose reviews and checks are fetched
	prParallel    = 6
	recentRunsLen = 20

	keyPR = "github:pr:" // + ns + ":" + kind + ":" + …; forgetUser drops them all
)

func prKey(ns string, parts ...string) string { return keyPR + ns + ":" + strings.Join(parts, ":") }

// Checks counts a commit's Actions runs.
type Checks struct {
	Total   int `json:"total"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Running int `json:"running"`
}

// PR is one open pull request.
type PR struct {
	Number          int    `json:"number"`
	Title           string `json:"title"`
	HTMLURL         string `json:"html_url"`
	Author          string `json:"author"`
	IsMine          bool   `json:"is_mine"`
	ReviewRequested bool   `json:"review_requested"`
	// approved | changes_requested | none ("" past the detail cap)
	ReviewState string `json:"review_state"`
	Draft       bool   `json:"draft"`
	HeadBranch  string `json:"head_branch"`
	HeadSHA     string `json:"head_sha"`
	UpdatedAt   string `json:"updated_at"`
	Checks      Checks `json:"checks"`
	// passing | failing | running | none | unknown (past the detail cap)
	ChecksState string `json:"checks_state"`
}

// DefaultCI is the default branch's state: failing when any workflow's
// latest run there failed, else running, else passing.
type DefaultCI struct {
	State         string `json:"state"`
	Workflow      string `json:"workflow,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
	HTMLURL       string `json:"html_url,omitempty"`
	CommitMessage string `json:"commit_message,omitempty"`
}

// RepoPRs is one repo's answer.
type RepoPRs struct {
	Repo      string     `json:"repo"`
	Available bool       `json:"available"`
	Stale     bool       `json:"stale,omitempty"`
	PRs       []PR       `json:"prs"`
	DefaultCI *DefaultCI `json:"default_ci,omitempty"`
	// Runs in progress on your PR branches or started by you.
	MineRunning int    `json:"mine_running"`
	MineSince   string `json:"mine_since,omitempty"`
	MineBranch  string `json:"mine_branch,omitempty"`
}

// PRsResponse is GET /github/prs.
type PRsResponse struct {
	Connected bool      `json:"connected"`
	Connect   bool      `json:"connect,omitempty"`
	Login     string    `json:"login,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	Repos     []RepoPRs `json:"repos"`
}

// ── GitHub wire shapes ──────────────────────────────────────────

type ghLogin struct {
	Login string `json:"login"`
}

type ghPull struct {
	Number             int       `json:"number"`
	Title              string    `json:"title"`
	HTMLURL            string    `json:"html_url"`
	Draft              bool      `json:"draft"`
	UpdatedAt          string    `json:"updated_at"`
	User               ghLogin   `json:"user"`
	RequestedReviewers []ghLogin `json:"requested_reviewers"`
	RequestedTeams     []struct {
		Slug string `json:"slug"`
	} `json:"requested_teams"`
	Head struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
}

type ghRun struct {
	Name         string  `json:"name"`
	WorkflowID   int64   `json:"workflow_id"`
	Status       string  `json:"status"`
	Conclusion   *string `json:"conclusion"`
	HTMLURL      string  `json:"html_url"`
	HeadBranch   *string `json:"head_branch"`
	HeadSHA      string  `json:"head_sha"`
	CreatedAt    string  `json:"created_at"`
	RunStartedAt *string `json:"run_started_at"`
	UpdatedAt    string  `json:"updated_at"`
	Actor        ghLogin `json:"actor"`
	HeadCommit   *struct {
		Message string `json:"message"`
	} `json:"head_commit"`
}

type ghRuns struct {
	WorkflowRuns []ghRun `json:"workflow_runs"`
}

var errLimited = errors.New("github rate limit spent")

// getJSON is one GitHub GET with the rate-limit hold, decoded into out on 200.
func getJSON(ctx context.Context, ns, path, token string, out any) (int, error) {
	resp, err := githubRequest(ctx, http.MethodGet, path, token, nil)
	if err != nil {
		return 0, fmt.Errorf("get %s: %w", path, err)
	}
	defer resp.Body.Close()
	if exhausted, resetAt := rateLimit(resp); exhausted {
		holdLimit(ctx, ns, resetAt)
		if resp.StatusCode != http.StatusOK {
			return resp.StatusCode, errLimited
		}
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return resp.StatusCode, errUnauthorized
	case http.StatusOK:
		if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out); err != nil {
			return resp.StatusCode, fmt.Errorf("decode %s: %w", path, err)
		}
	}
	return resp.StatusCode, nil
}

func cacheJSON(ctx context.Context, key string, out any) bool {
	raw, err := platform.Rdb.Get(ctx, key).Bytes()
	return err == nil && json.Unmarshal(raw, out) == nil
}

func storeJSON(ctx context.Context, key string, v any, ttl time.Duration) {
	if raw, err := json.Marshal(v); err == nil {
		_ = platform.Rdb.Set(ctx, key, raw, ttl).Err()
	}
}

// ── Reductions (pure) ───────────────────────────────────────────

// reduceReviews keeps each reviewer's last review that is not a comment (a
// dismissal clears it), then: any changes requested wins, else any approval.
func reduceReviews(reviews []struct {
	User  ghLogin `json:"user"`
	State string  `json:"state"`
}) string {
	last := map[string]string{}
	for _, r := range reviews { // GitHub lists them oldest first
		switch r.State {
		case "APPROVED", "CHANGES_REQUESTED":
			last[r.User.Login] = r.State
		case "DISMISSED":
			delete(last, r.User.Login)
		}
	}
	state := "none"
	for _, s := range last {
		if s == "CHANGES_REQUESTED" {
			return "changes_requested"
		}
		state = "approved"
	}
	return state
}

func runRunning(r ghRun) bool { return r.Status != "completed" }

func runFailed(r ghRun) bool {
	switch deref(r.Conclusion) {
	case "failure", "timed_out", "startup_failure":
		return true
	}
	return false
}

func runPassed(r ghRun) bool {
	switch deref(r.Conclusion) {
	case "success", "neutral", "skipped":
		return true
	}
	return false
}

// countChecks: a known failure is failing even while others still run.
func countChecks(runs []ghRun) (Checks, string) {
	var c Checks
	for _, r := range runs {
		c.Total++
		switch {
		case runRunning(r):
			c.Running++
		case runFailed(r):
			c.Failed++
		case runPassed(r):
			c.Passed++
		}
	}
	switch {
	case c.Failed > 0:
		return c, "failing"
	case c.Running > 0:
		return c, "running"
	case c.Passed > 0:
		return c, "passing"
	}
	return c, "none"
}

// defaultCI reduces the default branch's runs (newest first) to the latest
// per workflow, then failing > running > passing.
func defaultCI(runs []ghRun, branch string) *DefaultCI {
	seen := map[string]bool{}
	var newest, failing, running *ghRun
	for i := range runs {
		r := &runs[i]
		if deref(r.HeadBranch) != branch || seen[r.Name] {
			continue
		}
		seen[r.Name] = true
		if newest == nil {
			newest = r
		}
		if failing == nil && runFailed(*r) {
			failing = r
		}
		if running == nil && runRunning(*r) {
			running = r
		}
	}
	pick, state := newest, "passing"
	switch {
	case newest == nil:
		return nil
	case failing != nil:
		pick, state = failing, "failing"
	case running != nil:
		pick, state = running, "running"
	case !runPassed(*newest):
		state = "none"
	}
	d := &DefaultCI{State: state, Workflow: pick.Name, UpdatedAt: pick.UpdatedAt, HTMLURL: pick.HTMLURL}
	if pick.HeadCommit != nil {
		d.CommitMessage = pick.HeadCommit.Message
	}
	return d
}

// ── One repo ────────────────────────────────────────────────────

// prSource is what one request knows: whose token, and the user's teams on
// demand (fetched at most once, and only if some PR asks a team).
type prSource struct {
	ns, login, token string
	teams            func() map[string]bool
}

// repoPRs answers one repo through its 60 s cache. errUnauthorized asks
// the caller to refresh the token; a spent budget serves the last answer.
func repoPRs(ctx context.Context, src prSource, repo string) (RepoPRs, error) {
	freshKey, lastKey := prKey(src.ns, "repo", repo), prKey(src.ns, "last", repo)
	var out RepoPRs
	if cacheJSON(ctx, freshKey, &out) {
		return out, nil
	}
	stale := func() (RepoPRs, error) {
		if !cacheJSON(ctx, lastKey, &out) {
			out = RepoPRs{Repo: repo, PRs: []PR{}}
		}
		out.Stale = true
		return out, nil
	}
	if platform.Rdb.Exists(ctx, keyLimited+src.ns).Val() > 0 {
		return stale()
	}
	out, err := buildRepoPRs(ctx, src, repo)
	switch {
	case errors.Is(err, errLimited):
		return stale()
	case errors.Is(err, errUnauthorized):
		return out, err
	case err != nil:
		log.Printf("[GitHub] prs for %s: %v", repo, err)
		out = RepoPRs{Repo: repo, PRs: []PR{}}
	}
	storeJSON(ctx, freshKey, out, prsTTL)
	if out.Available {
		storeJSON(ctx, lastKey, out, lastGoodTTL)
	}
	return out, nil
}

func buildRepoPRs(ctx context.Context, src prSource, repo string) (RepoPRs, error) {
	out := RepoPRs{Repo: repo, PRs: []PR{}}
	path := "/repos/" + repo

	branch, found, err := repoBranch(ctx, src, repo)
	if !found {
		return out, err // 404 / no access: not available
	}

	var pulls []ghPull
	if status, err := getJSON(ctx, src.ns, path+"/pulls?state=open&per_page=50", src.token, &pulls); err != nil || status != http.StatusOK {
		return out, err
	}
	var recent ghRuns
	if _, err := getJSON(ctx, src.ns, fmt.Sprintf("%s/actions/runs?per_page=%d", path, recentRunsLen), src.token, &recent); err != nil {
		return out, err
	}
	out.Available = true

	// The default branch: from the recent runs, else its own latest run.
	out.DefaultCI = defaultCI(recent.WorkflowRuns, branch)
	if out.DefaultCI == nil && branch != "" {
		var own ghRuns
		if _, err := getJSON(ctx, src.ns, path+"/actions/runs?per_page=1&branch="+url.QueryEscape(branch), src.token, &own); err != nil {
			return out, err
		}
		out.DefaultCI = defaultCI(own.WorkflowRuns, branch)
	}

	// Your branches: runs in progress on your open PRs' heads, or started by you.
	mine := map[string]bool{}
	for _, p := range pulls {
		if strings.EqualFold(p.User.Login, src.login) {
			mine[p.Head.Ref] = true
		}
	}
	for _, r := range recent.WorkflowRuns { // newest first
		if runRunning(r) && (mine[deref(r.HeadBranch)] || strings.EqualFold(r.Actor.Login, src.login)) {
			if out.MineRunning == 0 {
				out.MineSince, out.MineBranch = deref(r.RunStartedAt), deref(r.HeadBranch)
			}
			out.MineRunning++
		}
	}

	// The latest run update per commit the recent list shows: a re-run moves
	// it, which moves the settled-checks cache key.
	touched := map[string]string{}
	for _, r := range recent.WorkflowRuns {
		if r.UpdatedAt > touched[r.HeadSHA] {
			touched[r.HeadSHA] = r.UpdatedAt
		}
	}

	out.PRs = make([]PR, len(pulls))
	for i, p := range pulls {
		pr := PR{
			Number: p.Number, Title: p.Title, HTMLURL: p.HTMLURL, Author: p.User.Login,
			IsMine: strings.EqualFold(p.User.Login, src.login), Draft: p.Draft,
			HeadBranch: p.Head.Ref, HeadSHA: p.Head.SHA, UpdatedAt: p.UpdatedAt, ChecksState: "unknown",
		}
		for _, r := range p.RequestedReviewers {
			pr.ReviewRequested = pr.ReviewRequested || strings.EqualFold(r.Login, src.login)
		}
		owner, _, _ := strings.Cut(repo, "/")
		for _, t := range p.RequestedTeams {
			if !pr.ReviewRequested && src.teams()[strings.ToLower(owner+"/"+t.Slug)] {
				pr.ReviewRequested = true
			}
		}
		out.PRs[i] = pr
	}

	// Details for at most maxPRDetails PRs: yours first, then the newest.
	order := make([]int, len(pulls))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return out.PRs[order[a]].IsMine && !out.PRs[order[b]].IsMine })
	order = order[:min(len(order), maxPRDetails)]

	var g errgroup.Group
	g.SetLimit(prParallel)
	for _, i := range order {
		g.Go(func() error {
			pr := &out.PRs[i]
			state, err := prReviews(ctx, src, repo, *pr)
			if err != nil {
				return err
			}
			pr.ReviewState = state
			pr.Checks, pr.ChecksState, err = prChecks(ctx, src, repo, pr.HeadSHA, touched[pr.HeadSHA])
			return err
		})
	}
	return out, g.Wait()
}

// repoBranch is the repo's default branch, cached 24 h. found is false for
// a repo the token cannot see (404) or on an error.
func repoBranch(ctx context.Context, src prSource, repo string) (branch string, found bool, err error) {
	key := prKey(src.ns, "branch", repo)
	if cacheJSON(ctx, key, &branch) {
		return branch, true, nil
	}
	var meta struct {
		DefaultBranch string `json:"default_branch"`
	}
	status, err := getJSON(ctx, src.ns, "/repos/"+repo, src.token, &meta)
	if err != nil || status != http.StatusOK {
		return "", false, err
	}
	storeJSON(ctx, key, meta.DefaultBranch, branchTTL)
	return meta.DefaultBranch, true, nil
}

func prReviews(ctx context.Context, src prSource, repo string, pr PR) (string, error) {
	key := prKey(src.ns, "reviews", repo, fmt.Sprint(pr.Number), pr.UpdatedAt)
	var state string
	if cacheJSON(ctx, key, &state) {
		return state, nil
	}
	var reviews []struct {
		User  ghLogin `json:"user"`
		State string  `json:"state"`
	}
	status, err := getJSON(ctx, src.ns, fmt.Sprintf("/repos/%s/pulls/%d/reviews?per_page=100", repo, pr.Number), src.token, &reviews)
	if err != nil {
		return "", err
	}
	state = "none"
	if status == http.StatusOK {
		state = reduceReviews(reviews)
	}
	storeJSON(ctx, key, state, prDetailTTL)
	return state, nil
}

// commitChecks is a commit's (or a branch's) check runs as runs, each
// with its app's slug in Actor. ok is false when GitHub would not say
// (403 before the install approves Checks: read, 404).
func commitChecks(ctx context.Context, src prSource, repo, ref string) (runs []ghRun, ok bool, err error) {
	var body struct {
		CheckRuns []struct {
			Name        string  `json:"name"`
			Status      string  `json:"status"`
			Conclusion  *string `json:"conclusion"`
			HTMLURL     string  `json:"html_url"`
			StartedAt   *string `json:"started_at"`
			CompletedAt *string `json:"completed_at"`
			App         struct {
				Slug string `json:"slug"`
			} `json:"app"`
		} `json:"check_runs"`
	}
	status, err := getJSON(ctx, src.ns, fmt.Sprintf("/repos/%s/commits/%s/check-runs?per_page=100", repo, url.PathEscape(ref)), src.token, &body)
	if err != nil || status != http.StatusOK {
		return nil, false, err
	}
	for _, c := range body.CheckRuns {
		at := deref(c.CompletedAt)
		if at == "" {
			at = deref(c.StartedAt)
		}
		runs = append(runs, ghRun{Name: c.Name, Status: c.Status, Conclusion: c.Conclusion, HTMLURL: c.HTMLURL,
			RunStartedAt: c.StartedAt, UpdatedAt: at, Actor: ghLogin{Login: c.App.Slug}})
	}
	return runs, true, nil
}

// commitStatuses is a commit's (or a branch's) statuses as runs: pending
// runs, success passes, failure and error fail. None on a 403 or 404.
func commitStatuses(ctx context.Context, src prSource, repo, ref string) ([]ghRun, error) {
	var body struct {
		Statuses []struct {
			Context   string `json:"context"`
			State     string `json:"state"`
			TargetURL string `json:"target_url"`
			UpdatedAt string `json:"updated_at"`
		} `json:"statuses"`
	}
	status, err := getJSON(ctx, src.ns, fmt.Sprintf("/repos/%s/commits/%s/status", repo, url.PathEscape(ref)), src.token, &body)
	if err != nil || status != http.StatusOK {
		return nil, err
	}
	var runs []ghRun
	for _, s := range body.Statuses {
		r := ghRun{Name: s.Context, Status: "completed", HTMLURL: s.TargetURL, UpdatedAt: s.UpdatedAt}
		switch s.State {
		case "pending":
			r.Status = "in_progress"
		case "success":
			r.Conclusion = ptr("success")
		default: // failure, error
			r.Conclusion = ptr("failure")
		}
		runs = append(runs, r)
	}
	return runs, nil
}

func ptr(s string) *string { return &s }

func prChecks(ctx context.Context, src prSource, repo, sha, touched string) (Checks, string, error) {
	key := prKey(src.ns, "checks", repo, sha, touched)
	var cached struct {
		Checks Checks
		State  string
	}
	if cacheJSON(ctx, key, &cached) {
		return cached.Checks, cached.State, nil
	}
	// Any CI (SCROLLR-312): the commit's check runs (Actions jobs and every
	// other app) plus its commit statuses (Vercel, Netlify). An install that
	// has not approved Checks: read gets 403: its Actions runs stand in.
	checks, ok, err := commitChecks(ctx, src, repo, sha)
	if err != nil {
		return Checks{}, "unknown", err
	}
	if !ok {
		var runs ghRuns
		status, err := getJSON(ctx, src.ns, fmt.Sprintf("/repos/%s/actions/runs?per_page=20&head_sha=%s", repo, url.QueryEscape(sha)), src.token, &runs)
		if err != nil {
			return Checks{}, "unknown", err
		}
		if status != http.StatusOK {
			return Checks{}, "unknown", nil
		}
		checks = runs.WorkflowRuns
	}
	statuses, err := commitStatuses(ctx, src, repo, sha)
	if err != nil {
		return Checks{}, "unknown", err
	}
	cached.Checks, cached.State = countChecks(append(checks, statuses...))
	if cached.Checks.Running == 0 {
		storeJSON(ctx, key, cached, prDetailTTL)
	}
	return cached.Checks, cached.State, nil
}

// userTeams is the set of "org/slug" the user belongs to, cached 1 h. A
// token without members:read gets 403: no teams, cached all the same.
func userTeams(ctx context.Context, ns, token string) map[string]bool {
	key := prKey(ns, "teams")
	teams := map[string]bool{}
	if cacheJSON(ctx, key, &teams) {
		return teams
	}
	var body []struct {
		Slug         string  `json:"slug"`
		Organization ghLogin `json:"organization"`
	}
	if status, err := getJSON(ctx, ns, "/user/teams?per_page=100", token, &body); err == nil && status == http.StatusOK {
		for _, t := range body {
			teams[strings.ToLower(t.Organization.Login+"/"+t.Slug)] = true
		}
	}
	storeJSON(ctx, key, teams, teamsTTL)
	return teams
}

// ── Handler ─────────────────────────────────────────────────────

// HandlePRs - GET /github/prs?repos=owner/a,owner/b (JWT). Connected
// accounts only; anyone else gets connect:true and no repos.
func HandlePRs(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	repos, ok := parseRepos(c)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	out := PRsResponse{Repos: []RepoPRs{}}

	conn, err := loadConnection(ctx, sub)
	if err != nil {
		log.Printf("[GitHub] prs: %v", err)
	}
	switch {
	case conn == nil:
		out.Connect = true
		return c.JSON(out)
	case conn.Status != "ok":
		out.Connect, out.Reason = true, brokenReason
		return c.JSON(out)
	}
	if res, broken := userPRs(ctx, conn, repos); !broken {
		out.Connected, out.Login, out.Repos = true, conn.Login, res
		return c.JSON(out)
	}
	out.Connect, out.Reason = true, brokenReason
	return c.JSON(out)
}

// userPRs answers every repo with the user's token, refreshing it once on a
// 401; a refused refresh marks the connection broken.
func userPRs(ctx context.Context, conn *connection, repos []string) (res []RepoPRs, broken bool) {
	res, broken = eachRepo(ctx, conn, len(repos), func(i int, src prSource) (RepoPRs, error) {
		return repoPRs(ctx, src, repos[i])
	}, func(i int) RepoPRs { return RepoPRs{Repo: repos[i], PRs: []PR{}} })
	markAnyOK(ctx, conn, res, func(r RepoPRs) bool { return r.Available })
	return res, broken
}
