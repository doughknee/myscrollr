# Sprint 2: Reconcile Tier Limits — Single Source of Truth

**Audit severity:** BLOCKER (A1 — marketing promises exceed what the desktop enforces)

**Branch:** `feature/sprint-2-tier-limits-reconcile`

**Status:** active

## Problem

The launch audit surfaced a consumer-protection-grade discrepancy between the
pricing page and the desktop app. Marketing promises higher caps than the
enforced limits for every tier except Ultimate.

| Limit            | Marketing (`uplink.tsx`) | Desktop (`tierLimits.ts`) |
| ---------------- | ------------------------ | ------------------------- |
| Free symbols     | 10                       | **5**                     |
| Free RSS feeds   | 5                        | **1**                     |
| Free fantasy     | 1 league                 | **0**                     |
| Uplink RSS feeds | 50                       | **25**                    |
| Uplink custom    | 10                       | **1**                     |
| Uplink fantasy   | 3                        | **1**                     |
| Pro RSS feeds    | 150                      | **100**                   |
| Pro custom       | 25                       | **3**                     |
| Pro fantasy      | 10                       | **3**                     |

A user who pays for Pro expecting 150 feeds gets 100. The copy on the pricing
page is higher than what the app allows. This is a legal and trust problem.

## Decision

Keep the enforced desktop values. Edit marketing to match. Put the canonical
definition in the Go backend so Sprint 3 (backend enforcement) and the two
clients read from a single place.

## Goals

1. **Source of truth in the backend.** A Go map, committed to the repo, is
   the one place tier limits are defined.
2. **Public `GET /tier-limits` endpoint** returning JSON matching the Go
   struct. No auth required — these are marketing-visible numbers.
3. **Marketing site fetches at runtime.** The pricing page, comparison
   table, tier showcases, and FAQ all read from the endpoint (with a
   server-matching fallback embedded for first-paint / offline). Numbers
   can no longer drift because the source of the string is the API.
4. **Desktop keeps `tierLimits.ts` synchronous for now.** Channel config
   panels and the onboarding wizard read tier caps during render; we are
   not doing an async refactor in this sprint. `tierLimits.ts` is kept
   **manually synchronized** with the backend, with a doc comment and a
   lightweight Go test that asserts the JSON shape the endpoint returns
   matches what desktop expects.
5. **No behavioral change for paying users.** The desktop already enforces
   the lower numbers; marketing was simply wrong. Pricing copy updates are
   a strict downward revision. No one's limit shrinks.

## Non-goals

- Backend enforcement on `POST/PUT /users/me/channels`. That's Sprint 3.
- Per-user TwelveData/Yahoo budgets. Sprint 3.
- Runtime edits to tier limits from an admin panel. Not needed for v1.0.
- Async desktop migration. Channel panels keep synchronous access.

## Canonical values

The desktop values, promoted to source of truth:

| Tier              | symbols    | feeds    | customFeeds | leagues  | fantasy  |
| ----------------- | ---------- | -------- | ----------- | -------- | -------- |
| `free`            | 5          | 1        | 0           | 1        | 0        |
| `uplink`          | 25         | 25       | 1           | 8        | 1        |
| `uplink_pro`      | 75         | 100      | 3           | 20       | 3        |
| `uplink_ultimate` | unlimited  | unlimited| 10          | unlimited| 10       |
| `super_user`      | unlimited  | unlimited| unlimited   | unlimited| unlimited|

`unlimited` surfaces as JSON `null` on the wire (instead of JS `Infinity`
which doesn't round-trip through JSON). Both clients translate `null` back
to unlimited in their presentation layer.

## Backend

### New file: `api/core/tier_limits.go`

```go
package core

type ChannelLimits struct {
    Symbols     *int `json:"symbols"`
    Feeds       *int `json:"feeds"`
    CustomFeeds *int `json:"custom_feeds"`
    Leagues     *int `json:"leagues"`
    Fantasy     *int `json:"fantasy"`
}

type TierLimitsResponse struct {
    Tiers map[string]ChannelLimits `json:"tiers"`
}

// DefaultTierLimits is the authoritative source for per-tier caps.
// Desktop and website both read from here (desktop via build-time sync,
// website via GET /tier-limits at runtime).
var DefaultTierLimits = map[string]ChannelLimits{
    "free":            {Symbols: intPtr(5),  Feeds: intPtr(1),  CustomFeeds: intPtr(0),  Leagues: intPtr(1),  Fantasy: intPtr(0)},
    "uplink":          {Symbols: intPtr(25), Feeds: intPtr(25), CustomFeeds: intPtr(1),  Leagues: intPtr(8),  Fantasy: intPtr(1)},
    "uplink_pro":      {Symbols: intPtr(75), Feeds: intPtr(100),CustomFeeds: intPtr(3),  Leagues: intPtr(20), Fantasy: intPtr(3)},
    "uplink_ultimate": {Symbols: nil,        Feeds: nil,        CustomFeeds: intPtr(10), Leagues: nil,        Fantasy: intPtr(10)},
    "super_user":     {Symbols: nil,        Feeds: nil,        CustomFeeds: nil,        Leagues: nil,        Fantasy: nil},
}

func HandleGetTierLimits(c *fiber.Ctx) error {
    c.Set("Cache-Control", "public, max-age=300") // 5min cache
    return c.JSON(TierLimitsResponse{Tiers: DefaultTierLimits})
}
```

### Route

Register `GET /tier-limits` in `server.go` under public routes, before the
protected block.

### Test

`api/core/tier_limits_test.go` asserts the exact numeric values shipped
— protecting against accidental edits. If a future sprint needs to change
a cap, the test must be updated together with the constant, forcing an
intentional diff.

## Marketing website

### Fetcher

Add `tierLimitsOptions()` to `myscrollr.com/src/api/client.ts`:

```ts
export interface ChannelLimits {
  symbols: number | null
  feeds: number | null
  custom_feeds: number | null
  leagues: number | null
  fantasy: number | null
}

export const tierLimitsOptions = queryOptions({
  queryKey: ['tier-limits'],
  queryFn: () =>
    request<{ tiers: Record<string, ChannelLimits> }>('/tier-limits'),
  staleTime: 5 * 60 * 1000, // 5 min — matches Cache-Control
})
```

Plus a helper `fmtLimit(n: number | null, unit: string)` that renders `25
symbols` or `Unlimited`.

### `uplink.tsx` changes

1. **Fallback constant** — embed the same values hardcoded at the top of
   the file so first paint isn't empty. Exact shape of the API response.
2. **`useQuery(tierLimitsOptions)`** — replace the fallback.
3. **`COMPARISON` → builder function** — takes `tierLimits` and produces
   the rows with correct numeric strings (`10 symbols` → `5 symbols` for
   free, etc.). Feature rows that don't depend on limits (Data Delivery,
   Custom Alerts, etc.) stay static.
4. **`TIER_SHOWCASES` → builder function** — same treatment for the
   feature bullets per tier.
5. **`UPLINK_FAQ` → builder function** — inline numbers in the highlight
   + answer text read from the fetched values.

### Fallback values

The fallback constant in `uplink.tsx` matches `DefaultTierLimits`
exactly. A CI-style assertion isn't required here — the useQuery
re-renders almost instantly with the real values, so the fallback only
exists for 10-50ms of first paint.

## Desktop

### `desktop/src/tierLimits.ts` — update

- Add doc comment at the top:

  ```ts
  /**
   * SOURCE OF TRUTH: api/core/tier_limits.go (DefaultTierLimits)
   *
   * If you edit these numbers here, you MUST also update:
   *   - api/core/tier_limits.go (the Go map)
   *   - api/core/tier_limits_test.go (the assertion)
   *   - myscrollr.com/src/routes/uplink.tsx (the fallback FALLBACK_LIMITS)
   *
   * Keep them identical. Drift breaks billing trust.
   */
  ```

- Values unchanged. Desktop continues to work synchronously, reading from
  the same values the backend will enforce in Sprint 3.

## Acceptance

1. `GET https://api.myscrollr.com/tier-limits` returns:

   ```json
   {
     "tiers": {
       "free": { "symbols": 5, "feeds": 1, "custom_feeds": 0, "leagues": 1, "fantasy": 0 },
       "uplink": { "symbols": 25, "feeds": 25, "custom_feeds": 1, "leagues": 8, "fantasy": 1 },
       "uplink_pro": { "symbols": 75, "feeds": 100, "custom_feeds": 3, "leagues": 20, "fantasy": 3 },
       "uplink_ultimate": { "symbols": null, "feeds": null, "custom_feeds": 10, "leagues": null, "fantasy": 10 },
       "super_user": { "symbols": null, "feeds": null, "custom_feeds": null, "leagues": null, "fantasy": null }
     }
   }
   ```

2. Marketing site comparison table shows **5 / 25 / 75 / Unlimited**
   tracked symbols (down from 10/25/75 on free), **1 / 25 / 100 /
   Unlimited** feeds, etc. Tier showcase bullets reflect these numbers.
   FAQ copy reflects these numbers.

3. Go tests pass: `go test ./core/...`

4. Desktop builds unchanged (`npm run build` passes).

5. Grep confirmation: no hardcoded "10 symbols", "50 feeds", "150 feeds",
   "25 custom", "10 leagues", "3 leagues" strings remain in `uplink.tsx`
   source. All limit strings flow from `tierLimits` or `FALLBACK_LIMITS`.

## Rollout

1. Ship both (core-api + website) in the same deploy run. Desktop not
   required this sprint.
2. Post-deploy verification via `curl` and visual check on
   `https://myscrollr.com/uplink`.
3. No migration, no data change — pure copy + one new endpoint.
