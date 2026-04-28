# Batch B — Account Overview Design

**Date:** 2026-04-28
**Status:** Approved (decisions locked, awaiting spec sign-off before plan)
**Scope:** New `GET /users/me/overview` endpoint that consolidates identity + tier + subscription + channel summary + GDPR + fantasy summary into one round-trip; refactor desktop and website Account pages to consume it; minor desktop additions (GDPR export button, channel/league stats card)
**Sequence:** Second in a three-batch plan. Batch A (quick fixes) shipped at PR #124. Batch C (settings IA redesign + website support page) follows.

---

## Why this batch

The website's `/account` page currently fans out across 4-5 separate fetches: identity claims via the Logto SDK, channels via `/users/me/channels`, subscription via `/users/me/subscription`, preferences via `/users/me/preferences`, and GDPR status via `/users/me/delete/status`. The desktop's Account tab is similar but coarser — it fetches subscription only, decodes the JWT for identity, and uses local hardcoded constants for tier limits.

That divergence is the source of "data all over the place" — both clients touch overlapping concerns through different shapes. A single `GET /users/me/overview` endpoint becomes the source-of-truth for both surfaces, eliminates per-platform drift on identity/billing/tier, and reduces page-load round-trips on the website from 4-5 to 1.

This is the foundation Batch C needs: with overview shipping, the settings IA redesign on desktop can confidently remove or relocate Account sections knowing their data still flows through one canonical endpoint.

---

## Decisions locked

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | GDPR on desktop | Export only; delete website-only | Desktop adds a "Download my data" button. Account deletion stays gated to website to keep accidental clicks rare. |
| 2 | Stats card on desktop | Yes, match website Quick Stats | Show "X of Y channels enabled" + "Z fantasy leagues imported" when applicable. Pulled from overview response. |
| 3 | In-app cancel on desktop | No, portal-only | Desktop continues to send users to Stripe portal. Website is the canonical billing surface. |
| 4 | Tier-limits table | Desktop only | Website ignores `tier.limits` field; visitors looking for tier comparisons go to `/uplink`. Cleaner separation. |
| 5 | Cache TTL | 30s Redis with singleflight | Mirror the `/dashboard` pattern. Webhook-driven invalidation handles real-time state. |
| 6 | JWT identity source | Add `username` + `name` to existing custom JWT | One-line script change. Zero Logto admin round-trips per request. Lowest latency. |
| 7 | Desktop release | Bump to v1.0.4 | Substantive user-visible changes (Account tab section). |

---

## API contract — `GET /users/me/overview`

### Endpoint

- **Method:** `GET`
- **Path:** `/users/me/overview`
- **Auth:** Required (Logto JWT via existing middleware)
- **Cache:** 30s per-user in Redis under key `overview:{logto_sub}`. Singleflight via a package-level `overviewGroup singleflight.Group` (mirrors `dashboardGroup` in `handlers_channel.go`).
- **Invalidation triggers** (`Rdb.Del("overview:" + sub)`):
  - Stripe webhook events that mutate `stripe_customers` (`api/core/stripe_webhook.go` — add to the existing handler tail)
  - Channel CRUD (`api/core/handlers_channel.go` — add to create/update/delete paths)
  - GDPR state changes (`api/core/user_deletion.go` — add to request/cancel/purge paths)

### Response shape

```jsonc
{
  "identity": {
    "sub": "logto-uuid",
    "email": "user@example.com",     // from JWT
    "name": "Brandon",                // from JWT (custom claim — see "Logto JWT script update" below)
    "username": "brandon"             // from JWT (custom claim) — null when user hasn't set one
  },
  "tier": {
    "current": "uplink_pro",          // resolved from JWT roles claim
    "is_super_user": false,
    "label": "Uplink Pro",            // server-rendered display name
    "limits": {                       // desktop consumes this; website ignores
      "symbols": 75,
      "feeds": 100,
      "custom_feeds": 3,
      "leagues": 20,
      "fantasy": 3,
      "max_ticker_rows": 3,
      "max_ticker_customization": false
    }
  },
  "subscription": {                   // SubscriptionResponse, embedded inline
    "plan": "pro_monthly",
    "status": "active",
    "current_period_end": "2026-05-21T00:00:00Z",
    "lifetime": false,
    "amount": 2499,
    "currency": "usd",
    "interval": "month",
    "trial_end": null,
    "pending_downgrade_plan": null,
    "scheduled_change_at": null,
    "had_prior_sub": true
  },
  "channels": {
    "total": 4,
    "enabled": 3,
    "by_type": [
      { "type": "finance",  "enabled": true,  "visible": true },
      { "type": "sports",   "enabled": true,  "visible": true },
      { "type": "rss",      "enabled": true,  "visible": false },
      { "type": "fantasy",  "enabled": false, "visible": false }
    ]
  },
  "fantasy": {                        // null when fantasy channel disabled or unreachable
    "yahoo_connected": true,
    "yahoo_synced": true,
    "league_count": 2
  },
  "gdpr": {
    "deletion_status": "none",        // none | pending | canceled | purged
    "requested_at": null,
    "purge_at": null
  },
  "links": {                          // server-built so clients don't need env vars
    "logto_account": "https://logto.example.com/account?client_id=...&redirect=..."
  }
}
```

### Error & degradation behavior

- **Fantasy channel unreachable** (timeout, 5xx, channel not registered in Redis) → `fantasy: null` in the response; rest of the payload still serves. 1-second context timeout per fan-out call. Same pattern as `/dashboard`'s per-channel error handling.
- **Logto admin call failure** — not applicable since identity reads from JWT only (no admin call in the hot path after Decision 6).
- **Stripe data missing** (user has no `stripe_customers` row) → `subscription: null` (free-tier user with no past subscription); rest of the payload serves.
- **GDPR table empty** for this user → `gdpr.deletion_status: "none"` and the timestamps are null.
- **Database failure** → 500 with the standard error envelope. No partial response.

### Cache key collision avoidance

- Key prefix `overview:` is distinct from `dashboard:` and `tier-limits:`. No collision with existing entries.
- Cache value is the full JSON-serialized response payload (same pattern as `/dashboard`).
- TTL: 30 seconds. Long enough to coalesce dashboard polling + Account tab visits; short enough that Stripe webhook lag-driven staleness self-resolves quickly even if invalidation hooks fail.

---

## Logto JWT script update

The existing custom JWT script needs two additional claims. **Drop-in replacement** for the Logto admin's getCustomJwtClaims script:

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

The change is purely additive — existing consumers (desktop's `getTier()`, `getUserIdentity()`) continue to work unchanged; new consumers (the overview handler) read `username` and `name` from the JWT directly.

After deployment of the JWT script change, existing access tokens still won't carry `username`/`name` until they're refreshed (token TTL ~1h on Logto's default config). The overview endpoint should treat both fields as nullable strings to handle the rollout window gracefully — `username: ""` is valid and means "not set".

---

## Backend implementation (Go)

### Files

- **New:** `api/core/handlers_overview.go` — handler + assembly + cache invalidation helper
- **New:** `api/core/handlers_overview_test.go` — happy path + fantasy-down + cache hit/miss + GDPR pending state
- **Modify:** `api/core/server.go` — register `GET /users/me/overview`
- **Modify:** `api/core/stripe_webhook.go` — invalidate cache on `customer.subscription.*` and `customer.subscription.updated/deleted` events
- **Modify:** `api/core/handlers_channel.go` — invalidate cache in CreateChannel, UpdateChannel, DeleteChannel handlers
- **Modify:** `api/core/user_deletion.go` — invalidate cache in RequestDeletion, CancelDeletion, PurgeUser handlers
- **New:** `channels/fantasy/api/yahoo_summary.go` (or similar) — small handler returning `{ yahoo_connected, yahoo_synced, league_count }`
- **Modify:** `channels/fantasy/api/main.go` — register the new route at `/users/me/yahoo-summary`

### Handler structure (pseudocode)

```go
package core

import (
  "context"
  "fmt"
  "encoding/json"
  "time"
  "golang.org/x/sync/singleflight"
  "github.com/gofiber/fiber/v2"
)

var overviewGroup singleflight.Group

const (
  RedisOverviewCachePrefix = "overview:"
  OverviewCacheTTL = 30 * time.Second
  FantasyFanoutTimeout = 1 * time.Second
)

func HandleGetOverview(c *fiber.Ctx) error {
  userID := GetUserSub(c)  // from JWT middleware

  // 1. Fast path: serve from cache
  cacheKey := RedisOverviewCachePrefix + userID
  if cached, err := Rdb.Get(c.Context(), cacheKey).Bytes(); err == nil {
    c.Set("X-Cache-Hit", "1")
    return c.Send(cached)
  }

  // 2. Slow path: assemble + cache, with singleflight to coalesce
  result, err, _ := overviewGroup.Do(userID, func() (interface{}, error) {
    return assembleOverview(c.Context(), userID, c)
  })
  if err != nil {
    return c.Status(500).JSON(ErrorResponse{Status: "error", Error: err.Error()})
  }

  payload, _ := json.Marshal(result)
  Rdb.Set(c.Context(), cacheKey, payload, OverviewCacheTTL)
  return c.Send(payload)
}

func assembleOverview(ctx context.Context, userID string, c *fiber.Ctx) (*OverviewResponse, error) {
  identity := buildIdentityFromJWT(c)  // reads sub, email, name, username from c.Locals
  tier := buildTierFromJWT(c)          // reads roles claim, builds {current, label, is_super_user, limits}
  subscription, _ := getSubscriptionForUser(ctx, userID)  // reuses existing code from handlers_billing.go
  channels, _ := getChannelSummary(ctx, userID)            // SELECT count, COUNT(enabled), array_agg from user_channels
  gdpr, _ := getDeletionStatus(ctx, userID)                // reuses existing code from user_deletion.go
  fantasy := nil
  if hasFantasyChannel(channels) {
    // fan out to fantasy channel with 1s timeout; on error, leave nil
    ctxFantasy, cancel := context.WithTimeout(ctx, FantasyFanoutTimeout)
    defer cancel()
    fantasy, _ = fetchFantasySummary(ctxFantasy, userID)
  }

  return &OverviewResponse{
    Identity:     identity,
    Tier:         tier,
    Subscription: subscription,
    Channels:     channels,
    Fantasy:      fantasy,
    GDPR:         gdpr,
    Links:        buildAccountLinks(),  // logto_account URL from env
  }, nil
}

func InvalidateOverviewCache(ctx context.Context, userID string) {
  if userID == "" { return }
  key := RedisOverviewCachePrefix + userID
  if err := Rdb.Del(ctx, key).Err(); err != nil {
    log.Printf("[Overview] cache invalidate failed for %s: %v", userID, err)
  }
}
```

### Fantasy fan-out

Today the fantasy API exposes `/users/me/yahoo-status` (boolean state) and `/users/me/yahoo-leagues` (full leagues list). For overview, we want a single coalesced read returning `{ yahoo_connected, yahoo_synced, league_count }`.

**Add as part of this batch:** new endpoint `GET /users/me/yahoo-summary` to `channels/fantasy/api/`, registered in the discovery payload at `channels/fantasy/api/main.go:331-333`. The handler is small — counts rows in `yahoo_user_leagues` for the user and reads `yahoo_users.connected`, `yahoo_users.synced` flags. Reuses the existing per-channel auth (`Auth: true`).

The core overview handler proxies via the existing channel-discovery mechanism (Redis-registered base URL), makes the call with the 1-second timeout, parses, and embeds. On error: `fantasy: null` in the response, log the failure but don't fail the whole request.

### Database queries needed

Most queries reuse existing helpers; only one new query is required:

```sql
-- Channel summary: total, enabled count, per-type breakdown
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE enabled = true) AS enabled_count,
  COALESCE(json_agg(json_build_object(
    'type', channel_type,
    'enabled', enabled,
    'visible', visible
  ) ORDER BY channel_type), '[]'::json) AS by_type
FROM user_channels
WHERE logto_sub = $1;
```

Lives in `handlers_overview.go` as a `getChannelSummary(ctx, userID)` helper. No new tables, no migrations.

---

## Desktop refactor

### Files

- **New:** `desktop/src/components/settings/AccountStatsRow.tsx` — small stats card showing channel + fantasy counts
- **New:** `desktop/src/components/settings/AccountExportButton.tsx` — GDPR export button
- **Modify:** `desktop/src/api/client.ts` — `userApi.overview()` method, `UserOverview` interface mirroring the response shape
- **Modify:** `desktop/src/api/queries.ts` — `userOverviewQueryOptions` for TanStack Query
- **Modify:** `desktop/src/components/settings/AccountSettings.tsx` — consume overview, render new sections
- **Modify:** `desktop/src/routes/__root.tsx` — derive `subscriptionInfo` from overview query result instead of separate `fetchSubscription` call (single source of truth in shell context)
- **Modify:** `desktop/src/auth.ts` — keep `getTier()` working (reads JWT roles); `getUserIdentity()` continues to decode JWT — both unchanged. Overview is for full-shape data needs.

### Account tab layout (top to bottom)

1. **Account** — email + plan label + Sign out (unchanged shape; data sourced from overview)
2. **Quick Stats** *(NEW)* — `X of Y channels enabled` + (when fantasy is connected) `Z fantasy leagues imported`. Hidden when channels.total === 0 (fresh install).
3. **Subscription** — same UX as today; data sourced from overview
4. **Your Plan** — `TierLimitsTable`, data sourced from `overview.tier.limits` (replaces local hardcoded constants in `desktop/src/tierLimits.ts` over time; for this batch the table reads from overview, but the hardcoded fallback stays for first-paint before the query resolves)
5. **Your Data** *(NEW)* — single button: `Download my data`. Below it, a small note: *"To delete your account, visit myscrollr.com/account."*
6. **Reset all settings** — local-only, unchanged

### `tierLimits.ts` strategy

Today's hardcoded constants in `desktop/src/tierLimits.ts` are used as a synchronous render-time mirror. The overview query is async and may not have resolved on first render. Strategy:

- Keep `desktop/src/tierLimits.ts` for first-paint fallback values (current behavior).
- After the overview query resolves, prefer `overview.tier.limits` for display (component-level prop drilling — `AccountSettings` passes `overview?.tier.limits ?? TIER_LIMITS[currentTier]` to `TierLimitsTable`).
- Long-term: a future cleanup could remove the hardcoded constants entirely if first-paint fallback isn't strictly necessary, but that's out of scope for Batch B.

### Loading and error states

The overview query's TanStack Query options include `staleTime: 30_000` (matches server cache) and `retry: 1`. The Account tab renders a skeleton state while loading and falls back to existing per-endpoint queries (subscription only) on error so it never shows a blank page. Same defensive degradation as the fantasy fan-out.

### `useTierMismatchDetector` hook

Today `__root.tsx:259-270` has a hook that detects when JWT roles disagree with subscription state and calls `auth.refreshTier()`. After Batch B, `overview.tier.current` is the canonical tier (sourced from JWT roles), and `overview.subscription.status` is the Stripe state. The mismatch detector reads both from overview directly — one less independent fetch.

---

## Website refactor

### Files

- **Modify:** `myscrollr.com/src/api/client.ts` — `userApi.overview()` method, `UserOverview` type
- **Modify:** `myscrollr.com/src/routes/account.tsx` — replace 4-5 separate fetches with single overview query; remove `getIdTokenClaims()` Logto SDK call (read identity from overview instead)
- **Modify:** `myscrollr.com/src/components/billing/SubscriptionStatus.tsx` — accept overview-shaped props or fetch from overview internally; remove the standalone `billingApi.getSubscription()` + `getPreferences()` round-trips for the tier mismatch
- **Modify:** `myscrollr.com/src/components/account/AccountDangerZone.tsx` — keep calling `/users/me/delete/*` and `/users/me/export` directly (these are mutating endpoints, not data reads); only the `gdpr.deletion_status` for the pending banner reads from overview

### `account.tsx` changes (specific)

Today's structure:

```tsx
// 5 separate fetches:
const { data: claims } = useQuery({ queryKey: ["claims"], queryFn: getIdTokenClaims });
const { data: channels } = useQuery({ queryKey: ["channels"], queryFn: channelsApi.getAll });
const { data: deletionStatus } = useQuery({ queryKey: ["deletion-status"], queryFn: ... });
// + SubscriptionStatus internally fetches subscription + preferences
```

After Batch B:

```tsx
// 1 fetch covering everything:
const { data: overview } = useQuery({ ...userOverviewQueryOptions });
```

The greeting (`Welcome back, {name}`) reads from `overview.identity.username ?? overview.identity.name`. The Public Profile card visibility (currently `claims.username` truthy check) reads from `overview.identity.username` truthy. Quick Stats card reads `overview.channels.total`, `overview.channels.enabled`. Subscription card reads `overview.subscription`. AccountDangerZone reads `overview.gdpr` for the pending banner; uses its existing direct API for mutations.

### Logto SDK retention

The `@logto/react` SDK stays installed. It's still needed for:
- Auth state lifecycle (sign-in, sign-out, refresh) — none of which Batch B touches
- The hub card link to Logto Account Center (Logto's own profile management)

We just stop calling `getIdTokenClaims()` on `/account` for display purposes; identity for display comes from overview.

---

## Migration & rollout

1. **Backend deploy first.** `/users/me/overview` goes live with cache + singleflight + invalidation hooks. Existing endpoints stay live and unchanged so existing client builds keep working.
2. **Logto JWT script update second.** Apply the one-line change in the Logto admin console. Existing access tokens still don't have `username`/`name` until they refresh (~1h). The overview handler reads JWT claims optimistically; missing claims serialize as `""` (empty strings).
3. **Desktop refactor next.** Account tab switches to consuming overview. Bump `desktop/src-tauri/tauri.conf.json` to v1.0.4 and ship a new release. Smoke-test the page renders identically plus the new Quick Stats and Export sections.
4. **Website refactor last.** Marketing site `/account` page consumes overview. Deploy.

### Stale-cache safety

If `overview` returns 5xx or times out (1s default, 5s hard cap), each client falls back to the existing per-endpoint queries for that page render. No hard dependency on the new endpoint for this rollout.

### `tier_limits` deprecation

The `/tier-limits` endpoint stays in service — it's still consumed by:
- The website's `/uplink` page (pricing/comparison view)
- The desktop tier limits hardcoded fallback (which will be removed in a future cleanup)
- Public, anonymous callers (no auth required) for marketing-site pre-render

Overview's `tier.limits` is for authenticated users only and is a pre-baked subset of `/tier-limits`; the two endpoints coexist with different audiences.

---

## Testing

### Backend

- **`api/core/handlers_overview_test.go`** — uses the existing pgx mock pattern from `core/billing_test.go`:
  - `TestOverview_HappyPath` — paid user with all fields populated
  - `TestOverview_FreeTier_NoSubscription` — `subscription: null` branch
  - `TestOverview_FantasyDisconnected` — `fantasy: null` branch
  - `TestOverview_FantasyChannelUnreachable` — fan-out timeout, `fantasy: null`, rest of payload serves
  - `TestOverview_DeletionPending` — `gdpr.deletion_status: "pending"`
  - `TestOverview_CacheHit` — second call returns cached bytes without re-assembly
  - `TestOverview_CacheInvalidation` — `InvalidateOverviewCache` deletes the key, next call rebuilds

### Desktop

- **`desktop/src/components/settings/AccountStatsRow.test.tsx`** — renders count line correctly with various `(total, enabled)` combinations; hides when total is 0
- **`desktop/src/components/settings/AccountExportButton.test.tsx`** — calls export endpoint, opens result via Tauri shell
- **`desktop/src/api/client.test.ts`** *(extend)* — `userApi.overview()` request shape

No new tests for the website (no Vitest setup currently for `/account` page; spec doesn't require adding one). Smoke test inline.

---

## Versioning

- **Desktop:** v1.0.3 → v1.0.4 (per Decision 7). Bump `desktop/package.json`, `desktop/package-lock.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml` (4 files) all to `1.0.4`.
- **Website:** No version bump (rolling deploy via Coolify).
- **API:** No version bump (rolling deploy; this is an additive endpoint that doesn't break existing consumers).

---

## PR shape

Single PR titled `feat(account): unified /users/me/overview endpoint + both clients (v1.0.4)`. Three logical commits:

1. `feat(api): GET /users/me/overview endpoint with singleflight + invalidation hooks`
2. `feat(desktop): consume /users/me/overview on Account tab + GDPR export + stats card (v1.0.4)`
3. `refactor(marketing): /account consumes /users/me/overview`

Branch name: `feature/batch-b-account-overview`.

Post-merge: deploy API first, update Logto JWT script second, then ship the desktop release (Coolify auto-deploys the website).

---

## Out of scope (deferred to Batch C)

- Settings IA redesign on desktop (Batch C)
- `Channel.visible` field rename to `tickerEnabled` (Batch C — flagged during Batch B due to user-reported confusion about RSS chips not appearing on the ticker)
- Website `/support` route + contact form (Batch C)
- Website `/account` getting tier-limits table (Decision 4 = no; if reversed, that's a separate cleanup)
- Removing `desktop/src/tierLimits.ts` hardcoded constants entirely (kept for first-paint fallback; future cleanup)
- Adding `cancel subscription` to desktop UI (Decision 3 = no)
- Adding `delete account` to desktop UI (Decision 1 = no)

---

## Acceptance criteria

- `go test ./api/core/...` clean (existing 7 tests + new overview tests)
- `cd api && go vet ./...` clean
- `cd desktop && npx tsc --noEmit` clean
- `cd desktop && npx vitest run` — all tests passing (171 from Batch A + new overview tests)
- `cd desktop && npm run build` clean
- `cd myscrollr.com && npm run check` clean
- `cd myscrollr.com && npm run build` clean
- Manual smoke test on dev API + dev desktop + dev marketing build:
  - Desktop Account tab renders Quick Stats, Subscription, Tier Limits, Your Data sections in order
  - Desktop "Download my data" button downloads a ZIP via shell
  - Website /account renders with one fetch (verify in Network tab)
  - Website username greeting + Public Profile hub card visibility match overview response
  - Cancellation a paid sub from Stripe portal → website /account reflects within 30s
  - Adding a channel via desktop → desktop and website Account tabs both update within 30s
  - Disconnecting fantasy → `overview.fantasy` becomes `null`; both clients hide the league count gracefully
- Logto JWT script updated; verify a freshly-issued access token contains `username` and `name` claims
- Desktop v1.0.4 release published (or draft ready for publish)
