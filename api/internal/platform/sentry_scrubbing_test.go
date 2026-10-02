package platform

import (
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
)

// TestScrubSentryEventRemovesPII asserts the scrubber strips every category
// of sensitive data the privacy spec requires. If this test fails, the
// Sentry integration is leaking PII and must NOT be deployed.
//
// See AGENTS.md "Error Monitoring — Sentry" for invariants.
func TestScrubSentryEventRemovesPII(t *testing.T) {
	scrubWorstCase(t, "https://api.myscrollr.com/ops/release?key=ops-release-key", "code=logto-auth-code&state=csrf123")
}

// TestScrubSentryEventGitHubPaths runs the worst case through the Connect
// GitHub routes (SCROLLR-304): the callback carries GitHub's OAuth code and
// state in its query, and every route a bearer token.
func TestScrubSentryEventGitHubPaths(t *testing.T) {
	for _, path := range []string{
		"/github/connect",
		"/github/callback?code=gh-oauth-code&state=gh-state-secret",
		"/github/runs?repos=victim/private-repo",
	} {
		t.Run(path, func(t *testing.T) {
			query := ""
			if i := strings.Index(path, "?"); i >= 0 {
				query = path[i+1:]
			}
			scrubWorstCase(t, "https://api.myscrollr.com"+path, query)
		})
	}
}

func scrubWorstCase(t *testing.T, url, query string) {
	t.Helper()
	event := &sentry.Event{
		Request: &sentry.Request{
			URL:         url,
			Cookies:     "session=abc; AUTH_TOKEN=very-secret",
			QueryString: query,
			Data:        `{"access_token":"REPLACE_ME","refresh_token":"refresh-leak"}`,
			Headers: map[string]string{
				"Authorization":   "Bearer leaking-token",
				"Cookie":          "session=abc",
				"User-Agent":      "ScrollrTest/1.0",
				"Content-Type":    "application/json",
				"X-Request-Id":    "req-123",
				"X-Forwarded-For": "203.0.113.5",
				"X-Real-Ip":       "203.0.113.5",
			},
			Env: map[string]string{
				"REMOTE_ADDR": "203.0.113.5",
			},
		},
		User: sentry.User{
			IPAddress: "203.0.113.5",
			Email:     "victim@example.com",
			Username:  "victim",
		},
	}

	ScrubSentryEvent(event)

	if event.Request.Cookies != "" {
		t.Errorf("Cookies not scrubbed: %q", event.Request.Cookies)
	}
	if want, _, _ := strings.Cut(url, "?"); event.Request.URL != want {
		t.Errorf("URL query not scrubbed (ops key / OAuth code+state leak risk): %q", event.Request.URL)
	}
	if event.Request.QueryString != "" {
		t.Errorf("QueryString not scrubbed (Logto code/state leak risk): %q", event.Request.QueryString)
	}
	if event.Request.Data != "" {
		t.Errorf("Data not scrubbed: %q", event.Request.Data)
	}
	if event.Request.Env != nil {
		t.Errorf("Env not cleared: %+v", event.Request.Env)
	}

	allowed := map[string]bool{"user-agent": true, "content-type": true, "x-request-id": true}
	for k, v := range event.Request.Headers {
		if !allowed[strings.ToLower(k)] {
			t.Errorf("Forbidden header survived scrubbing: %q=%q", k, v)
		}
	}

	if event.User.IPAddress != "" {
		t.Errorf("IP not scrubbed: %q", event.User.IPAddress)
	}
	if event.User.Email != "" {
		t.Errorf("Email not scrubbed: %q", event.User.Email)
	}
	if event.User.Username != "" {
		t.Errorf("Username not scrubbed: %q", event.User.Username)
	}
}

// TestHashUserSubIsDeterministic confirms the hash is stable across calls
// (Sentry event grouping depends on this) and that it returns "" when the
// salt isn't configured.
func TestHashUserSubIsDeterministic(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "test-salt-do-not-rotate")

	a := HashUserSub("usr_abc123")
	b := HashUserSub("usr_abc123")
	if a != b {
		t.Errorf("HashUserSub not deterministic: %q vs %q", a, b)
	}
	if len(a) != 16 {
		t.Errorf("HashUserSub length unexpected: %d (want 16). Value=%q", len(a), a)
	}

	c := HashUserSub("usr_xyz789")
	if a == c {
		t.Errorf("HashUserSub collision between different subs: %q == %q", a, c)
	}
}

func TestHashUserSubEmptyWhenUnsalted(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "")
	if got := HashUserSub("usr_abc123"); got != "" {
		t.Errorf("HashUserSub should return empty when salt is unset, got %q", got)
	}
}

func TestHashUserSubEmptyForEmptySub(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "test-salt")
	if got := HashUserSub(""); got != "" {
		t.Errorf("HashUserSub should return empty for empty sub, got %q", got)
	}
}
