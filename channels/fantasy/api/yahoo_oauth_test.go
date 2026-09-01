package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
)

// OAuth callback tests.
//
// The connect flow had no coverage at all before this file: the twelve
// tests in yahoo_test.go are serialisation helpers. Everything between
// "user clicks Connect" and "the account is linked" was unexercised,
// which is where the reported flakiness lives.
//
// These skip without TEST_REDIS_URL, the same way the schema contract
// test skips without TEST_DATABASE_URL. YahooCallback consumes its CSRF
// state through Redis GETDEL, and faking that would mean faking the
// replay protection — which is one of the things worth testing.

const testTimeoutMs = 10_000

// newOAuthTestApp builds an App wired to mock Yahoo servers.
//
// Both endpoints are already env-overridable in production code
// (YAHOO_TOKEN_URL, YAHOO_API_BASE_URL), so nothing here exists purely
// for the benefit of tests.
func newOAuthTestApp(t *testing.T, tokenSrv, apiSrv *httptest.Server) (*App, *fiber.App) {
	t.Helper()

	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL not set — skipping OAuth callback test")
	}
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse TEST_REDIS_URL: %v", err)
	}
	rdb := redis.NewClient(opt)
	if err := rdb.Ping(context.Background()).Err(); err != nil {
		t.Skipf("Redis unreachable at TEST_REDIS_URL: %v", err)
	}
	t.Cleanup(func() { _ = rdb.Close() })

	if apiSrv != nil {
		t.Setenv("YAHOO_API_BASE_URL", apiSrv.URL)
	}

	app := &App{
		rdb: rdb,
		yahooConfig: &oauth2.Config{
			ClientID:     "test-client",
			ClientSecret: "test-secret",
			Endpoint: oauth2.Endpoint{
				AuthURL:   "https://example.invalid/authorize",
				TokenURL:  tokenSrv.URL,
				AuthStyle: oauth2.AuthStyleInHeader,
			},
			RedirectURL: "https://api.example.invalid/yahoo/callback",
		},
	}

	fiberApp := fiber.New()
	fiberApp.Get("/yahoo/callback", app.YahooCallback)
	return app, fiberApp
}

// seedState primes the two Redis keys that /yahoo/start would have
// written before redirecting the user to Yahoo.
func seedState(t *testing.T, app *App, state, logtoSub string) {
	t.Helper()
	ctx := context.Background()
	if err := app.rdb.Set(ctx, RedisCSRFPrefix+state, "1", time.Minute).Err(); err != nil {
		t.Fatalf("seed csrf: %v", err)
	}
	if logtoSub != "" {
		if err := app.rdb.Set(ctx, RedisYahooStateLogtoPrefix+state, logtoSub, time.Minute).Err(); err != nil {
			t.Fatalf("seed logto_sub: %v", err)
		}
	}
	t.Cleanup(func() {
		app.rdb.Del(ctx, RedisCSRFPrefix+state, RedisYahooStateLogtoPrefix+state)
	})
}

// tokenServer returns a mock Yahoo token endpoint. When refresh is empty
// the response omits refresh_token entirely, which is what Yahoo does
// when the user has already granted consent and is only re-authenticating.
func tokenServer(t *testing.T, refresh string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{
			"access_token": "test-access-token",
			"token_type":   "bearer",
			"expires_in":   3600,
		}
		if refresh != "" {
			body["refresh_token"] = refresh
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(body)
	}))
}

// yahooUserServer is a stand-in for Yahoo's users;use_login=1 endpoint,
// counting how many times a link was attempted.
//
// It answers XML, because the handler parses with xml.Unmarshal — a JSON
// body would fail one step earlier and the test would pass for the wrong
// reason. The users element is empty on purpose: fetchAndLinkYahooUser
// then bails with "no Yahoo user found" BEFORE it reaches a.db, which is
// what lets these tests run without a database. Linking has still been
// ATTEMPTED by that point, which is the thing being counted.
func yahooUserServer(calls *int32, inspect func(*http.Request)) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(calls, 1)
		if inspect != nil {
			inspect(r)
		}
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `<?xml version="1.0"?><fantasy_content><users/></fantasy_content>`)
	}))
}

// TestYahooCallbackWithoutRefreshTokenStillLinks covers the bug this
// file was written to pin down, now fixed.
//
// Yahoo issues a refresh token on FIRST consent. On a reconnect the user
// re-authenticates — /yahoo/start sends prompt=login, a fresh login but
// not fresh consent — so the token response can carry an access token
// and no refresh token.
//
// The handler used to gate ALL linking on `token.RefreshToken != ""`
// and serve the success page either way: the browser said
// "Authentication successful", nothing was written, and the desktop app
// polled a row that did not exist until its five-minute timeout blamed
// Yahoo. Shape: worked the first time, silently failed forever after.
//
// It now links regardless, reusing the refresh token already stored for
// that Yahoo account. This test asserts the link is ATTEMPTED — the
// exact assertion that was inverted before the fix.
func TestYahooCallbackWithoutRefreshTokenStillLinks(t *testing.T) {
	var linkAttempts int32
	apiSrv := yahooUserServer(&linkAttempts, nil)
	defer apiSrv.Close()

	tokenSrv := tokenServer(t, "") // no refresh_token in the response
	defer tokenSrv.Close()

	app, fiberApp := newOAuthTestApp(t, tokenSrv, apiSrv)
	const state = "state-no-refresh-token"
	seedState(t, app, state, "logto|user-123")

	resp, err := fiberApp.Test(
		httptest.NewRequest("GET", "/yahoo/callback?state="+state+"&code=abc123", nil),
		testTimeoutMs,
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	// The assertion that was inverted before the fix: linking is now
	// attempted rather than skipped.
	if n := atomic.LoadInt32(&linkAttempts); n == 0 {
		t.Error("no link attempted without a refresh token — the original bug is back")
	}
}

// TestYahooCallbackWithoutRefreshTokenDoesNotClaimSuccess is the other
// half of the same fix.
//
// The stub Yahoo endpoint returns no user, so the link fails. What
// matters is that the failure REACHES THE USER. Previously any response
// without a refresh token produced a 200 and "Authentication
// successful" no matter what happened underneath, which is what made
// this so hard to diagnose from the outside.
func TestYahooCallbackWithoutRefreshTokenDoesNotClaimSuccess(t *testing.T) {
	var linkAttempts int32
	apiSrv := yahooUserServer(&linkAttempts, nil)
	defer apiSrv.Close()

	tokenSrv := tokenServer(t, "")
	defer tokenSrv.Close()

	app, fiberApp := newOAuthTestApp(t, tokenSrv, apiSrv)
	const state = "state-no-refresh-no-success"
	seedState(t, app, state, "logto|user-123")

	resp, err := fiberApp.Test(
		httptest.NewRequest("GET", "/yahoo/callback?state="+state+"&code=abc123", nil),
		testTimeoutMs,
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == fiber.StatusOK {
		t.Errorf("status = 200 for a link that failed; the user is being told it worked")
	}
	if strings.Contains(string(body), "Authentication successful") {
		t.Error("page claims success for a link that failed")
	}
}

// TestYahooCallbackWithRefreshTokenLinks is the control. Same flow, one
// field different, and the link is attempted — which is what pins the
// refresh token as the deciding factor rather than something else.
func TestYahooCallbackWithRefreshTokenLinks(t *testing.T) {
	var linkAttempts int32
	apiSrv := yahooUserServer(&linkAttempts, func(r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-access-token" {
			t.Errorf("Authorization = %q, want the freshly exchanged access token", got)
		}
	})
	defer apiSrv.Close()

	tokenSrv := tokenServer(t, "test-refresh-token")
	defer tokenSrv.Close()

	app, fiberApp := newOAuthTestApp(t, tokenSrv, apiSrv)
	const state = "state-with-refresh-token"
	seedState(t, app, state, "logto|user-123")

	resp, err := fiberApp.Test(
		httptest.NewRequest("GET", "/yahoo/callback?state="+state+"&code=abc123", nil),
		testTimeoutMs,
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if n := atomic.LoadInt32(&linkAttempts); n == 0 {
		t.Error("Yahoo user endpoint was never called, so no link was attempted")
	}
}

// TestYahooCallbackRejectsMissingParams covers Yahoo redirecting back
// without a code — a denied consent, for instance.
func TestYahooCallbackRejectsMissingParams(t *testing.T) {
	tokenSrv := tokenServer(t, "test-refresh-token")
	defer tokenSrv.Close()
	_, fiberApp := newOAuthTestApp(t, tokenSrv, nil)

	cases := []struct{ name, query string }{
		{"no state", "?code=abc123"},
		{"no code", "?state=some-state"},
		{"neither", ""},
		{"consent denied", "?error=access_denied&state=some-state"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := fiberApp.Test(
				httptest.NewRequest("GET", "/yahoo/callback"+tc.query, nil),
				testTimeoutMs,
			)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != fiber.StatusBadRequest {
				t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
			}
		})
	}
}

// TestYahooCallbackRejectsUnknownState is the CSRF guard: a state the
// server never issued must not reach the token exchange.
func TestYahooCallbackRejectsUnknownState(t *testing.T) {
	var exchanges int32
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&exchanges, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer tokenSrv.Close()

	_, fiberApp := newOAuthTestApp(t, tokenSrv, nil)

	resp, err := fiberApp.Test(
		httptest.NewRequest("GET", "/yahoo/callback?state=never-issued&code=abc123", nil),
		testTimeoutMs,
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	if n := atomic.LoadInt32(&exchanges); n != 0 {
		t.Errorf("token exchange ran %d times for an unissued state; want 0", n)
	}
}

// TestYahooCallbackStateIsSingleUse covers replay. The handler consumes
// state with GETDEL precisely so a captured callback URL cannot be
// replayed inside the ten-minute window; this proves the GETDEL is doing
// that job rather than a plain GET that happens to pass.
func TestYahooCallbackStateIsSingleUse(t *testing.T) {
	tokenSrv := tokenServer(t, "test-refresh-token")
	defer tokenSrv.Close()

	var linkAttempts int32
	apiSrv := yahooUserServer(&linkAttempts, nil)
	defer apiSrv.Close()

	app, fiberApp := newOAuthTestApp(t, tokenSrv, apiSrv)
	const state = "state-replayed"
	seedState(t, app, state, "logto|user-123")

	target := "/yahoo/callback?state=" + url.QueryEscape(state) + "&code=abc123"

	first, err := fiberApp.Test(httptest.NewRequest("GET", target, nil), testTimeoutMs)
	if err != nil {
		t.Fatalf("first request: %v", err)
	}
	first.Body.Close()
	// Not asserting 200: the stub Yahoo endpoint returns no user, so the
	// link legitimately fails. What matters here is that the state was
	// ACCEPTED and consumed — anything but 400 proves it got past the
	// CSRF check.
	if first.StatusCode == fiber.StatusBadRequest {
		t.Fatalf("first callback rejected the state it was given (status %d)", first.StatusCode)
	}

	second, err := fiberApp.Test(httptest.NewRequest("GET", target, nil), testTimeoutMs)
	if err != nil {
		t.Fatalf("second request: %v", err)
	}
	defer second.Body.Close()
	if second.StatusCode != fiber.StatusBadRequest {
		t.Errorf("replayed state accepted with status %d; want %d", second.StatusCode, fiber.StatusBadRequest)
	}
}
