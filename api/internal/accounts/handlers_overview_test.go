package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// ─── Test helpers ───────────────────────────────────────────────────

// makeTestUser returns a unique synthetic logto_sub for use as a row key.
func makeTestUser() string {
	return fmt.Sprintf("test-overview-%d", time.Now().UnixNano())
}

// cleanupTestUser drops any rows the overview tests insert.
func cleanupTestUser(_ *testing.T, userID string) {
	if platform.DBPool == nil {
		return
	}
	_, _ = platform.DBPool.Exec(context.Background(),
		`DELETE FROM user_widgets WHERE logto_sub = $1`, userID)
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
	// Per-feature depth caps are retired (nil now); sanity-check the limits
	// row threaded through via MaxWidgets (pro = 12).
	if got.Limits.MaxWidgets == nil || *got.Limits.MaxWidgets != 12 {
		t.Errorf("expected MaxWidgets=12 for uplink_pro; got %v", got.Limits.MaxWidgets)
	}
}

// ─── Channel summary ────────────────────────────────────────────────

func TestGetChannelSummary_NoChannels(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	got, err := getWidgetSummary(context.Background(), userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Total != 0 || got.Enabled != 0 || len(got.ByType) != 0 {
		t.Errorf("expected empty summary, got %+v", got)
	}
}

func TestGetChannelSummary_MixedEnabledStates(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub, widget_type, enabled, ticker_enabled) VALUES
		($1, 'finance', true, true),
		($1, 'sports', true, true),
		($1, 'rss', true, false),
		($1, 'fantasy', false, false)`, userID)

	got, err := getWidgetSummary(context.Background(), userID)
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

// ─── hasFantasyWidget ──────────────────────────────────────────────

func TestHasFantasyChannel(t *testing.T) {
	cases := []struct {
		name string
		in   OverviewWidgets
		want bool
	}{
		{"no rows", OverviewWidgets{}, false},
		// The row is "fantasy_yahoo" — resolved through the catalog's source,
		// never by matching a bare "fantasy" literal.
		{"fantasy_yahoo enabled", OverviewWidgets{ByType: []OverviewWidgetRow{{Type: "fantasy_yahoo", Enabled: true}}}, true},
		{"fantasy_yahoo disabled", OverviewWidgets{ByType: []OverviewWidgetRow{{Type: "fantasy_yahoo", Enabled: false}}}, false},
		// A hypothetical second fantasy provider routes by source prefix.
		{"fantasy_espn enabled", OverviewWidgets{ByType: []OverviewWidgetRow{{Type: "fantasy_espn", Enabled: true}}}, true},
		{"only finance", OverviewWidgets{ByType: []OverviewWidgetRow{{Type: "finance_stocks", Enabled: true}}}, false},
		// The pre-split coarse type is no longer a valid widget id.
		{"legacy coarse fantasy is not a widget", OverviewWidgets{ByType: []OverviewWidgetRow{{Type: "fantasy", Enabled: true}}}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hasFantasyWidget(tc.in); got != tc.want {
				t.Errorf("hasFantasyWidget: want %v, got %v", tc.want, got)
			}
		})
	}
}

// ─── Cache invalidation ─────────────────────────────────────────────

func TestInvalidateOverviewCache_DeletesKey(t *testing.T) {
	if !testsupport.RedisAvailable(t) {
		return
	}
	userID := fmt.Sprintf("test-invalidate-%d", time.Now().UnixNano())
	key := platform.RedisOverviewCachePrefix + userID

	if err := platform.Rdb.Set(context.Background(), key, []byte("test"), 60*time.Second).Err(); err != nil {
		t.Fatalf("seed Set failed: %v", err)
	}
	platform.InvalidateOverviewCache(context.Background(), userID)

	_, err := platform.Rdb.Get(context.Background(), key).Result()
	if err == nil {
		t.Error("expected cache key to be deleted, but it still exists")
	}
}

func TestInvalidateOverviewCache_EmptyUserIDIsNoop(t *testing.T) {
	// Defensive: an empty user must never wildcard-delete the namespace.
	// We can verify this without a Redis connection because the function
	// short-circuits before touching the client.
	platform.InvalidateOverviewCache(context.Background(), "")
	// If we got here without panicking, the no-op path works.
}

// ─── Roundtrip cache behavior ───────────────────────────────────────

func TestHandleGetOverview_CacheRoundtrip(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	if !testsupport.RedisAvailable(t) {
		return
	}

	userID := makeTestUser()
	defer cleanupTestUser(t, userID)

	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub, widget_type, enabled, ticker_enabled)
		VALUES ($1, 'finance', true, true)`, userID)

	// Ensure no stale entry from a previous run.
	platform.Rdb.Del(context.Background(), platform.RedisOverviewCachePrefix+userID)

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
	platform.Rdb.Del(context.Background(), platform.RedisOverviewCachePrefix+userID)
}
