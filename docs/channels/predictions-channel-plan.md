# Scrollr "Predictions" Channel — Master Integration Plan

> **Status:** DRAFT — planning only. No code is to be written into the app from this document.
> **Goal:** Define the ultimate Scrollr channel: a real-time prediction-markets + player-props feed,
> anchored on Kalshi, designed to be the flagship channel that outclasses finance/sports/rss/fantasy.

---

## Iteration Log

| Pass | Focus | Key changes |
| --- | --- | --- |
| v0.1 | Initial synthesis from research | Strategic reframe (unified "Predictions" channel, not "Kalshi" or "PrizePicks"); compliance-first architecture; data-source matrix; mapping to Scrollr channel framework; phased roadmap |
| v0.2 | Adversarial critique vs. real `finance` code | **Corrected 3 errors:** routing is per-resource (not broadcast); finance has no write-throttling to reuse (coalescing is net-new); added the shared-`_sqlx_migrations` unique-prefix requirement. Added: Redis cache layer w/ real TTLs, Kalshi event-explosion grouping strategy, props-volume control, quota/rate-limit monitoring (api-football lesson), data retention/cleanup, dark-launch/rollout. |
| v0.3 | Product/UX stress-test + readiness | Added §8.1 ticker-UX realities (title compaction, default config, one-time compliance gate flow, broad-appeal categories). Added §14 readiness: walking-skeleton first PR, start-blocker vs go-live-blocker analysis (Q7 is the only hard start-blocker; R1/legal gates GA not build), and an "airtight" checklist. |
| v0.4 | Verify core routing claims vs real code | **Corrected v0.2's overcorrection.** Read `api/core/events.go` + `channels.go`: core has per-channel coupling — an `events.go` `switch ch.ChannelType` with a `case` per channel (the one unavoidable core edit), plus sports-style per-resource sets in `channels.go` that finance avoids by doing them channel-side. Rewrote §6.2 to the accurate 3-layer routing model; added the core edit to roadmap + files; new risk R13 (silent SSE failure if the `case` is missed). |
| v0.5 | Tier/billing placement + 2nd core touchpoint | Found `api/core/tier_limits.go`: channels are tier-gated, and caps are a **5-file CI-enforced sync** (drift guard, ties to June hardening memory). Added §6.6 (tier-limits touchpoint), roadmap core-edit-2, risk R14, and product decision Q10 (free vs premium placement + per-tier caps). Two distinct core touchpoints now mapped (events.go + tier_limits.go) that the initial exploration missed. **Converged.** |
| v0.6 | **Build: client-side account link + premier polish** (branch `claude/dreamy-curran-8f2152`) | Implemented GOAL A (on-device "Connect your Kalshi account" + My Positions) and GOAL B (premier polish). KEY ARCHITECTURE: the user's Kalshi key is stored **only in the OS keychain on the user's device** and signed locally by the desktop's Rust backend (`desktop/src-tauri/src/kalshi/` + `commands/kalshi.rs`) — never server-side (ToS §3.1/3.2/3.6/3.7). READ-ONLY (portfolio reads + read-only WS), never trades. GOAL B: market-detail modal + live sparkline, watchlist + local price alerts, Resolved Today recap, category lenses, WS seq-gap handling in the ingestion service. All-green; awaiting user local test + approval. Does NOT touch monetization/tiers (still uncapped). |

**Open decisions still needing the user** are collected in §13. Everything above that is my current best recommendation.

---

## 0. Decision Log

| Date | Decision | Rationale | Status |
| --- | --- | --- | --- |
| Jun 26 | **Build predictions channel-native now, widget-ready; widget/preset IA layer is Phase 2.** | Creds are the only blocker; widgets are a product-wide IA+pricing re-model that shouldn't gate the premier feature. Predictions becomes the proof-case/flagship tenant for the widget layer. | Recommended → confirm |
| Jun 26 | **"Widgets" = presentation layer (preset views), NOT backend splits.** A widget = `{channel, preset filter, label, icon, display mode}`. Channels stay 1-per-integration (no splitting finance into stocks/crypto services — same provider). | Avoids duplicated services/CDC/infra for zero benefit; gives users a concrete "Lego brick" gallery + a simpler "# of widgets" pricing story (hybrid w/ per-widget depth). | Recommended → Phase 2 |
| Jun 26 | **Pillar B props source = SportsGameOdds (MVP), defer OpticOdds.** | Legit sportsbook props at low/free tier to validate UX; normalize via `source_type`; upgrade to branded DFS lines only if proven. Proceeding autonomously per user OK. | Accepted |
| Jun 26 | **Predictions config axis = `{categories:[...], favorites:[...]}`, category-primary.** | This is the seam the Phase 2 widget gallery snaps into — each category becomes a gallery brick with ~zero rework. | Locked |
| Jun 26 | **Account linking is CLIENT-SIDE / on-device ONLY** (OS keychain, signed locally by the desktop Rust backend; READ-ONLY; never server-side, never trades). | Kalshi Developer Agreement §3.1/3.2/3.6/3.7 prohibit a third party storing/using other members' keys server-side; on-device is the only permitted model. There is no Kalshi OAuth, and retail keys are trade-capable, so treat the imported key like a password and keep it on the device. | Implemented (v0.6) |
| Jun 26 | **Watchlist + local price alerts are account-free + local** (localStorage prefs; sparklines from streamed ticks, not candlesticks yet). | Candlesticks need a signed call + a data pipeline not yet wired; local rolling history gives the live "heartbeat" with zero infra and works for everyone. | Implemented (v0.6) |

## 1. Executive Summary

**What we're building:** A new first-party Scrollr channel — working name **`predictions`** (UI brand: *"Markets"* or *"Action"*) — that streams live, resolvable real-world markets into the Scrollr ticker:

- **Pillar A — Kalshi event contracts** (flagship): "Will the Fed cut rates in July? 38¢ YES", "Will it hit 90°F in NYC today? 71¢", live sports event contracts, election/econ/culture markets. CFTC-regulated, legal in all 50 states, clean signed-REST + websocket API.
- **Pillar B — Player props / "pick'em" lines** (the PrizePicks-style experience): "LeBron James — Points — More/Less 27.5". Sourced from a **licensed odds vendor**, never scraped from PrizePicks.

**Why it wins:** Every existing channel shows you *what happened* (a score, a stock tick, a headline). This channel shows you *what's about to happen and what the crowd thinks it's worth* — a live, probabilistic, money-on-the-line view of the world that updates by the second. It's inherently more "alive" in a ticker than any other feed, and it spans politics, sports, econ, weather, and culture in one strip.

**The single most important design decision:** ship **display-only**. A read-only informational ticker sidesteps app-store gambling policies, state affiliate licensing, and geo/KYC requirements. Monetization (affiliate deep-links) is designed in as a **separately-gated layer on top of an always-compliant display core** — built for, but disabled until, legal review.

**Effort:** ~2–3 weeks for a polished Kalshi-only v1 (Pillar A). Pillar B adds ~1–2 weeks plus a vendor contract. This maps almost 1:1 onto the existing `finance` channel, which already does signed external API + websocket ingestion + CDC + ticker UI.

---

## 2. The Strategic Reframe (read this first)

The user's instinct — "a Kalshi channel, maybe a PrizePicks channel" — is right in spirit but research forces three corrections that make the result *better*, not smaller:

### 2.1 Don't build "a Kalshi channel." Build a "Predictions" channel with Kalshi as pillar one.
A channel is a *grouping of widgets* (per the user's own framing). "Kalshi" is a brand; "Predictions/Markets" is a category that can hold Kalshi today and Polymarket, sportsbook odds, and DFS lines tomorrow — without a re-architecture. This is what makes it a *premier* channel instead of a single-vendor integration. We normalize everything to one internal record with a `source` field.

### 2.2 "PrizePicks" cannot be a literal data source.
- **No official/partner API.** Their ToS prohibits scraping; they actively block it (Cloudflare/CAPTCHA/IP bans).
- **Legally radioactive.** PrizePicks-style against-the-house pick'em is being reclassified as illegal sports betting — cease-and-desist in FL/IL, banned in **WA, ID, NV, MT**, forced peer-to-peer in CA/NY. Surfacing *scraped* PrizePicks lines inside a (potentially monetized) app stacks ToS/CFAA civil exposure on top of a gambling-display question.
- **The legitimate way to deliver that experience:** license player-props data from an odds vendor and present it as "More/Less" lines. We get the same stat lines (points, rebounds, passing yards) — just sourced cleanly. We do **not** use PrizePicks branding or multipliers unless we license them.

### 2.3 Display-only vs. facilitating wagers is the whole risk axis.
Gambling-law obligations attach to *facilitating a wager* (taking bets, holding funds, brokering a transaction), **not to publishing data**. Stay display-only and obligations collapse to near-zero + voluntary best practice. Add a monetized "place this bet" handoff and the entire state-by-state machine switches on. **Architect the deep-link layer as a separately gated toggle so the compliant core ships regardless of monetization rollout.**

---

## 3. Scope & Phasing

| Phase | Name | Content | Compliance tier | Effort |
| --- | --- | --- | --- | --- |
| **P1** | **Kalshi core** | Pillar A only. Live Kalshi markets in the ticker, category filters, favorites, market detail widget. Display-only. | Tier A (display) | ~2–3 wk |
| **P2** | **Props pillar** | Pillar B via licensed vendor (sportsbook player props framed as More/Less). Normalized into same record. | Tier A (display) | ~1–2 wk + contract |
| **P3** | **Premier polish** | Movers/biggest-swings widget, sparkline price history, "resolved today" recap, watchlist alerts, cross-pillar "trending" view. | Tier A | ~1–2 wk |
| **P4** | **Monetization (gated)** | Per-state, per-source affiliate deep-links (Kalshi referral, DFS affiliate). Off by default; behind legal sign-off. | Tier B (advertising) | ~1 wk + legal |

**Recommendation:** Commit to P1 now. Treat P2 as fast-follow contingent on a vendor decision (§5). P3 is where "blows everything out of the water" actually lives. P4 is a business/legal decision, not an engineering one.

---

## 4. Compliance Architecture (the load-bearing constraint)

This is designed in from line one, not bolted on. Full brief lives in the research notes; the guardrails the channel must implement:

**Always-on (display core, Tier A):**
1. **Display-only.** No bet slip, no wager handoff, no "place bet" button in P1–P3.
2. **Disclaimer set** baked into the channel UI and any store metadata: "informational/entertainment only," "not a sportsbook/exchange/operator," "does not accept or place wagers," accuracy disclaimer, no-affiliation clause, jurisdiction-shifting language.
3. **Self-attested age gate** on first channel enable (18+ for Kalshi/DFS content; 21+ where sports betting framing applies). Self-attested **state selection**, optionally IP-prefilled with a "VPN may be inaccurate" note.
4. **Responsible-gambling line** using the **current NCPG number (1-800-MY-RESET / 1-800-522-4700)** — NOT "1-800-GAMBLER" (that mark is now litigated/owned by CCGNJ). Link to ncpgambling.org.
5. **Lead with Kalshi (CFTC financial-data) framing** over sportsbook framing — lowest regulatory profile.
6. **Respect each source's market-data ToS.** Kalshi's Developer Agreement + Data ToS gate redistribution/caching — see §11 risk R1.

**Gated layer (P4, Tier B — do not enable without counsel):**
7. Affiliate deep-links are a **per-state, per-source feature flag** sitting on top of the display core. Start with Kalshi referral + DFS (no state affiliate licensing). Gate sportsbook links behind per-state availability + affiliate-license status; **fail closed on VPN/proxy**.
8. FTC material-connection disclosure adjacent to every monetized link.

**Distribution implications (informs, but doesn't change, the channel):**
- Direct-download (notarized Mac + Authenticode Windows) has **no content review** — lowest risk.
- Microsoft Store / Mac App Store: ship as a **sports/information app** with the disclaimer set + honest 17+/18+ age rating. Display-only avoids the "offers real-money gaming" trigger.
- **Never** ship this as a browser extension surface — Chrome's policy explicitly bans odds-calculation/bet-tracking as facilitation. (Scrollr's desktop app is the right home; note the repo still has an `extension/` lineage in docs — confirm the prod surface is the Tauri desktop app, §13-Q5.)

---

## 5. Data Sources & Decision Matrix

### Pillar A — Kalshi (decided)
- **Auth:** API Key ID + RSA private key, per-request RSA-PSS(SHA-256) signature. Stateless — fits a long-running Rust backend well. Store the PEM in `scrollr-secrets`.
- **REST base:** `https://external-api.kalshi.com/trade-api/v2` (demo: `https://external-api.demo.kalshi.co/trade-api/v2`).
- **WS:** `wss://external-api-ws.kalshi.com/trade-api/ws/v2` — channels `ticker`, `trade`, `market_lifecycle_v2`, `orderbook_delta`.
- **Rate limits:** Basic (free/default) = 200 read tokens/s (~20 req/s at 10 tok each) — ample. Prefer WS over REST polling to stay well under.
- **Universe:** ~100–300 active markets — small enough to enumerate the full open set via `GET /markets?status=open` and subscribe to all of it.
- **Field migration note:** Kalshi is mid-migration to fixed-point `*_dollars`/`*_fp` fields alongside legacy integer cents. **Use the fixed-point fields for new code; expect both in responses.**

### Pillar B — Props vendor (decision required, §13-Q1)
| Option | Carries real DFS pick'em lines? | Pricing | Verdict |
| --- | --- | --- | --- |
| **OpticOdds** | **Yes** — PrizePicks/Underdog as licensed tracked sources, with grading/schedules | Enterprise (~$5k+/mo/sport, reported) | Best fidelity, premium cost. Target for a serious P2/P3. |
| **SportsGameOdds** | Partial; strong sportsbook props; free tier to prototype | $75–$499/mo, free tier | **Recommended MVP** — validate UX cheaply on legit sportsbook props. |
| **The Odds API** | Mostly no (sportsbook props) | $99–$249/mo | Viable budget alt; rich market keys. |

**Recommendation:** Prototype Pillar B on **SportsGameOdds free/low tier** (sportsbook player props rendered as More/Less). Graduate to **OpticOdds** only if/when branded DFS lines are a proven draw. The normalized record + `source_type` flag (`event_contract` / `sportsbook_prop` / `dfs_pickem`) means this swap is a config change, not a rewrite.

**Hard rule:** No scraped PrizePicks/Underdog endpoints. Ever. Not in MVP, not as a "temporary" shortcut.

---

## 6. Technical Architecture — mapping onto the Scrollr channel framework

Scrollr has a documented, template-driven channel framework (`api/CHANNELS.md`). The **`finance` channel is the near-exact template** — it already does: signed external API + **websocket ingestion** (`channels/finance/service/src/websocket.rs`), single CDC table (`trades`), broadcast routing, dashboard provider, health checker. We clone its shape.

> **Layout note:** `api/CHANNELS.md` references an older tree (`api/channels/`, `extension/channels/`). The live tree is **root-level `channels/`** and **`desktop/src/channels/`**. The *architecture* in the doc is current; only the paths drifted. Plan uses live paths.

### 6.1 Rust ingestion service — `channels/predictions/service/`
Clone `channels/finance/service/`. Modules (mirroring finance's `src/`):
- `main.rs` / `lib.rs` — startup, readiness gate, task coordination.
- `kalshi/` — `auth.rs` (RSA-PSS signer), `rest.rs` (signed client, cursor pagination), `ws.rs` (subscribe to `ticker`/`trade`/`market_lifecycle_v2`, **track `seq`, resnapshot on gap**, shard markets across subscriptions, handle err 25/26/27).
- `props/` — vendor client (P2). Polling (vendors are HTTP, not WS).
- `database.rs` — upsert markets/props, mark settled.
- `catalog.rs` — periodic full-universe sync via REST (`GET /markets?status=open`) to catch new/closed markets the WS doesn't announce; reconcile against WS stream.
- `types.rs`, `log.rs`, `init.rs`.
- `configs/` — category/series allowlist (analogous to finance `subscriptions.json` and sports `leagues.json`): which Kalshi categories/series to track, which leagues/stat-types for props.

**Real-time strategy:** WS is the primary live path (precedent: finance). REST catalog sync on a timer (e.g. 60s) is the safety net for universe membership + backfill + reconciliation. This hybrid is the key correctness pattern (don't rely on WS alone for "what markets exist").

### 6.2 Go API — `channels/predictions/api/`
Clone `channels/finance/api/`. Implements the core `Channel` interface + capabilities:
- `CDCHandler` — route CDC records from the `prediction_markets` (and `prop_lines`) tables. **Routing spans three layers (verified against real code — this corrects v0.1's "broadcast" and v0.2's "zero core changes"):**
  1. **Channel-level subscriber set** — `channel:subscribers:predictions`, maintained *generically* by core for every channel (`api/core/channels.go` line ~63/99/127, `RedisChannelSubscribersPrefix + channelType`). **Automatic, no code.**
  2. **Per-resource Redis sets** (optional) — e.g. `predictions:subscribers:{category}`. Two precedents: **sports maintains these in core `channels.go`** (`if channelType == "sports"` blocks ×3); **finance maintains its `finance:subscribers:{symbol}` sets *channel-side*** in its own `ChannelLifecycle` handler (`finance.go onSyncSubscriptions`) with **no `channels.go` block**. **Follow finance** — keep per-category set maintenance in the predictions channel's own lifecycle handler, so `channels.go` stays untouched.
  3. **SSE topic registry** — `api/core/events.go` has a hardcoded `switch ch.ChannelType` (a `case` per channel: finance→`TopicPrefixFinance+sym`, sports→`+league`, rss→feed, fantasy→league) that subscribes a user's live SSE connection to granular topics. **Every existing channel has a case here; predictions needs one too.** This is the one **unavoidable core edit** — a localized ~4-line `case "predictions":` following four precedents.
- **Net:** routing is *mostly* self-contained but **not zero-core-change** — budget one small, well-bounded `case` in `api/core/events.go` (+ a matching `TopicPrefixPredictions` const). Whether channel-level broadcast can skip even that (reuse a generic topic path) is the one thing to confirm in the walking-skeleton PR (§14.1). Decision: **start with category-granular topics** mirroring sports, since Kalshi categories map naturally to user interest and keep SSE fan-out lean.
- `DashboardProvider` — contribute initial market set to `GET /dashboard` (fair-share across categories so one category doesn't dominate, like sports' per-league ≥2).
- `HealthChecker` — probe Postgres + downstream Rust service + last-successful-WS-message staleness.
- Routes: `GET /predictions` (auth, user-filtered), `GET /predictions/public`, `GET /predictions/catalog` (categories/series counts + ingestion health), `GET /predictions/health`.
- `manifest.json` — `cdc_tables: ["prediction_markets","prop_lines"]`, capabilities, routes, internal_url.
- Register in `api/main.go` via `srv.RegisterChannel(...)`. Channel-type validation is automatic (`BuildValidChannelTypes()`).

### 6.3 Desktop UI — `desktop/src/channels/predictions/`
Clone `desktop/src/channels/finance/`. Components:
- `FeedTab.tsx` — main ticker tab; `useScrollrCDC({ table: 'prediction_markets', ... })`. Renders market cards (comfort = grid, compact = single-row ticker).
- `MarketItem.tsx` — the card: question, YES/NO price (¢ → implied %), price-change color, category badge, close countdown, settled result. This is where the "alive" feel is won or lost.
- `ConfigPanel.tsx` — category pickers (Politics/Sports/Econ/Weather/Culture/Crypto), favorite markets/series (analogous to finance `SymbolManager.tsx`), props league/stat filters.
- `DisplayPanel.tsx` — view/sort options (by volume, by biggest mover, by closing soon).
- `view.ts` + `view.test.ts` — pure rendering/formatting logic (price→%, countdown, mover ranking) extracted for unit tests.
- Register in `desktop/src/channels/registry.ts` (add to channels Map + `TAB_ORDER`) and the dashboard key map.

### 6.4 Frontend config — `myscrollr.com/src/channels/...` (if/when web config UI exists)
`DashboardTab.tsx` for category/favorites config + InfoCards (active markets, biggest mover, resolved today). Per Explore, this layer may not be fully built yet — confirm (§13-Q5).

### 6.5 Infra
- DB tables created by the Rust service via migrations on startup.
- **⚠️ Reserve a unique migration version prefix.** All Rust services share ONE `_sqlx_migrations` table (sqlx 0.8 can't name it per-service). Each service uses a unique numeric prefix: finance `11*`, sports `12*`, rss `13*`/`20250601*`. **Predictions must claim its own — propose `14*`** (12-digit filenames, e.g. `140000000001_initial.up.sql`). The service enforces a boot-time invariant (on-disk up-migrations == recorded rows in its prefix range) and **refuses to boot on mismatch** — this exact pattern caused an April 2026 prod boot failure, so get the prefix + invariant constants right from the first migration. (See `channels/finance/service/src/database.rs` for the canonical implementation to copy.)
- **Sequin CDC** configured to track `prediction_markets` + `prop_lines` → `POST /webhooks/sequin`. Replica identity FULL (CDC), like `games`.
- **Redis cache layer** (mirror finance, verified TTLs): `cache:predictions` (public, 30s), `cache:predictions:{user_sub}` (per-user, 30s), `cache:predictions:catalog` (category/series catalog, 5min). Bust per-user cache on `ChannelLifecycle` update; public caches expire on TTL.
- Env: `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY` (PEM), `KALSHI_ENV` (demo|prod — keys are environment-specific), `PROPS_VENDOR_KEY`, `INTERNAL_PREDICTIONS_URL`, `CHANNEL_URL`.
- K8s: `k8s/predictions-api.yaml` + `k8s/predictions-service.yaml` (clone sports/finance manifests). Secrets into `scrollr-secrets`. DB pool: size for tick volume — finance runs `max_connections=20` for ~500 writes/min; predictions may need equal or more (see §9).

---

### 6.6 Tier limits & entitlements (cross-cutting, CI-enforced — second core touchpoint)
Scrollr gates channel features by subscription tier (free / uplink / uplink_pro / uplink_ultimate / super_user) via `api/core/tier_limits.go` (`ChannelLimits` struct + `DefaultTierLimits` map), enforced server-side by `ValidateChannelConfig`. Predictions needs its own cap field (e.g. `Markets *int` and/or `Categories *int`, `nil` = unlimited), mirroring `Symbols`/`Leagues`/`Feeds`.

**⚠️ This is a documented 5-file synchronized change ("drift is unforgiving" — CI fails on mismatch; relates to the June 2026 tier-limit drift guard):**
1. `api/core/tier_limits.go` — add field to `ChannelLimits` + values in all 5 tiers of `DefaultTierLimits`.
2. `api/core/tier_limits.json` — sync snapshot (Go test + both frontends' Vitest pin to it).
3. `desktop/src/tierLimits.ts` — synchronous reads during config-panel render.
4. `myscrollr.com/src/lib/fallbackTierLimits.ts` — first-paint fallback.
5. `api/core/tier_limits_test.go` — assertion protecting the table.

So besides the `events.go` topic `case` (§6.2), **`tier_limits.go` + its 4 sync files are the second required core/cross-repo touchpoint.** Also note `MaxTickerRows`/`MaxTickerCustomization` are per-tier — they bound how the predictions ticker renders for each plan. Proposed caps (mirroring the Leagues pattern; final values are §13-Q10): free = a few favorite markets / 1–2 categories; uplink ≈ 8; pro ≈ 20; ultimate/super = unlimited.

## 7. Data Model (normalized, source-agnostic)

The core insight: **one record type for all market-like things**, with a `source` discriminator. This is what lets Kalshi, sportsbook props, and future Polymarket coexist in one ticker.

### `prediction_markets` (Pillar A + any binary market)
| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | `kalshi:{ticker}` namespaced |
| `source` | text | `kalshi` (future: `polymarket`) |
| `external_id` | text | Kalshi `ticker` |
| `event_id` | text | Kalshi `event_ticker` (grouping) |
| `category` | text | politics/sports/econ/weather/culture/crypto |
| `title` | text | event/market question |
| `yes_sub_title` | text | outcome label |
| `yes_price_cents` | int | 1–99 (≈ implied %) |
| `yes_bid_cents` / `yes_ask_cents` | int | top of book |
| `last_price_cents` | int | for change calc |
| `prev_price_cents` | int | for mover ranking |
| `volume` / `volume_24h` / `open_interest` | bigint | from `*_fp` fields |
| `status` | text | unopened/open/paused/closed/settled |
| `result` | text | yes/no/scalar (when settled) |
| `open_time` / `close_time` / `settlement_ts` | timestamptz | lifecycle |
| `link` | text | deep link to market page (display; deep-link gated in P4) |
| `updated_at` | timestamptz | CDC ordering |

### `prop_lines` (Pillar B)
| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | `{vendor}:{player}:{stat}:{game}` |
| `source` | text | `sportsgameodds` / `opticodds` / ... |
| `source_type` | text | `sportsbook_prop` / `dfs_pickem` |
| `league` | text | NBA/NFL/MLB/... |
| `player_name` / `player_id` | text | |
| `team` / `opponent` | text | |
| `stat_type` | text | points/rebounds/pass_yds/... |
| `line_value` | numeric | the projection |
| `over_odds` / `under_odds` | int | American (null for pure pick'em) |
| `multiplier_tier` | text | standard/demon/goblin (only if licensed) |
| `game_time` | timestamptz | |
| `status` | text | active/suspended/settled |
| `result_value` | numeric | post-game grading |
| `updated_at` | timestamptz | |

Both tables are CDC sources. The desktop renders them in distinct sub-views but the same tab.

---

## 8. What makes it the *premier* channel (the differentiators)

Anyone can list markets. These are the things that make it feel like the best thing in Scrollr — most live in P3:

1. **Implied-probability rendering.** Don't show "62¢" — show **"62% YES ▲3"** with a live color pulse on change. A ticker of probabilities reads as a heartbeat of the world.
2. **Biggest Movers widget.** Rank by `|last - prev|` over a window. "Fed cut odds +9pts in the last hour" is genuinely arresting and unique to this data — no other channel can do it.
3. **Closing Soon / Resolving Now.** Countdown to close; "awaiting result" state; then a **"Resolved Today"** recap strip (market → YES/NO outcome) — closure no other feed gives.
4. **Sparkline price history.** Kalshi candlesticks (`/series/.../candlesticks`) → tiny inline sparkline per market. Cheap, high-impact.
5. **Cross-pillar "Trending."** One blended view: top Kalshi markets + top prop lines by volume/movement. The unification payoff.
6. **Category lenses.** Politics-only, Sports-only, Weather-only modes — each feels like a different product in the same channel.
7. **Personal watchlist + (P3) local alerts.** "Ping me if 'Rate cut in July' crosses 50%." Desktop-native notification. (Local-only; no server fan-out needed for v1.)
8. **Settlement payoff.** When a watched market settles, a satisfying resolve animation. Turns passive watching into a tiny narrative arc.

These are widgets *within* the channel — exactly the channel-as-widget-grouping model the user described.

### 8.1 UX realities to design for (ticker-specific)
- **Title compaction is mandatory.** Kalshi event titles are full sentences ("Will the high temperature in NYC today be 90°F or above?"). A scrolling ticker needs a derived short label: `{emoji/category} {subject} {outcome} {price}%` → "🌡️ NYC ≥90°F · 71% ▲2". Build a compaction function (from `event` + `yes_sub_title` + strike fields) with a tested fallback; this is real work, not cosmetic. Belongs in `view.ts`.
- **Compact vs comfort modes both must work.** Compact = single horizontal scroll of `label · prob ▲Δ` chips. Comfort = grid of cards with sparkline + countdown. Mirror finance's mode handling.
- **Sensible default config / empty state.** Before the user picks categories, show a curated "Trending" default (top markets by volume across Politics/Econ/Weather — the broad-appeal categories, not niche sports props). A blank ticker on first enable is a failure state.
- **Lead with broad-appeal categories.** Politics/weather/econ markets interest a general audience; sports props are narrower and carry more regulatory weight. Default ordering and onboarding should foreground the former.
- **One-time compliance gate flow.** On first channel-enable: a single lightweight modal — age confirm (18+/21+), state select (IP-prefilled, editable), disclaimer acknowledgment — stored in channel config so it never re-prompts unless state changes. Must render *before* any market data. This is both a legal requirement (§4) and a testable gate (§10).
- **Readability of probabilities.** Show implied % + directional delta, not raw cents. Color is the heartbeat; keep it accessible (don't rely on color alone — pair with ▲/▼ glyphs).

---

## 9. Real-Time & Correctness Design

- **WS primary, REST catalog secondary.** WS (`ticker`/`trade`/`market_lifecycle_v2`) drives live price updates; a 60s REST `GET /markets?status=open` sweep maintains the universe (new markets, closures) and backfills on reconnect. Don't trust WS alone for membership.
- **Sequence-gap handling.** Track per-subscription `seq`; on gap, resnapshot that market. (Kalshi explicitly documents this.)
- **Subscription sharding.** WS has undocumented per-subscription market caps (err 26) — shard the ~100–300 markets across N subscriptions; handle err 25/26/27 with backoff.
- **Settlement transitions.** `market_lifecycle_v2` → flip `status`/`result`; UI shows resolve state. Resolution can lag close by hours — model `closed` ("awaiting result") distinct from `settled`.
- **Reconnect/backoff.** WS drop → exponential backoff + full resnapshot. No `Retry-After` on Kalshi 429s → exponential backoff w/ jitter on REST.
- **CDC volume — net-new work, NOT inherited.** Correction from v0.1: finance does **not** throttle — `database.rs` writes every tick (the code comment notes "500+ WS price events/min," ~8/s) and simply scaled its DB pool to 20 connections. Kalshi with 100–300+ live markets, each with bid/ask/last moving, can exceed that. So we **add** what finance lacks: (a) **change-detection** — only `UPDATE` when a displayed field actually changed (skip no-op ticks); (b) **coalescing** — debounce sub-second updates per market to ≤1 write/sec. This caps Postgres write load *and* the downstream Sequin→CDC→SSE fan-out. Without it, a busy election night or NFL Sunday floods CDC. This is the single most important scale safeguard and has no finance precedent to copy.
- **Kalshi event-explosion → market grouping.** One Kalshi *event* can spawn dozens of *markets* (e.g. a temperature event = one market per degree bucket; a game = many strikes). Dumping all of them into the ticker is noise. Strategy: ingest all markets (for detail/sparklines) but **tag a "primary" market per event** (most liquid / closest-to-50¢ / headline) and default the ticker to primary-per-event, with an expand-to-event detail widget. Store `event_id` (done in schema §7) and compute `is_primary` at ingestion. Confirm exact event→market fan-out against live data (§13-Q8).
- **Universe size — design for peaks, not the average.** "~100–300 active markets" is the steady state; election nights, Fed days, and NFL Sundays can multiply sports/event markets. Don't hardcode a small cap on subscriptions or rows — shard WS subscriptions dynamically and let the catalog sweep drive subscription count.

---

## 10. Testing Strategy

Mirror existing channel test patterns:
- **Go API:** table-driven handler tests (`predictions_test.go`), CDC routing, cache hit/miss, dashboard fair-share allocation, health probe (`health_test.go`), Sentry PII scrubbing (`sentry_scrubbing_test.go`).
- **Rust service:** migration-version test, readiness HTTP, RSA-PSS signer unit test (sign a known string, verify against Kalshi's documented example), WS `seq`-gap reconciliation logic, price-change/mover computation.
- **Desktop:** `view.test.ts` — price→% formatting, countdown, mover ranking, settled-state rendering. Vitest.
- **Compliance:** a test asserting the disclaimer/age-gate gate renders before market data on first enable, and that deep-link affiliate code paths are inert when the P4 flag is off.

---

## 10.5 Operations, Monitoring & Rollout (lessons from existing channels)

**Quota / rate-limit monitoring (direct lesson from the api-football incident).** The sports channel was knocked out when daily API quota silently exhausted. Design this in from day one for predictions:
- Track Kalshi token-bucket usage (`GET /account/limits`) and props-vendor credit usage; expose as health fields and Sentry breadcrumbs.
- **Alert before exhaustion**, not after. Health goes `degraded` if WS has had no message in N minutes (mirror finance's `last_updated` staleness → 503 readiness pattern) or REST budget drops below a floor.
- For the props vendor especially (metered credits, real $), add a hard local rate cap so a bug can't burn the monthly quota in an hour — and a "circuit breaker" that pauses polling on repeated 429s rather than hammering.
- Beware the **budget-reset-on-pod-restart** failure mode noted in the api-football incident: if quota tracking is in-memory, a crash-loop resets the counter and defeats the cap. Persist usage counters (Redis) so restarts don't paper over runaway usage.

**Props-volume control (Pillar B).** Player props can be enormous (every player × stat × game). Don't ingest the firehose:
- Ingestion-side allowlist: only tracked leagues + "interesting" stat types (config-driven, like sports `leagues.json`).
- Cap rows per league/game; prune lines for finished games.
- Route via `predictions:subscribers:{league}` sets (per-league, sports-style) so users only get their leagues.

**Data retention / cleanup.** Settled Kalshi markets and finished prop lines must roll off the live ticker but feed the "Resolved Today" widget, then be pruned. Add a periodic cleanup job (the sports service has cleanup test scaffolding to mirror): keep `settled`/`closed` rows for a retention window (e.g. 24–48h for "resolved today"), then delete. Prevents unbounded table growth and CDC churn from stale rows.

**Dark-launch / staged rollout.** Channels are compile-time registered, so "ship dark" needs a gate:
- Build the channel but **omit it from `TAB_ORDER`** (desktop + frontend) until ready — code ships, UI hidden.
- Or gate visibility behind a feature flag / internal-user allowlist for a canary period.
- Roll out: internal users → small % → all. Validate WS stability, write volume, and CDC fan-out under real load before GA. Confirm the available flagging mechanism (§13-Q9).

**Timezone/format.** Kalshi timestamps are UTC; render close countdowns and "resolved today" in the user's local time. Prices: cents → implied %; volumes → abbreviated ($1.2M).

## 11. Risks & Open Questions

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| **R1** | **Kalshi Data ToS restricts redistribution/caching to third parties.** Scrollr re-serves market data to end users via its own API/CDC — this may need a data agreement. | **High** | **Human/legal review of `kalshi.com/developer-agreement` + Data ToS before launch.** Consider contacting Kalshi for a data agreement. Possibly serve as "live display, no third-party re-serve/caching" and add attribution. **This is the top gating item.** |
| R2 | Props data legitimacy — any scraped PrizePicks path is ToS/legal risk. | High | Licensed vendor only (§5). Hard rule. |
| R3 | Gambling-display regulatory exposure, esp. if monetized. | Med→High if P4 | Display-only core; disclaimers; age/state gating; P4 behind counsel. |
| R4 | Kalshi sports-contract state-law status is in active litigation (circuit split, maybe SCOTUS). | Med | Affects *promotion* (P4), not passive display. Lead with non-sports Kalshi framing; keep deep-links gated. |
| R5 | WS undocumented limits (err 25/26/27), no documented connection caps. | Med | Shard subscriptions; handle errors; REST fallback. Validate against demo env. |
| R6 | High-frequency price churn floods CDC/desktop. **No finance throttling to reuse** (finance writes every tick). | Med→High | Net-new change-detection + per-market coalescing (§9). Treat as required P1 work, not polish. |
| R10 | Kalshi event-explosion (one event → dozens of markets) makes the ticker noisy. | Med | `is_primary` per event + expand-to-detail (§9). Validate fan-out on live data. |
| R11 | Props volume (player×stat×game) floods ingestion/cost. | Med | Ingestion allowlist + per-league routing + row caps (§10.5). |
| R12 | Migration version-prefix collision in shared `_sqlx_migrations` → boot failure. | Med | Reserve `14*` prefix + correct invariant constants from first migration (§6.5). |
| R13 | Core is not fully channel-agnostic: `events.go` topic switch needs a per-channel `case`. Missing it = SSE delivers nothing despite correct ingestion/CDC. | Med | Add `case "predictions":` + `TopicPrefixPredictions` (§6.2 layer 3). Easy to forget, silent failure — call it out in the first Go-API PR checklist. |
| R14 | Tier-limits caps are a 5-file CI-enforced sync (`tier_limits.{go,json}`, desktop, frontend, test). Partial edit = red CI ("drift is unforgiving"). | Med | Treat §6.6 as one atomic change; run `go test ./core/...` + both Vitest suites. Decide caps (Q10) before coding. |
| R7 | Field migration (cents vs `*_dollars`/`*_fp`). | Low | Use fixed-point fields; tolerate both. |
| R8 | Vendor cost for real DFS lines (OpticOdds ~$5k+/mo/sport). | Med (business) | Start SportsGameOdds; upgrade only on proven draw. |
| R9 | Desktop is the only safe surface; if Scrollr pushes web/extension, compliance changes. | Med | Confirm prod surface (§13-Q5); never ship odds via browser extension. |

---

## 12. Phased Roadmap (engineering)

**P1 — Kalshi core (~2–3 wk)**
1. Scaffold `channels/predictions/{service,api}` from `finance`. (~0.5d)
2. Rust: RSA-PSS signer + signed REST client + cursor pagination + catalog sync. (~3–4d)
3. Rust: WS client (ticker/trade/lifecycle), seq-gap handling, sharding, reconnect, **+ change-detection & per-market coalescing** (net-new, no finance precedent). (~4–5d)
4. DB schema (claim `14*` migration prefix + invariant constants) + upsert/settlement logic + `is_primary` event grouping + Sequin config. (~2d)
5. Go API: handlers, CDC per-resource routing, dashboard provider, health, manifest, register in `api/main.go`; **+ core edit 1: `case "predictions":` + `TopicPrefixPredictions` in `api/core/events.go`**; **+ core edit 2: `predictions` caps in `api/core/tier_limits.go` synced across its 4 sibling files + test** (§6.6). (~3d)
6. Desktop: FeedTab + MarketItem + ConfigPanel + DisplayPanel + view tests. (~3–4d)
7. Compliance: disclaimer/age-gate/state-select gate + RG line. (~1–2d)
8. Tests (Go/Rust/desktop) + k8s manifests + secrets. (~2–3d)

**P2 — Props pillar (~1–2 wk + vendor contract)**
9. Vendor decision + key. Rust props poller → `prop_lines`. Desktop props sub-view. Tests.

**P3 — Premier polish (~1–2 wk)**
10. Movers widget, sparklines (candlesticks), Resolved-Today recap, watchlist + local alerts, cross-pillar Trending.

**P4 — Monetization (gated, ~1 wk + legal)**
11. Per-state/per-source affiliate deep-link layer, FTC disclosures, fail-closed geo. **Off by default.**

---

## 13. Open Decisions (need the user)

- **Q1 — Props vendor:** OK to prototype Pillar B on **SportsGameOdds** (cheap, legit sportsbook props) and defer OpticOdds (real DFS lines, enterprise $) to a later, proven phase? Or is branded DFS-style data essential to v1?
- **Q2 — Scope of v1:** Ship **Kalshi-only P1 first** (recommended), or wait and ship A+B together?
- **Q3 — Monetization intent:** Is affiliate revenue a goal (build the P4 layer now, disabled), or is this purely a display feature (skip P4 design entirely)? This changes how much compliance scaffolding we build up front.
- **Q4 — Legal review owner:** Who signs off on R1 (Kalshi Data ToS redistribution) and the gambling-display posture before launch? This is a true blocker for go-live, not for building.
- **Q5 — Production surface:** Confirm the prod client is the **Tauri desktop app** (the only compliance-safe surface). Does the web frontend (`myscrollr.com`) render channels too, and does a per-channel config UI layer exist there yet?
- **Q6 — Channel id/brand:** `predictions` as the internal id? UI brand — "Markets", "Action", "Predictions", or something else?
- **Q7 — Kalshi account/tier:** Do we have (or will we create) a Kalshi account to mint API keys? Basic tier suffices technically; confirm ToS posture for an org account re-serving data (ties to R1).
- **Q8 — Event fan-out:** Need a quick live-data check of how many markets a typical Kalshi event spawns (affects the primary-market grouping strategy, §9). Can validate against demo env during P1 scaffolding.
- **Q9 — Dark-launch mechanism:** What's the available way to ship a channel hidden? `TAB_ORDER` omission is the simple lever; is there an existing feature-flag/internal-allowlist system to prefer instead?
- **Q10 — Tier placement & caps (product):** Where does the premier channel sit in the lineup — available on **free** (a flagship hook to drive signups) or gated to **Uplink Pro/Ultimate** (a premium upsell)? And the per-tier caps (# favorite markets / categories) for the §6.6 table. This is a monetization-of-the-channel decision, distinct from the betting-affiliate monetization (P4/Q3).

---

## 14. Readiness to Begin Integration

### 14.1 The walking-skeleton first PR (prove the plumbing before adding WS complexity)
Smallest end-to-end vertical slice that de-risks the whole integration:
1. Scaffold `channels/predictions/{service,api}` from `finance` (rename package, claim `14*` migration prefix).
2. Rust: Kalshi RSA-PSS signer + **REST catalog only** (`GET /markets?status=open`) → upsert ~20 markets into `prediction_markets`. **No WS, no coalescing yet.** (Verify whether REST market-data is reachable unauthenticated — if so, the skeleton is even simpler; assume signed until confirmed.)
3. Go API: `GET /predictions/public` reads the table; `manifest.json`; register in `api/main.go`.
4. Desktop: minimal `FeedTab` rendering markets from the dashboard (polling, **no live CDC yet**), behind a `TAB_ORDER` omission so it ships dark.

This proves auth + ingestion + the channel framework + UI render end-to-end. **Then** layer on WS (live), coalescing, event-grouping, the compliance gate, props, and polish. Each subsequent PR is independently shippable.

### 14.2 What actually blocks *starting* (vs. blocks *go-live*)
| Item | Blocks start of build? | Blocks GA/go-live? |
| --- | --- | --- |
| **Q7 — Kalshi API credentials** | **YES — the only hard start-blocker.** Can't call the API without keys. | — |
| Q4/R1 — Legal review of Kalshi Data ToS redistribution | No — parallelize during build | **YES** |
| Q5 — Confirm desktop is prod surface | No — desktop build proceeds regardless | Yes (compliance) |
| Q3 — Monetization intent | No — build compliant core regardless | Only gates P4 |
| Q1 — Props vendor | No — P1 is Kalshi-only | Only gates P2 |
| Q2/Q6/Q8/Q9 — scope / name / event-fanout / dark-launch | No — safe defaults exist (`predictions`, Kalshi-only, validate in P1, TAB_ORDER omission) | No |

**Conclusion:** The plan is **ready to begin integration** the moment we have **Kalshi API credentials (Q7)**. Legal review (R1) and surface confirmation (Q5) run in parallel and gate the *public launch*, not the build. Everything else has a safe default. The walking-skeleton PR (§14.1) can start immediately on receipt of keys and carries no compliance exposure (ships dark, display-only, internal).

### 14.3 Definition of "airtight" — met?
- ✅ Strategy reframed and justified (unified channel; PrizePicks impossibility; display-only axis).
- ✅ Architecture grounded in *actual* code (finance routing/throttling/migrations verified, errors corrected).
- ✅ Data model normalized for multi-source future.
- ✅ Real-time correctness, scale safeguards, and the no-precedent coalescing work identified.
- ✅ Compliance designed in as a gated core, with concrete guardrails.
- ✅ Ops/monitoring/rollout informed by the api-football incident.
- ✅ Premier differentiators that are unique to this data.
- ✅ Phased roadmap + walking-skeleton first PR + crisp start-blocker analysis.
- ✅ Open questions classified by whether they block start or only go-live.

*End v0.5 — CONVERGED. Five passes, each verified against real code. Caught and corrected three errors (broadcast→3-layer routing; finance-has-no-throttling; the unavoidable `events.go` edit) and mapped two distinct core touchpoints the initial exploration missed (`events.go` topic case + `tier_limits.go` 5-file synced caps). Designed around three prior-incident landmines (migration-prefix boot failure, api-football quota exhaustion, tier-limit drift guard). The plan is internally consistent, grounded in real code, and de-risked across engineering, product, compliance, and ops.*

*Remaining items are user **decisions** (§13), not plan gaps. The two that gate everything: **Q7** (Kalshi API credentials — the only thing blocking the start of build) and **Q4/R1** (legal ToS review — the only thing blocking public launch); both have safe parallel-track defaults. Convergence test: the last two passes found real touchpoints, but they were *additive precision* (more files to touch), not *corrections* — the strategy, architecture, data model, compliance posture, and roadmap have been stable since v0.2. Further passes would surface ever-smaller wiring details best discovered during the walking-skeleton PR itself, not more planning. **Ready to begin integration on receipt of Kalshi API credentials.***
