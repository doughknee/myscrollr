package ops

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

const (
	testKey   = "test-ops-key"
	testToken = "test-gh-token"
)

// fakeGitHub answers the three calls the handlers make. runs is the
// workflow_runs list; dispatches records every dispatch body.
type fakeGitHub struct {
	mu         sync.Mutex
	runs       string
	jobs       string
	dispatches []map[string]any
	auth       []string
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.auth = append(f.auth, r.Header.Get("Authorization"))
	switch {
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/actions/workflows/finish-release.yml/runs"):
		io.WriteString(w, `{"workflow_runs":[`+f.runs+`]}`)
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/jobs"):
		io.WriteString(w, f.jobs)
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/actions/workflows/finish-release.yml/dispatches"):
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		f.dispatches = append(f.dispatches, body)
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

func setup(t *testing.T, gh *fakeGitHub) *fiber.App {
	t.Helper()
	srv := httptest.NewServer(gh)
	t.Cleanup(srv.Close)
	prevAPI := GitHubRepoAPI
	GitHubRepoAPI = srv.URL + "/repos/doughknee/myscrollr"
	t.Cleanup(func() { GitHubRepoAPI = prevAPI })

	mr := miniredis.RunT(t)
	prevRdb := platform.Rdb
	platform.Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { platform.Rdb = prevRdb })

	t.Setenv("OPS_RELEASE_KEY", testKey)
	t.Setenv("GITHUB_OPS_TOKEN", testToken)
	t.Setenv("OPS_RELEASE_TAG", "")

	app := fiber.New()
	app.Get("/ops/release", HandleReleasePage)
	app.Post("/ops/release/finish", HandleReleaseFinish)
	app.Get("/ops/release/status", HandleReleaseStatus)
	return app
}

func do(t *testing.T, app *fiber.App, method, url string) (int, string, http.Header) {
	t.Helper()
	resp, err := app.Test(httptest.NewRequest(method, url, nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), resp.Header
}

func run(title, status, conclusion string) string {
	b, _ := json.Marshal(map[string]any{
		"id": 42, "display_title": title, "status": status, "conclusion": conclusion,
		"html_url": "https://github.com/doughknee/myscrollr/actions/runs/42", "created_at": "2026-10-02T10:00:00Z",
	})
	return string(b)
}

func TestWrongKeyIs404(t *testing.T) {
	gh := &fakeGitHub{}
	app := setup(t, gh)
	for _, url := range []string{"/ops/release", "/ops/release?key=nope", "/ops/release/status?key=", "/ops/release/finish?key=nope"} {
		method := http.MethodGet
		if strings.Contains(url, "finish") {
			method = http.MethodPost
		}
		if code, body, _ := do(t, app, method, url); code != http.StatusNotFound || strings.Contains(body, "I did it") {
			t.Errorf("%s %s: got %d, want 404", method, url, code)
		}
	}
	// An unset key disables the page, even for an empty ?key=.
	t.Setenv("OPS_RELEASE_KEY", "")
	if code, _, _ := do(t, app, http.MethodGet, "/ops/release?key="); code != http.StatusNotFound {
		t.Errorf("unset key: got %d, want 404", code)
	}
	if len(gh.auth) != 0 {
		t.Errorf("wrong key reached GitHub %d times", len(gh.auth))
	}
}

func TestPageWithKey(t *testing.T) {
	app := setup(t, &fakeGitHub{})
	code, body, h := do(t, app, http.MethodGet, "/ops/release?key="+testKey)
	if code != http.StatusOK {
		t.Fatalf("got %d", code)
	}
	for _, want := range []string{"Scrollr 1.7.0", "I did it", "Done — 1.7.0 is out."} {
		if !strings.Contains(body, want) {
			t.Errorf("page missing %q", want)
		}
	}
	if strings.Contains(body, testKey) {
		t.Error("page embeds the key")
	}
	if h.Get("Referrer-Policy") != "no-referrer" || !strings.Contains(h.Get("Content-Security-Policy"), "script-src 'unsafe-inline'") {
		t.Errorf("headers: %v", h)
	}
}

func TestFinishDispatchesThenRateLimits(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(io.Discard) })

	// The dry run's failed run, plus a still-running run for an older tag
	// that must not count as this release's.
	gh := &fakeGitHub{runs: run("Finish desktop-v1.6.10", "in_progress", "") + "," + run("Finish desktop-v1.7.0", "completed", "failure")}
	app := setup(t, gh)

	code, body, _ := do(t, app, http.MethodPost, "/ops/release/finish?key="+testKey)
	if code != http.StatusAccepted {
		t.Fatalf("got %d %s", code, body)
	}
	if len(gh.dispatches) != 1 {
		t.Fatalf("dispatches = %d", len(gh.dispatches))
	}
	d := gh.dispatches[0]
	if d["ref"] != "main" || d["inputs"].(map[string]any)["tag"] != "desktop-v1.7.0" {
		t.Errorf("dispatch body = %v", d)
	}
	for _, a := range gh.auth {
		if a != "Bearer "+testToken {
			t.Errorf("Authorization = %q", a)
		}
	}

	if code, _, _ := do(t, app, http.MethodPost, "/ops/release/finish?key="+testKey); code != http.StatusTooManyRequests {
		t.Errorf("second press: got %d, want 429", code)
	}
	if len(gh.dispatches) != 1 {
		t.Errorf("second press dispatched")
	}
	if s := logs.String(); !strings.Contains(s, "dispatched finish-release.yml for desktop-v1.7.0") || strings.Contains(s, testKey) || strings.Contains(s, testToken) {
		t.Errorf("log = %q", s)
	}
}

func TestFinishWhileRunningIs409(t *testing.T) {
	gh := &fakeGitHub{runs: run("Finish desktop-v1.7.0", "in_progress", "")}
	app := setup(t, gh)
	if code, _, _ := do(t, app, http.MethodPost, "/ops/release/finish?key="+testKey); code != http.StatusConflict {
		t.Errorf("got %d, want 409", code)
	}
	if len(gh.dispatches) != 0 {
		t.Error("dispatched while a run was in progress")
	}
}

func TestStatus(t *testing.T) {
	gh := &fakeGitHub{
		runs: run("Finish Desktop Release", "completed", "failure") + "," + run("Finish desktop-v1.7.0", "in_progress", ""),
		jobs: `{"jobs":[{"steps":[{"name":"Set up job","status":"completed"},{"name":"Re-run the failed jobs and wait","status":"in_progress"},{"name":"Publish the release","status":"queued"}]}]}`,
	}
	app := setup(t, gh)
	code, body, _ := do(t, app, http.MethodGet, "/ops/release/status?key="+testKey)
	var s statusResponse
	json.Unmarshal([]byte(body), &s)
	if code != http.StatusOK || s.Status != "in_progress" || s.Step != "Re-run the failed jobs and wait" || s.Label != "Rebuilding macOS…" || s.URL == "" {
		t.Errorf("got %d %s", code, body)
	}

	gh.runs = run("Finish desktop-v1.6.10", "completed", "success")
	_, body, _ = do(t, app, http.MethodGet, "/ops/release/status?key="+testKey)
	if !strings.Contains(body, `"status":"none"`) {
		t.Errorf("another tag's run leaked into this release's status: %s", body)
	}
}

func TestStepLabel(t *testing.T) {
	for step, want := range map[string]string{
		"":                                   "Starting…",
		"Set up job":                         "Starting…",
		"Find the build run":                 "Starting…",
		"Re-run the failed jobs and wait":    "Rebuilding macOS…",
		"Check the draft has every platform": "Publishing…",
		"Publish the release":                "Publishing…",
		"Fire the publish-time workflows":    "Announcing…",
	} {
		if got := stepLabel(step); got != want {
			t.Errorf("stepLabel(%q) = %q, want %q", step, got, want)
		}
	}
}

// TestStepNamesMatchWorkflow fails when a step stepLabel maps is renamed in
// finish-release.yml, or the run-name the status lookup matches on changes.
func TestStepNamesMatchWorkflow(t *testing.T) {
	b, err := os.ReadFile("../../../.github/workflows/finish-release.yml")
	if err != nil {
		t.Fatal(err)
	}
	wf := string(b)
	for _, step := range []string{"Find the build run", "Re-run the failed jobs and wait", "Check the draft has every platform", "Publish the release", "Fire the publish-time workflows"} {
		if !strings.Contains(wf, "- name: "+step) {
			t.Errorf("finish-release.yml has no step %q", step)
		}
	}
	if !strings.Contains(wf, "run-name: "+runTitlePrefix+"${{ inputs.tag }}") {
		t.Errorf("finish-release.yml run-name is not %q", runTitlePrefix+"${{ inputs.tag }}")
	}
}
