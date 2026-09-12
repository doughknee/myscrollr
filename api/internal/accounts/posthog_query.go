package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// =============================================================================
// PostHog — read side (HogQL) for the staff dashboard (SCROLLR-210)
// =============================================================================
//
// Capture (posthog_analytics.go) sends events with the project key. Reading
// them back needs a personal API key with query scope, kept separate from
// the deletion key so neither is wider than its one job:
// POSTHOG_QUERY_API_KEY. When it is unset the website figures report
// themselves unavailable rather than guessing.

var (
	errPostHogQueryNotConfigured = errors.New("POSTHOG_QUERY_API_KEY, POSTHOG_PROJECT_ID and an https POSTHOG_API_HOST are required")
	postHogQueryHTTP             = &http.Client{Timeout: 25 * time.Second}
)

// PostHogQueryConfigured reports whether a HogQL read is possible.
func PostHogQueryConfigured() bool {
	return os.Getenv("POSTHOG_QUERY_API_KEY") != "" && os.Getenv("POSTHOG_PROJECT_ID") != "" &&
		strings.HasPrefix(os.Getenv("POSTHOG_API_HOST"), "https://")
}

// PostHogQuery runs one HogQL query and returns the result rows. Every value
// comes back as decoded JSON (float64 for numbers, string, nil).
func PostHogQuery(ctx context.Context, query string) ([][]any, error) {
	if !PostHogQueryConfigured() {
		return nil, errPostHogQueryNotConfigured
	}
	body, err := json.Marshal(map[string]any{
		"query": map[string]any{"kind": "HogQLQuery", "query": query},
	})
	if err != nil {
		return nil, err
	}
	url := strings.TrimRight(os.Getenv("POSTHOG_API_HOST"), "/") + "/api/projects/" + os.Getenv("POSTHOG_PROJECT_ID") + "/query"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+os.Getenv("POSTHOG_QUERY_API_KEY"))
	resp, err := postHogQueryHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The body can carry the query text back; never log it, the status
		// is enough to act on (401/403 = key scope, 429 = rate limit).
		return nil, fmt.Errorf("PostHog query returned status %d", resp.StatusCode)
	}
	var out struct {
		Results [][]any `json:"results"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode PostHog query: %w", err)
	}
	return out.Results, nil
}

// HogQLTime formats an instant for a HogQL comparison, always UTC.
func HogQLTime(t time.Time) string {
	return "toDateTime('" + t.UTC().Format("2006-01-02 15:04:05") + "', 'UTC')"
}
