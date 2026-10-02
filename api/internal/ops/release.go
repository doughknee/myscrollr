// Package ops holds the one-button pages people outside engineering press to
// finish something that stalled (SCROLLR-305).
//
// GET /ops/release?key=… serves a page with one green "I did it" button. The
// button dispatches .github/workflows/finish-release.yml, which re-runs the
// failed desktop build jobs, publishes the draft and fires the publish-time
// workflows. The page then polls the run and says where it is.
//
// The key in the URL is the only auth. A wrong or missing key falls through
// to Fiber's own 404, so the routes look like they do not exist. The key and
// GITHUB_OPS_TOKEN never reach a log line or a Sentry event (the scrubber
// drops query strings; see platform.ScrubSentryEvent).
package ops

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Configuration
// =============================================================================

// GitHubRepoAPI is the repo the workflow lives in. A var so tests can point
// it at an httptest server.
var GitHubRepoAPI = "https://api.github.com/repos/doughknee/myscrollr"

const (
	workflowFile   = "finish-release.yml"
	defaultTag     = "desktop-v1.7.0"
	finishLockKey  = "ops:release:finish"
	finishLockTTL  = time.Minute
	githubTimeout  = 10 * time.Second
	runsToSearch   = 20
	runTitlePrefix = "Finish " // finish-release.yml's run-name is "Finish <tag>"
)

var githubClient = &http.Client{Timeout: githubTimeout}

func releaseTag() string {
	if tag := os.Getenv("OPS_RELEASE_TAG"); tag != "" {
		return tag
	}
	return defaultTag
}

// keyOK reports whether the request carries OPS_RELEASE_KEY. An unset key
// disables the page entirely.
func keyOK(c *fiber.Ctx) bool {
	want := os.Getenv("OPS_RELEASE_KEY")
	return want != "" && subtle.ConstantTimeCompare([]byte(c.Query("key")), []byte(want)) == 1
}

// =============================================================================
// GitHub
// =============================================================================

// github calls the repo API. Errors carry the method, path and status only:
// the token is a header and never part of either.
func github(ctx context.Context, method, path string, body, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, GitHubRepoAPI+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("GITHUB_OPS_TOKEN"))
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Content-Type", "application/json")
	resp, err := githubClient.Do(req)
	if err != nil {
		return fmt.Errorf("github %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("github %s %s: status %d", method, path, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("github %s %s: decode: %w", method, path, err)
		}
	}
	return nil
}

type workflowRun struct {
	ID           int64     `json:"id"`
	DisplayTitle string    `json:"display_title"`
	Status       string    `json:"status"`
	Conclusion   string    `json:"conclusion"`
	HTMLURL      string    `json:"html_url"`
	CreatedAt    time.Time `json:"created_at"`
}

// latestRun returns the newest finish-release run for tag, or nil. Runs are
// matched on their run-name, so a run for an earlier release (or one started
// before the run-name existed) never reads as this one's.
func latestRun(ctx context.Context, tag string) (*workflowRun, error) {
	var page struct {
		WorkflowRuns []workflowRun `json:"workflow_runs"`
	}
	path := fmt.Sprintf("/actions/workflows/%s/runs?per_page=%d", workflowFile, runsToSearch)
	if err := github(ctx, http.MethodGet, path, nil, &page); err != nil {
		return nil, err
	}
	for i := range page.WorkflowRuns {
		if page.WorkflowRuns[i].DisplayTitle == runTitlePrefix+tag {
			return &page.WorkflowRuns[i], nil
		}
	}
	return nil, nil
}

// currentStep returns the name of the step the run is on, or "".
func currentStep(ctx context.Context, runID int64) (string, error) {
	var jobs struct {
		Jobs []struct {
			Steps []struct {
				Name   string `json:"name"`
				Status string `json:"status"`
			} `json:"steps"`
		} `json:"jobs"`
	}
	if err := github(ctx, http.MethodGet, fmt.Sprintf("/actions/runs/%d/jobs", runID), nil, &jobs); err != nil {
		return "", err
	}
	for _, j := range jobs.Jobs {
		for _, s := range j.Steps {
			if s.Status == "in_progress" {
				return s.Name, nil
			}
		}
	}
	return "", nil
}

// stepLabel maps finish-release.yml's step names to the line under the
// button. Rename a step there, rename it here.
func stepLabel(step string) string {
	switch step {
	case "Re-run the failed jobs and wait":
		return "Rebuilding macOS…"
	case "Check the draft has every platform", "Publish the release":
		return "Publishing…"
	case "Fire the publish-time workflows":
		return "Announcing…"
	default:
		return "Starting…"
	}
}

// =============================================================================
// Handlers
// =============================================================================

// HandleReleasePage serves the page.
func HandleReleasePage(c *fiber.Ctx) error {
	if !keyOK(c) {
		return c.Next()
	}
	// The page's own script and styles, nothing else; and no Referer, so the
	// key in this URL never follows the run link to github.com.
	c.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("Cache-Control", "no-store")
	c.Type("html", "utf-8")
	version := strings.TrimPrefix(releaseTag(), "desktop-v")
	return c.SendString(strings.ReplaceAll(releasePage, "{{VERSION}}", version))
}

type statusResponse struct {
	Status     string    `json:"status"` // "none" when no run exists for the tag yet
	Conclusion string    `json:"conclusion"`
	URL        string    `json:"url"`
	Step       string    `json:"step"`
	Label      string    `json:"label"`
	CreatedAt  time.Time `json:"created_at"`
}

// HandleReleaseStatus reports the newest run for the release tag.
func HandleReleaseStatus(c *fiber.Ctx) error {
	if !keyOK(c) {
		return c.Next()
	}
	c.Set("Cache-Control", "no-store")
	ctx := c.UserContext()
	run, err := latestRun(ctx, releaseTag())
	if err != nil {
		log.Printf("[Ops] release status: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{Status: "error", Error: "GitHub did not answer"})
	}
	if run == nil {
		return c.JSON(statusResponse{Status: "none"})
	}
	out := statusResponse{Status: run.Status, Conclusion: run.Conclusion, URL: run.HTMLURL, CreatedAt: run.CreatedAt}
	if run.Status != "completed" {
		if out.Step, err = currentStep(ctx, run.ID); err != nil {
			log.Printf("[Ops] release step: %v", err)
		}
		out.Label = stepLabel(out.Step)
	}
	return c.JSON(out)
}

// HandleReleaseFinish dispatches finish-release.yml for the release tag: 409
// while a run for it is still going, 429 within a minute of the last press.
func HandleReleaseFinish(c *fiber.Ctx) error {
	if !keyOK(c) {
		return c.Next()
	}
	if os.Getenv("GITHUB_OPS_TOKEN") == "" {
		log.Println("[Ops] GITHUB_OPS_TOKEN not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Not configured"})
	}
	ctx := c.UserContext()
	tag := releaseTag()

	run, err := latestRun(ctx, tag)
	if err != nil {
		log.Printf("[Ops] release finish: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{Status: "error", Error: "GitHub did not answer"})
	}
	if run != nil && run.Status != "completed" {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Status: "error", Error: "Already running"})
	}

	// One press a minute across replicas. This also covers the seconds
	// between a dispatch and its run showing up in the list above. Redis
	// down: let the press through; the 409 above still guards most of it.
	if platform.Rdb != nil {
		ok, err := platform.Rdb.SetNX(ctx, finishLockKey, "1", finishLockTTL).Result()
		if err != nil {
			log.Printf("[Ops] release finish lock: %v", err)
		} else if !ok {
			return c.Status(fiber.StatusTooManyRequests).JSON(platform.ErrorResponse{Status: "error", Error: "Pressed less than a minute ago"})
		}
	}

	// The page ignores runs created before this, so the previous run's
	// result does not flash up while GitHub queues the new one. The slack
	// absorbs clock skew against GitHub's created_at.
	since := time.Now().UTC().Add(-10 * time.Second)
	body := map[string]any{"ref": "main", "inputs": map[string]string{"tag": tag}}
	if err := github(ctx, http.MethodPost, "/actions/workflows/"+workflowFile+"/dispatches", body, nil); err != nil {
		log.Printf("[Ops] release dispatch: %v", err)
		if platform.Rdb != nil {
			platform.Rdb.Del(ctx, finishLockKey)
		}
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{Status: "error", Error: "GitHub refused the dispatch"})
	}
	log.Printf("[Ops] dispatched %s for %s", workflowFile, tag)
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"status": "dispatched", "since": since})
}
