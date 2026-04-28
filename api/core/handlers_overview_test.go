package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ─── Test helpers ───────────────────────────────────────────────────

// testDBAvailable skips the calling test when the DB pool isn't
// initialised. Most unit-test runs (`go test ./core/`) bring up the
// package without a real database, so any test that touches DBPool
// must guard itself.
func testDBAvailable(t *testing.T) bool {
	t.Helper()
	if DBPool == nil {
		t.Skip("DBPool not initialised; skipping integration test")
		return false
	}
	return true
}

// testRedisAvailable skips when Rdb is nil — same reason as above for
// the cache-related tests.
func testRedisAvailable(t *testing.T) bool {
	t.Helper()
	if Rdb == nil {
		t.Skip("Rdb not initialised; skipping integration test")
		return false
	}
	return true
}

// makeTestUser returns a unique synthetic logto_sub for use as a row key.
func makeTestUser() string {
	return fmt.Sprintf("test-overview-%d", time.Now().UnixNano())
}

// cleanupTestUser drops any rows the overview tests insert.
func cleanupTestUser(_ *testing.T, userID string) {
	if DBPool == nil {
		return
	}
	_, _ = DBPool.Exec(context.Background(),
		`DELETE FROM user_channels WHERE logto_sub = $1`, userID)
}

// mustExec runs an INSERT/UPDATE in the test DB or fails the test.
func mustExec(t *testing.T, query string, args ...interface{}) {
	t.Helper()
	if DBPool == nil {
		t.Skip("DBPool not initialised")
		return
	}
	_, err := DBPool.Exec(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("mustExec failed: %v", err)
	}
}

// runWithLocals stands up a minimal Fiber app, registers a single GET
// handler that seeds c.Locals before calling fn, and returns the
// captured value. Avoids reaching into Fiber's internal AcquireCtx,
// which is not part of the v2 public API and behaves erratically.
func runWithLocals(t *testing.T, locals map[string]interface{}, fn func(c *fiber.Ctx) interface{}) interface{} {
	t.Helper()
	app := fiber.New()
	var captured interface{}
	app.Get("/_test", func(c *fiber.Ctx) error {
		for k, v := range locals {
			c.Locals(k, v)
		}
		captured = fn(c)
		return c.SendStatus(http.StatusOK)
	})
	req, _ := http.NewRequest(http.MethodGet, "/_test", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test failed: %v", err)
	}
	resp.Body.Close()
	return captured
}

// ─── Identity ───────────────────────────────────────────────────────

func TestBuildIdentityFromContext_AllClaimsPresent(t *testing.T) {
	got := runWithLocals(t, map[string]interface{}{
		"user_id":       "logto-uuid-1",
		"user_email":    "user@example.com",
		"user_name":     "Brandon",
		"user_username": "brandon",
	}, func(c *fiber.Ctx) interface{} {
		return buildIdentityFromContext(c)
	}).(OverviewIdentity)

	want := OverviewIdentity{
		Sub:      "logto-uuid-1",
		Email:    "user@example.com",
		Name:     "Brandon",
		Username: "brandon",
	}
	if got != want {
		t.Errorf("identity mismatch:\ngot:  %+v\nwant: %+v", got, want)
	}
}

func TestBuildIdentityFromContext_MissingUsername(t *testing.T) {
	// Simulates the auth middleware writing "" for a missing username
	// claim — which is what auth.go does after the change in this PR.
	got := runWithLocals(t, map[string]interface{}{
		"user_id":       "logto-uuid-2",
		"user_email":    "user2@example.com",
		"user_name":     "",
		"user_username": "",
	}, func(c *fiber.Ctx) interface{} {
		return buildIdentityFromContext(c)
	}).(OverviewIdentity)

	if got.Username != "" {
		t.Errorf("expected empty username when claim missing, got %q", got.Username)
	}
	if got.Sub != "logto-uuid-2" {
		t.Errorf("sub mismatch: got %q", got.Sub)
	}
}

// ─── Tier ───────────────────────────────────────────────────────────

func TestBuildTierFromContext_FreeTier(t *testing.T) {
	// Empty roles slice → tierFromRoles falls through to "free".
	got := runWithLocals(t, map[string]interface{}{
		"user_roles": []string{},
	}, func(c *fiber.Ctx) interface{} {
		return buildTierFromContext(c)
	}).(OverviewTier)

	if got.Current != "free" {
		t.Errorf("expected current=free, got %q", got.Current)
	}
	if got.IsSuperUser {
		t.Error("expected is_super_user=false for free tier")
	}
	if got.Label == "" {
		t.Error("expected non-empty label")
	}
}

func TestBuildTierFromContext_SuperUser(t *testing.T) {
	got := runWithLocals(t, map[string]interface{}{
		"user_roles": []string{"super_user"},
	}, func(c *fiber.Ctx) interface{} {
		return buildTierFromContext(c)
	}).(OverviewTier)

	if !got.IsSuperUser {
		t.Error("expected is_super_user=true for super_user tier")
	}
	if got.Current != "super_user" {
		t.Errorf("current mismatch: got %q", got.Current)
	}
}

func TestBuildTierFromContext_UplinkPro(t *testing.T) {
	got := runWithLocals(t, map[string]interface{}{
		"user_roles": []string{"uplink_pro"},
	}, func(c *fiber.Ctx) interface{} {
		return buildTierFromContext(c)
	}).(OverviewTier)

	if got.Current != "uplink_pro" {
		t.Errorf("expected current=uplink_pro, got %q", got.Current)
	}
	if got.Label != "Uplink Pro" {
		t.Errorf("expected label=Uplink Pro, got %q", got.Label)
	}
	// Pro tier has Symbols=75 — sanity check the limits row threaded through.
	if got.Limits.Symbols == nil || *got.Limits.Symbols != 75 {
		t.Errorf("expected Symbols=75 for uplink_pro; got %v", got.Limits.Symbols)
	}
}

// ─── Channel summary ────────────────────────────────────────────────

func TestGetChannelSummary_NoChannels(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	got, err := getChannelSummary(context.Background(), userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Total != 0 || got.Enabled != 0 || len(got.ByType) != 0 {
		t.Errorf("expected empty summary, got %+v", got)
	}
}

func TestGetChannelSummary_MixedEnabledStates(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	mustExec(t, `INSERT INTO user_channels (logto_sub, channel_type, enabled, visible) VALUES
		($1, 'finance', true, true),
		($1, 'sports', true, true),
		($1, 'rss', true, false),
		($1, 'fantasy', false, false)`, userID)

	got, err := getChannelSummary(context.Background(), userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Total != 4 {
		t.Errorf("total: want 4, got %d", got.Total)
	}
	if got.Enabled != 3 {
		t.Errorf("enabled: want 3, got %d", got.Enabled)
	}
	if len(got.ByType) != 4 {
		t.Errorf("by_type len: want 4, got %d", len(got.ByType))
	}
}

// ─── hasFantasyChannel ──────────────────────────────────────────────

func TestHasFantasyChannel(t *testing.T) {
	cases := []struct {
		name string
		in   OverviewChannels
		want bool
	}{
		{"no rows", OverviewChannels{}, false},
		{"fantasy disabled", OverviewChannels{ByType: []OverviewChannelRow{{Type: "fantasy", Enabled: false}}}, false},
		{"fantasy enabled", OverviewChannels{ByType: []OverviewChannelRow{{Type: "fantasy", Enabled: true}}}, true},
		{"only finance", OverviewChannels{ByType: []OverviewChannelRow{{Type: "finance", Enabled: true}}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasFantasyChannel(tc.in); got != tc.want {
				t.Errorf("hasFantasyChannel: want %v, got %v", tc.want, got)
			}
		})
	}
}

// ─── Cache invalidation ─────────────────────────────────────────────

func TestInvalidateOverviewCache_DeletesKey(t *testing.T) {
	if !testRedisAvailable(t) {
		return
	}
	userID := fmt.Sprintf("test-invalidate-%d", time.Now().UnixNano())
	key := RedisOverviewCachePrefix + userID

	if err := Rdb.Set(context.Background(), key, []byte("test"), 60*time.Second).Err(); err != nil {
		t.Fatalf("seed Set failed: %v", err)
	}
	InvalidateOverviewCache(context.Background(), userID)

	_, err := Rdb.Get(context.Background(), key).Result()
	if err == nil {
		t.Error("expected cache key to be deleted, but it still exists")
	}
}

func TestInvalidateOverviewCache_EmptyUserIDIsNoop(t *testing.T) {
	// Defensive: an empty user must never wildcard-delete the namespace.
	// We can verify this without a Redis connection because the function
	// short-circuits before touching the client.
	InvalidateOverviewCache(context.Background(), "")
	// If we got here without panicking, the no-op path works.
}

// ─── Roundtrip cache behavior ───────────────────────────────────────

func TestHandleGetOverview_CacheRoundtrip(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	if !testRedisAvailable(t) {
		return
	}

	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	mustExec(t, `INSERT INTO user_channels (logto_sub, channel_type, enabled, visible)
		VALUES ($1, 'finance', true, true)`, userID)

	// Ensure no stale entry from a previous run.
	Rdb.Del(context.Background(), RedisOverviewCachePrefix+userID)

	app := fiber.New()
	app.Get("/users/me/overview", func(c *fiber.Ctx) error {
		c.Locals("user_id", userID)
		c.Locals("user_email", "test@example.com")
		c.Locals("user_roles", []string{})
		c.Locals("user_name", "")
		c.Locals("user_username", "")
		return HandleGetOverview(c)
	})

	// First call: cache miss.
	req1, _ := http.NewRequest(http.MethodGet, "/users/me/overview", nil)
	resp1, err := app.Test(req1)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if resp1.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp1.Body)
		t.Fatalf("first call status %d: %s", resp1.StatusCode, body)
	}
	if got := resp1.Header.Get("X-Cache"); got != "miss" {
		t.Errorf("first call X-Cache: want miss, got %q", got)
	}

	// Body must be valid JSON shaped like OverviewResponse.
	body1, _ := io.ReadAll(resp1.Body)
	resp1.Body.Close()
	var ov OverviewResponse
	if err := json.Unmarshal(body1, &ov); err != nil {
		t.Fatalf("first body unmarshal: %v\nbody: %s", err, body1)
	}
	if ov.Identity.Sub != userID {
		t.Errorf("identity.sub want %q, got %q", userID, ov.Identity.Sub)
	}

	// Second call: cache hit.
	req2, _ := http.NewRequest(http.MethodGet, "/users/me/overview", nil)
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got := resp2.Header.Get("X-Cache"); got != "hit" {
		t.Errorf("second call X-Cache: want hit, got %q", got)
	}
	resp2.Body.Close()

	// Cleanup.
	Rdb.Del(context.Background(), RedisOverviewCachePrefix+userID)
}
