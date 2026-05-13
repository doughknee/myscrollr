package main

import (
	"crypto/sha256"
	"encoding/hex"
	"log"
	"os"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	sentryfiber "github.com/getsentry/sentry-go/fiber"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Sentry helpers — duplicated per channel (channels are independent modules
// per AGENTS.md; do NOT extract a shared library).
//
// Privacy invariants (see docs/superpowers/plans/2026-05-12-sentry-rollout.md):
//   - No IPs, cookies, query strings, request bodies, or arbitrary headers
//   - User IDs are an 8-byte hex hash of (sub + SENTRY_USER_SALT)
//   - Only User-Agent, Content-Type, X-Request-Id headers are preserved
// =============================================================================

const sentryServiceTag = "scrollr-fantasy-api"

// initSentry boots the Sentry SDK. Returns true when init succeeded so the
// caller can decide whether to register middleware.
func initSentry() bool {
	dsn := os.Getenv("SENTRY_DSN")
	if dsn == "" {
		return false
	}
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              dsn,
		Environment:      envOr("ENVIRONMENT", "development"),
		Release:          envOr("GIT_SHA", "unknown"),
		EnableTracing:    true,
		TracesSampleRate: 0.1,
		AttachStacktrace: true,
		SendDefaultPII:   false,
		BeforeSend: func(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
			scrubSentryEvent(event)
			return event
		},
	})
	if err != nil {
		log.Printf("[Sentry] init failed: %v", err)
		return false
	}
	sentry.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetTag("service", sentryServiceTag)
	})
	log.Printf("[Sentry] initialized for service=%s environment=%s", sentryServiceTag, envOr("ENVIRONMENT", "development"))
	return true
}

// sentryMiddleware returns the sentryfiber middleware. Repanic=true so
// Fiber's own recover() still runs and the client still gets a response.
func sentryMiddleware() fiber.Handler {
	return sentryfiber.New(sentryfiber.Options{
		Repanic:         true,
		WaitForDelivery: false,
		Timeout:         2 * time.Second,
	})
}

// sentryUserHook reads X-User-Sub (set by the core gateway after JWT
// validation) and attaches an irreversibly-hashed anonymous user ID to
// the Sentry hub for the current request. No-op when SENTRY_USER_SALT
// is unset.
func sentryUserHook() fiber.Handler {
	return func(c *fiber.Ctx) error {
		sub := c.Get("X-User-Sub")
		if sub != "" {
			if hub := sentryfiber.GetHubFromContext(c); hub != nil {
				if hashed := hashUserSub(sub); hashed != "" {
					hub.Scope().SetUser(sentry.User{ID: hashed})
				}
			}
		}
		return c.Next()
	}
}

// scrubSentryEvent removes PII and sensitive fields. Called from BeforeSend.
func scrubSentryEvent(event *sentry.Event) {
	if event.Request != nil {
		event.Request.Cookies = ""
		event.Request.Data = ""
		event.Request.QueryString = ""
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

// hashUserSub deterministically hashes a Logto subject to a short anonymous
// ID. Returns "" when SENTRY_USER_SALT isn't configured.
func hashUserSub(sub string) string {
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

// envOr returns the env value or fallback when unset.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
