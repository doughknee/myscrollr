# Design: Scrollr Widget Model & Slot-Based Pricing

**Status:** proposed (brainstorm locked 2026-06-30, pending implementation approval)
**Date:** 2026-06-30
**Author:** brainstorming session
**Branch:** `claude/settings-refactor`

## Background

The [2026-05-09 desktop IA refactor](2026-05-09-desktop-ia-refactor-design.md) unified the desktop chassis around one model — **Library / Source / Ticker** — and introduced the Catalog. It deliberately left two structural problems untouched:

1. **Configuration still means navigating *into* a thing.** To add a stock you go Home → Finance card → Source page → Configure tab → add symbol. The IA refactor reduced this to 2 tabs but kept the "go to the source, then click into it" shape. This is the friction the user describes: *"not intuitive that you have to go to the specific widget and then click it… way too many menus and areas to learn."*

2. **Two primitives, two storage layers, and a 7-dimensional price model.** "Channels" (finance/sports/rss/fantasy/predictions) are server rows in `user_channels`; "widgets" (clock/timer/weather/sysmon/uptime/github) are client-only `prefs.widgets`. Monetization is **5 tiers × 7 caps** (`symbols`, `feeds`, `custom_feeds`, `leagues`, `fantasy`, `max_ticker_rows`, `max_ticker_customization`) plus an undocumented 8th lever — real-time delivery is gated to Ultimate at [`handlers_channel.go:71`](../../../api/core/handlers_channel.go). The caps are mirrored across three files held in sync by CI tests, so every pricing change is a 4-file change.

This redesign collapses both problems into **one primitive (the widget), one surface (the Catalog), one price lever (slots).**

### The de-risking insight

Splitting the coarse "channels" into fine widgets is **presentation-layer work, not a data-plane rewrite.** CDC is already per-item:

| Data source | CDC topic granularity | Source |
|---|---|---|
| finance | `cdc:finance:{SYMBOL}` (per symbol) | `handlers_webhook.go` |
| sports | `cdc:sports:{LEAGUE}` (per league) | `channels.go:71,102` per-league subscriber sets |
| rss | `cdc:rss:{feed-hash}` (per feed) | `events.go` `TopicForRSSFeed()` |
| fantasy | `cdc:fantasy:{league_key}` (per league) | join resolution |

No new services, tables, or CDC topics are required. Stocks-vs-crypto already exists as `tracked_symbols.category` in the finance service. The work is: introduce a widget abstraction over these sources, merge the desktop registries, and replace the cap model with a slot count.

## Goals

- **One user-facing primitive: the widget.** "Channels" disappear from the UI; backend services become invisible *data sources*.
- **Configure where you discover.** Adding and configuring a widget both happen inline in the Catalog. Eliminate the per-source Configure/Display tabs.
- **One monetization lever: max active widget slots.** Collapse 7 caps → 1 number per plan.
- **Universal real-time.** Remove the Ultimate-only SSE gate; retire tier-branched polling as the steady-state path.
- **Zero disruption to existing subscribers and billing.** The Stripe → plan → Logto role → JWT pipeline is untouched; existing users are grandfathered.

## Non-goals

- New data sources beyond splitting existing ones. Predictions widget granularity coordinates with the [predictions channel plan](../../channels/predictions-channel-plan.md) but its expansion is out of scope here.
- Changing Stripe products/prices or the Logto role model. Tiers keep their identities and price points; only what a tier *grants* changes.
- Re-architecting ingestion services, CDC tables, or topics — already per-item granular.
- Mobile (separate track).
- Onboarding wizard work (already removed by the IA refactor).

## Mental model: Source → Widget → Catalog → Ticker

Four nouns; the user only ever sees the last three.

- **Data source** *(invisible)* — a backend service + CDC table (finance, sports, rss, fantasy, predictions). Users never see or pick these. Unchanged by this work.
- **Widget** — the only user-facing primitive. A widget is a **named, pre-filtered view over a data source** (or a local-only utility). "MLB" = sports▸MLB. "Crypto" = finance▸crypto. "News" = rss + your feeds. "Clock" = local, no source.
- **Catalog** — the one surface. Browse, add, remove, and inline-configure widgets. Locked widgets (beyond your slot count) show an upsell. Replaces every Source page Configure/Display tab.
- **Ticker** — the radar. The live preview *and* a direct-manipulation control surface (right-click a widget to tweak, drag to reorder). No separate "display" pages.

| Verb | Canonical home (today → proposed) |
|---|---|
| Discover / add a widget | Catalog → **Catalog** (unchanged) |
| Configure a widget | Source page → Configure tab → **Catalog card, inline** |
| Set widget display | Source page → Configure → Display → **per-widget preset on the card; advanced via ticker right-click** |
| Remove a widget | Source page header Trash → **Catalog card toggle / ticker right-click** |
| View widget data | Source page Feed tab → **the ticker itself + Home preview** |
| Manage ticker rows | Settings → Ticker → **unchanged (now free for all tiers)** |
| Upgrade for more widgets | Account → Plan → **Catalog lock + Account → Plan** |

The per-widget **Source page becomes optional** — retained only as an optional "details/feed" drill-in from Home, with no Configure/Display tabs. All configuration lives on the Catalog card.

## The widget registry (new core primitive)

The load-bearing addition. Today `CreateChannel` validates `channel_type` against `GetValidChannelTypes()` — the set of services that self-registered in Redis ([`discovery.go:157`](../../../api/core/discovery.go), [`channels.go:262`](../../../api/core/channels.go)). That couples *user-facing widget types* to *backend service registration*: naively making `sports_mlb` a `channel_type` would be rejected at creation.

**Fix: a code-defined widget registry, decoupled from service discovery.** Service discovery keeps governing the *data-source/proxy* layer; a new registry governs *what widgets exist* and how each maps to a source.

```go
// WidgetKind distinguishes data-backed widgets from local-only utilities.
type WidgetKind string

const (
    WidgetData    WidgetKind = "data"    // backed by a data source + CDC
    WidgetUtility WidgetKind = "utility" // local-only (clock, weather, …)
)

// WidgetDef is the source of truth for one user-facing widget. Every
// widget costs exactly one slot. The desktop mirrors this table in TS.
type WidgetDef struct {
    ID         string            // "sports_mlb", "finance_stocks", "news", "clock"
    Label      string            // "MLB", "Stocks", "News", "Clock"
    Kind       WidgetKind
    DataSource string            // backing channel name ("sports"); "" for utilities
    Filter     map[string]string // {"league":"MLB"} / {"asset_class":"crypto"} — drives subscriptions
    Params     []string          // user-supplied config keys: ["symbols"], ["feeds"], nil
}
```

Validation (`CreateChannel`/`UpdateChannel`) checks `widget_type` against the registry instead of `GetValidChannelTypes()`. Subscription sync (below) reads `DataSource` + `Filter` instead of the hardcoded `if channelType == "sports"`.

### Initial widget catalog

**Data widgets** (split from today's coarse channels):

| Widget ID | Label | Data source | Filter | Params |
|---|---|---|---|---|
| `sports_mlb` | MLB | sports | `league=MLB` | — |
| `sports_nba` | NBA | sports | `league=NBA` | — |
| `sports_nhl` | NHL | sports | `league=NHL` | — |
| `sports_nfl` | NFL | sports | `league=NFL` | — |
| `sports_f1` | F1 | sports | `league=F1` | — |
| `sports_worldcup` | World Cup | sports | `league=WORLDCUP` | — |
| `finance_stocks` | Stocks | finance | `asset_class=stock` | `symbols` |
| `finance_crypto` | Crypto | finance | `asset_class=crypto` | `symbols` |
| `news` | News | rss | — | `feeds` |
| `fantasy_yahoo` | Yahoo Fantasy | fantasy | — | (OAuth) |
| `predictions` | Predictions | predictions | — | (TBD w/ predictions plan) |

**Utility widgets** (today's `prefs.widgets`, unchanged behavior, now first-class): `clock`, `timer`, `weather`, `sysmon`, `uptime`, `github`.

Notes:
- **Sports** widgets are zero-config — the league is implied by the ID, so `config` is empty (carry `favorite_teams` if present).
- **Stocks/Crypto** are *parameterized* (`symbols`), each with unlimited depth. The asset-class label is primarily a UI grouping; the finance service already handles both per-symbol via `tracked_symbols.category`, so no service change is needed for new data.
- **News** is one parameterized widget (`feeds`), not many. It's "the Stocks of news": Stocks = pick your tickers, News = pick your feeds. Its inline config holds the curated catalog toggles **and** the custom-URL field. The old `custom_feeds` cap is removed (depth is unlimited; slots are the only gate).

## Storage model & migration

### Unify all widgets into rows

Today: channels in `user_channels` (server), utilities in `prefs.widgets` (client). Because **every widget counts toward the slot limit**, counting must be authoritative and server-side. Therefore **all widgets — data and utility — become rows.**

- Keep the `user_channels` table and the `channel_type` column as storage (a later cosmetic migration can rename to `user_widgets`/`widget_type`; deferred to keep blast radius down). The column value now holds a **widget ID** from the registry.
- The existing `UNIQUE(logto_sub, channel_type)` constraint maps perfectly to the locked decision **"one instance per widget type."** No constraint change required.
- Utility rows have `DataSource=""`, empty subscriptions, and `config` holding the utility's local options. (Open question: whether utility *display options* stay in `prefs` and only *enabled-state* becomes a row — see Open Questions.)

A user's **active slot count = `SELECT count(*) FROM user_channels WHERE logto_sub=$1 AND enabled=true`.**

### Data migration (one-time)

For each existing user:

- **sports** row with `config.leagues=[L1,L2,…]` → one row per league: `channel_type = "sports_" + lower(L)`, `config = {}` (carry `favorite_teams`). Delete the old `sports` row.
- **finance** row with `config.symbols=[…]` → split by category into `finance_stocks` (config.symbols = stocks) and `finance_crypto` (config.symbols = crypto). Category source = the finance service's `tracked_symbols.category` (see Risks for the lookup approach). Delete the old `finance` row.
- **rss** row → rename to `news` (config carries `feeds` unchanged).
- **fantasy** row → rename to `fantasy_yahoo`.
- **predictions** row → rename/map per the predictions plan.
- **client `prefs.widgets` enabled utilities** → insert a row per enabled utility (`clock`, etc.).

**Grandfather rule:** on cutover, keep **every** migrated widget `enabled=true` even if the user now exceeds their new slot count. The slot cap is enforced **only on subsequent additions** — no existing free or paid user is auto-pruned. (Genuine later downgrades still prune; see below.)

## Subscriptions & CDC routing

Generalize the sports-specific block in `SyncChannelSubscriptions` / `addChannelSubscriptions` / `removeChannelSubscriptions` ([`channels.go:54–150`](../../../api/core/channels.go)) into a registry-driven loop:

For each enabled data widget row:
1. Look up its `WidgetDef`.
2. Derive subscriptions from `DataSource` + `Filter` + `config`:
   - **Sports:** `Filter["league"]` → add to `SportsLeagueSubscribersPrefix + league` (the per-league set that already exists). Per-league widgets subscribe **only** to their league set, not the coarse `channel:subscribers:sports` broadcast.
   - **Finance:** subscribe to per-symbol topics from `config.symbols` (already the routing key).
   - **News:** per-feed topics from `config.feeds` (already hashed per URL).
   - **Fantasy:** unchanged join resolution.
3. `NotifyTopicSubscriptionChange(logtoSub)` to rebuild active SSE topic subscriptions (ADR-0001) — unchanged.

Utility widgets create no subscriptions.

## Monetization redesign

### Single lever: slots

Replace the 7-field `ChannelLimits` with one cap. Strawman counts (locked as a starting point on 2026-06-30; tune against usage later):

| Plan | `max_widgets` | Maps from |
|---|---|---|
| `free` | 3 | free |
| `uplink` | 6 | uplink |
| `uplink_pro` | 12 | uplink_pro |
| `uplink_ultimate` | unlimited (`nil`) | uplink_ultimate |
| `super_user` | unlimited (`nil`) | super_user |
| (Lifetime) | unlimited | maps to ultimate role, as today |

```go
type ChannelLimits struct {
    MaxWidgets *int `json:"max_widgets"` // nil = unlimited
}
```

**Removed entirely:** `symbols`, `feeds`, `custom_feeds`, `leagues`, `fantasy`, `max_ticker_rows`, `max_ticker_customization`. Ticker rows and per-row customization become **free** for all tiers (locked decision).

### Enforcement

- **`ValidateChannelConfig` → slot check.** The per-field cap logic is deleted. On `CreateChannel` (and on `UpdateChannel` when toggling `enabled=true`), count the user's enabled widget rows; if adding/enabling would exceed `max_widgets[tier]`, return the existing structured 403 (repurpose `TierLimitError` with `Field="widgets"`).
- **`PruneChannelConfig` → `PruneWidgetsForTier`.** Per-field trimming is replaced by: on a genuine downgrade (Stripe `subscription.updated`/`deleted` → `PruneUserChannelsForTier`), if enabled widgets exceed the new cap, **disable** the lowest-priority widgets over the cap (priority = newest `created_at` first, or an explicit user pin — see Open Questions). Disable, don't delete — re-upgrading re-enables.
- **Real-time gate removed.** Delete the tier check at [`handlers_channel.go:71`](../../../api/core/handlers_channel.go).

### Billing pipeline — unchanged

Stripe price → `planFromPriceID` → `tierForPlan` → Logto role → JWT `tierFromRoles` is **fully intact**. We keep Uplink/Pro/Ultimate/Lifetime prices and roles; we only redefine what each role grants (a slot count instead of 7 caps). This is why existing subscribers migrate cleanly.

### The three-file sync

`DefaultTierLimits` is mirrored in four places pinned by CI tests; all must change together:
- `api/core/tier_limits.go` (`DefaultTierLimits`)
- `api/core/tier_limits.json` (sync snapshot)
- `desktop/src/tierLimits.ts` (`TIER_LIMITS` + helpers — replace `getMaxTickerRows`/`getLimit`/etc. with `getMaxWidgets`)
- `myscrollr.com/src/lib/fallbackTierLimits.ts` (`FALLBACK_LIMITS`)
- Tests: `api/core/tier_limits_test.go`, `desktop/src/tierLimits.test.ts`, `myscrollr.com/src/lib/fallbackTierLimits.test.ts`

## Real-time: universal SSE

Make live delivery available to every tier and retire tier-branched polling as the steady state:

- Remove the Ultimate gate at `handlers_channel.go:71`.
- Desktop: all clients use the existing SSE path; polling (`dashboardQueryOptions` refetch) is demoted to **initial load + reconnect fallback** only.
- **Cost profile:** more SSE subscribers do **not** increase upstream data-provider quota (TwelveData/api-sports) — CDC fans out already-ingested data via Redis. The only marginal cost is connection concurrency, which is bounded and horizontally scalable via API pods on the existing Redis fan-out (ADR-0001 multi-replica topic rebuild already handles this).
- **Pre-launch:** load-test the SSE hub at a few thousand idle connections; confirm clean reconnect/heartbeat under that load.

## UX redesign

### The Catalog is the primary surface

Extends the IA refactor's Catalog (`/catalog`). Card states per the existing hierarchy (not-added > added > locked):

- **Add** — not yet active. For zero-config widgets, one click activates. For parameterized widgets (Stocks/Crypto/News/Fantasy), the card **expands inline** to its config (symbol/feed picker, OAuth) — no navigation.
- **Added** — active. Inline controls: edit config, per-widget display preset, remove (toggle off).
- **Locked** — beyond the slot count. Shows "Using 3 of 3 — upgrade for more" with a deeplink to Account → Plan.

A compact **"Your ticker" strip** at the top shows active widgets as chips (drag to reorder). This subsumes the Home preview's role for the common case.

### Per-widget display: presets, not a matrix

The venue toggle matrix from [2026-04-25 display-venue-toggle](2026-04-25-display-venue-toggle-design.md) (per-metric off/feed/ticker/both) is **removed**. Each widget ships a sensible default and a small **preset** control (e.g. Compact ↔ Comfortable). Power users reach any remaining advanced toggles via right-click on the ticker. This deletes the single largest source of "too many menus."

### Ticker as control surface

Right-click a widget chip on the ticker → quick actions (remove, settings, move row). Drag to reorder. The thing you see is the thing you configure.

### Deleted UI

- The Source page **Configure** and **Display** tabs/sections (config moves to Catalog cards). The Source page is reduced to an optional read-only Feed/details drill-in, or removed if Home preview suffices.
- `DisplayPanel` venue-matrix components per channel.
- The separate `widgets/registry.ts` vs `channels/registry.ts` split (merged).

## File-level impact

**API (Go):**
- *New:* `api/core/widgets.go` — the `WidgetDef` registry + `GetValidWidgetTypes()`, slot-count helpers.
- *Modified:* `tier_limits.go` (→ `MaxWidgets`, slot validation, prune-by-disable), `tier_limits.json`, `tier_limits_test.go`; `channels.go` (validate against widget registry; registry-driven subscription sync); `handlers_channel.go` (remove SSE gate); `handlers_overview.go` (`buildTierFromContext` returns `max_widgets` + current count).
- *New migration:* `api/migrations/0000XX_split_channels_into_widgets.up.sql` — the data migration (split sports/finance rows, rename rss/fantasy/predictions, insert utility rows).

**Desktop (TS):**
- *New:* unified `desktop/src/widgets/registry.ts` (merge `channels/registry.ts` + `widgets/registry.ts` into one `WidgetManifest`); per-widget `WidgetCard` with inline config.
- *Modified:* `tierLimits.ts` (+ `.test.ts`) → `getMaxWidgets`; `catalog.tsx` (inline config, lock/upsell, "Your ticker" strip); `App.tsx` (single registry); ticker right-click menu; `api/client.ts` (slot-aware errors); `preferences.ts` (utility enabled-state → server rows).
- *Deleted:* per-channel `ConfigPanel.tsx`/`DisplayPanel.tsx` venue matrices; `channel.$type.$tab.tsx` + `widget.$id.$tab.tsx` Configure/Display tabs (or the routes entirely).

**Marketing (React):**
- *Modified:* `myscrollr.com/src/routes/uplink.tsx` (7-row comparison table → one "Widgets" row + feature callouts; FAQ rewrite); `lib/fallbackTierLimits.ts` (+ `.test.ts`).

## Implementation phases

Each phase commits independently; the model stays shippable between them.

1. **Widget registry + entitlements (backend, no user-visible change).** Add `widgets.go` registry; switch create/update validation to it (keep old channel_type IDs valid during transition); replace `ChannelLimits` with `MaxWidgets` across the 4 synced files + tests; remove the SSE gate.
2. **Data migration + subscription generalization.** Ship the migration (split/rename rows; insert utilities) behind the grandfather rule; generalize subscription sync to registry-driven. Verify CDC still flows per widget.
3. **Desktop registry merge + Catalog inline config.** Merge the two registries; build `WidgetCard` with inline config and lock/upsell; wire slot counting to `/overview`.
4. **Delete Source Configure/Display + venue matrix.** Collapse to per-widget presets; ticker right-click; remove dead routes/components.
5. **Pricing page + marketing.** Comparison table → one widgets number; FAQ; fallback limits.
6. **Polish + rollout.** Onboarding defaults (which widgets a new free user starts with, given 3 slots); SSE load-test; calibration review against migrated counts.

## Migration & rollout

- **Grandfather:** keep all migrated widgets enabled; enforce the cap only on new adds. Communicate the upgrade ("we made every tier deeper — unlimited items per widget — and simpler: one number").
- **Finance category source:** existing mixed `finance` rows need each symbol's `category`. Preferred: a finance-service lookup endpoint (batch categorize symbols). Fallback: seed all into Stocks and surface a one-time "we found crypto — split it out?" prompt.
- **Calibration check:** simulate the migration against production `user_channels` to confirm how many existing free users land over 3 slots (grandfathered, but informs whether Free should start at 4).
- **Pre-launch QA:** SSE concurrency load-test; verify per-widget CDC delivery; verify downgrade-prune disables (not deletes) the right widgets.

## Risks & open questions

**Risks:**
- *Finance category split for existing users* — needs a category source (see above). Lowest-risk fallback is the Stocks-default + prompt.
- *Slot calibration vs migrated reality* — finer widgets make 3 feel tight (2 sports + news already fills Free). Grandfather mitigates day-one; revisit Free=3 vs 4 after the calibration check.
- *SSE concurrency* — universal real-time raises connection counts; bounded and scalable, but must be load-tested before launch.
- *Superseding the venue-matrix* — some users may rely on per-metric venue control; presets must cover the common cases. This reverses a recent shipped spec — acceptable, it's the simplification the user wants.
- *The 4-file tier sync* — CI fails if any copy drifts; all must land in one PR.

**Open questions:**
1. **Utility storage:** do utility *display options* stay in `prefs.widgets` with only enabled-state mirrored to a row, or does all utility state move server-side? (Recommend: enabled-state → row for authoritative counting; keep local-only display options in prefs.)
2. **Downgrade prune priority:** newest-first, or a user-pinned priority order? (Recommend: newest-first v1; add pinning later.)
3. **Predictions granularity:** one `predictions` widget, or per-category? Coordinate with the [predictions plan](../../channels/predictions-channel-plan.md).
4. **Rename `user_channels`/`channel_type`?** Cosmetic; recommend deferring to a follow-up to keep this blast radius down.
5. **Onboarding defaults:** which 1–3 widgets does a fresh free account start with so the ticker self-demonstrates?

## Supersedes / relates to

- **Supersedes:** [2026-04-18 tier-enforcement](2026-04-18-tier-enforcement.md) and [2026-04-18 tier-limits-reconcile](2026-04-18-tier-limits-reconcile.md) (the 7-cap model); [2026-04-25 display-venue-toggle](2026-04-25-display-venue-toggle-design.md) (venue matrix → presets); the billing/IA boundaries left open by [2026-05-09 desktop IA refactor](2026-05-09-desktop-ia-refactor-design.md).
- **Builds on:** [2026-03-30 marketplace-design](2026-03-30-marketplace-design.md) (the Catalog); [2026-04-25 ticker-multi-deck](2026-04-25-ticker-multi-deck.md) (rows, now free); [2026-05-13 clock-timer-widget-split](2026-05-13-clock-timer-widget-split-design.md) (the utility-widget pattern this generalizes).
- **Coordinates with:** [predictions channel plan](../../channels/predictions-channel-plan.md).
