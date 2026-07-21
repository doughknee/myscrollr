package main

import (
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
)

// TestScrubSentryEventRemovesPII asserts the scrubber strips every category
// of sensitive data the privacy spec requires. If this test fails, the
// Sentry integration is leaking PII and must NOT be deployed.
//
// See docs/superpowers/plans/2026-05-12-sentry-rollout.md for invariants.
func TestScrubSentryEventRemovesPII(t *testing.T) {
	event := &sentry.Event{
		Request: &sentry.Request{
			Cookies:     "session=abc; AUTH_TOKEN=very-secret",
			QueryString: "code=yahoo-oauth-code&state=csrf123",
			Data:        `{"refresh_token":"REPLACE_ME","access_token":"REPLACE_ME"}`,
			Headers: map[string]string{
				"Authorization":   "Bearer leaking-token",
				"Cookie":          "session=abc",
				"X-Yahoo-Token":   "another-leak",
				"User-Agent":      "ScrollrTest/1.0",
				"Content-Type":    "application/json",
				"X-Request-Id":    "req-123",
				"X-Forwarded-For": "203.0.113.5",
				"X-Real-Ip":       "203.0.113.5",
			},
			Env: map[string]string{
				"REMOTE_ADDR": "203.0.113.5",
				"SERVER_NAME": "fantasy-api",
			},
		},
		User: sentry.User{
			IPAddress: "203.0.113.5",
			Email:     "victim@example.com",
			Username:  "victim",
		},
	}

	scrubSentryEvent(event)

	// --- Request scrubbing ---
	if event.Request.Cookies != "" {
		t.Errorf("Cookies not scrubbed: %q", event.Request.Cookies)
	}
	if event.Request.QueryString != "" {
		t.Errorf("QueryString not scrubbed (Logto code/state leak risk): %q", event.Request.QueryString)
	}
	if event.Request.Data != "" {
		t.Errorf("Data not scrubbed (request body leak risk): %q", event.Request.Data)
	}
	if event.Request.Env != nil {
		t.Errorf("Env not cleared (server-side leak risk): %+v", event.Request.Env)
	}

	// --- Header allow-list enforcement ---
	allowed := map[string]bool{"user-agent": true, "content-type": true, "x-request-id": true}
	for k, v := range event.Request.Headers {
		if !allowed[strings.ToLower(k)] {
			t.Errorf("Forbidden header survived scrubbing: %q=%q", k, v)
		}
	}
	if event.Request.Headers["User-Agent"] != "ScrollrTest/1.0" {
		t.Errorf("Safe header User-Agent was unexpectedly dropped: got headers=%v", event.Request.Headers)
	}

	// --- User scrubbing ---
	if event.User.IPAddress != "" {
		t.Errorf("IP address not scrubbed: %q", event.User.IPAddress)
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
// salt isn't configured (so we never accidentally attach an UNSALTED hash,
// which would be a recoverable identifier).
func TestHashUserSubIsDeterministic(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "test-salt-do-not-rotate")

	a := hashUserSub("usr_abc123")
	b := hashUserSub("usr_abc123")
	if a != b {
		t.Errorf("hashUserSub not deterministic: %q vs %q", a, b)
	}
	if len(a) != 16 {
		// 8 bytes hex-encoded = 16 chars
		t.Errorf("hashUserSub length unexpected: %d (want 16). Value=%q", len(a), a)
	}

	c := hashUserSub("usr_xyz789")
	if a == c {
		t.Errorf("hashUserSub collision between different subs: %q == %q", a, c)
	}
}

func TestHashUserSubEmptyWhenUnsalted(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "")
	if got := hashUserSub("usr_abc123"); got != "" {
		t.Errorf("hashUserSub should return empty when salt is unset, got %q", got)
	}
}

func TestHashUserSubEmptyForEmptySub(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "test-salt")
	if got := hashUserSub(""); got != "" {
		t.Errorf("hashUserSub should return empty for empty sub, got %q", got)
	}
}
