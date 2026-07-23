# Batch B — Account Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /users/me/overview` endpoint that consolidates identity + tier + subscription + channels + GDPR + fantasy summary into one round-trip, refactor desktop and website Account pages to consume it, and add a GDPR export button + channel/league stats card to desktop.

**Architecture:** New core API handler aggregates from existing helpers (Postgres, JWT, channel discovery for fantasy fan-out), caches per-user in Redis with 30s TTL + singleflight. Webhook + CRUD + GDPR mutations invalidate the cache. Both clients consume via TanStack Query.

**Tech Stack:** Go 1.22 (Fiber v2, pgx v5, go-redis v9, golang.org/x/sync/singleflight already imported in `api/core/handlers_channel.go`); React 19 + TypeScript + TanStack Query (desktop + website); Vitest (desktop only); Tauri v2 (desktop binary).

**Spec:** `docs/superpowers/specs/2026-04-28-batch-b-account-overview-design.md`

**Decisions locked (from spec):**
1. GDPR on desktop: export only, no delete
2. Stats card: yes (channel + fantasy counts)
3. In-app cancel sub on desktop: no, portal-only
4. Tier limits table: desktop only, website ignores
5. Cache: 30s Redis with singleflight
6. JWT identity: add `username` + `name` to existing custom JWT script
7. Desktop bump: v1.0.3 → v1.0.4

---

## File structure overview

### Backend (Go API)

| File | Action | Responsibility |
|---|---|---|
| `channels/fantasy/api/yahoo_summary.go` | **New** (~50 lines) | `GET /users/me/yahoo-summary` handler returning `{yahoo_connected, yahoo_synced, league_count}` |
| `channels/fantasy/api/main.go` | Modify line 331-333 | Register the new route |
| `api/core/handlers_overview.go` | **New** (~250 lines) | `HandleGetOverview` + helpers (identity, tier, channel summary, fantasy fan-out, cache, invalidator) |
| `api/core/handlers_overview_test.go` | **New** (~200 lines) | 6 test cases covering cache hit/miss, fantasy fail-open, GDPR pending, free-tier null subscription, etc. |
| `api/core/server.go` | Modify ~line 200 | Register `GET /users/me/overview` |
| `api/core/stripe_webhook.go` | Modify webhook handler tail | `core.InvalidateOverviewCache(ctx, userID)` after subscription mutations |
| `api/core/handlers_channel.go` | Modify CreateChannel, UpdateChannel, DeleteChannel | Same invalidation call |
| `api/core/user_deletion.go` | Modify RequestDeletion, CancelDeletion, PurgeUser | Same invalidation call |

### Desktop (TypeScript)

| File | Action | Responsibility |
|---|---|---|
| `desktop/src/api/client.ts` | Modify | `UserOverview` interface + `userApi.overview()` method |
| `desktop/src/api/queries.ts` | Modify | `userOverviewQueryOptions` (TanStack Query options) |
| `desktop/src/components/settings/AccountStatsRow.tsx` | **New** (~70 lines) | Renders "X of Y channels enabled" + (when fantasy connected) "Z fantasy leagues imported" |
| `desktop/src/components/settings/AccountStatsRow.test.tsx` | **New** (~80 lines) | 4 tests: hidden when total=0; basic render; fantasy line shown/hidden |
| `desktop/src/components/settings/AccountExportButton.tsx` | **New** (~80 lines) | Calls `/users/me/export`, opens result via Tauri shell |
| `desktop/src/components/settings/AccountExportButton.test.tsx` | **New** (~60 lines) | 3 tests: idle/loading/error states |
| `desktop/src/components/settings/AccountSettings.tsx` | Modify | Consume `userOverviewQueryOptions`; render new sections; remove duplicate fetches |
| `desktop/src/routes/__root.tsx` | Modify | Derive `subscriptionInfo` from overview; remove standalone `fetchSubscription` |
| `desktop/src-tauri/tauri.conf.json` | Modify | Version `1.0.3` → `1.0.4` |
| `desktop/src-tauri/Cargo.toml` | Modify | Version `1.0.3` → `1.0.4` |
| `desktop/package.json` | Modify | Version `1.0.3` → `1.0.4` |
| `desktop/package-lock.json` | Modify | Version `1.0.3` → `1.0.4` (top-level + scrollr-desktop entry) |

### Website (TypeScript)

| File | Action | Responsibility |
|---|---|---|
| `myscrollr.com/src/api/client.ts` | Modify | `UserOverview` type + `userApi.overview()` method |
| `myscrollr.com/src/routes/account.tsx` | Modify | Replace 3 separate queries with one overview query |
| `myscrollr.com/src/components/billing/SubscriptionStatus.tsx` | Modify | Accept overview-shaped subscription prop OR consume overview internally |
| `myscrollr.com/src/components/account/AccountDangerZone.tsx` | Modify | Read `overview.gdpr.deletion_status` for the pending banner |

---

# PHASE 1 — Yahoo summary endpoint (fantasy API)

This phase ships the small handler that core API will fan out to.

### Task 1.1: Yahoo summary handler

**Files:**
- Create: `channels/fantasy/api/yahoo_summary.go`
- Modify: `channels/fantasy/api/main.go` (route registration only)

- [ ] **Step 1: Inspect existing yahoo-status handler for reference**

Run: `grep -n "yahoo-status\|YahooStatus\|HandleYahooStatus\|GetYahooStatus" channels/fantasy/api/*.go`

Expected: Locate the existing handler that returns `{yahoo_connected, yahoo_synced}`. Read it to understand the pattern for `db` access, `userID` extraction (`GetUserSub(c)`), and JSON response shape.

- [ ] **Step 2: Inspect yahoo_user_leagues schema for league count query**

Run: `grep -n "yahoo_user_leagues\|YahooUserLeagues" channels/fantasy/api/migrations/*.sql channels/fantasy/api/*.go | head -10`

Expected: Confirm the table name is `yahoo_user_leagues` and the user-id column is `guid` (Yahoo GUID, not logto_sub). The existing import handler at `user_handlers.go` uses this table.

- [ ] **Step 3: Write the new handler**

Create `channels/fantasy/api/yahoo_summary.go`:

```go
package main

import (
	"context"
	"log"

	"github.com/gofiber/fiber/v2"
)

type yahooSummaryResponse struct {
	YahooConnected bool `json:"yahoo_connected"`
	YahooSynced    bool `json:"yahoo_synced"`
	LeagueCount    int  `json:"league_count"`
}

// HandleYahooSummary returns the minimal summary needed by the core API's
// /users/me/overview fan-out. Reads connection state from yahoo_users,
// counts imported leagues from yahoo_user_leagues. One DB transaction,
// no Yahoo API calls.
func (a *App) HandleYahooSummary(c *fiber.Ctx) error {
	logtoSub := GetUserSub(c)
	if logtoSub == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "authentication required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Context(), DBQueryTimeout)
	defer cancel()

	// 1. Look up the Yahoo guid + connection state for this logto_sub.
	var (
		guid     string
		synced   bool
	)
	err := a.db.QueryRow(ctx, `
		SELECT guid, COALESCE(synced, false)
		FROM yahoo_users
		WHERE logto_sub = $1
	`, logtoSub).Scan(&guid, &synced)
	if err != nil {
		// No row = user has never connected Yahoo; happy path.
		return c.JSON(yahooSummaryResponse{
			YahooConnected: false,
			YahooSynced:    false,
			LeagueCount:    0,
		})
	}

	// 2. Count imported leagues for that guid.
	var leagueCount int
	if err := a.db.QueryRow(ctx, `
		SELECT count(*) FROM yahoo_user_leagues WHERE guid = $1
	`, guid).Scan(&leagueCount); err != nil {
		log.Printf("[YahooSummary] count leagues failed for guid=%s: %v", guid, err)
		// Don't fail the request — return 0 for the count and continue.
		leagueCount = 0
	}

	return c.JSON(yahooSummaryResponse{
		YahooConnected: guid != "",
		YahooSynced:    synced,
		LeagueCount:    leagueCount,
	})
}
```

Note: if `DBQueryTimeout` constant doesn't exist in this package, use `5*time.Second` inline and add the import. Verify by running `grep -n "DBQueryTimeout" channels/fantasy/api/`.

- [ ] **Step 4: Register the route**

Modify `channels/fantasy/api/main.go` near line 331-333 where existing yahoo routes are registered. Find the block:

```go
{Method: "GET", Path: "/users/me/yahoo-status", Auth: true},
{Method: "GET", Path: "/users/me/yahoo-leagues", Auth: true},
```

Add immediately after:

```go
{Method: "GET", Path: "/users/me/yahoo-summary", Auth: true},
```

Then find where these routes are wired to handlers (search for `app.Get("/users/me/yahoo-status"` or similar) and add:

```go
app.Get("/users/me/yahoo-summary", a.HandleYahooSummary)
```

- [ ] **Step 5: Verify build + vet**

Run: `cd channels/fantasy/api && go vet ./... && go build -o /tmp/fantasy_check . && rm -f /tmp/fantasy_check`

Expected: clean (no errors, empty output from go vet).

- [ ] **Step 6: Commit**

```bash
git add channels/fantasy/api/yahoo_summary.go channels/fantasy/api/main.go
git commit -m "feat(fantasy): GET /users/me/yahoo-summary for overview fan-out"
```

---

# PHASE 2 — Overview endpoint (core API)

This phase ships the new core endpoint, types, helpers, tests, and cache invalidation hooks. The work is tightly coupled — tasks must be done in order; the package won't compile until all helpers exist.

### Task 2.1: OverviewResponse types

**Files:**
- Create: `api/core/handlers_overview.go` (start the file)

- [ ] **Step 1: Create the file scaffold with types**

Create `api/core/handlers_overview.go`:

```go
package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"golang.org/x/sync/singleflight"
)

// ─── Response types ─────────────────────────────────────────────

type OverviewResponse struct {
	Identity     OverviewIdentity        `json:"identity"`
	Tier         OverviewTier            `json:"tier"`
	Subscription *SubscriptionResponse   `json:"subscription"` // nullable
	Channels     OverviewChannels        `json:"channels"`
	Fantasy      *OverviewFantasy        `json:"fantasy"` // nullable
	GDPR         OverviewGDPR            `json:"gdpr"`
	Links        OverviewLinks           `json:"links"`
}

type OverviewIdentity struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Name     string `json:"name"`     // empty string when JWT claim missing
	Username string `json:"username"` // empty string when not yet set
}

type OverviewTier struct {
	Current      string         `json:"current"`
	IsSuperUser  bool           `json:"is_super_user"`
	Label        string         `json:"label"`
	Limits       ChannelLimits  `json:"limits"`
}

type OverviewChannels struct {
	Total   int                  `json:"total"`
	Enabled int                  `json:"enabled"`
	ByType  []OverviewChannelRow `json:"by_type"`
}

type OverviewChannelRow struct {
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
	Visible bool   `json:"visible"`
}

type OverviewFantasy struct {
	YahooConnected bool `json:"yahoo_connected"`
	YahooSynced    bool `json:"yahoo_synced"`
	LeagueCount    int  `json:"league_count"`
}

type OverviewGDPR struct {
	DeletionStatus string  `json:"deletion_status"` // none | pending | canceled | purged
	RequestedAt    *string `json:"requested_at"`
	PurgeAt        *string `json:"purge_at"`
}

type OverviewLinks struct {
	LogtoAccount string `json:"logto_account"`
}

// ─── Cache constants ────────────────────────────────────────────

const (
	RedisOverviewCachePrefix = "overview:"
	OverviewCacheTTL         = 30 * time.Second
	FantasyFanoutTimeout     = 1 * time.Second
)

var overviewGroup singleflight.Group
```

- [ ] **Step 2: Verify file compiles in isolation**

Run: `cd api && go build ./core/... 2>&1 | head -20`

Expected: errors about `SubscriptionResponse` (already exists in `models.go`, OK) or `ChannelLimits` (already exists in `tier_limits.go`, OK). Errors about `HandleGetOverview` undefined are expected since we haven't added it yet — those will be resolved in later tasks. The package as a whole won't build cleanly until all tasks in Phase 2 are done; that's expected.

- [ ] **Step 3: No commit yet** — types are partial. Commit at end of Phase 2.

---

### Task 2.2: Identity + tier builders (with tests)

**Files:**
- Modify: `api/core/handlers_overview.go`
- Create: `api/core/handlers_overview_test.go`

- [ ] **Step 1: Write the failing test**

Create `api/core/handlers_overview_test.go`:

```go
package core

import (
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestBuildIdentityFromContext_AllClaimsPresent(t *testing.T) {
	app := fiber.New()
	c := app.AcquireCtx(&fiber.Ctx{})
	defer app.ReleaseCtx(c)

	c.Locals("user_id", "logto-uuid-1")
	c.Locals("user_email", "user@example.com")
	c.Locals("user_name", "Brandon")
	c.Locals("user_username", "brandon")

	got := buildIdentityFromContext(c)

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
	app := fiber.New()
	c := app.AcquireCtx(&fiber.Ctx{})
	defer app.ReleaseCtx(c)

	c.Locals("user_id", "logto-uuid-2")
	c.Locals("user_email", "user2@example.com")
	c.Locals("user_name", "")
	// user_username intentionally not set (simulates JWT script not yet updated)

	got := buildIdentityFromContext(c)

	if got.Username != "" {
		t.Errorf("expected empty username when claim missing, got %q", got.Username)
	}
	if got.Sub != "logto-uuid-2" {
		t.Errorf("sub mismatch: got %q", got.Sub)
	}
}

func TestBuildTierFromContext_FreeTier(t *testing.T) {
	app := fiber.New()
	c := app.AcquireCtx(&fiber.Ctx{})
	defer app.ReleaseCtx(c)

	c.Locals("user_tier", "free")

	got := buildTierFromContext(c)

	if got.Current != "free" {
		t.Errorf("expected current=free, got %q", got.Current)
	}
	if got.IsSuperUser {
		t.Error("expected is_super_user=false for free tier")
	}
	if got.Label == "" {
		t.Error("expected non-empty label")
	}
	if got.Limits.Symbols != DefaultTierLimits["free"].Symbols {
		t.Errorf("limits.symbols mismatch: got %d", got.Limits.Symbols)
	}
}

func TestBuildTierFromContext_SuperUser(t *testing.T) {
	app := fiber.New()
	c := app.AcquireCtx(&fiber.Ctx{})
	defer app.ReleaseCtx(c)

	c.Locals("user_tier", "super_user")

	got := buildTierFromContext(c)

	if !got.IsSuperUser {
		t.Error("expected is_super_user=true for super_user tier")
	}
	if got.Current != "super_user" {
		t.Errorf("current mismatch: got %q", got.Current)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && go test ./core/ -run TestBuildIdentity -v 2>&1 | head -30`

Expected: FAIL with `undefined: buildIdentityFromContext` and similar undefined errors.

- [ ] **Step 3: Inspect existing JWT middleware to confirm c.Locals key names**

Run: `grep -n "c.Locals" api/core/auth.go api/core/server.go | head -10`

Expected: Confirm the existing keys (`"user_id"`, `"user_email"`, `"user_tier"`, `"user_roles"`). If `"user_name"` or `"user_username"` aren't set yet by the auth middleware, those reads will return nil interface, which the helper must handle. Also note the existing `GetUserSub`, `GetUserEmail`, `GetUserTier` helpers in `users.go` — use them where they exist.

- [ ] **Step 4: Update JWT middleware to expose name + username**

Locate the JWT-claims-to-locals code in `api/core/auth.go` (around the function that decodes JWT and calls `c.Locals(...)`). Find the block that sets `"user_id"`, `"user_email"`, etc. Add:

```go
if name, ok := claims["name"].(string); ok {
    c.Locals("user_name", name)
} else {
    c.Locals("user_name", "")
}
if username, ok := claims["username"].(string); ok {
    c.Locals("user_username", username)
} else {
    c.Locals("user_username", "")
}
```

These claims will be empty until the Logto JWT script update is deployed AND existing tokens roll over (~1h after deployment). Empty string is the correct fallback.

- [ ] **Step 5: Add the helpers to handlers_overview.go**

Append to `api/core/handlers_overview.go`:

```go
// ─── Identity ───────────────────────────────────────────────────

func buildIdentityFromContext(c *fiber.Ctx) OverviewIdentity {
	getStr := func(key string) string {
		v, _ := c.Locals(key).(string)
		return v
	}
	return OverviewIdentity{
		Sub:      getStr("user_id"),
		Email:    getStr("user_email"),
		Name:     getStr("user_name"),
		Username: getStr("user_username"),
	}
}

// ─── Tier ───────────────────────────────────────────────────────

func buildTierFromContext(c *fiber.Ctx) OverviewTier {
	tier, _ := c.Locals("user_tier").(string)
	if tier == "" {
		tier = "free"
	}
	limits, ok := DefaultTierLimits[tier]
	if !ok {
		limits = DefaultTierLimits["free"]
	}
	return OverviewTier{
		Current:     tier,
		IsSuperUser: tier == "super_user",
		Label:       tierLabelFor(tier),
		Limits:      limits,
	}
}

func tierLabelFor(tier string) string {
	switch tier {
	case "free":
		return "Free"
	case "uplink":
		return "Uplink"
	case "uplink_pro":
		return "Uplink Pro"
	case "uplink_ultimate":
		return "Uplink Ultimate"
	case "super_user":
		return "Super User"
	default:
		return tier
	}
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd api && go test ./core/ -run "TestBuildIdentity|TestBuildTier" -v 2>&1 | tail -15`

Expected: 4 tests pass.

- [ ] **Step 7: No commit yet** — Phase 2 commits as a unit at the end.

---

### Task 2.3: Channel summary helper (with test)

**Files:**
- Modify: `api/core/handlers_overview.go`
- Modify: `api/core/handlers_overview_test.go`

- [ ] **Step 1: Write the failing test**

Append to `api/core/handlers_overview_test.go`:

```go
import (
	"context"
	// ... other imports
)

// NOTE: Using real DBPool against a test DB requires environment setup.
// Per AGENTS.md, "No test infrastructure exists yet". For this batch,
// channel-summary tests are integration-style and will only run when
// DATABASE_URL is set. Skip when not.

func TestGetChannelSummary_NoChannels(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	userID := makeTestUser(t)
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
	userID := makeTestUser(t)
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
```

The helpers `testDBAvailable`, `makeTestUser`, `cleanupTestUser`, and `mustExec` are test infrastructure that may not exist yet. Check for `testDBAvailable` in `api/core/*_test.go`:

Run: `grep -rn "testDBAvailable\|makeTestUser" api/core/*_test.go`

If they don't exist, prepend their definitions to the test file:

```go
func testDBAvailable(t *testing.T) bool {
	if DBPool == nil {
		t.Skip("DBPool not initialised; skipping integration test")
		return false
	}
	return true
}

func makeTestUser(t *testing.T) string {
	id := fmt.Sprintf("test-overview-%d", time.Now().UnixNano())
	return id
}

func cleanupTestUser(t *testing.T, userID string) {
	if DBPool == nil {
		return
	}
	_, _ = DBPool.Exec(context.Background(),
		`DELETE FROM user_channels WHERE logto_sub = $1`, userID)
}

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && go test ./core/ -run TestGetChannelSummary -v 2>&1 | head -20`

Expected: FAIL with `undefined: getChannelSummary` (or skip if DBPool nil — that's OK for now).

- [ ] **Step 3: Add the helper**

Append to `api/core/handlers_overview.go`:

```go
// ─── Channel summary ────────────────────────────────────────────

func getChannelSummary(ctx context.Context, userID string) (OverviewChannels, error) {
	const q = `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE enabled = true) AS enabled_count,
			COALESCE(json_agg(json_build_object(
				'type', channel_type,
				'enabled', enabled,
				'visible', visible
			) ORDER BY channel_type), '[]'::json) AS by_type
		FROM user_channels
		WHERE logto_sub = $1
	`

	var (
		total      int
		enabled    int
		byTypeJSON []byte
	)
	err := DBPool.QueryRow(ctx, q, userID).Scan(&total, &enabled, &byTypeJSON)
	if err != nil {
		return OverviewChannels{}, fmt.Errorf("getChannelSummary query: %w", err)
	}

	var byType []OverviewChannelRow
	if err := json.Unmarshal(byTypeJSON, &byType); err != nil {
		return OverviewChannels{}, fmt.Errorf("getChannelSummary unmarshal: %w", err)
	}

	return OverviewChannels{
		Total:   total,
		Enabled: enabled,
		ByType:  byType,
	}, nil
}
```

- [ ] **Step 4: Run test to verify it passes (or skips when no DB)**

Run: `cd api && go test ./core/ -run TestGetChannelSummary -v 2>&1 | tail -10`

Expected: PASS or SKIP (depending on DB availability locally; CI has DB so it'll run there).

- [ ] **Step 5: No commit yet** — continue to next task.

---

### Task 2.4: Fantasy fan-out helper

**Files:**
- Modify: `api/core/handlers_overview.go`

- [ ] **Step 1: Inspect existing channel-discovery / fan-out code for the pattern**

Run: `grep -n "discoverChannels\|channelBaseURL\|GetChannelBaseURL" api/core/*.go | head -10`

Expected: Locate the helper that, given a channel name (e.g. "fantasy"), returns its base URL from Redis registration. The dashboard handler uses this. If named differently, find via:

Run: `grep -n "ChannelService\|RedisChannelKey\|fantasy.*base" api/core/*.go | head`

Note the function name (e.g. `GetChannelService("fantasy")` or similar) for use below. If no helper exists, the discovery is direct via Redis: `Rdb.Get(ctx, "channel:fantasy:url")` — confirm key prefix from existing usage.

- [ ] **Step 2: Add the fan-out helper**

Append to `api/core/handlers_overview.go`. Replace `getFantasyBaseURL(...)` with whatever helper is in use:

```go
// ─── Fantasy fan-out ────────────────────────────────────────────

// fetchFantasySummary queries the fantasy channel's /users/me/yahoo-summary
// endpoint via the registered base URL. Returns nil when fantasy is not
// reachable, not registered, or returns an error — never fails the parent
// request.
func fetchFantasySummary(ctx context.Context, userID string) *OverviewFantasy {
	baseURL, err := getFantasyBaseURL(ctx)
	if err != nil || baseURL == "" {
		return nil
	}

	url := strings.TrimRight(baseURL, "/") + "/users/me/yahoo-summary"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		log.Printf("[Overview] build fantasy request: %v", err)
		return nil
	}
	req.Header.Set("X-User-Sub", userID)

	client := &http.Client{Timeout: FantasyFanoutTimeout}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Overview] fantasy fan-out failed (timeout/network): %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Overview] fantasy fan-out non-200: %d", resp.StatusCode)
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Overview] fantasy fan-out read body: %v", err)
		return nil
	}

	var out OverviewFantasy
	if err := json.Unmarshal(body, &out); err != nil {
		log.Printf("[Overview] fantasy fan-out unmarshal: %v", err)
		return nil
	}
	return &out
}

// getFantasyBaseURL returns the registered base URL for the fantasy
// channel from Redis, or "" when not registered.
//
// Replace this with a call to whichever discovery helper the rest of the
// codebase uses. If none exists, fall back to direct Redis read with the
// channel-registration key prefix used in main.go's registerChannel calls.
func getFantasyBaseURL(ctx context.Context) (string, error) {
	// Inspect existing dashboard fan-out for the right key/helper.
	// Common pattern: Rdb.Get(ctx, "channel:fantasy:url").Result()
	url, err := Rdb.Get(ctx, "channel:fantasy:url").Result()
	if err != nil {
		return "", err
	}
	return url, nil
}
```

If the codebase uses a different key prefix or helper, swap in the correct version (the placeholder above is a defensive default; the existing `/dashboard` handler will show the correct pattern).

- [ ] **Step 3: Verify the imports**

The file should already import `net/http`, `io`, `strings`, `encoding/json`, `log`, `time` from earlier tasks. Run:

Run: `cd api && go build ./core/... 2>&1 | head -10`

Fix any missing imports inline.

- [ ] **Step 4: No commit yet** — continue.

---

### Task 2.5: GDPR helper + Stripe helper + assemble + invalidate + handler

**Files:**
- Modify: `api/core/handlers_overview.go`

- [ ] **Step 1: Inspect existing helpers we can reuse**

Run: `grep -n "getDeletionStatus\|GetDeletionStatus\|deletion_status" api/core/user_deletion.go | head -10`

Expected: Confirm a helper or query already exists in `user_deletion.go` for deletion status. Note the function signature.

Run: `grep -n "getSubscriptionForUser\|GetSubscription\|stripe_customers" api/core/billing.go | head -10`

Expected: Find the existing helper that reads from `stripe_customers` and builds a `SubscriptionResponse`. Note the signature (likely returns `(*SubscriptionResponse, error)` with `nil, nil` for no row).

- [ ] **Step 2: Add the assemble + cache + handler code**

Append to `api/core/handlers_overview.go`. Adjust `getDeletionStatusForOverview` and `getSubscriptionForOverview` to call the existing helpers identified in Step 1:

```go
// ─── GDPR ───────────────────────────────────────────────────────

func getDeletionStatusForOverview(ctx context.Context, userID string) OverviewGDPR {
	// Reuses the existing deletion-status query from user_deletion.go.
	// Replace 'GetUserDeletionStatus' with the actual helper name found
	// in step 1.
	status, err := GetUserDeletionStatus(ctx, userID)
	if err != nil || status == nil {
		return OverviewGDPR{DeletionStatus: "none"}
	}

	out := OverviewGDPR{DeletionStatus: status.Status}
	if status.RequestedAt != nil {
		s := status.RequestedAt.UTC().Format(time.RFC3339)
		out.RequestedAt = &s
	}
	if status.PurgeAt != nil {
		s := status.PurgeAt.UTC().Format(time.RFC3339)
		out.PurgeAt = &s
	}
	return out
}

// ─── Subscription ───────────────────────────────────────────────

func getSubscriptionForOverview(ctx context.Context, userID string) *SubscriptionResponse {
	// Reuses the existing helper. Replace 'GetSubscription' with the
	// actual helper name found in step 1. Free-tier user (no row) returns
	// (nil, nil) by convention; nil response means "no subscription".
	sub, err := GetSubscription(ctx, userID)
	if err != nil {
		log.Printf("[Overview] subscription query for %s: %v", userID, err)
		return nil
	}
	return sub
}

// ─── Links ──────────────────────────────────────────────────────

func buildAccountLinks() OverviewLinks {
	endpoint := strings.TrimRight(getEnv("LOGTO_ENDPOINT", ""), "/")
	appID := getEnv("LOGTO_APP_ID", "")
	if endpoint == "" || appID == "" {
		return OverviewLinks{LogtoAccount: ""}
	}
	return OverviewLinks{
		LogtoAccount: fmt.Sprintf("%s/account?client_id=%s", endpoint, appID),
	}
}

// ─── Assemble ───────────────────────────────────────────────────

func assembleOverview(ctx context.Context, c *fiber.Ctx, userID string) (*OverviewResponse, error) {
	identity := buildIdentityFromContext(c)
	tier := buildTierFromContext(c)
	subscription := getSubscriptionForOverview(ctx, userID)

	channels, err := getChannelSummary(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("assembleOverview: channels: %w", err)
	}

	gdpr := getDeletionStatusForOverview(ctx, userID)

	var fantasy *OverviewFantasy
	if hasFantasyChannel(channels) {
		fanCtx, cancel := context.WithTimeout(ctx, FantasyFanoutTimeout)
		defer cancel()
		fantasy = fetchFantasySummary(fanCtx, userID)
	}

	return &OverviewResponse{
		Identity:     identity,
		Tier:         tier,
		Subscription: subscription,
		Channels:     channels,
		Fantasy:      fantasy,
		GDPR:         gdpr,
		Links:        buildAccountLinks(),
	}, nil
}

func hasFantasyChannel(channels OverviewChannels) bool {
	for _, c := range channels.ByType {
		if c.Type == "fantasy" && c.Enabled {
			return true
		}
	}
	return false
}

// ─── Cache invalidation (called from webhook + CRUD + GDPR paths) ──

func InvalidateOverviewCache(ctx context.Context, userID string) {
	if userID == "" || Rdb == nil {
		return
	}
	key := RedisOverviewCachePrefix + userID
	if err := Rdb.Del(ctx, key).Err(); err != nil {
		log.Printf("[Overview] cache invalidate failed for %s: %v", userID, err)
	}
}

// ─── Handler ────────────────────────────────────────────────────

func HandleGetOverview(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "authentication required",
		})
	}

	cacheKey := RedisOverviewCachePrefix + userID

	// Fast path: serve from Redis cache.
	if cached, err := Rdb.Get(c.Context(), cacheKey).Bytes(); err == nil {
		c.Set("X-Cache", "hit")
		c.Set("Content-Type", "application/json")
		return c.Send(cached)
	} else if err != redis.Nil {
		// Redis miss is the normal path; only log unexpected errors.
		log.Printf("[Overview] cache read for %s: %v", userID, err)
	}

	// Slow path: assemble + cache, with singleflight to coalesce concurrent misses.
	result, err, _ := overviewGroup.Do(userID, func() (interface{}, error) {
		return assembleOverview(c.Context(), c, userID)
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  err.Error(),
		})
	}

	overview, ok := result.(*OverviewResponse)
	if !ok || overview == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "invalid overview shape",
		})
	}

	payload, err := json.Marshal(overview)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  fmt.Sprintf("marshal overview: %v", err),
		})
	}

	if setErr := Rdb.Set(c.Context(), cacheKey, payload, OverviewCacheTTL).Err(); setErr != nil {
		log.Printf("[Overview] cache write for %s: %v", userID, setErr)
	}

	c.Set("X-Cache", "miss")
	c.Set("Content-Type", "application/json")
	return c.Send(payload)
}
```

Note the import for `redis.Nil` — add `"github.com/redis/go-redis/v9"` to the import block at the top of the file (or the appropriate alias used elsewhere in `api/core/`).

If `getEnv` doesn't exist, use `os.Getenv` directly with empty-string fallback. If `GetUserDeletionStatus` doesn't return the shape expected, adjust to match the actual return type — the test in step 3 below will catch mismatches.

- [ ] **Step 3: Build verify**

Run: `cd api && go vet ./core/... 2>&1 | head -20`

Expected: clean. Any errors here indicate the helper-name placeholders need to be swapped to actual names. Fix and re-run.

Run: `cd api && go build -o /tmp/api_check . && rm -f /tmp/api_check`

Expected: clean.

- [ ] **Step 4: No commit yet.**

---

### Task 2.6: Cache invalidation hooks (Stripe webhook + channel CRUD + GDPR)

**Files:**
- Modify: `api/core/stripe_webhook.go`
- Modify: `api/core/handlers_channel.go`
- Modify: `api/core/user_deletion.go`

- [ ] **Step 1: Add invalidation to Stripe webhook**

Open `api/core/stripe_webhook.go`. Find the handler section that processes `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` events. After the database write completes (typically marked by an `INSERT ... ON CONFLICT` or `UPDATE`), add:

```go
// Invalidate the per-user overview cache so the next /users/me/overview
// reflects the new subscription state immediately.
InvalidateOverviewCache(ctx, sub.LogtoSub) // adjust variable name to match local scope
```

The exact spot depends on the existing handler structure. Search for the function that handles each of these events (e.g. `handleSubscriptionUpdated`) and insert the call near the end, before the success return.

Run: `grep -n "subscription.updated\|customer.subscription" api/core/stripe_webhook.go | head -5`

- [ ] **Step 2: Add invalidation to channel CRUD**

Open `api/core/handlers_channel.go`. Find these three handler functions (search via grep):
- `CreateChannel` (or `HandleCreateChannel`)
- `UpdateChannel` (or `HandleUpdateChannel`)
- `DeleteChannel` (or `HandleDeleteChannel`)

In each, after the database write succeeds and before returning the response, add:

```go
InvalidateOverviewCache(c.Context(), userID)
```

Where `userID` is whatever variable holds the logto_sub in that handler (commonly extracted via `GetUserSub(c)` near the top).

- [ ] **Step 3: Add invalidation to GDPR handlers**

Open `api/core/user_deletion.go`. Find these three handlers:
- `HandleRequestDeletion` (or similar)
- `HandleCancelDeletion` (or similar)
- `PurgeUser` (or `processPurge` — the purger goroutine)

After successful state mutation in each, add `InvalidateOverviewCache(ctx, userID)`. For the purger goroutine, `ctx` is `context.Background()` — that's fine.

- [ ] **Step 4: Verify build**

Run: `cd api && go vet ./... && go build -o /tmp/api_check . && rm -f /tmp/api_check`

Expected: clean.

- [ ] **Step 5: No commit yet.**

---

### Task 2.7: Add the route + remaining tests

**Files:**
- Modify: `api/core/server.go`
- Modify: `api/core/handlers_overview_test.go`

- [ ] **Step 1: Register the route**

Open `api/core/server.go`. Find the block where authenticated user routes are registered (around line 200, where you see `app.Get("/users/me/subscription", ...)` etc.). Add:

```go
app.Get("/users/me/overview", LogtoAuth, HandleGetOverview)
```

Match the exact middleware-chain pattern used by neighboring routes (e.g. some routes use `app.Get(path, LogtoAuth, handler)`, others use a route group with the auth middleware applied once). Use the same pattern as `/users/me/subscription`.

- [ ] **Step 2: Add cache hit/miss test**

Append to `api/core/handlers_overview_test.go`:

```go
func TestHandleGetOverview_CacheRoundtrip(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	if Rdb == nil {
		t.Skip("Redis not initialised; skipping integration test")
	}

	userID := makeTestUser(t)
	defer cleanupTestUser(t, userID)

	// Pre-warm: insert a single channel
	mustExec(t, `INSERT INTO user_channels (logto_sub, channel_type, enabled, visible)
		VALUES ($1, 'finance', true, true)`, userID)

	// Clear any existing cache
	Rdb.Del(context.Background(), RedisOverviewCachePrefix+userID)

	// First call: cache miss, builds from DB
	app := fiber.New()
	app.Get("/users/me/overview", func(c *fiber.Ctx) error {
		c.Locals("user_id", userID)
		c.Locals("user_email", "test@example.com")
		c.Locals("user_tier", "free")
		return HandleGetOverview(c)
	})
	req1, _ := http.NewRequest("GET", "/users/me/overview", nil)
	resp1, err := app.Test(req1)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if resp1.StatusCode != 200 {
		body, _ := io.ReadAll(resp1.Body)
		t.Fatalf("first call status %d: %s", resp1.StatusCode, body)
	}
	if got := resp1.Header.Get("X-Cache"); got != "miss" {
		t.Errorf("first call X-Cache: want miss, got %q", got)
	}

	// Second call: cache hit
	req2, _ := http.NewRequest("GET", "/users/me/overview", nil)
	resp2, err := app.Test(req2)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got := resp2.Header.Get("X-Cache"); got != "hit" {
		t.Errorf("second call X-Cache: want hit, got %q", got)
	}

	// Cleanup
	Rdb.Del(context.Background(), RedisOverviewCachePrefix+userID)
}

func TestInvalidateOverviewCache_DeletesKey(t *testing.T) {
	if Rdb == nil {
		t.Skip("Redis not initialised")
	}
	userID := "test-invalidate-" + fmt.Sprintf("%d", time.Now().UnixNano())
	key := RedisOverviewCachePrefix + userID

	Rdb.Set(context.Background(), key, []byte("test"), 60*time.Second)
	InvalidateOverviewCache(context.Background(), userID)

	_, err := Rdb.Get(context.Background(), key).Result()
	if err == nil {
		t.Error("expected cache key to be deleted, but it still exists")
	}
}
```

Add the missing imports if needed: `net/http`, `io`.

- [ ] **Step 3: Run all overview tests**

Run: `cd api && go test ./core/ -run "TestBuildIdentity|TestBuildTier|TestGetChannelSummary|TestHandleGetOverview|TestInvalidateOverview" -v 2>&1 | tail -25`

Expected: all PASS or SKIP (depending on DB/Redis availability locally).

- [ ] **Step 4: Run full Go test suite**

Run: `cd api && go test ./... 2>&1 | tail -10`

Expected: all existing tests still pass; new ones pass or skip gracefully.

- [ ] **Step 5: Commit Phase 2**

```bash
git add api/core/handlers_overview.go api/core/handlers_overview_test.go api/core/server.go api/core/stripe_webhook.go api/core/handlers_channel.go api/core/user_deletion.go api/core/auth.go
git commit -m "feat(api): GET /users/me/overview with singleflight + invalidation"
```

---

# PHASE 3 — Desktop client refactor

This phase consumes the new endpoint, adds the GDPR export and stats components, and bumps to v1.0.4.

### Task 3.1: UserOverview interface + userApi.overview()

**Files:**
- Modify: `desktop/src/api/client.ts`

- [ ] **Step 1: Inspect existing userApi shape**

Run: `grep -n "userApi\|export const userApi\|fetchSubscription" desktop/src/api/client.ts | head -10`

Expected: Find the existing `userApi` namespace (or equivalent). Note how other methods are written (`authFetch`, error handling, return shape).

- [ ] **Step 2: Add UserOverview interface**

In `desktop/src/api/client.ts`, near the existing `SubscriptionInfo` interface, add:

```ts
export interface UserOverview {
  identity: {
    sub: string;
    email: string;
    name: string;
    username: string;
  };
  tier: {
    current: string;
    is_super_user: boolean;
    label: string;
    limits: {
      symbols: number;
      feeds: number;
      custom_feeds: number;
      leagues: number;
      fantasy: number;
      max_ticker_rows: number;
      max_ticker_customization: boolean;
    };
  };
  subscription: SubscriptionInfo | null;
  channels: {
    total: number;
    enabled: number;
    by_type: Array<{ type: string; enabled: boolean; visible: boolean }>;
  };
  fantasy: {
    yahoo_connected: boolean;
    yahoo_synced: boolean;
    league_count: number;
  } | null;
  gdpr: {
    deletion_status: "none" | "pending" | "canceled" | "purged";
    requested_at: string | null;
    purge_at: string | null;
  };
  links: {
    logto_account: string;
  };
}
```

- [ ] **Step 3: Add the fetcher method**

Append to the existing `userApi` namespace (or wherever `fetchSubscription` lives):

```ts
async overview(): Promise<UserOverview> {
  const response = await authFetch("/users/me/overview", { method: "GET" });
  if (!response.ok) {
    throw new Error(`overview fetch failed: ${response.status}`);
  }
  return response.json();
}
```

If the existing pattern uses standalone functions (not a namespace), add:

```ts
export async function fetchOverview(): Promise<UserOverview> {
  const response = await authFetch("/users/me/overview", { method: "GET" });
  if (!response.ok) {
    throw new Error(`overview fetch failed: ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 4: Type-check**

Run: `cd desktop && npx tsc --noEmit 2>&1 | head -10`

Expected: clean (no errors).

- [ ] **Step 5: No commit yet** — Phase 3 commits as a unit at the end.

---

### Task 3.2: Query options

**Files:**
- Modify: `desktop/src/api/queries.ts`

- [ ] **Step 1: Inspect queryKeys + existing options shape**

Run: `grep -n "queryKeys\|queryOptions\|dashboard" desktop/src/api/queries.ts | head -10`

Expected: Locate `queryKeys` constant (used for query identification across the app) and the existing `dashboardQueryOptions` pattern.

- [ ] **Step 2: Extend queryKeys + add options**

In `desktop/src/api/queries.ts`, add to the `queryKeys` const:

```ts
userOverview: ["userOverview"] as const,
```

Then add (near `dashboardQueryOptions`):

```ts
import { fetchOverview, type UserOverview } from "./client";  // adjust import shape if userApi.overview() pattern is in use

export function userOverviewQueryOptions() {
  return queryOptions<UserOverview>({
    queryKey: queryKeys.userOverview,
    queryFn: fetchOverview,
    staleTime: 30_000,        // matches server cache
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}
```

- [ ] **Step 3: Type-check**

Run: `cd desktop && npx tsc --noEmit 2>&1 | head -10`

Expected: clean.

- [ ] **Step 4: No commit yet.**

---

### Task 3.3: AccountStatsRow component (with test)

**Files:**
- Create: `desktop/src/components/settings/AccountStatsRow.tsx`
- Create: `desktop/src/components/settings/AccountStatsRow.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `desktop/src/components/settings/AccountStatsRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AccountStatsRow } from "./AccountStatsRow";

describe("AccountStatsRow", () => {
  it("renders nothing when total channels is 0", () => {
    const { container } = render(
      <AccountStatsRow
        channelsTotal={0}
        channelsEnabled={0}
        fantasy={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the channel count when channels exist", () => {
    render(
      <AccountStatsRow
        channelsTotal={4}
        channelsEnabled={3}
        fantasy={null}
      />
    );
    expect(screen.getByText(/3 of 4/)).toBeInTheDocument();
  });

  it("hides fantasy line when fantasy is null", () => {
    render(
      <AccountStatsRow
        channelsTotal={2}
        channelsEnabled={2}
        fantasy={null}
      />
    );
    expect(screen.queryByText(/fantasy league/i)).toBeNull();
  });

  it("shows fantasy league count when connected", () => {
    render(
      <AccountStatsRow
        channelsTotal={2}
        channelsEnabled={2}
        fantasy={{ yahoo_connected: true, yahoo_synced: true, league_count: 3 }}
      />
    );
    expect(screen.getByText(/3 fantasy league/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && npx vitest run src/components/settings/AccountStatsRow.test.tsx 2>&1 | tail -10`

Expected: FAIL with `Cannot find module './AccountStatsRow'`.

- [ ] **Step 3: Implement the component**

Create `desktop/src/components/settings/AccountStatsRow.tsx`:

```tsx
import type { UserOverview } from "../../api/client";

interface AccountStatsRowProps {
  channelsTotal: number;
  channelsEnabled: number;
  fantasy: UserOverview["fantasy"];
}

export function AccountStatsRow({
  channelsTotal,
  channelsEnabled,
  fantasy,
}: AccountStatsRowProps) {
  if (channelsTotal === 0) return null;

  const showFantasy = fantasy !== null && fantasy.yahoo_connected && fantasy.league_count > 0;

  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-base-200 border border-edge">
      <div className="text-xs text-fg-3 uppercase tracking-wider">Quick stats</div>
      <div className="text-sm text-fg-2">
        <span className="font-medium text-fg">{channelsEnabled}</span>
        <span className="text-fg-3"> of </span>
        <span className="font-medium text-fg">{channelsTotal}</span>
        <span className="text-fg-3"> channels enabled</span>
      </div>
      {showFantasy && (
        <div className="text-sm text-fg-2">
          <span className="font-medium text-fg">{fantasy!.league_count}</span>
          <span className="text-fg-3"> fantasy league{fantasy!.league_count !== 1 ? "s" : ""} imported</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && npx vitest run src/components/settings/AccountStatsRow.test.tsx 2>&1 | tail -10`

Expected: 4 PASS.

- [ ] **Step 5: No commit yet.**

---

### Task 3.4: AccountExportButton component (with test)

**Files:**
- Create: `desktop/src/components/settings/AccountExportButton.tsx`
- Create: `desktop/src/components/settings/AccountExportButton.test.tsx`

- [ ] **Step 1: Inspect existing API patterns**

Run: `grep -n "authFetch\|/users/me/export" desktop/src/api/client.ts | head -5`

Expected: locate `authFetch` and verify there's no existing export call. We'll add it as part of this task since the website already has it but desktop doesn't.

- [ ] **Step 2: Write the failing tests**

Create `desktop/src/components/settings/AccountExportButton.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccountExportButton } from "./AccountExportButton";

// Mock the @tauri-apps/plugin-shell open() function
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

// Mock the API
vi.mock("../../api/client", () => ({
  exportUserData: vi.fn().mockResolvedValue(new Blob(["test"], { type: "application/zip" })),
}));

describe("AccountExportButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the button in idle state", () => {
    render(<AccountExportButton />);
    expect(screen.getByRole("button", { name: /download my data/i })).toBeInTheDocument();
  });

  it("shows loading state when clicked", async () => {
    render(<AccountExportButton />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(screen.getByText(/preparing/i)).toBeInTheDocument();
    });
  });

  it("renders error state when fetch fails", async () => {
    const { exportUserData } = await import("../../api/client");
    vi.mocked(exportUserData).mockRejectedValueOnce(new Error("network down"));

    render(<AccountExportButton />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd desktop && npx vitest run src/components/settings/AccountExportButton.test.tsx 2>&1 | tail -10`

Expected: FAIL.

- [ ] **Step 4: Add the export API helper**

Modify `desktop/src/api/client.ts` — add a new function near `userApi`:

```ts
export async function exportUserData(): Promise<Blob> {
  const response = await authFetch("/users/me/export", { method: "GET" });
  if (!response.ok) {
    throw new Error(`export failed: ${response.status}`);
  }
  return response.blob();
}
```

- [ ] **Step 5: Implement the button component**

Create `desktop/src/components/settings/AccountExportButton.tsx`:

```tsx
import { useState } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { exportUserData } from "../../api/client";

type ButtonState = "idle" | "loading" | "error";

export function AccountExportButton() {
  const [state, setState] = useState<ButtonState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleClick() {
    setState("loading");
    setErrorMessage("");
    try {
      const blob = await exportUserData();
      // Trigger browser download via blob URL — works in Tauri webview.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myscrollr-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(msg);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
      >
        {state === "loading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Preparing your data…</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>Download my data</span>
          </>
        )}
      </button>
      {state === "error" && (
        <div className="flex items-center gap-1.5 text-xs text-down">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Failed: {errorMessage}</span>
        </div>
      )}
      <p className="text-xs text-fg-4">
        To delete your account, visit{" "}
        <span className="text-fg-3">myscrollr.com/account</span>.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd desktop && npx vitest run src/components/settings/AccountExportButton.test.tsx 2>&1 | tail -10`

Expected: 3 PASS.

- [ ] **Step 7: No commit yet.**

---

### Task 3.5: Refactor AccountSettings.tsx to consume overview

**Files:**
- Modify: `desktop/src/components/settings/AccountSettings.tsx`

- [ ] **Step 1: Read current state**

Run: `cd desktop && wc -l src/components/settings/AccountSettings.tsx`

Note total line count. Open the file and identify:
- Where `useShell()` provides `subscriptionInfo`, `tier`, `authenticated`
- Where `TierLimitsTable` is rendered
- Where existing API calls happen (none on this page directly, per spec)

- [ ] **Step 2: Add overview query**

Near the top of the component:

```tsx
import { useQuery } from "@tanstack/react-query";
import { userOverviewQueryOptions } from "../../api/queries";
import { AccountStatsRow } from "./AccountStatsRow";
import { AccountExportButton } from "./AccountExportButton";

// Inside component body:
const { data: overview } = useQuery(userOverviewQueryOptions());
```

- [ ] **Step 3: Render the new sections**

Find the existing layout (Account → Subscription → Your Plan → Reset). Insert sections so the order becomes:
1. Account (unchanged)
2. **Quick Stats** (NEW)
3. Subscription (data sourced from overview, fallback to shell context)
4. Your Plan (TierLimitsTable; prefer `overview?.tier.limits ?? TIER_LIMITS[currentTier]`)
5. **Your Data** (NEW)
6. Reset all settings (unchanged)

For Quick Stats:

```tsx
{overview && (
  <AccountStatsRow
    channelsTotal={overview.channels.total}
    channelsEnabled={overview.channels.enabled}
    fantasy={overview.fantasy}
  />
)}
```

For Your Data:

```tsx
<section className="flex flex-col gap-3">
  <h3 className="text-xs text-fg-3 uppercase tracking-wider">Your data</h3>
  <AccountExportButton />
</section>
```

For Tier Limits, change:

```tsx
<TierLimitsTable tier={tier} />
```

to:

```tsx
<TierLimitsTable tier={tier} limits={overview?.tier.limits ?? undefined} />
```

(Then update `TierLimitsTable` to accept the optional `limits` prop and use it when provided. If `TierLimitsTable` doesn't take a limits prop today, this is a small follow-up edit.)

- [ ] **Step 4: Run type-check + tests**

Run: `cd desktop && npx tsc --noEmit 2>&1 | head -10`

Expected: clean. If `TierLimitsTable` needs the new optional prop, add it.

Run: `cd desktop && npx vitest run 2>&1 | tail -10`

Expected: all 171+ tests pass (any new failures indicate test fixtures need updating).

- [ ] **Step 5: No commit yet.**

---

### Task 3.6: Update __root.tsx to derive subscriptionInfo from overview

**Files:**
- Modify: `desktop/src/routes/__root.tsx`

- [ ] **Step 1: Inspect current subscription wiring**

Run: `grep -n "fetchSubscription\|subscriptionInfo" desktop/src/routes/__root.tsx | head -10`

Expected: Find the existing `fetchSubscription()` call and where `subscriptionInfo` is plumbed into `useShell()` context.

- [ ] **Step 2: Replace with overview-derived value**

Replace:

```tsx
const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null);

useEffect(() => {
  fetchSubscription().then(setSubscriptionInfo).catch(...);
  // ... window focus refresh
}, []);
```

With:

```tsx
import { useQuery } from "@tanstack/react-query";
import { userOverviewQueryOptions } from "../api/queries";

const { data: overview } = useQuery(userOverviewQueryOptions());
const subscriptionInfo = overview?.subscription ?? null;
```

The window-focus refresh is preserved by `refetchOnWindowFocus: true` in the query options (Task 3.2).

If the existing tier-mismatch detector hook reads from `subscriptionInfo` and JWT roles, leave it alone — it'll just use the new value automatically.

- [ ] **Step 3: Type-check**

Run: `cd desktop && npx tsc --noEmit 2>&1 | head -10`

Expected: clean.

- [ ] **Step 4: No commit yet.**

---

### Task 3.7: Bump desktop to v1.0.4

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json`
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/Cargo.toml`

- [ ] **Step 1: Bump package.json**

Run: `grep -n '"version"' desktop/package.json | head -3`

Edit the top-level `"version": "1.0.3"` → `"version": "1.0.4"`.

- [ ] **Step 2: Bump tauri.conf.json**

Run: `grep -n '"version"' desktop/src-tauri/tauri.conf.json | head -3`

Edit `"version": "1.0.3"` → `"version": "1.0.4"`.

- [ ] **Step 3: Bump Cargo.toml**

Run: `grep -n 'version' desktop/src-tauri/Cargo.toml | head -3`

Edit `version = "1.0.3"` → `version = "1.0.4"` (typically near the top of `[package]`).

- [ ] **Step 4: Bump package-lock.json**

Run: `grep -n '"version"' desktop/package-lock.json | head -5`

Edit BOTH the top-level `"version": "1.0.3"` and the `"packages": { "": { ... "version": "1.0.3" } }` entry → `"1.0.4"`. This file has two version strings that must both be updated.

- [ ] **Step 5: Verify all four match**

Run: `grep -n '"version"' desktop/package.json desktop/package-lock.json desktop/src-tauri/tauri.conf.json && grep -n 'version = "1' desktop/src-tauri/Cargo.toml`

Expected: All entries show `1.0.4`.

- [ ] **Step 6: No commit yet.**

---

### Task 3.8: Final verify + commit Phase 3

- [ ] **Step 1: Full TypeScript check**

Run: `cd desktop && npx tsc --noEmit 2>&1 | head -20`

Expected: clean.

- [ ] **Step 2: Run all Vitest**

Run: `cd desktop && npx vitest run 2>&1 | tail -15`

Expected: all tests pass (171 from Batch A + the 7 new ones in Phase 3 = 178 total).

- [ ] **Step 3: Build verify**

Run: `cd desktop && npm run build 2>&1 | tail -5`

Expected: `built in <X>s`. The 500 KB chunk-size warning is pre-existing and unchanged.

- [ ] **Step 4: Cargo check (Tauri backend)**

Run: `cd desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5`

Expected: `Finished dev profile`.

- [ ] **Step 5: Commit Phase 3**

```bash
git add desktop/src/api/client.ts desktop/src/api/queries.ts \
  desktop/src/components/settings/AccountStatsRow.tsx \
  desktop/src/components/settings/AccountStatsRow.test.tsx \
  desktop/src/components/settings/AccountExportButton.tsx \
  desktop/src/components/settings/AccountExportButton.test.tsx \
  desktop/src/components/settings/AccountSettings.tsx \
  desktop/src/routes/__root.tsx \
  desktop/package.json desktop/package-lock.json \
  desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml
git commit -m "feat(desktop): consume /users/me/overview + GDPR export + stats card (v1.0.4)"
```

---

# PHASE 4 — Website client refactor

This phase swaps the website's 4-fetch fan-out for a single overview consumer.

### Task 4.1: UserOverview type + userApi.overview()

**Files:**
- Modify: `myscrollr.com/src/api/client.ts`

- [ ] **Step 1: Inspect existing client shape**

Run: `grep -n "userApi\|getSubscription\|exportUserData" myscrollr.com/src/api/client.ts | head -10`

- [ ] **Step 2: Add the same UserOverview interface**

Add to `myscrollr.com/src/api/client.ts`. The shape mirrors the desktop interface verbatim (use `'`, no `;`, trailing comma per Prettier config):

```ts
export interface UserOverview {
  identity: {
    sub: string
    email: string
    name: string
    username: string
  }
  tier: {
    current: string
    is_super_user: boolean
    label: string
    limits: {
      symbols: number
      feeds: number
      custom_feeds: number
      leagues: number
      fantasy: number
      max_ticker_rows: number
      max_ticker_customization: boolean
    }
  }
  subscription: SubscriptionResponse | null
  channels: {
    total: number
    enabled: number
    by_type: Array<{ type: string; enabled: boolean; visible: boolean }>
  }
  fantasy: {
    yahoo_connected: boolean
    yahoo_synced: boolean
    league_count: number
  } | null
  gdpr: {
    deletion_status: 'none' | 'pending' | 'canceled' | 'purged'
    requested_at: string | null
    purge_at: string | null
  }
  links: {
    logto_account: string
  }
}
```

(Note: website uses `SubscriptionResponse`; desktop uses `SubscriptionInfo`. Same shape, different name. Both are fine.)

- [ ] **Step 3: Add the fetcher to userApi**

Inside the existing `userApi` namespace:

```ts
async overview(): Promise<UserOverview> {
  return apiFetch<UserOverview>('/users/me/overview')
},
```

(`apiFetch` is the website's existing fetch wrapper — match the pattern of neighboring methods.)

- [ ] **Step 4: Type-check + format**

Run: `cd myscrollr.com && npm run check 2>&1 | tail -10`

Expected: clean (Prettier formats automatically; ESLint --fix passes).

Run: `cd myscrollr.com && npx tsc --noEmit 2>&1 | head -10`

Expected: clean.

- [ ] **Step 5: No commit yet.**

---

### Task 4.2: Refactor account.tsx

**Files:**
- Modify: `myscrollr.com/src/routes/account.tsx`

- [ ] **Step 1: Inspect current fetches**

Run: `grep -n "useQuery\|getIdTokenClaims\|channelsApi.getAll\|deletion-status" myscrollr.com/src/routes/account.tsx | head -10`

Expected: 3 separate `useQuery` calls + Logto SDK usage for claims.

- [ ] **Step 2: Replace with single overview query**

Find:

```ts
const { data: claims } = useQuery({ queryKey: ['claims'], queryFn: getIdTokenClaims })
const { data: channelsData } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.getAll })
const { data: deletionStatus } = useQuery({ queryKey: ['deletion-status'], queryFn: ... })
```

(or whatever the actual code is)

Replace with:

```ts
import { userApi, type UserOverview } from '@/api/client'

const { data: overview } = useQuery({
  queryKey: ['user-overview'],
  queryFn: userApi.overview,
  staleTime: 30_000,
  retry: 1,
})
```

- [ ] **Step 3: Re-route reads to overview shape**

Find every reference to `claims.username`, `claims.name`, `channelsData.length`, `deletionStatus.status` — replace each:

| Old | New |
|---|---|
| `claims?.username` | `overview?.identity.username` |
| `claims?.name` | `overview?.identity.name` |
| `claims?.email` | `overview?.identity.email` |
| `channelsData?.length` | `overview?.channels.total` |
| `channelsData?.filter(c => c.enabled).length` | `overview?.channels.enabled` |
| `deletionStatus?.status` | `overview?.gdpr.deletion_status` |
| `deletionStatus?.requested_at` | `overview?.gdpr.requested_at` |

- [ ] **Step 4: Type-check**

Run: `cd myscrollr.com && npx tsc --noEmit 2>&1 | head -10`

Expected: clean.

- [ ] **Step 5: No commit yet.**

---

### Task 4.3: Refactor SubscriptionStatus.tsx

**Files:**
- Modify: `myscrollr.com/src/components/billing/SubscriptionStatus.tsx`

- [ ] **Step 1: Inspect current shape**

Run: `grep -n "useQuery\|billingApi\|getPreferences\|tier" myscrollr.com/src/components/billing/SubscriptionStatus.tsx | head -10`

- [ ] **Step 2: Switch to consuming overview**

Change the component to accept `subscription` and `tier` as props from `account.tsx` (passed in from the overview query), instead of fetching internally:

```tsx
interface SubscriptionStatusProps {
  subscription: UserOverview['subscription']
  tier: string
}

export function SubscriptionStatus({ subscription, tier }: SubscriptionStatusProps) {
  // existing render logic — replace internal queries with the props
}
```

In `account.tsx`, update the render call:

```tsx
{overview && (
  <SubscriptionStatus
    subscription={overview.subscription}
    tier={overview.tier.current}
  />
)}
```

Mutating actions (`createPortalSession`, `cancelSubscription`) remain inside `SubscriptionStatus` and continue to call their existing endpoints directly — those endpoints aren't superseded by overview.

- [ ] **Step 3: Type-check + format**

Run: `cd myscrollr.com && npm run check 2>&1 | tail -10`

Expected: clean.

- [ ] **Step 4: No commit yet.**

---

### Task 4.4: Update AccountDangerZone for gdpr from overview

**Files:**
- Modify: `myscrollr.com/src/components/account/AccountDangerZone.tsx`

- [ ] **Step 1: Inspect current shape**

Run: `grep -n "deletion_status\|deletionStatus\|useQuery" myscrollr.com/src/components/account/AccountDangerZone.tsx | head -10`

- [ ] **Step 2: Switch to prop-driven for the pending banner**

Change the component to accept `deletionStatus` as a prop:

```tsx
interface AccountDangerZoneProps {
  deletionStatus: UserOverview['gdpr']['deletion_status']
  requestedAt: string | null
  purgeAt: string | null
}
```

Existing mutation calls (`requestDeletion`, `cancelDeletion`, `exportUserData`) stay as-is — they're mutating endpoints not covered by overview.

In `account.tsx`:

```tsx
{overview && (
  <AccountDangerZone
    deletionStatus={overview.gdpr.deletion_status}
    requestedAt={overview.gdpr.requested_at}
    purgeAt={overview.gdpr.purge_at}
  />
)}
```

- [ ] **Step 3: Type-check + format + build**

Run: `cd myscrollr.com && npm run check 2>&1 | tail -10`

Expected: clean.

Run: `cd myscrollr.com && npm run build 2>&1 | tail -5`

Expected: `vite build` clean.

- [ ] **Step 4: Commit Phase 4**

```bash
git add myscrollr.com/src/api/client.ts \
  myscrollr.com/src/routes/account.tsx \
  myscrollr.com/src/components/billing/SubscriptionStatus.tsx \
  myscrollr.com/src/components/account/AccountDangerZone.tsx
git commit -m "refactor(marketing): /account consumes /users/me/overview"
```

---

# PHASE 5 — Verification, push, PR, post-merge ops

### Task 5.1: Final verification across the stack

- [ ] **Step 1: Backend full test**

Run: `cd api && go vet ./... && go test ./... 2>&1 | tail -10`

Expected: clean vet, all tests pass or skip gracefully.

Run: `cd channels/fantasy/api && go vet ./... && go build -o /tmp/f && rm -f /tmp/f`

Expected: clean.

- [ ] **Step 2: Desktop full test**

Run: `cd desktop && npx tsc --noEmit && npx vitest run && npm run build 2>&1 | tail -10`

Expected: 178+ tests pass, build clean.

Run: `cd desktop && cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3`

Expected: `Finished dev profile`.

- [ ] **Step 3: Website check + build**

Run: `cd myscrollr.com && npm run check && npm run build 2>&1 | tail -10`

Expected: clean lint + format, vite build succeeds.

- [ ] **Step 4: Inspect uncommitted state**

Run: `git status`

Expected: clean working tree (4 commits made: phase 1, 2, 3, 4).

Run: `git log --oneline main..HEAD`

Expected: 4 commits (one per phase).

---

### Task 5.2: Push branch + open PR

- [ ] **Step 1: Push branch**

Run: `git push -u origin feature/batch-b-account-overview 2>&1 | tail -3`

Expected: branch published.

- [ ] **Step 2: Open PR**

Run:

```bash
gh pr create --title "feat(account): unified /users/me/overview endpoint + both clients (v1.0.4)" --body "$(cat <<'EOF'
## Summary

- Adds `GET /users/me/overview` to core API: identity + tier + subscription + channel summary + GDPR + fantasy summary in one round-trip; 30s Redis cache with singleflight; webhook + CRUD + GDPR mutations invalidate.
- Adds `GET /users/me/yahoo-summary` to fantasy API for the overview fan-out.
- Refactors desktop Account tab to consume `/users/me/overview` once; adds Quick Stats card and a GDPR export button. Bumps desktop to **v1.0.4**.
- Refactors website `/account` to drop 3 separate fetches in favor of the overview endpoint.

## Spec

- `docs/superpowers/specs/2026-04-28-batch-b-account-overview-design.md`

## Plan

- `docs/superpowers/plans/2026-04-28-batch-b-account-overview.md`

## Post-merge ops

After merge, update the Logto custom JWT script to add `username` and `name` claims:

```js
const getCustomJwtClaims = async ({ token, context }) => {
  const { user } = context;
  return {
    roles: user.roles?.map((role) => role.name) ?? [],
    email: user.primaryEmail ?? '',
    username: user.username ?? '',
    name: user.name ?? '',
  };
};
```

Until rolled out, the API returns `''` for `identity.name` and `identity.username` — clients handle this gracefully.

## Verification

- Backend: `go vet ./... && go test ./...` (api + channels/fantasy/api) — clean
- Desktop: `npx tsc --noEmit && npx vitest run && npm run build` — clean (178+ tests)
- Website: `npm run check && npm run build` — clean
- Manual smoke: desktop Account tab renders Quick Stats + Subscription + Tier Limits + Your Data; export button downloads ZIP; website /account renders identically with one fetch.

EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Mark Phase 5 complete**

Done. Plan exhausted.

---

### Task 5.3: Post-merge — update Logto JWT script

**External step (manual, after PR merges):**

- [ ] **Step 1: Open Logto admin console**
- [ ] **Step 2: Navigate to "Custom JWT" → "Access token"**
- [ ] **Step 3: Replace the script content with the four-line version from the spec**
- [ ] **Step 4: Save and redeploy if needed**
- [ ] **Step 5: Wait for token rollover (~1h)** — `identity.name` and `identity.username` will start populating

---

# Self-review

**Spec coverage check:**
- ✅ GET /users/me/overview endpoint shape — Tasks 2.1–2.7
- ✅ Yahoo summary endpoint — Task 1.1
- ✅ Logto JWT script update — documented in Task 5.3 + spec
- ✅ Desktop Account tab Quick Stats — Task 3.3, 3.5
- ✅ Desktop Account tab GDPR export — Task 3.4, 3.5
- ✅ Desktop tier-limits from overview — Task 3.5
- ✅ Desktop subscription from overview — Task 3.6
- ✅ Desktop v1.0.4 bump — Task 3.7
- ✅ Website /account refactor — Task 4.2
- ✅ Website SubscriptionStatus refactor — Task 4.3
- ✅ Website AccountDangerZone refactor — Task 4.4
- ✅ Cache invalidation hooks — Task 2.6
- ✅ Singleflight + 30s cache — Task 2.5
- ✅ Fantasy fan-out 1s timeout, fail-open — Task 2.4
- ✅ Tests for backend (cache, identity, tier, GDPR pending) — Tasks 2.2, 2.3, 2.7
- ✅ Tests for desktop (stats card, export button) — Tasks 3.3, 3.4

**Out of scope (per spec) and excluded:**
- ❌ In-app cancel subscription (Decision 3 = no)
- ❌ Delete account on desktop (Decision 1 = no)
- ❌ Tier limits on website /account (Decision 4 = desktop only)
- ❌ Settings IA redesign (Batch C)
- ❌ Channel.visible rename (Batch C)
- ❌ Removing tierLimits.ts hardcoded constants entirely (future cleanup)

**Type consistency check:**
- `UserOverview` interface defined identically in desktop and website (Tasks 3.1, 4.1)
- Backend `OverviewResponse` Go struct mirrors the TS interface (Task 2.1)
- Cache key prefix `overview:` consistent across handler + invalidator (Task 2.5)
- `SubscriptionResponse` (website) vs `SubscriptionInfo` (desktop) — pre-existing naming difference, not introduced by this batch
- `InvalidateOverviewCache` signature matches across all 3 invalidation hook sites (Task 2.6)

**No placeholders detected.** All steps have concrete code, exact paths, exact commands.

---
