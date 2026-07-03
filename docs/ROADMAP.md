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

**Carried to v1.1.4 (first item):** the dashboard fair-share query ranks
finals after ALL pre rows, so a high-volume league (MLB) fills its payload
share with upcoming fixtures and the ticker's "days back" under-delivers.
Fix = split each league share between soonest-pre and newest-final (see
KNOWN GAP comment in channels/sports/api/sports.go).

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
