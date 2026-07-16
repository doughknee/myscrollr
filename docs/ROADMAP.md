# Post-1.1.0 Roadmap — "the widget era grows up"

*Internal planning doc. Written 2026-07-02, the day v1.1.0 shipped. Source: Brandon's
first-pass runthrough of the live release. Versions are intent, not promises — releases
can merge or split as work reveals itself.*

**The through-line:** v1.1.0 shipped the widget *model*; these releases make every
surface actually behave like it. None of them are breaking — `MIN_DESKTOP_VERSION`
stays at 1.1.0 and nobody gets force-updated.

| Version | Codename | Theme | Size |
|---|---|---|---|
| ~~v1.1.1~~ | Paper Cuts | ✅ **Shipped 2026-07-02** — grew into the catalog redesign (absorbed half of The Library) | S→M |
| ~~v1.1.2~~ | The Library | ✅ **Shipped 2026-07-02** — slots-only monetization everywhere, fantasy gate retired | S–M |
| ~~v1.1.3~~ | Time Controls | ✅ **Shipped 2026-07-03** — day windows for sports/news + 7-day score retention (+ pricing-page overhaul rode along) | M |
| ~~v1.1.4~~ | Kalshi Grows Up | ✅ **Shipped 2026-07-03** — event cards, watchlist-first ticker, real history charts (+ the fair-share finals fix) | M |
| ~~v1.1.5~~ | Kalshi Cleans Up | ✅ **Shipped 2026-07-14** — sweep reconciliation ends the stale-market feed; lens-based browse, stars-only personalization, server config retired | M–L |
| ~~v1.1.6~~ | Kalshi Fixed Up | ✅ **Shipped 2026-07-15** — history charts + My Positions un-broken (Kalshi fp migration), market search, multi-category filter, whole-card UX | M |
| v1.1.7 | Spring Cleaning | Under-the-hood release: backend consolidated into core (ADR-0002), simpler undo, Kalshi connect slimmed to prod-only, compact-number polish | S |
| v1.2.0 | Double-Decker 2.0 | Multi-row ticker rebuilt around widgets | L |
| — | Website rides along | Pricing rewrite shipped with v1.1.2–3; screenshots now unblocked (post-v1.1.4) | S–M |

*Numbering philosophy (house style, see v1.0.9→v1.0.20): patch = the same app,
better — fixes, refinements, even sizable ones. Minor = something new to learn.
Only Double-Decker introduces a new interaction model + config migration, so it
alone earns the minor. Numbers are assigned at release time; if a batch grows or
merges, promote it then.*

---

## Launch tail (before anything else)

Not a release — the v1.1.0 loose ends:

- [x] **macOS build** — Apple Developer agreement accepted 2026-07-02; v1.1.1 built,
  notarized, and DMG-stapled clean. The v1.1.0 job rerun is moot — Macs update
  straight to 1.1.1 (darwin is back in `latest.json`).
- [x] **Sequin sink for `markets`** — verified delivering end-to-end 2026-07-02
  (forced-row-touch test observed on `cdc:predictions:all`). The earlier silence was
  write *sparsity*, not a broken sink: the service no longer creates untracked
  markets, so off-peak updates arrive minutes apart.
- [ ] Archive the old $399 Stripe price; delete the downloaded Kalshi key file.

---

## ✅ v1.1.1 — Paper Cuts (shipped 2026-07-02, `desktop-v1.1.1`)

**What was planned** shipped in full: the optimistic-add data fix, the card-height
reflow, the tab-pill z-fix, the RSS per-source-cap retirement (with a one-shot 4→0
prefs migration), and the entrance-animation pass — which turned up the real bug:
`AnimatePresence initial={false}` in PageLayout was silently suppressing *every*
mount animation in the app.

**What it absorbed** (four rounds of live feel-testing pulled The Library's catalog
half forward): browse-only catalog cards, full per-widget product/info pages (hero,
ticker preview, quick facts, usage steps, More-like-this), the "Your widgets" /
"Discover new widgets" split, Featured/A–Z sorting + the slot meter in a catalog
header, and remove/swap from the widget page (which supersedes the planned
"remove from the catalog card" — cards are deliberately button-free now).

Also along for the ride: DOMPurify on both What's New pages, predictions in the
production smoke script, the website release-fetch token, and — because the Apple
agreement got accepted mid-release — the return of macOS builds.

---

## ✅ v1.1.2 — The Library (shipped 2026-07-02, `desktop-v1.1.2`)

Shipped same-day as v1.1.1: the fantasy tier gate is fully retired (a normal
widget on every plan including Free — which also surfaced and killed a
leftover server-side ladder in the fantasy API that had been capping Uplink
accounts at ONE league import despite the "unlimited leagues" marketing);
the Account page swapped its all-"Unlimited" limits table for the shared
slot meter; the sidebar grew a right-click menu (Open / Configure /
Show-Hide on ticker / Widget page / Remove — the review pass caught and
fixed the ticker toggle reading raw row state instead of effective state);
and Priority Support moved from Ultimate-only to every paid tier across the
pricing page, FAQ + JSON-LD mirrors, and support copy.

**Deferred out of the release:** the "Popular" catalog sort (no analytics
infra exists; A–Z + Featured cover sorting until install-count data is
worth plumbing — note it could come from our own user_channels counts, no
PostHog needed).

**Original scope notes (historical)**

**Monetization coherence**
- **Retire the Fantasy tier gate.** Yahoo Fantasy becomes a normal widget on every
  plan — the last non-slot gate in the product dies. (Must land together with the
  pricing-copy sweep below, or the Uplink card oversells "Yahoo Fantasy sync".)
- **Account page plan panel rebuilt.** Kill the wall of "Unlimited" limits. Replace
  with: *"You're using 4 of 6 widget slots"* + a meter + a catalog/upgrade link.
  The tier's story is slots; the page should say only that.

**Website (ships alongside, no desktop release needed)**
- **Pricing cards rewritten around one number.** Widget count is the headline and
  almost the whole card. Strip the feature noise.
- **Compare table trimmed to what sells:** widgets at once (the star row), then
  Ultimate's roadmap features — feed profiles, custom alerts, data export, API
  access — kept with their "coming soon" badges (honest bait), early access for all
  paid tiers, and **priority support moves from Ultimate-only to all paid tiers**
  (sweep the support-page copy to match).

---

## ✅ v1.1.3 — Time Controls (shipped 2026-07-03, `desktop-v1.1.3`)

Shipped as planned: per-widget day windows for sports (calendar-day anchored,
live games always show, presets + steppers) and news ("last N days"), the
upcoming/final toggles retired with automatic migration of saved values, and
finals now retained **7 days** server-side (was 12 hours) so the lookback has
data — the prod backlog fills over the first week post-deploy. The ticker
gained per-widget rss display override support (previously global-only).
A pricing-page overhaul rode along: plan cards reduced to the widget-cap
stat (tier-tinted, pointer-tilt), compare table trimmed six rows, annual
sold as "4 months free."

**Carried to v1.1.4 (first item — ✅ landed there):** the dashboard fair-share
query ranked finals after ALL pre rows, so a high-volume league (MLB) filled
its payload share with upcoming fixtures and the ticker's "days back"
under-delivered. Fixed in v1.1.4 by splitting each league share between
soonest-pre and newest-final (`fairShareSideSplit` in
channels/sports/api/sports.go).

**Original scope notes (historical)**

**Goal:** replace vague "upcoming / final" style toggles with a control people
actually think in: *how many days back, how many days ahead.*

- **Sports widgets:** per-widget "show games from N days ago to N days ahead"
  (sliders or steppers in Configure), replacing the venue-era show-upcoming /
  show-final toggles as the primary control.
- **News widgets:** "articles from the last N days" per widget.
- **What it entails under the hood:** per-widget config schema additions, Configure
  UI, and the feed/ticker selectors honoring the window. Needs a check on data
  horizons — the sports service only retains what the upstream API provides, so the
  ranges get clamped to what's actually available rather than pretending.
- **Open design question:** do the old toggles survive as "advanced" filters inside
  the window, or die entirely? (Lean: die — one mental model.)

---

## ✅ v1.1.4 — Kalshi Grows Up (shipped 2026-07-03, `desktop-v1.1.4`)

Shipped after three rounds of live feel-testing against real Kalshi data:

- **Event cards.** Markets carry their event context end-to-end (migration
  `140000000002`; the sweep keeps each event's top two legs, 240-market
  catalog cap). The feed groups legs under the event *question* — and any
  single-leg event gets a synthetic No row, so there's never a lone "Yes"
  card. Compact mode keeps flat rows, event-titled. Ticker chips and the
  detail modal lead with the question too.
- **Watchlist-first ticker.** Stars scope the ticker; no stars falls back to
  the top-15 rank-1 movers — never again the whole ingested universe. Stars
  survive category narrowing: `config.favorites` is repurposed as a silent
  server mirror of the local watchlist and unioned into the payload, and the
  feed's watchlist lens bypasses categories. Ship-review catch before merge:
  the pref-store cache is per-webview, so the ticker window now *subscribes*
  to watchlist changes instead of reading a boot-time snapshot.
- **Real history charts.** The detail modal renders 7 days of hourly
  candlesticks (Rust internal endpoint → Go proxy with a 5-min Redis cache);
  the old live-session sparkline survives only as the loading fallback.
- **Configure has a job now.** Categories = the widget's server-side
  universe; the watchlist is managed in the same place; pre-1.1.4 favorites
  pins auto-migrate into stars once (CategoryPicker.tsx deleted).
- **Sports fair-share fix** (carried from v1.1.3): verified live at 60 rows —
  29 upcoming + 1 live + 18 finals for MLB where the old query starved finals
  entirely.

**Post-ship watch-list (known minors):** pre-1.1.4 clients that still write
`favorites` as pins are effectively editing the watchlist mirror (same union
semantics — acceptable); a market that drops out of an event's top-2 keeps a
stale `event_rank` until the next sweep touches it (the feed predicate
tolerates this); during a deploy window where predictions-api is new but the
service pod is old, candlesticks 5xx until the Rust pod rolls.

**Original scope notes (historical)**

**Goal:** the predictions widget stops being a foreign app bolted on.

- **The ticker shows *your* markets, not all 200.** Watchlist/favorites and category
  selections scope the ticker chips the same way leagues scope a sports widget.
  This is the fix that makes Configure meaningful — today it only filters the feed
  view while the ticker firehoses everything.
- **Feed page rework.** Either restructure the dense category-picker/watchlist/
  positions view to follow the widget feed pattern, or keep the "pro view" but make
  its layers discoverable (the current page reads as "makes no sense" on first
  contact — that's an IA problem, not a data problem).
- **What it entails:** per-widget scoping for predictions in the shared
  `scopeSourceData` path (medium — the payload isn't scoped per user selection yet),
  plus the page redesign. Server already supports favorites/categories per user in
  the dashboard provider, so most of this is desktop-side.

---

## ✅ v1.1.5 — Kalshi Cleans Up (shipped 2026-07-14, `desktop-v1.1.5`)

The v1.1.4 follow-through, in two stacked PRs (#223 backend, #224 desktop):

- **Data you can trust.** The catalog sweep now demotes markets that drop out
  of the selection (`in_sweep`), REST-rechecks dropped tickers so missed
  settlements land, and stamps `settled_at` exactly once at resolution. The
  API serves the live set + trailing-24h resolutions ordered by
  `volume_24h` — prod went from 3,905 rows served (51 of the top 60 stale
  >1 day) to ~240 live ones. WS ticks skip demoted rows, ending the
  dormant-market CDC churn.
- **One system.** Server-side `config.categories`/`favorites` retired (API
  keeps honoring old clients; new client migrates + clears them once). The
  feed is lens-based — Trending (category-section browse) / Movers /
  Closing soon / Resolved (full result cards, replaced the chip strip) /
  Watchlist — with a single control bar (segmented view switcher + lens
  pills). Configure is one page: watchlist, ticker fallback, display grid.
- **Polish pass** (Playwright-verified at 1440/375 against a checked-in
  browser harness, `channels/predictions/preview/`): card anatomy with
  category-anchored headers, uniform heights, fixed delta/pill columns,
  probability-pill chip restyle, `--color-predictions` teal unification,
  Home preview rows.

**Known issues accepted:** a just-closed market can show a muted "Closed"
chip until the next poll drops it; a starred market that falls out of the
top-240 while still trading leaves the payload (favorites union retired) —
the watchlist labels it "no longer tracked".

---

## ✅ v1.1.6 — Kalshi Fixed Up (shipped 2026-07-15, `desktop-v1.1.6`)

Two production bugs root-caused and fixed, plus the browse-UX pass —
all inside the channel/widget scope (full evidence trail lives in the
local `ui-review/NOTES.md` decision log; follow-ups filed as REL-5/6/7):

- **History charts were 401ing on every market** — the candlesticks fetch
  never sent auth against an `Auth: true` route; it only ever worked
  through the fail-open hole hotfix #220 closed. Channel now owns an
  `authFetch` query + distinct "unavailable" vs "no trades yet" fallbacks.
- **My Positions showed zero with open positions** — Kalshi completed its
  fixed-point migration (`position_fp`/`count_fp`/`outcome_side`; integer
  twins removed) and the desktop parser had `*_dollars` fallbacks for
  money but none for counts, so every position normalized to flat. Parser
  now reads both shapes (mocked-response Rust tests), `count_filter`
  corrected, `limit=1000`.
- **Browse UX:** client-side market search (typo-tolerant, "/" focus);
  whole-card click targets with hover/pressed affordance; fully clickable
  section headers; multi-select category filter composing with search and
  every lens; sticky control bar with pinned elevation + early collapse
  into an animated filter menu (<1024px container); price-sorted outcomes
  with "+N more" and an all-outcomes list in the detail modal; LIVE badge
  + "Starts in Xh" indicator logic (dormant until the payload ships a
  start-time field — REL-6 — close labels everywhere per the
  no-fabrication rule).
- **Layout lessons encoded in tests:** sticky must pin against the page
  scroller (no dead inner scrollports), geometry assertions over
  class-list assertions, focus rings inherit the parent's border-radius.

**Known issues accepted:** "+N more" can't trigger until the server ships
>2 legs per event (REL-5); signed-out users still get the chart fallback
(candlesticks route stays authed — REL-7).

---

## v1.2.0 — Double-Decker 2.0

**Goal:** the multi-row ticker becomes the flagship feature it deserves to be.
Biggest item on the list; gets its own design pass before any code.

- **Rows built from widgets, not sources.** Assign widgets to rows directly —
  drag-and-drop in a row editor — instead of the channel-era source lists (which
  v1.1.0 only kept alive through a compatibility shim).
- **Per-row personality:** speed, density (compact/detailed), maybe direction —
  the pieces exist per-ticker; making them per-row is the upgrade.
- **Migration:** existing row configs (coarse source ids) map to "all widgets of
  that source" on first run, then users refine.
- **Design questions to settle first:** does a widget live on exactly one row or
  many? Is row 1 special (pinned zone)? What's the empty-row experience? Worth a
  short spec in `docs/superpowers/specs/` before building.

---

## Deferred on purpose

- **Marketing screenshots** — all product imagery still shows the channel-era UI.
  v1.1.4 is out, so this is now **unblocked** — the UI it would capture is the one
  users get. Precondition: `desktop/scripts/capture-screenshots.mjs` still shoots
  deleted routes and needs updating first.
- **Popularity sorting** if PostHog wiring drags — A–Z ships regardless.

## Sequencing rationale

Paper cuts first because trust compounds — v1.1.0 just asked every user to
re-learn the app, so the fastest possible "they're on it" signal matters. The
Library second because it aligns the product and the pricing page around the same
sentence, and the fantasy-gate removal forces the pricing rewrite anyway. Time
Controls and Kalshi are independent and can swap order freely. Double-Decker last
because it's the largest, benefits from the catalog/scoping groundwork, and
deserves design time rather than being squeezed in.
