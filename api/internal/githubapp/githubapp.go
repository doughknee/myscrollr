// Package githubapp connects a Scrollr account to GitHub through the
// "Scrollr Desktop" GitHub App and serves the GitHub widget (SCROLLR-304).
//
// Core brokers the user-to-server OAuth flow and holds the tokens
// (AES-GCM, platform.Encrypt); the desktop never sees one. The widget asks
// GET /github/runs, which answers from the user's own 5,000 req/h budget
// when connected and from one shared unauthenticated budget (60 req/h per
// core egress IP) when not, so nobody's widget goes blank on upgrade.
//
// Privacy: tokens, OAuth codes and the state value never reach a log line or
// a Sentry event. Errors wrap with %w and carry GitHub's error code only.
package githubapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/singleflight"
)

// =============================================================================
// Configuration
// =============================================================================

// Upstream bases. Variables so tests can point them at an httptest server.
var (
	WebBase    = "https://github.com"
	APIBase    = "https://api.github.com"
	httpClient = &http.Client{Timeout: 10 * time.Second}
	now        = time.Now
)

const (
	stateTTL    = 10 * time.Minute
	userRunsTTL = 60 * time.Second
	// ponytail: the unauthenticated fallback shares core's one 60 req/h IP
	// budget across every unconnected user. Five minutes per repo keeps one
	// user's five repos inside it; past that the limiter below serves stale
	// copies until GitHub's reset. Upgrade path: nudge users to Connect.
	publicRunsTTL = 5 * time.Minute
	lastGoodTTL   = 24 * time.Hour
	refreshSkew   = 5 * time.Minute
	maxRepos      = 20
	requestBudget = 20 * time.Second

	keyState   = "github:oauth:state:"
	keyRuns    = "github:runs:"    // + ns + ":" + owner/repo
	keyLast    = "github:last:"    // + ns + ":" + owner/repo
	keyLimited = "github:limited:" // + ns
	nsPublic   = "public"

	brokenReason = "GitHub stopped accepting Scrollr's access. Reconnect GitHub."
)

func clientID() string     { return os.Getenv("GITHUB_APP_CLIENT_ID") }
func clientSecret() string { return os.Getenv("GITHUB_APP_CLIENT_SECRET") }

// callbackURL must be one of the app's registered callback URLs. Each
// environment sets its own (dev-api, localhost); production is the default.
func callbackURL() string {
	if v := os.Getenv("GITHUB_APP_CALLBACK_URL"); v != "" {
		return v
	}
	return "https://api.myscrollr.com/github/callback"
}

func frontendURL() string {
	if v := os.Getenv("FRONTEND_URL"); v != "" {
		return strings.TrimSuffix(v, "/")
	}
	return platform.DefaultFrontendURL
}

func configured() bool { return clientID() != "" && clientSecret() != "" }

func userNS(sub string) string { return "user:" + sub }

// =============================================================================
// Storage
// =============================================================================

type connection struct {
	Sub          string
	Login        string
	AccessToken  string // plaintext, in memory only
	RefreshToken string
	ExpiresAt    *time.Time
	Status       string
	CreatedAt    time.Time
}

// tokenResponse is GitHub's /login/oauth/access_token answer. GitHub reports
// failures with HTTP 200 and an `error` field.
type tokenResponse struct {
	AccessToken           string `json:"access_token"`
	ExpiresIn             int    `json:"expires_in"`
	RefreshToken          string `json:"refresh_token"`
	RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
	Error                 string `json:"error"`
}

func loadConnection(ctx context.Context, sub string) (*connection, error) {
	var c connection
	var access, refresh string
	err := platform.DBPool.QueryRow(ctx, `
		SELECT github_login, access_token, refresh_token, expires_at, status, created_at
		  FROM github_connections WHERE logto_sub = $1`, sub).
		Scan(&c.Login, &access, &refresh, &c.ExpiresAt, &c.Status, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read connection: %w", err)
	}
	c.Sub = sub
	if c.AccessToken, err = platform.Decrypt(access); err != nil {
		return nil, fmt.Errorf("decrypt access token: %w", err)
	}
	if refresh != "" {
		if c.RefreshToken, err = platform.Decrypt(refresh); err != nil {
			return nil, fmt.Errorf("decrypt refresh token: %w", err)
		}
	}
	return &c, nil
}

// saveTokens upserts the connection with a fresh token pair. login/userID
// are only written when non-empty (a refresh does not re-read the user).
func saveTokens(ctx context.Context, sub, login string, userID int64, t tokenResponse) error {
	access, err := platform.Encrypt(t.AccessToken)
	if err != nil {
		return fmt.Errorf("encrypt access token: %w", err)
	}
	refresh := ""
	if t.RefreshToken != "" {
		if refresh, err = platform.Encrypt(t.RefreshToken); err != nil {
			return fmt.Errorf("encrypt refresh token: %w", err)
		}
	}
	var expires, refreshExpires *time.Time
	if t.ExpiresIn > 0 {
		v := now().Add(time.Duration(t.ExpiresIn) * time.Second)
		expires = &v
	}
	if t.RefreshTokenExpiresIn > 0 {
		v := now().Add(time.Duration(t.RefreshTokenExpiresIn) * time.Second)
		refreshExpires = &v
	}
	if login != "" {
		_, err = platform.DBPool.Exec(ctx, `
			INSERT INTO github_connections (logto_sub, github_user_id, github_login, access_token,
			       refresh_token, expires_at, refresh_expires_at, status, broken_reason, last_ok_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, 'ok', NULL, now())
			ON CONFLICT (logto_sub) DO UPDATE SET
			       github_user_id = EXCLUDED.github_user_id, github_login = EXCLUDED.github_login,
			       access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
			       expires_at = EXCLUDED.expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at,
			       status = 'ok', broken_reason = NULL, last_ok_at = now(), updated_at = now()`,
			sub, userID, login, access, refresh, expires, refreshExpires)
	} else {
		_, err = platform.DBPool.Exec(ctx, `
			UPDATE github_connections
			   SET access_token = $2, refresh_token = $3, expires_at = $4, refresh_expires_at = $5,
			       updated_at = now()
			 WHERE logto_sub = $1`, sub, access, refresh, expires, refreshExpires)
	}
	if err != nil {
		return fmt.Errorf("save connection: %w", err)
	}
	return nil
}

func markBroken(ctx context.Context, sub, reason string) {
	if _, err := platform.DBPool.Exec(ctx, `
		UPDATE github_connections SET status = 'broken', broken_reason = $2, updated_at = now()
		 WHERE logto_sub = $1`, sub, reason); err != nil {
		log.Printf("[GitHub] mark broken: %v", err)
	}
}

func markOK(ctx context.Context, sub string) {
	if _, err := platform.DBPool.Exec(ctx, `
		UPDATE github_connections SET last_ok_at = now()
		 WHERE logto_sub = $1 AND (last_ok_at IS NULL OR last_ok_at < now() - interval '5 minutes')`,
		sub); err != nil {
		log.Printf("[GitHub] mark ok: %v", err)
	}
}

// =============================================================================
// GitHub calls
// =============================================================================

var errRefreshRefused = errors.New("refresh refused")

// postToken calls GitHub's token endpoint (code exchange or refresh).
func postToken(ctx context.Context, form url.Values) (tokenResponse, error) {
	form.Set("client_id", clientID())
	form.Set("client_secret", clientSecret())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, WebBase+"/login/oauth/access_token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return tokenResponse{}, fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	var t tokenResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&t); err != nil {
		return tokenResponse{}, fmt.Errorf("token response (HTTP %d): %w", resp.StatusCode, err)
	}
	if t.Error != "" || t.AccessToken == "" {
		// GitHub's error code (bad_verification_code, bad_refresh_token, …)
		// is safe to log; nothing else from this body is.
		return tokenResponse{}, fmt.Errorf("%w: %s", errRefreshRefused, t.Error)
	}
	return t, nil
}

func githubRequest(ctx context.Context, method, path, token string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, APIBase+path, body)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "Scrollr")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return httpClient.Do(req)
}

func fetchUser(ctx context.Context, token string) (login string, id int64, err error) {
	resp, err := githubRequest(ctx, http.MethodGet, "/user", token, nil)
	if err != nil {
		return "", 0, fmt.Errorf("get user: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("get user: HTTP %d", resp.StatusCode)
	}
	var u struct {
		Login string `json:"login"`
		ID    int64  `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return "", 0, fmt.Errorf("decode user: %w", err)
	}
	return u.Login, u.ID, nil
}

// revokeGrant removes the user's authorization of the app at GitHub, so the
// app disappears from their GitHub settings too. Best effort.
func revokeGrant(ctx context.Context, token string) {
	if !configured() || token == "" {
		return
	}
	body, _ := json.Marshal(map[string]string{"access_token": token})
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		APIBase+"/applications/"+url.PathEscape(clientID())+"/grant", strings.NewReader(string(body)))
	if err != nil {
		return
	}
	req.SetBasicAuth(clientID(), clientSecret())
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Scrollr")
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[GitHub] revoke grant: %v", err)
		return
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		log.Printf("[GitHub] revoke grant: HTTP %d", resp.StatusCode)
	}
}

// Run is one repo's latest workflow run: the fields the widget reads.
type Run struct {
	Repo          string `json:"repo"`
	Available     bool   `json:"available"`
	Status        string `json:"status,omitempty"`
	Conclusion    string `json:"conclusion,omitempty"`
	Name          string `json:"name,omitempty"`
	HTMLURL       string `json:"html_url,omitempty"`
	HeadBranch    string `json:"head_branch,omitempty"`
	RunStartedAt  string `json:"run_started_at,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
	CommitMessage string `json:"commit_message,omitempty"`
	Stale         bool   `json:"stale,omitempty"`
}

// upstream is what one /actions/runs call told us.
type upstream struct {
	status    int
	run       Run
	exhausted bool // the budget behind this token is spent until resetAt
	resetAt   time.Time
}

func fetchRun(ctx context.Context, repo, token string) (upstream, error) {
	resp, err := githubRequest(ctx, http.MethodGet, "/repos/"+repo+"/actions/runs?per_page=1", token, nil)
	if err != nil {
		return upstream{}, fmt.Errorf("runs: %w", err)
	}
	defer resp.Body.Close()
	up := upstream{status: resp.StatusCode, run: Run{Repo: repo}}
	if resp.Header.Get("X-Ratelimit-Remaining") == "0" || resp.StatusCode == http.StatusTooManyRequests {
		up.exhausted = true
		up.resetAt = now().Add(time.Minute)
		if s, err := strconv.ParseInt(resp.Header.Get("X-Ratelimit-Reset"), 10, 64); err == nil {
			up.resetAt = time.Unix(s, 0)
		}
	}
	if resp.StatusCode != http.StatusOK {
		return up, nil
	}
	var body struct {
		WorkflowRuns []struct {
			Name         string  `json:"name"`
			Status       string  `json:"status"`
			Conclusion   *string `json:"conclusion"`
			HTMLURL      string  `json:"html_url"`
			HeadBranch   *string `json:"head_branch"`
			RunStartedAt *string `json:"run_started_at"`
			UpdatedAt    string  `json:"updated_at"`
			HeadCommit   *struct {
				Message string `json:"message"`
			} `json:"head_commit"`
		} `json:"workflow_runs"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil {
		return up, fmt.Errorf("decode runs: %w", err)
	}
	if len(body.WorkflowRuns) == 0 {
		return up, nil
	}
	r := body.WorkflowRuns[0]
	up.run = Run{
		Repo: repo, Available: true, Status: r.Status, Name: r.Name,
		HTMLURL: r.HTMLURL, UpdatedAt: r.UpdatedAt,
		Conclusion: deref(r.Conclusion), HeadBranch: deref(r.HeadBranch), RunStartedAt: deref(r.RunStartedAt),
	}
	if r.HeadCommit != nil {
		up.run.CommitMessage = r.HeadCommit.Message
	}
	return up, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// =============================================================================
// Cache
// =============================================================================

func cacheGet(ctx context.Context, key string) (Run, bool) {
	raw, err := platform.Rdb.Get(ctx, key).Bytes()
	if err != nil {
		return Run{}, false
	}
	var r Run
	return r, json.Unmarshal(raw, &r) == nil
}

func cacheSet(ctx context.Context, key string, r Run, ttl time.Duration) {
	if raw, err := json.Marshal(r); err == nil {
		_ = platform.Rdb.Set(ctx, key, raw, ttl).Err()
	}
}

// forgetUser drops every cached answer for one account (disconnect, purge).
func forgetUser(ctx context.Context, sub string) {
	if platform.Rdb == nil {
		return
	}
	for _, prefix := range []string{keyRuns, keyLast} {
		iter := platform.Rdb.Scan(ctx, 0, prefix+userNS(sub)+":*", 100).Iterator()
		for iter.Next(ctx) {
			_ = platform.Rdb.Del(ctx, iter.Val()).Err()
		}
	}
	_ = platform.Rdb.Del(ctx, keyLimited+userNS(sub)).Err()
}

// errUnauthorized means GitHub answered 401 for this token.
var errUnauthorized = errors.New("github answered 401")

// answer resolves one repo through the cache for a namespace (one user, or
// the shared public budget). token is called only on a cache miss, so a
// fully cached request costs GitHub nothing.
//
// Every outcome that cost a call is cached for ttl, failures included —
// that is what bounds the calls per repo to one per ttl.
func answer(ctx context.Context, ns, repo string, ttl time.Duration, token func() (string, error)) (Run, error) {
	runsKey := keyRuns + ns + ":" + repo
	if r, ok := cacheGet(ctx, runsKey); ok {
		return r, nil
	}
	// Concurrent misses on one replica share one call. (ponytail: replicas
	// can still each miss once per ttl; the 400/h acceptance has headroom.)
	v, err, _ := flight.Do(runsKey, func() (any, error) {
		r, err := miss(ctx, ns, repo, ttl, token)
		return r, err
	})
	return v.(Run), err
}

var flight singleflight.Group

func miss(ctx context.Context, ns, repo string, ttl time.Duration, token func() (string, error)) (Run, error) {
	runsKey, lastKey := keyRuns+ns+":"+repo, keyLast+ns+":"+repo
	if r, ok := cacheGet(ctx, runsKey); ok {
		return r, nil
	}
	stale := func() Run {
		r, ok := cacheGet(ctx, lastKey)
		if !ok {
			r = Run{Repo: repo}
		}
		r.Stale = true
		return r
	}
	if platform.Rdb.Exists(ctx, keyLimited+ns).Val() > 0 {
		return stale(), nil
	}
	tok, err := token()
	if err != nil {
		return Run{Repo: repo}, err
	}
	up, err := fetchRun(ctx, repo, tok)
	if up.exhausted {
		if wait := up.resetAt.Sub(now()); wait > 0 {
			_ = platform.Rdb.Set(ctx, keyLimited+ns, "1", wait+time.Second).Err()
		}
	}
	switch {
	case err != nil:
		log.Printf("[GitHub] runs for %s: %v", repo, err)
		cacheSet(ctx, runsKey, Run{Repo: repo}, ttl)
		return Run{Repo: repo}, nil
	case up.status == http.StatusUnauthorized:
		return Run{Repo: repo}, errUnauthorized
	case up.exhausted && up.status != http.StatusOK:
		return stale(), nil
	}
	cacheSet(ctx, runsKey, up.run, ttl)
	if up.status == http.StatusOK && up.run.Available {
		cacheSet(ctx, lastKey, up.run, lastGoodTTL)
	}
	return up.run, nil
}

// =============================================================================
// Handlers
// =============================================================================

func requireUser(c *fiber.Ctx) (string, bool) {
	sub := platform.GetUserID(c)
	if sub == "" {
		_ = c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
		return "", false
	}
	return sub, true
}

// HandleConnect - GET /github/connect (JWT). Returns the GitHub authorize URL
// for the desktop to open in the system browser.
func HandleConnect(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	if !configured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Status: "error", Error: "GitHub connection is not configured"})
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not start GitHub connection"})
	}
	state := hex.EncodeToString(buf)
	if err := platform.Rdb.Set(context.Background(), keyState+state, sub, stateTTL).Err(); err != nil {
		log.Printf("[GitHub] store state: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not start GitHub connection"})
	}
	q := url.Values{"client_id": {clientID()}, "redirect_uri": {callbackURL()}, "state": {state}}
	return c.JSON(fiber.Map{"url": WebBase + "/login/oauth/authorize?" + q.Encode()})
}

// HandleCallback - GET /github/callback (public). GitHub sends the browser
// here after the user approves; the browser ends on the website's account
// page either way.
func HandleCallback(c *fiber.Ctx) error {
	// Cloned: c.Query aliases fasthttp's pooled buffer.
	code, state := strings.Clone(c.Query("code")), strings.Clone(c.Query("state"))
	fail := func(why string) error {
		log.Printf("[GitHub] callback: %s", why)
		return c.Redirect(frontendURL()+"/account?github=error", fiber.StatusFound)
	}
	if code == "" || state == "" {
		return fail("missing code or state")
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	sub, err := platform.Rdb.GetDel(ctx, keyState+state).Result()
	if err != nil || sub == "" {
		return fail("unknown or expired state")
	}
	tok, err := postToken(ctx, url.Values{"code": {code}, "redirect_uri": {callbackURL()}})
	if err != nil {
		return fail(fmt.Sprintf("code exchange: %v", err))
	}
	login, id, err := fetchUser(ctx, tok.AccessToken)
	if err != nil {
		return fail(err.Error())
	}
	if err := saveTokens(ctx, sub, login, id, tok); err != nil {
		return fail(err.Error())
	}
	forgetUser(ctx, sub)
	return c.Redirect(frontendURL()+"/account?github=connected", fiber.StatusFound)
}

// StatusResponse is GET /github/status.
type StatusResponse struct {
	Connected bool   `json:"connected"`
	Login     string `json:"login,omitempty"`
	Since     string `json:"since,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// HandleStatus - GET /github/status (JWT).
func HandleStatus(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	var out StatusResponse
	var status string
	var created time.Time
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT github_login, status, created_at FROM github_connections WHERE logto_sub = $1`, sub).
		Scan(&out.Login, &status, &created)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return c.JSON(out)
	case err != nil:
		log.Printf("[GitHub] status: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not read GitHub connection"})
	}
	out.Since = created.UTC().Format(time.RFC3339)
	out.Connected = status == "ok"
	if !out.Connected {
		out.Reason = brokenReason
	}
	return c.JSON(out)
}

// HandleDisconnect - DELETE /github/connection (JWT).
func HandleDisconnect(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	if err := Forget(ctx, sub); err != nil {
		log.Printf("[GitHub] disconnect: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not disconnect GitHub"})
	}
	return c.JSON(StatusResponse{})
}

// RevokeGrant revokes the account's grant at GitHub, best effort. The GDPR
// purge calls it before deleting the row inside its transaction.
func RevokeGrant(ctx context.Context, sub string) {
	conn, err := loadConnection(ctx, sub)
	if err != nil || conn == nil {
		return
	}
	revokeGrant(ctx, conn.AccessToken)
}

// Forget revokes the grant (best effort), deletes the row and drops the
// cached answers.
func Forget(ctx context.Context, sub string) error {
	RevokeGrant(ctx, sub)
	if _, err := platform.DBPool.Exec(ctx, `DELETE FROM github_connections WHERE logto_sub = $1`, sub); err != nil {
		return fmt.Errorf("delete connection: %w", err)
	}
	ForgetCache(ctx, sub)
	return nil
}

// ForgetCache drops one account's cached runs (private repos' commit
// messages included).
func ForgetCache(ctx context.Context, sub string) { forgetUser(ctx, sub) }

// RunsResponse is GET /github/runs.
type RunsResponse struct {
	// Connected: answered with the user's own token.
	Connected bool `json:"connected"`
	// Connect: show the Connect (or Reconnect) GitHub button.
	Connect bool   `json:"connect,omitempty"`
	Login   string `json:"login,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Runs    []Run  `json:"runs"`
}

var repoRE = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

// HandleRuns - GET /github/runs?repos=owner/a,owner/b (JWT).
//
// Always 200: an unconnected account still gets its public repos through
// the shared fallback, with connect:true so the widget offers the button.
func HandleRuns(c *fiber.Ctx) error {
	sub, ok := requireUser(c)
	if !ok {
		return nil
	}
	var repos []string
	for _, r := range strings.Split(strings.Clone(c.Query("repos")), ",") {
		r = strings.TrimSpace(r)
		if r == "" {
			continue
		}
		if !repoRE.MatchString(r) || strings.Contains(r, "..") {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "repos must be owner/repo"})
		}
		repos = append(repos, r)
	}
	if len(repos) > maxRepos {
		repos = repos[:maxRepos]
	}

	ctx, cancel := context.WithTimeout(context.Background(), requestBudget)
	defer cancel()
	out := RunsResponse{Runs: make([]Run, 0, len(repos))}

	conn, err := loadConnection(ctx, sub)
	if err != nil {
		log.Printf("[GitHub] runs: %v", err)
	}
	switch {
	case conn == nil:
		out.Connect = true
	case conn.Status != "ok":
		out.Connect, out.Reason = true, brokenReason
	default:
		runs, broken := userRuns(ctx, conn, repos)
		if !broken {
			out.Connected, out.Login, out.Runs = true, conn.Login, runs
			return c.JSON(out)
		}
		out.Connect, out.Reason = true, brokenReason
	}

	for _, repo := range repos {
		r, _ := answer(ctx, nsPublic, repo, publicRunsTTL, func() (string, error) { return "", nil })
		out.Runs = append(out.Runs, r)
	}
	return c.JSON(out)
}

// userRuns answers with the user's token, refreshing it when it is within
// refreshSkew of expiry or GitHub says 401. broken reports that GitHub
// refused both the token and the refresh; the connection is marked so.
func userRuns(ctx context.Context, conn *connection, repos []string) (runs []Run, broken bool) {
	// One refresh per request at most. refreshErr keeps a transient failure
	// (GitHub unreachable) from being mistaken for a refused token.
	refreshed := false
	var refreshErr error
	refresh := func() error {
		if refreshed {
			if refreshErr != nil {
				return refreshErr
			}
			return errUnauthorized // a fresh token was refused too
		}
		refreshed = true
		if conn.RefreshToken == "" {
			refreshErr = errRefreshRefused
			return refreshErr
		}
		t, err := postToken(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {conn.RefreshToken}})
		if err == nil {
			err = saveTokens(ctx, conn.Sub, "", 0, t)
		}
		if err != nil {
			refreshErr = err
			return err
		}
		conn.AccessToken, conn.RefreshToken, conn.ExpiresAt = t.AccessToken, t.RefreshToken, nil
		if t.ExpiresIn > 0 {
			v := now().Add(time.Duration(t.ExpiresIn) * time.Second)
			conn.ExpiresAt = &v
		}
		return nil
	}
	token := func() (string, error) {
		if conn.ExpiresAt != nil && conn.ExpiresAt.Sub(now()) < refreshSkew {
			if err := refresh(); err != nil {
				return "", err
			}
		}
		return conn.AccessToken, nil
	}

	ns := userNS(conn.Sub)
	ok := false
	for _, repo := range repos {
		r, err := answer(ctx, ns, repo, userRunsTTL, token)
		if errors.Is(err, errUnauthorized) {
			if rerr := refresh(); rerr == nil {
				r, err = answer(ctx, ns, repo, userRunsTTL, token)
			} else {
				err = rerr
			}
		}
		if errors.Is(err, errUnauthorized) || errors.Is(err, errRefreshRefused) {
			markBroken(ctx, conn.Sub, err.Error())
			return nil, true
		}
		if err != nil {
			log.Printf("[GitHub] runs: %v", err)
		}
		ok = ok || r.Available
		runs = append(runs, r)
	}
	if ok {
		markOK(ctx, conn.Sub)
	}
	return runs, false
}

// =============================================================================
// Health (the Yahoo lesson, SCROLLR-196: an upstream 403 must not sit silent)
// =============================================================================

// ReadHealth counts connections and when GitHub last answered any of them.
func ReadHealth(ctx context.Context) (platform.GitHubHealth, error) {
	var h platform.GitHubHealth
	if platform.DBPool == nil {
		return h, errors.New("github health: no database")
	}
	var last *time.Time
	err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status <> 'ok'), max(last_ok_at)
		  FROM github_connections`).Scan(&h.Connections, &h.Broken, &last)
	if err != nil {
		return platform.GitHubHealth{}, fmt.Errorf("github health: %w", err)
	}
	if last != nil {
		h.LastOK = last.UTC().Format(time.RFC3339)
	}
	return h, nil
}
