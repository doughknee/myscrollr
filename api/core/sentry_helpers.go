package core

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"strings"

	"github.com/getsentry/sentry-go"
)

// =============================================================================
// Sentry helpers
//
// Privacy invariants (see docs/superpowers/plans/2026-05-12-sentry-rollout.md):
//   - No IPs, no cookies, no query strings, no request bodies
//   - No user emails, no usernames
//   - User IDs (if any) are an 8-byte hex hash of (logto_sub + SENTRY_USER_SALT)
//   - Only User-Agent, Content-Type, X-Request-Id headers are preserved
// =============================================================================

// HashUserSub deterministically hashes a Logto subject to a short anonymous ID
// suitable for attaching to Sentry events. Returns "" when SENTRY_USER_SALT
// isn't configured, in which case no user ID should be attached.
//
// The salt MUST NOT rotate after the first event is sent — all historical
// events would un-cluster.
func HashUserSub(sub string) string {
	if sub == "" {
		return ""
	}
	salt := os.Getenv("SENTRY_USER_SALT")
	if salt == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(sub + salt))
	return hex.EncodeToString(sum[:8])
}

// ScrubSentryEvent removes PII and sensitive fields from a Sentry event.
// Designed to be called from a sentry.BeforeSend hook.
func ScrubSentryEvent(event *sentry.Event) {
	if event.Request != nil {
		event.Request.Cookies = ""
		event.Request.Data = ""
		event.Request.QueryString = ""
		// Keep only an explicit allow-list of safe headers. Anything else
		// (Authorization, Cookie, custom auth headers) could leak secrets.
		safe := map[string]string{}
		for k, v := range event.Request.Headers {
			switch strings.ToLower(k) {
			case "user-agent", "content-type", "x-request-id":
				safe[k] = v
			}
		}
		event.Request.Headers = safe
		event.Request.Env = nil
	}
	if event.User.IPAddress != "" {
		event.User.IPAddress = ""
	}
	event.User.Email = ""
	event.User.Username = ""
}
