<!--
Salvaged from the untracked ui-review/ working directory (July 15, 2026
Kalshi polish + version-bump sessions) when that directory was retired
(REL-9). Screenshot references (iter-*.png, search-*.png) pointed at
session artifacts that were not kept; the decisions and defect
inventory are the durable content. The Playwright harness lives on at
desktop/scripts/verify-kalshi.mjs and verify-search.mjs.
-->

# Kalshi channel UI review — defect inventory & reference patterns

Working notes for the v1.1.5 polish pass. Scope: ONLY files belonging to the
Kalshi channel/widget (`desktop/src/channels/predictions/**`,
`desktop/src/components/chips/PredictionChip.tsx`). Shared components, global
styles, tokens, other channels: off-limits — anything needing them is logged
in "Out of scope" at the bottom.

Reference images: `current-widget.png` (Scrollr, light theme, ~1323px) and
`kalshi-reference.png` (kalshi.com trending, dark). The Kalshi shot is a
hierarchy reference ONLY — Scrollr's design language stays.

---

## A. Defects in the current widget

### Prescribed (from the brief)

1. **Orphaned metadata row.** Card row 1 is `— · "Closes 28d ☆"`: an empty
   left slot with right-aligned metadata floating alone (browse mode hides
   the category badge, leaving `<span/>`). Title sits BELOW the metadata, so
   the card leads with its least important content.
2. **Cards read as table cells.** `grid gap-px bg-edge` renders shared
   hairlines, no radius, no per-card surface. Side effect: partially-filled
   rows expose the container as a gray slab (visible in the Watchlist lens
   with 1 star; also any last row ≠ column multiple).
3. **Movement indicators inconsistent.** Delta (`▲ 3` / `▼ 1`) renders as a
   loose text node between label and pill only when ≠ 0 — rows without
   movement have no reserved slot, so pills don't share a column edge with
   their delta'd siblings. Moved rows ALSO get a 2px tinted left border that
   shifts their label 2px right vs unmoved rows in the same card.
4. **Uneven card heights.** Titles clamp at 2 lines but 1-line titles don't
   reserve the space ("Which states will redistrict before the midterms?" is
   2 lines; "Michigan Democratic Senate nominee?" is 1) → outcome rows and
   footers land at different y across a row; ragged grid.
5. **Footer is a dangling left cell.** `Vol 9.5M · 24h` sits alone left; the
   right half of the footer is empty. The `· 24h` suffix reads like a second
   datum rather than a qualifier.

### Found beyond the brief (same defect classes)

6. **Resolved-today strip shows a fat OS horizontal scrollbar** (light
   theme makes it a big gray bar under the chips). `overflow-x-auto` without
   the app's `scrollbar-thin` utility. Same class as #2 (accidental chrome).
7. **Resolved chips vs outcome rows disagree on radius** (`rounded-lg` vs
   `rounded-md`) and on internal padding scale. Same class as #2.
8. **Probability pill width varies with content** (`1%` vs `99%` vs `100%`)
   so the delta slot to its left starts at a different x per row — no
   columnar alignment (Kalshi pills are fixed-width). Same class as #3.
9. **Outcome-row left-tint border only on moved rows** (see #3) — remove or
   reserve; any conditional border must not shift layout.
10. **Title dominance is weak**: `text-ui-body font-medium` (13px/500) vs
    outcome labels `text-ui-meta` (12px) — 1px and one weight step apart.
    Metadata (countdown, mono) is nearly as loud as the title. Hierarchy
    inversion vs the checklist ("metadata quieter than titles").
11. **Watchlist-lens single card sits next to the bg-edge slab** (worst case
    of #2's side effect — screenshot from earlier session confirms).
12. **Section header x-alignment**: header text (`px-3` on section wrapper)
    aligns with the grid EDGE, not with card CONTENT once cards get their
    own surfaces + gap — must re-check after #2 lands.
13. **EventCard hover**: cards have no hover treatment while their inner
    outcome rows do (`hover:border-edge/60`) — fine if the card itself isn't
    interactive (it isn't; star + rows are), but the star's hit area
    (absolute, h-6 w-6) has no hover surface, only color change. Minor.
14. **Compact MarketItem row**: delta column `min-w-[40px]` but pill is
    `size="sm"` variable width — same columnar wobble as #8 at compact
    density. Same class as #3/#8.
15. **`aria-pressed` star buttons flip color only** — acceptable, but with
    the new header row the star should share the metadata row baseline, not
    absolute-position over content (absolute star currently forces `pr-7`
    hacks on the header row — brittle spacing).

## B. Kalshi reference — hierarchy patterns worth borrowing (not the skin)

1. **Header row has a left anchor.** Cards open with small, muted category
   context on the LEFT (icon + "SOCCER" / "FIFA WORLD CUP") and the
   contextual extra on the right. Metadata never floats alone — every row
   with right-aligned content has left content. → Borrow: card header =
   muted uppercase category label left, `Closes Xd` + ☆ right. (Kalshi
   repeats the category inside cards even under a category section header —
   so showing it in browse mode is correct, not redundant.)
2. **Title block owns the card.** Title is the largest, boldest element;
   date/subtitle in small muted type directly beneath. → Borrow: title to
   `text-ui-title`-weight dominance, everything else one step quieter.
3. **Fixed right-rail columns in outcome rows.** Odds multiplier + pill are
   two fixed-width right columns; labels truncate, numbers never move.
   → Borrow: reserve a fixed delta slot + fixed-width pill (min-w) so all
   pills/deltas share column edges across rows AND cards.
4. **Balanced footer.** Volume left, market count/context right — two-sided
   footer, no orphan. → Borrow: `Vol X · 24h` left, `Closes Xd` right
   (moving the countdown down-right also declutters the header).
5. **Uniform card heights per row** regardless of title length — title area
   is a fixed slot. → Borrow: `line-clamp-2` + 2-line min-height.
6. **Pills are calm.** Neutral until the market moves; movement shows as a
   small colored delta next to a still-readable pill — not a full-row tint.

## C. Fix plan (all in-scope files)

- `FeedTab.tsx` — EventCard restructure (header/title/rows/footer per B.1–5),
  card surface (`rounded-lg border border-edge/40 bg-surface p-3`), grid
  `gap-2 p-2` transparent container (kills slab), fixed delta slot +
  outcome-row border normalization, resolved-strip scrollbar + chip radius,
  section-header alignment, compact-row delta/pill columns.
- `ProbabilityPill.tsx` — fixed min-widths per size so pills column-align.
- `PredictionChip.tsx` — verify pill/delta consistency at ticker sizes
  (same-class check; minimal change if already consistent).
- `MarketDetail.tsx`, `ConfigPanel.tsx` — same-class sweep (radius scale,
  orphaned rows); expected small or none.

## D. Verification checklist (from the brief)

- one spacing scale; one focal point per card; metadata quieter than titles;
  identical card treatment across the whole channel; no overflow/truncation
  at 1440px or 375px; hover, loading, empty states styled.
- Loop: harness page → Playwright screenshots (1440, 375) → critique → fix →
  re-shoot until zero violations. Screenshots: `ui-review/iter-N-{w}.png`.

## E. Out of scope — RESOLVED DISPOSITIONS (scope lifted by user, 2026-07-14)

- **Home-page preview rows** — ✅ DONE (confident): `PredictionsRows` in
  `routes/feed.tsx` now uses the channel's ProbabilityPill + the standard
  fixed delta slot (empty when unmoved), matching the feed's column
  treatment.
- **A reusable "card surface" primitive / restyling other channels** —
  ❌ deliberately NOT done: the hairline grid is Scrollr's current design
  language elsewhere; reskinning finance/sports/rss/fantasy mid-release
  without a per-channel design pass risks four half-polished channels.
  Belongs in its own pass if the card look should become app-wide.
- **Cross-chip pill slots (`chipColors.ts`)** — ❌ not done: on
  re-inspection this was hypothetical; other chips have no probability
  pill and no columnar defect. No change needed.
- **`DisplayItemsGrid` styling** — ❌ not done: no actual defect
  identified; it's the app-standard settings grid.

## E2. Header-stack rework (user callout, same session)

The top of the page was three stacked bands of near-identical pills
(Markets/Positions switcher · lens row · Resolved-today strip). Fixed
in-channel:
- ONE control bar: ViewSwitcher restyled as a CONTAINED segmented control
  (rounded box, active segment raised on bg-surface + soft shadow) ·
  hairline divider · open lens pills · freshness pill right. The two
  control levels (view vs lens) now read as different shapes.
- Resolved today is CONTENT, not chrome: header markup identical to the
  category section headers (text-ui-section + mono count, chevron collapse
  right, px-3 alignment), placed as the first section in the scroll.
- Verified: `iter-4-{1440,375}.png` (harness, no switcher in browser) +
  live Tauri zoom (segmented control + divider + pills in one bar).

## E3. Resolved today → a first-class lens (user follow-up, same session)

The section/chip-rail treatment was still the weakest element (cramped
chips, a second card idiom, content pushed down). Rather than a new
route/page (heavier IA + shared routing changes), "Resolved" joined the
lens row — the page's existing navigation idiom — as a full view:

- New `resolved` lens (`selectLens` + `PredictionsLens`, `now`-anchored
  24h window), pill shows the count like Watchlist.
- `ResolvedCard`: same card anatomy as EventCard (header category ·
  "Settled 37m" + ★, clamped title, rows, quiet footer) with purpose-fit
  content — YES/NO result badges per leg (fixed min-width, same column
  edge as pills), total volume in the footer (24h volume decays to noise
  after settlement), no synthetic-No.
- The strip/section is GONE — Trending opens directly into live sections;
  chrome is one bar.
- Verified: `iter-5-{1440,375}.png`, `iter-5-resolved-{1440,375}.png`,
  `iter-5-trending-top-1440.png`; 452 vitest tests (new resolved-lens
  selector test) + tsc.

## F. Iteration log

- **iter-1** (`iter-1-1440.png`, `iter-1-375.png`) — after the main
  restructure (card surfaces + gap grid, category-anchored header, title
  slot, fixed delta column + fixed-width pills, footer, thin scrollbar,
  chip radius, empty-state copy). 1440: defects 1–5 + 6–12 resolved;
  found: reserved 2-line title slot reads as dead air at single-column
  (375) where row alignment doesn't apply.
- **iter-2** (`iter-2-{1440,375}.png` + state matrix `movers / watchlist /
  detail / compact / dark`) — title slot made `sm:`-only. Verified: flat
  lenses share the exact card anatomy as browse (identical treatment ✓);
  watchlist with one star floats clean — slab gone (defect 11 ✓); detail
  modal consistent, no same-class defects; dark theme tokens hold; compact
  exposed one more: zero-delta renders "—" in compact but empty in cards
  (movement-indicator standardization, defect class #3).
- **iter-3** (`iter-3-{1440,375}.png`, `iter-3-compact-1440.png`) — compact
  zero-delta now an empty reserved slot, matching cards. Full checklist
  pass: one spacing scale (gap-2 / p-3 / gap-1.5 / gap-1), one focal point
  (title), metadata quieter than titles, identical treatment across
  browse/flat/watchlist/modal, no overflow or unintended truncation at
  either width, hover (card border / row border+bg / star bg), loading +
  empty states styled. **Zero violations — loop closed.**

### Notes from the loop

- The "BTC 15 min" card shows countdown "Closed" with a live pill — a
  fixture-staleness artifact (the 15-minute market closed after the
  snapshot was taken; the live server drops it within one sweep). Between
  polls the real app can briefly show a just-closed market the same way —
  the muted "Closed" chip is the designed treatment for that window.
- Harness (`preview/index.html` + `preview.tsx` + `fixture.json`) is
  browser-only dev tooling: the real FeedTab against a static API snapshot.
  Refresh the fixture with the curl one-liner in preview.tsx. The
  ViewSwitcher (Markets / My Positions) is Tauri-only and therefore not in
  harness shots; it was verified in the live app earlier this session.

---

# Market search bar — 2026-07-15

## Phase 0 plan (search strategy: CLIENT-SIDE ONLY)

1. Data layer: the dashboard payload already ships the FULL curated universe
   (~240 markets) client-side; all Predictions filtering is client-side by
   design since v1.1.5 (FeedTab header comment).
2. API check (docs.kalshi.com, trade-api/v2, checked 2026-07-15): GET /markets
   accepts only limit/cursor/event_ticker/series_ticker/ts-ranges/status/
   tickers/mve_filter; GET /events only limit/cursor/nested/milestones/status/
   series_ticker/tickers/ts-ranges. NO free-text/title search param exists.
3. Even if one existed, markets outside the curated sweep would render frozen
   prices (the stale-feed bug v1.1.5 just killed) and a proxy route would
   touch core API — out of scope. So: no API leg, no 250ms debounce path, no
   network loading state; "API failure" state is N/A by construction.
4. Build: new pure `search.ts` (normalize → per-token substring / word-prefix /
   bounded Damerau-Levenshtein ≤1–2 edits) over event_title, outcome labels,
   subtitle, category; returns score + highlight ranges. Vitest unit tests.
5. UI: compact→expanding input in the existing sticky control row (comfort
   view); filters events/sections in place, exit-animated via already-installed
   `motion` (AnimatePresence); headers persist only for matching categories;
   "/" focus, Esc clear→blur, ↑/↓ roving selection, Enter opens detail;
   styled no-results state echoing the query. Playwright (system Edge) on the
   channel preview harness at 1440/375 → screenshots here.

## Result (shipped in this pass)

**Strategy chosen: client-side-only** — for the three reasons above (full
universe already local; no text-search param in trade-api/v2; anything
outside the sweep would be stale-price data). The 250ms-debounced API leg
from the brief is therefore N/A, as is the API-failure fallback state.

Files touched (all Kalshi-channel-only):
- `desktop/src/channels/predictions/search.ts` — NEW pure matcher
  (tokenized AND; substring → per-word bounded Damerau-Levenshtein with
  length-scaled budget; highlight ranges into the original strings).
  `outcomeLabel` moved here as the single source shared with the rows.
- `desktop/src/channels/predictions/search.test.ts` — NEW, 27 vitest cases
  (exact / prefix / fuzzy / typo / transposition / category / outcome /
  subtitle / AND semantics / order preservation / range merging).
- `desktop/src/channels/predictions/FeedTab.tsx` — SearchBox (compact,
  expands on focus, "/" kbd hint, clear ×, sr-only live result count),
  in-place filtering of sections + flat grids, per-section preview cap
  lifted while searching, AnimatePresence popLayout exit animation via the
  already-installed `motion` dep, keyboard layer ("/" focus w/ modal guard,
  Esc clear→blur, ↑/↓ roving ring, Enter opens detail), no-results state.
- `.claude/launch.json` — dev-server entry for the desktop vite app
  (tooling config only).

Verification: `ui-review/verify-search.mjs` (Playwright, system Edge, run
`node verify-search.mjs` with the vite dev server on :5174 and playwright
installed) — 25/25 checks green at 1440px & 375px incl. keyboard-only e2e,
fast typing, typo + zero-result queries, clear flows, star interactivity,
and a console-error gate. Screenshots: `search-01…13-*.png` (incl. dark).
Unit: 97/97 predictions tests pass; `tsc --noEmit` clean.

### Skipped for scope
- **Compact density (Home preview) has no search** — the channel header
  only exists in comfort mode by prior design; nothing shared was touched
  to add one there.
- **Ticker window untouched** — search state lives entirely in FeedTab;
  matching is memoized per (query, events) so the 1s `now` tick and live
  CDC updates never re-run it. No shared perf work needed.
- **No fuzzy-search dependency added** — matcher is ~90 LOC in-channel;
  playwright was installed OUTSIDE the repo (scratchpad) so package.json
  is untouched.
- **Diacritic folding** (café → cafe) skipped — Kalshi titles are ASCII in
  practice; add a normalize step in `matchToken` if that ever changes.

---

# Kalshi channel version bump — 2026-07-15 (bugs + UX pass)

## A1 root cause — broken market graphs

**The candlesticks fetch has NEVER sent auth, against a route that requires
it — it only ever worked through the fail-open auth hole that hotfix #220
closed.**

Chain of evidence:
1. Client: `predictionsCandlesticksOptions` (api/queries.ts) uses
   `request()` — the **unauthenticated** helper (no Authorization header).
2. Route: `/predictions/candlesticks/:ticker` registers `Auth: true`
   (channels/predictions/api/main.go:213).
3. Timeline: the chart shipped in v1.1.4 (Jul 3) while `ValidateAuth`
   still failed open (nil-on-401 — every Auth:true route was effectively
   public). Security hotfix #220 (same day) closed the hole → every
   candlesticks request from the desktop has 401'd since.
4. Live probe (2026-07-15): `GET api.myscrollr.com/predictions/
   candlesticks/FEDHIKE-26DEC31` unauthenticated → **HTTP 401**;
   `/predictions/catalog` (Auth:false) → 200. Kalshi upstream + the
   ingestion proxy are healthy (probed Kalshi directly: 156 candles,
   price.close_dollars shape matches the client transform exactly).

**Which markets "work" and why:** none get candles. Markets whose price
ticked ≥2× while the app was open render the in-session tick-accumulator
sparkline (the v1.1.4 fallback) — that's the "some graphs work" illusion
(high-churn markets: live sports, crypto). Quiet markets show the
"Tracking price live…" placeholder box, read as "renders nothing".

**Ruled out:** series_ticker mismatch. The sweep's prefix heuristic IS
wrong for 4 fixture series (FEDHIKE/GTA6/TESLAOPTIMUS → real series are
KX-prefixed; KXNEWOUTBREAK → KXNEWOUTBREAK-P), but Kalshi's candlesticks
endpoint ignores the series path segment (probed: 200 + identical candles
via both values). No DB rows lack series_ticker (all 225 fixture tickers
resolve). Documented here so nobody "fixes" the heuristic expecting graphs
back.

**Fix (in-channel):** candlesticks queryOptions move into the channel
(MarketDetail) using `authFetch`; error state gets its own styled fallback,
distinct from "no trade history yet".

## A2 root cause — My Positions shows zero while a position is open

**Kalshi completed its fixed-point API migration; the desktop portfolio
parser still reads the retired integer count fields, so every position
parses as flat and is filtered out.**

Raw-response diff (the two surfaces):
- kalshi.com portfolio (works) consumes the CURRENT GetPositions shape:
  `market_positions[].position_fp` ("5.00" string), `*_dollars` money,
  **no integer `position`, no `resting_orders_count` field at all**
  (docs.kalshi.com OpenAPI, checked 2026-07-15).
- Scrollr My Positions (broken) parses `RawMarketPosition.position:
  Option<i64>` → `None` → 0 → `side: "flat", count: 0` → dropped by the
  `position != 0 || resting_orders_count != 0` filter in
  `rest.rs::positions()` → empty list. Money fields survive (the model
  added `*_dollars` fallbacks — that's why balance and account value are
  right while the position list is empty).
- Corroborated live without creds: public market data has completed the
  same migration (`open_interest_fp`/`volume_fp`/`*_dollars` only — no
  integer twins left in `GET /markets`). The server-side ingestion model
  was already fp-only; the desktop portfolio model missed the count half
  of the migration.

Secondary defects, same class:
- `count_filter=position,resting_order_count` — `resting_order_count` is
  no longer an accepted value (docs allow `position`/`total_traded`). If
  Kalshi ever 400s on it, `portfolio()`'s `unwrap_or_default()` silently
  blanks the list (the error-masking that hid this bug).
- Fills: only `count_fp` exists now (`count` gone) → "0 @ 62¢" rows;
  `side`/`action` are deprecated (removal slated May 2026, `outcome_side`
  replaces `side`).
- Resting orders: same for `remaining_count`.

**Checked and ruled out:** status filters (unsettled default is correct),
pagination (count_filter=position bounds the set; limit raised to 1000),
event-vs-market ticker mismatch (positions key by market ticker; the panel
falls back to raw ticker rendering), stale caching (5s staleTime + WS
invalidation — and the bug persists across refetches).

**Fix (in-widget, src-tauri/kalshi):** parse `*_fp` counts with legacy
integer fields still preferred when present, `outcome_side` fallback for
fill sides, `count_filter=position`, `limit=1000`; Rust tests deserialize
a mocked CURRENT-shape (fp-only) GetPositions/GetFills response and assert
the open position survives normalization + filtering.

## B3 findings — time fields that actually exist

Dashboard payload (fixture = real prod snapshot, 225 rows, plus
api/models.go DTO): **`close_time`** (all rows), **`settled_at`**
(resolved rows only), **`updated_at`** (all rows). Nothing else.

Upstream inventory:
- markets table + Kalshi market object: adds `open_time` — when TRADING
  opened, not when the underlying event starts (a July 15 match's market
  had open_time = its listing moment). Wrong semantic for LIVE/countdown;
  not exposed to the client, and shouldn't be for this purpose.
- Kalshi event objects carry no start time in what we ingest
  (`event_ticker/series_ticker/title/sub_title/category`). Kalshi's
  `strike_date` exists on some series upstream but is not ingested.
- Sports market close_times are NOT game starts (World Cup advance
  markets close weeks after the match).

**Conclusion: no market type in today's payload has a start-time field →
per the brief's no-fabrication rule, every market keeps the close label in
prod.** The indicator logic (`timeIndicator()` in view.ts) implements the
full LIVE / "Starts in Xh" / "Closes Xd" priority against an optional
`start_time` field and is unit-tested with synthetic values, so it lights
up the day the payload ships one. The harness injects synthetic
`start_time`s (dev-only, ?b3=1) to photograph the LIVE and countdown
states.

## Shared-code changes needed (logged, NOT made — hard scope)

1. **api/queries.ts**: `predictionsCandlesticksOptions` + its types are
   now dead code (the channel owns an authFetch-based copy). Delete on the
   next shared-code pass.
2. **Backend, candlesticks route**: consider `Auth: false` (it serves
   public market data already cached in Redis) — would restore graphs for
   signed-out/demo users too. Until then, auth'd fetch covers signed-in
   users.
3. **Backend, MARKETS_PER_EVENT=2** (service lib.rs): the payload never
   carries >2 legs per event, so B2's "+N more" can't trigger in prod.
   Lifting the cap (e.g. 4–6 with CATALOG_MAX_MARKETS/payload-size
   review + CONTRACT.md update) is the enabling change; the UI + tests
   are ready for N legs.
4. **Backend, start times**: LIVE/countdown indicators need a real event
   start-time source (Kalshi `strike_date` ingestion where present, or
   the sports channel's schedule data); expose as `start_time` on the
   dashboard payload. UI is ready (see B3 above).
5. **utils/format.ts `formatCloseCountdown`** stays shared-untouched; the
   channel wraps it (single-unit output is reused for "Starts in Xh").

## Version-bump pass — iteration log & verification

Harness additions (dev-only, all in `preview/preview.tsx`):
- Tauri-bridge mock (always on in the harness): `isKalshiAvailable()` is
  now true in the browser, the Markets/Positions switcher renders, and
  `kalshi_status`/`kalshi_portfolio` answer with a mocked portfolio (an
  open YES 15× and an open NO 4× on fixture tickers) — the "positions page
  with mocked open position" verification surface.
- `?demo=1`: injects `start_time` into two fixture events (one live, one
  starting in 3h), grafts two synthetic legs onto a third event (+2 more),
  and seeds real-shape candles into the query cache per ticker (the real
  fetch needs the authed prod API). States prod can't produce today are
  photographable without touching fixture.json.

Verification (`verify-kalshi.mjs`, Playwright on system Edge, vite :5174):
- **Round 1 — 42/43.** Demo chart didn't render: the fetch shim sat below
  `authFetch`, which fails in the harness before fetch is reached (no auth
  config in a plain browser). Fix: seed the query cache instead of
  shimming fetch.
- **Round 2 — found by eyeballing vb-07.** Card click landed on the
  rank-1 (most liquid) leg while the card visually leads with the top-
  priced leg (All-Star card showed AL 79% first, modal opened NL 21%).
  Fix: card click / +N / search-Enter open the top-PRICED leg; the ★
  stays anchored to the rank-1 lead.
- **Round 3 — found by eyeballing vb-12; DOM checks passed, eyes failed.**
  The 375px filter menu (left-anchored, w-56) clipped off the right
  viewport edge, hiding the selected-state checkmarks. Fix: the dropdown
  anchors to the sticky bar (`inset-x-2 top-full`) and spans the channel
  width at collapsed sizes. Added hard assertions: 2 aria-checked rows, 2
  check glyphs, menu bounding box inside the viewport.
- **Final — 47/47 PASS** at 1440 / 720 (app min channel width) / 375,
  plus `verify-search.mjs` (previous pass' suite, selectors updated
  h3 → [data-section-title]) all green — no search regressions from the
  card/header rework.

Screenshots (`vb-01…15-*.png`): card + header hover, category focus,
category×search, sticky elevated, LIVE + Starts-in + "+2 more" (light and
dark), detail with all-outcomes + working chart, chart error fallback,
positions 1440/375, collapsed filter idle/menu/filtered, min-width 720.

Test totals: desktop vitest 494/494 (24 new: outcome sort/truncation ×7,
time indicators ×9, plus existing suites), `tsc --noEmit` clean, cargo
kalshi tests 13/13 (4 new fixed-point mocked-response tests).

Tooling note: `ui-review/node_modules` is a junction into this session's
scratchpad npm install (playwright). If it dangles later:
`npm i playwright` anywhere and re-point, or run the scripts with a local
install — package.json stays untouched either way.

## Feedback round (user, in-app testing) — 4 fixes

1. **Bar didn't stick in the real app** (worked in harness). Root cause:
   PageLayout's feed mode scrolls the PAGE (`flex-1 overflow-y-auto`),
   while the FeedTab root's own `h-full overflow-y-auto` created a
   never-scrolling inner scrollport — `sticky` pins against the nearest
   scroll CONTAINER, not the nearest thing that scrolls, so the bar pinned
   to a box that itself scrolled away. The harness masked it by
   constraining height (FeedTab really scrolled there). Fix: no inner
   scroll container — root is `flex min-h-full flex-col` (RSS's idiom);
   the harness shell now mirrors the app (`overflow-y-auto` page scroll);
   the stuck-observer uses the default root (intersection clips through
   whichever ancestor scrolls). Same fix applied to MyPositionsPanel,
   whose summary had the identical dead-scrollport sticky. The positions
   switcher bar is now sticky too (the way back to Markets survives
   scrolling); the panel summary deliberately is NOT — stacking it under
   the switcher needs a px offset that drifts with bar height (a guessed
   41px vs measured 45px was already 4px wrong), and it never pinned in
   prod anyway. NOTE: finance FeedTab has the same dead-scrollport
   pattern (`h-full overflow-y-auto`) — harmless there (no sticky chrome)
   but worth aligning in a shared pass. Test upgraded from "elevation
   class appears" to "bar bounding box pins at scroller top while content
   moves ≥300px" — the class-only check is exactly how this bug slipped.
2. **Crowded bar.** Counts dropped from lens pills (menu + section
   headers still carry them), category select compacted ("All" instead of
   "All categories", max-w + truncate for long category names) and moved
   into the right-hand control cluster with search/freshness so the lens
   row breathes.
3. **Category options reshuffled per lens.** They derived from the
   current lens's items. Now derived from the full payload (live +
   resolved) — identical options in every lens; a lens-empty category
   shows the standard empty state. Asserted: options identical between
   Trending and Resolved.
4. **Rectangular focus outline on the rounded select.** style.css global
   `select:focus-visible { outline: 2px solid …; border-radius: inherit }`
   inherits the PARENT's radius — square wrapper ⇒ rectangle ring around
   a pill (and it beats utility classes: unlayered CSS wins over
   Tailwind's @layer utilities, so the old `outline-none` never applied).
   Fix: radius on the wrappers the ring inherits from (select wrapper
   rounded-full, filter-button wrapper rounded-lg, section wrapper
   rounded-md); dead focus utilities removed from cards (CardCell already
   provides the lg radius). Asserted: focused select keeps a non-zero
   computed border-radius. Shared-code note: `border-radius: inherit` in
   that global rule is a footgun for any control whose parent is square —
   consider `border-radius: 9999px`-per-shape or dropping inherit in a
   style pass (NOT changed here, scope).

Final state after round: verify-kalshi 51/51 (incl. new pin, category-
stability, focus-radius checks), verify-search green, vitest 494/494,
tsc clean. Fresh screenshots: vb-05 (pinned + elevated, de-crowded bar),
vb-12 (full-width menu), vb-16 (positions).

## Feedback round 2 (user, in-app) — 4 fixes

1. **Stale shadow after Markets ⇄ Positions round-trip.** The stuck
   observer held a plain ref to the sentinel; the markets tree unmounts on
   the Positions view, so the IO kept watching a DETACHED node and `stuck`
   froze at its last value — switch back at top ⇒ pre-shadowed bar. Fix:
   the sentinel is React STATE via callback ref; the observer re-arms on
   every node identity change (also covers the empty→data remount, where
   elevation previously never armed at all). Regression test: scroll →
   Positions → Markets → scrollTop=0 ⇒ no shadow.
2. **Category dropdown square/unanimated; wanted multi-select.** The
   native <select> popup is OS-drawn — unstylable and unanimatable by
   design — so it's gone. New `CategoryMenu`: pill trigger (label = All /
   name / "N categories", chevron rotates), motion-animated panel
   (fade + y + scale, 140ms, origin-top) shared with the narrow FilterMenu
   via one `MenuPanel` primitive + `useDismiss` hook. MULTI-select
   (menuitemcheckbox rows; toggling keeps the menu open; "All categories"
   clears): `categoryFocus: string|null` became `selectedCats: string[]`
   throughout — grid filter is set-membership, "View all"/header click
   focuses exactly that one, lens switch clears, filter badge counts
   lens≠trending + per-category.
3. **Header hover surface touched the cards** — `mb-1` on the header
   button; asserted ≥3px clearance between hover box and first card.
4. **Pills rendered cut off before collapsing** — collapse threshold
   raised @3xl→@5xl (container <1024px now uses the Filter button; the
   full bar needs ~900px+ and search focus-expansion adds ~130px more).
   New 960px test block: pills hidden, filter button shown, no clip.

Final state: verify-kalshi **58/58** at 1440/960/720/375, verify-search
green, vitest 494/494, tsc clean. New shots: vb-04a (menu open), vb-04b
(2 categories combined), vb-17 (960 collapsed).
