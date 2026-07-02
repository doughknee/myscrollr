# Post-1.1.0 Roadmap — "the widget era grows up"

*Internal planning doc. Written 2026-07-02, the day v1.1.0 shipped. Source: Brandon's
first-pass runthrough of the live release. Versions are intent, not promises — releases
can merge or split as work reveals itself.*

**The through-line:** v1.1.0 shipped the widget *model*; these releases make every
surface actually behave like it. None of them are breaking — `MIN_DESKTOP_VERSION`
stays at 1.1.0 and nobody gets force-updated.

| Version | Codename | Theme | Size |
|---|---|---|---|
| v1.1.1 | Paper Cuts | Bug fixes + fossil removals, ship fast | S |
| v1.1.2 | The Library | Catalog becomes yours + slots-only monetization everywhere | M |
| v1.1.3 | Time Controls | Day-range windows replace vague feed toggles | M |
| v1.1.4 | Kalshi Grows Up | Predictions widget behaves like a widget | M |
| v1.2.0 | Double-Decker 2.0 | Multi-row ticker rebuilt around widgets | L |
| — | Website rides along | Pricing rewrite ships with v1.1.2; screenshots after v1.1.4 | S–M |

*Numbering philosophy (house style, see v1.0.9→v1.0.20): patch = the same app,
better — fixes, refinements, even sizable ones. Minor = something new to learn.
Only Double-Decker introduces a new interaction model + config migration, so it
alone earns the minor. Numbers are assigned at release time; if a batch grows or
merges, promote it then.*

---

## Launch tail (before anything else)

Not a release — the v1.1.0 loose ends:

- [ ] **macOS 1.1.0 build** — accept the Apple Developer agreement, re-run the failed
  job, `.dmg` appends to the published release. *(Blocks Mac users from updating.)*
- [ ] **Sequin sink for `markets`** — the table isn't in the sink's delivery list yet;
  sports/finance CDC verified flowing, predictions is polling-only until this is fixed.
- [ ] Archive the old $399 Stripe price; delete the downloaded Kalshi key file.

---

## v1.1.1 — Paper Cuts

**Goal:** every small thing that makes v1.1.0 feel unfinished, gone within days.
No design decisions required; pure execution.

**Fixes**
- **Data appears only after visiting Configure.** Adding a news widget shows an empty
  feed until you open Configure and come back. Likely the optimistic-add cache row
  (empty config) not being reconciled until a refetch that Configure happens to
  trigger. Fix the add flow so data lands on the feed page directly.
- **"Widget limit reached" badge stretches catalog cards.** Reserve the badge's height
  so at-capacity states don't reflow the grid.
- **Catalog filter pill overlaps its label when moving right.** The sliding-pill
  animation renders over the text in one direction — z-order/layering fix.

**Fossil removals**
- **RSS "2 items per source" feed default.** Made sense when one News channel mixed ten
  sources; now the source *is* the widget. Show the feed properly.

**Polish**
- **Entrance animations for Workspace and Account pages** to match the widget pages'
  tab-switch quality.

---

## v1.1.2 — The Library

**Goal:** the catalog stops being a store you visited once, and the whole product
tells one monetization story: *your plan = how many widgets you run.*

**Catalog**
- **Two sections: "Your widgets" on top, the shop below.** Installed items clearly
  yours (Configure / Open / Remove), everything else clearly addable.
- **Remove directly from the catalog card** — no more hunting through Options.
- **Sidebar right-click menu per widget**: Configure, Remove, show/hide on ticker.
- **Sorting: A–Z default in the shop**, with a "Popular" option if we wire install
  counts out of PostHog (stretch — ship A–Z first, don't block on analytics).

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

## v1.1.3 — Time Controls

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

## v1.1.4 — Kalshi Grows Up

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
  Reshooting now would capture a product we're about to polish twice more. Do it
  after v1.1.4. Precondition either way: `desktop/scripts/capture-screenshots.mjs`
  still shoots deleted routes and needs updating first.
- **Popularity sorting** if PostHog wiring drags — A–Z ships regardless.

## Sequencing rationale

Paper cuts first because trust compounds — v1.1.0 just asked every user to
re-learn the app, so the fastest possible "they're on it" signal matters. The
Library second because it aligns the product and the pricing page around the same
sentence, and the fantasy-gate removal forces the pricing rewrite anyway. Time
Controls and Kalshi are independent and can swap order freely. Double-Decker last
because it's the largest, benefits from the catalog/scoping groundwork, and
deserves design time rather than being squeezed in.
