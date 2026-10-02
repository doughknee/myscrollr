# Ticker specification (for AI agents)

This is the complete, exact specification for building or changing anything on the Scrollr
ticker: a page cell, a chip, the edge zone. It is written for a model: every number, class,
file path, contract and test pattern is stated literally so nothing has to be inferred. The
human summary is `docs/CHIP_DESIGN.md`. When the two disagree, this file wins, and the
disagreement is a bug to fix in the other.

Read all of it before touching `desktop/src/components/pages/`,
`desktop/src/components/chips/` or any `desktop/src/datawidgets/*/ticker.tsx`. Then follow
§12 (build recipe) and §13 (review checklist) literally, the half that matches what you are
building.

**State of the code.** This file describes what is on `main`. A rule marked
*(lands with SCROLLR-xxx)* is decided and written down but the code that enforces it is not
on `main` yet; build to the rule, and delete the mark when the issue merges.

---

## Map: which presentation each section covers

The ticker has **two presentations of one set of selection rules** (§P.0). Pages is the
default; Continuous is a Settings option. Pick the sections that match what you are building.

| Sections | Covers |
|---|---|
| §0 vocabulary, §1 invariants | Both |
| **§P Pages** (P.0 to P.15) | Pages only: the bar, label, columns, visit rule, timings, freeze, cells, edge zone, pins, Also page |
| §2 to §7 | Continuous chips only (anatomy, geometry, reservations, text, detail row, colour). Page cells reuse the helpers named in §P.9 |
| §8.0, §8.5 rules 1 to 3 and 5, §8.7 words | Both: what is eligible, the feed-page-versus-ticker rule, what a pin is, what an empty widget says |
| §8.1 slots, §8.2 to §8.4, §8.5 zone, §8.6 | Continuous only: slots, rotation, the off-screen rule, the fixed zone, the status chip |
| §9 motion | Continuous chips (Pages motion is §P.7) |
| §10 data, §11 traps | Both |
| §12, §13 | Two recipes and two checklists: 12A/13A page cells, 12B/13B chips |

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| **Pages / Continuous** | The two presentations, `prefs.ticker.scrollMode` `"pages"` (default) or `"continuous"`. Settings › Ticker › Scroll mode. |
| **page** | One widget's items laid across the bar in equal columns, shown whole, then swiped away (§P). |
| **cell** | One item in one page column: a game, a headline, a quote, an Also entry. No card shell. `desktop/src/components/pages/cells/`. |
| **column** | One equal-width slot of a page. Its width is `content width / items on the page`. |
| **label** | The 112px block at the left of a page naming the widget (§P.2). |
| **visit** | One trip to a widget: exactly one page, the next after the last visit's; then the bar moves to the next widget (§P.6). |
| **edge zone** | The fixed block at the right of the Pages bar: utilities, then pins (§P.10, §P.11). |
| **Also page** | The one shared page, last, listing every widget that has nothing on (§P.12). |
| **freeze** | A page's items, order and column width are fixed at swipe-in (§P.8). |
| **chip** | Continuous only: one `<button>` on the rail representing one item (game, symbol, headline, …) or one widget (clock, weather, …). |
| **rail** | Continuous only: the scrolling marquee. `desktop/src/components/ScrollrTicker.tsx`, rendered by motion-plus `<Ticker>`. |
| **one height** | The bar has one height, 64px (SCROLLR-278, 1 Oct 2026). A chip is two rows, 30px + 20px; a page fills the 64px. The compact density and the `tickerMode` setting are deleted. |
| **tab** | Continuous: the left cell naming the source: league code, feed name, widget name, or status cap. Spans both rows. |
| **fixed right cell** | Continuous: the rightmost cell holding the one value that changes on screen. Bordered on its left. |
| **reservation** | Width held from first render for a value that will change, so the chip or cell never resizes. |
| **cap** | A chip's max width: `CHIP_MAX_PX = 640`, class `max-w-[640px]`. |
| **slot** | Continuous: one rail position that cycles through several items, keeping its React key while its content changes. (The edge zone has its own "slot": one utility's cell, §P.10.) |
| **pool** | Everything eligible from one source, in display order. Both presentations draw from it. |
| **lap / cycle** | Continuous: one complete trip of a slot off the right edge, across, and off the left. A slot's content advances once per lap. (Pages measure a lap as one pass through every widget's visits.) |
| **horizon** | Continuous only: the per-source time rule deciding what is eligible for the rail. Pages have none: they show the widget page's pool (§P.4a). |
| **floor** | Continuous only: what a quiet source still shows when nothing is inside its horizon: one item for most sources, the whole next matchday for Sports (§8.1). |
| **cursor** | Pages: where a widget's next visit continues, per widget, held by the leader window; it survives refreshes and re-plans and wraps (§P.6). |
| **fill** | Pages only: popular symbols that top a short watchlist's page up to its column count (§P.4a). Never written anywhere; never a setting. |
| **palette** | The `ChipColors` object for a chip's widget. Page cells take one `--accent` variable instead (§P.13). |
| **status chip** | Continuous: the single grey chip a widget with nothing on the rail shows: why, and when if known (§8.7). Pages say the same words on the Also page. |
| **source** | A `TickerSource` in `desktop/src/datawidgets/<source>/ticker.tsx`, registered in `tickerRegistry.ts`. Pages read the same sources through the same selectors. |

---

## 1. The invariants (never violate)

1. **One height.** The bar is 64px in both presentations and there is no other density or setting for it. A page cell fills it; a chip is a 30px top row plus one 20px detail row.
2. **Nothing moves while it is up.**
   - **Pages:** nothing on a page moves while it is up. Every cell keeps its x, y, width and height from swipe-in to swipe-out; a value (score, price, age, clock) changes in place and never changes its box; items do not re-sort, appear or vanish on a page being read. A resize, a re-rank or a new item reaches the layout on the next page (§P.8). Verify: `e2e/ticker/cells.spec.ts` (values) and `e2e/ticker/pages.spec.ts` (whole pages).
   - **Continuous:** a chip never changes width while on screen. Every value that can change reserves its widest plausible width from first render (§4). Verify: render the same fixture in every state it can pass through (pre / live / final; no-score / one-digit / two-digit; short / long swap) side by side; widths must be identical.
3. **The detail line is never derivable from the top line.** It is what the user would otherwise open the app to find (§6 for chips; §P.9 for cells).
4. **Nothing on the ticker is user-configurable.** No per-widget or global setting decides what is on the bar or how many. Horizons, floors and slot counts are constants (§8); Pages' columns per page are derived from the bar width and each family's minimum width (§P.4), never set.
5. **The ticker is independent of the widget page's display settings.** A source's selector must not read any feed-page display preference (`defaultSort`, `articlesPerSource`, `maxArticles`, `maxArticleAgeDays`, filters). Verify: `selectXForTicker` (Continuous) and `selectXForPages` (Pages) take no prefs argument; Pages do not read a sports widget's `display` day window either (the Continuous sports selector still takes it as config). Pages show the widget page's *pool* (what it holds, at the app's default window), never the user's view of it.
6. **Red means live or urgent, and nothing else.** Never use `live`, `down`, `error` or `warning` tokens for brand or emphasis.
7. **Never fabricate a value.** Missing data reserves its space and renders empty. No "—" placeholders for scores. No single-point sparklines. No synthetic history.
8. **Tailwind classes are literal strings in source.** Never build a class with a template literal or string concatenation (§11). Page cells take their accent through an inline style (`--accent`, `mix(pct)`), which is allowed because it is a `style`, not a class.

---

## P. Pages (the default presentation)

Code: `desktop/src/components/pages/` (`pagePlan.ts` arithmetic, `widgetPages.ts` what is shown
and in what order, `PagedBar.tsx` the engine, `EdgeZone.tsx`, `cells/`). Shipped across
SCROLLR-270 to SCROLLR-274 behind `scrollMode`; Pages became the default for new installs in
SCROLLR-274. Existing users keep a stored `continuous` until the release flips them once
*(lands with SCROLLR-277)*. The design record is SCROLLR-268.

### P.0 Two presentations, one set of selection rules

| | Pages | Continuous |
|---|---|---|
| What the bar is | One whole widget at a time, in equal columns that fill the bar, swiped to the next | Chips scrolling right to left without stopping |
| Unit | A page of cells | A chip in a slot |
| What is eligible | **The widget page's pool** (§P.4a): every headline the widget holds, the week's games, the watchlist; no horizon. `selectXForPages`; the **fill** tops a short watchlist up | The horizons and floors (§8.1), `selectXForTicker`; slots and rotation absorb a short pool |
| Pins and favourites | **Shared meaning** (§8.5): a pin is a subject, bypasses the horizon, leaves the main flow, shows once | **Shared meaning** |
| An empty widget | The Also page (§P.12) | The status chip (§8.7); same words |
| How much is on screen | Derived: columns = content width / the family's minimum column (§P.4) | Fixed slots per source (§8.1) |
| What reaches the next item | The visit rule and the page clock (§P.6, §P.7) | Rotation inside slots, only off screen (§8.2 to §8.4) |
| Pins live | The edge zone, right (§P.11) | The fixed zone (§8.5) |
| Utilities (clock, timer, weather, sysmon, uptime, GitHub) | The edge zone, one Cycle slot each (§P.10) | One chip each in the rail, or pinned |
| Settings that apply | Scroll mode, Size, Screen edge, Monitors | Those plus Speed, On hover |
| Width stability | Fixed columns; scores and clocks reserve (§P.9) | Reservation per chip (§4) |

A rule about *what is on the bar* (pool, horizon, order, pin handling, status words) lives
once, in `datawidgets/`, beside the source's other selectors: `selectXForTicker` for
Continuous, `selectXForPages` for Pages (SCROLLR-293: Pages dropped the horizon, so the two
differ only in the window; order, `dropPinned` and the status words are shared).
`buildPageWidgets` (`widgetPages.ts`) is the only place Pages adapts that output into pages.

### P.1 The bar

- Height `h-16`, 64px, `ticker-container relative flex w-full shrink-0 items-stretch overflow-hidden border-b border-edge/50 bg-base-150`. One height: no density branch (invariant 1).
- Left to right: **label** (112px, `shrink-0`), **pager** (`PAGER_W` = 88px, `shrink-0`, §P.7a), **page block** (`min-w-0 flex-1 overflow-hidden`), **edge zone** (`ml-auto shrink-0`, absent when empty).
- The edge sits outside the page block, so it shows with no page at all.
- `data-pages` on the bar; `data-motion-style` is `"swipe"` or `"fade"` (reduced motion, §P.7).
- Nothing to draw (no widget page, no utility, no pin): `EmptyBar` in its Pages look (a label block in the theme accent, then the same one-row message). Two states, decided in `App.tsx`: **sourceless** (signed in, no widgets installed: browse the catalog) and **installedOff** (installed, none showing: open one to turn it on). A clock or a pin on the edge counts as something to show: the bar stays.

### P.2 The label

- 112px (`LABEL_W`), widget colour mixed at 16% (dark) or 12% (light) over the bar, right border at 40%, vertically centred, `pl-3.5 pr-2`.
- **Name:** the widget code in the ink (`--accent-ink`, §P.13), `font-sans font-extrabold`, `text-[19px]`; `text-[15px]` when the code is longer than six characters; truncates. Sports: league code (`leagueCode`). News: first word of `sourceTab(feed name)`. Finance: the catalog name in capitals. Also: `ALSO`.
- **One fact** beneath, `font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-2` (`data-fact`; fg-2, not fg-3: it sits on the label's tint): sports `n LIVE`, else the first game's day (`SUN 4`: a game is at most a week away, so no month); news `HEADLINES` on one page, nothing on several (the counter says it all); finance `▲up ▼down`, or `+n POPULAR` when popular symbols fill the page (`n POPULAR` with no watchlist; `labelFact`, SCROLLR-292); Also `NOTHING ON`. It is read live, so it updates in place while a page is up (a fact, not a layout).
- **Position** at the right of that line, on every widget with more than one page: `n/m` (`2/8`, `data-pos`) in the ink, `tabular-nums tracking-normal`, `shrink-0`, after a 3px gap (SCROLLR-293; the dots are gone: they did not say how many, and three already cut `HEADLINES`). One page: nothing. The line has 90px; the fact truncates before the counter does, but every fact the bar produces fits beside a two-digit counter (measured at the bar's rendered size: `12 LIVE` + `10/14` = 89.9px; `pages.spec.ts` asserts no fact is cut on any fixture).
- **Dwell line:** a 2px line along the bottom of the label that fills (`scaleX` 0 to 1, linear) over the page's dwell. It stops while the page is held (an active pointer, §P.7), and runs on when the pointer rests.
- **Wipe:** the label rolls upward (`y` 100% to 0 in, 0 to -100% out, 0.45s, §P.7) only when the widget changes. Pages of the same widget keep it still.

### P.3 Geometry of a page

```
|<- 112 ->|<- 88 ->|<---------- content width ---------->|<- edge ->|
| label   | ‹ 7/23 ›| col 1 | col 2 | col 3 | ... all equal | edge     |
```

- **Content width** = `bar width - LABEL_W - PAGER_W - edge width` (`contentWidth`). The edge's width is measured with `offsetWidth` when each page is planned, not with a ResizeObserver (which fires after the first page has been planned against an empty edge).
- The page block is a grid, `repeat(n, minmax(0, 1fr))` where `n` is the number of items **on that page**. Every page is full (§P.4a), so `n` is the column count except in two cases:
  - **A widget on several pages** whose pool is not a multiple of the columns splits evenly (§P.4): 9 headlines at 8 columns are 5 + 4, each page's columns widened to fill the bar.
  - **A truly short widget** (one page, fewer items than columns even after the fill: one NFL game all week, a feed holding two headlines) keeps **a full page's column width**, `content width / columns`, **left-aligned** from the label: `repeat(n, colW px)`, `data-short` on the page. Never one item stretched across the bar, and never centred: a centred cell floats away from the label that names it and reads as one item lost on a page (both drawn on SCROLLR-292; left picked).
- `colW = content width / n` (a short page: `/ columns`), frozen with the page (§P.8) and passed to the cell, which picks its own layout from it.
- A hairline `Rule` (`parts.tsx`) sits between columns: 1px, inset 9px top and bottom, the ink at 40% (clears 1.5:1 on every palette). Cells have no border, no background card, no rounded shell.
- Height is not an input to any of this.

### P.4 Columns and pages

`columnsFor(contentW, minCol) = max(1, floor(contentW / minCol))`. `minCol` is **always the
cell family's own export**, never a default in `pagePlan.ts`:

| Family | Minimum column | Export |
|---|---|---|
| Game, US pro (NFL MLB NBA NHL MLS WNBA) | 264px | `gameMinCol(league)` |
| Game, every other league | 276px | `gameMinCol(league)` |
| Quote (stock, coin) | 260px | `QUOTE_MIN_COL` |
| Headline | 400px | `NEWS_MIN_COL` |
| Also entry | 300px | `ALSO_MIN_COL` |

Worked columns, no edge: at 1280 the content is 1080px: 4 NFL, 3 college, 4 quotes, 2
headlines. At 1920 it is 1720px: 6, 6, 6, 4. With the Clock on the edge (102px): 3, 3, 3, 2
and 6, 5, 6, 4. An edge of 400px takes 400px off the content. The pager (§P.7a, SCROLLR-298)
costs 88px: before it, 1280 had 1168px (4, 4, 4, 2; with the Clock 4, 3, 4, 2) and 1920 had
1808px (6, 6, 6, 4 either way), so it costs a column for NFL and quotes at 1280 with the
Clock and for college at 1920 with it. SCROLLR-296 widened the game
and quote columns on purpose (Brandon, 1 Oct 2026: "we don't need that many per page. I'd
rather fit more of the names"; the price "should be the biggest, most important thing"):
fewer, roomier cells are the feature. Before it they were 212 / 244 / 172 (5, 4, 6, 2 and
8, 7, 10, 4 with no edge). Under one page per visit (SCROLLR-294, SCROLLR-297), a widget with more pages
does not lengthen the lap; it takes more laps to come round.

`paginate(items, cols)` makes the **fewest pages of at most `cols`**, evenly: sizes differ by
at most one, larger pages first, so there is never a lonely last page (14 at 12 columns is
7 + 7; 56 at 5 is 8 pages of 5 then 4 of 4). Order is kept: what was ranked first is page 1.

There is no per-widget slot count in Pages. How many items a page holds is the width, and
how many pages a widget has is its pool divided by that.

### P.4a The pool: what the widget page shows (and the fill)

SCROLLR-293 (Brandon, 1 Oct 2026: "NPR has a ton of things in the feed but the ticker only
shows one page worth"). **A widget's pages hold everything the app's widget page shows for
it, in the ticker's order. There is no time window.** The chip-era horizons and floors
(§8.1) exist to keep the continuous rail short; under Pages the width decides how much is on
a page (§P.4), the visit rule how many pages a visit takes (§P.6), and the cursor brings the
rest round on later laps. Nothing eligible is hidden.

| Family | Pool (`selectXForPages`, Pages only; no prefs) | Bound |
|---|---|---|
| Sports | Every game in the app's **default** day window (`SPORTS_WINDOW_DEFAULTS`: yesterday through seven days ahead, local calendar days), never the user's `display` window. `sortForDisplay`: live, then soonest kick-off, then newest finals (`selectSportsForPages`). A Thursday is TNF, Sunday and MNF | The week |
| News | Every headline the widget holds, newest first, interleaved by feed like the ticker pool; undated counts as current (`selectRssForPages`) | The rss ingester's 7-day storage |
| Stocks, Crypto | The watchlist, in the user's order (`selectFinanceForTicker`, unchanged) | The watchlist |

**Every page is full** (SCROLLR-292): a page shows as many items as it has columns, unless
the widget has fewer items in total than one page holds. With the whole pool on pages, only
a short watchlist still needs topping up:

- `buildPageWidgets` gives each widget its `items` (the pool) and a `fill` (sports and news:
  none, the pool is already everything). `planAll` calls `topUp(items, fill, cols)`: it adds
  **exactly the empty columns of the last page**, never a whole extra page, so the page
  count, the visit rule (§P.6) and the lap are what the pool alone would give. 1 item at 8
  columns becomes 8; 9 at 8 becomes 16 (two full pages); 8 at 8 takes nothing.
- `PagePlan` carries `cols` (a full page's columns) and `avail` (items + every fill it may
  use); the page publishes `data-cols`, `data-total`, `data-avail`.

| Family | Fill, in order (Pages only) | Tier |
|---|---|---|
| Sports, News | None: the pool is already everything the widget holds; still short is a short page (§P.3) | |
| Stocks, Crypto | **Only when the watchlist (after pins) is shorter than a page.** Popular symbols of the widget's own asset class with a live quote in `/finance/public`: the widget's starter list (SCROLLR-259, `addConfigForWidget(tab).symbols`), then `POPULAR_SYMBOLS` (a constant: nothing counts how many users track a symbol), then the rest of the market by day volume. Never one of the user's own or a pinned one (`selectFinanceFill`) | 3, `fill: true`, no pin subject |
| Also | None (one entry per quiet widget; a short Also page is a short page, §P.3) | 4 |

- **Fills are never written anywhere.** The watchlist stays exactly what the user saved;
  each symbol they add pushes one fill out, one for one. A fill cell looks like any other
  cell; the label says so (`+4 POPULAR`, §P.2). The watchlist screen lists the fills the
  bar is showing (as many as the narrowest bar's page has columns, from `useEdgeRoom`) as
  one-click adds, only under Pages with the widget on the ticker.
- A watchlist as long as a page or longer takes no fill (10 symbols at 9 columns are 5 + 5,
  not 9 of yours and then 1 + 8 popular).
- The quotes come from `/finance/public` (`financeMarketOptions`, the query the watchlist
  screen already uses), fetched only while some finance widget on the ticker is shorter
  than a page. The **first** page waits for it (or its failure) so a one-symbol watchlist
  never opens as one quote; after that a refetch only reaches the next page (§P.8).
- The pool and the fill read no display preference (invariant 5): the watchlist and
  favourite teams are inputs; the sports window is the app's default, a constant.
- Continuous is unchanged: no fill, the horizons stand, slots and rotation absorb a short
  pool.

### P.5 Order inside a widget: the tier ladder

`planWidget` sorts **stably** by tier and keeps the caller's order inside a tier. The ladder
(`TIER` in `pagePlan.ts`; the assignment is `widgetPages.ts`):

| Tier | Meaning | Who |
|---|---|---|
| 0 live | Leads the widget: page 1 | A live game; a game of one of the widget's `favoriteTeams` |
| 1 fresh | | A game starting within 3 h; a headline under 2 h old; a finance symbol on the watchlist |
| 2 recent | | A game later today; a result inside the 18 h window; a headline 2 to 6 h old; every other finance row |
| 3 quiet | | A game on a later day; an older result (yesterday's, which the widget page still shows); a headline over 6 h old |
| 4 status | | The Also page's entries |

- Sports order within a widget: **your games first, then every other live game, each in
  kick-off order**, then the rest in the ticker's own order (`sortForDisplay`). There is no
  per-score ranking on purpose: closeness changes with every score and would reshuffle a
  page. A close game is marked on its cell instead (§P.9).
- Finance: the watchlist, in the user's order, is tier 1, not tier 0: tier 0 is for live
  games and your team.
- News and finance are never tier 0.
- Fills (§P.4a) are ranked on the same ladder after the pool: a fill never pushes a pool
  item off its page, because `topUp` only adds the empty columns.
- The ladder **orders only**. It decides what is on page 1, never how often a page shows:
  there are no sticky pages (SCROLLR-297 removed them; §P.6).

### P.6 The visit rule

Widgets are visited in ticker order (`activeTabs`), the Also page last, then round again.
**Each lap, every widget shows its next page** (`nextTurn`; SCROLLR-297): exactly one page
a visit, continuing from that widget's cursor and wrapping, then the bar moves to the next
widget. A widget's pages run 1, 2, 3 ... N, then 1 again; a one-page widget shows its page
every lap. 30 NPR headlines at 1920 are 8 pages: page 1, then 2 ... 8, then 1, so every
headline is seen within 8 laps.

**Consequence, chosen knowingly: a live game is no longer on every lap.** The ladder (§P.5)
puts live games and your team on page 1, so they come round first after a wrap, but on a
widget with N pages that is once every N laps (the busiest fixture's lap is about 50 s).
There is no sticky page and no exception for live or yours. Brandon, 1 Oct 2026, on
SCROLLR-294's "sticky pages plus one": "why does it cycle one page at a time for NPR and
Stocks, but cycles through all the NFL pages? I think they should all cycle one page at a
time." Live NFL took two or three pages a lap while news and stocks took one.

History: SCROLLR-293 showed three pages a visit (NPR held the bar up to 36 s a lap);
SCROLLR-294 showed the sticky pages (live and yours) every visit plus one of the rest;
SCROLLR-297 is one page, full stop. The cost is "all shown": a widget's whole pool takes
as many laps as it has pages. Measured in §P.15.

**The cursor.** Where the next visit continues, per widget, found by name (`Nav.cursors` in
the leader's page clock, `newNav`). A cursor starts at 0 and is a page index, wrapped
on every use, so it survives everything that is not a new visit: a refetch, a CDC update, a
re-plan, a page count that changes (a new headline on top shifts the items, never sends the
widget back to page 1). It is **leader-owned** (§P.14): only the primary window advances
it, and followers show the leader's page, so every monitor agrees. It lives as long as the
leader's bar (a restart starts each widget at its first page again). A widget appearing or
leaving never skips another; a widget that left starts the next visit from the first
widget. Every page swipes the label too when the widget changed. Each turn's `seq` is
published as `data-visit` on the page for the browser checks (a visit is one page).

### P.7 Timing and motion

| What | Value |
|---|---|
| Dwell | `dwellFor(items on page) = clamp(3 + 0.75 x items, 6, 12)` seconds: 6 s for a page of four or fewer, 12 s from twelve |
| Swipe | 0.6 s (`SWIPE_S`), ease `(0.32, 0.72, 0, 1)`; the new page enters from `x: 100%`, the old leaves to `x: -100%` |
| Label wipe | 0.45 s, same ease, upward, only when the widget changes |
| Edge slot roll | 0.45 s, same ease, upward |
| Reduced motion | The **OS** setting, read directly (`prefers-reduced-motion`); every swipe, wipe and roll becomes a 0.4 s linear crossfade, and `data-motion-style="fade"` |
| Hover | A page held by an **active** pointer holds, and so does the dwell line; the clock stands still and resumes when the hold ends. Active = over the bar and entering or moving within the last **5 s** (`HOVER_IDLE_MS`, `activeHover.ts`). A pointer that rests 5 s releases the hold and the bar turns again (worst case a further dwell of up to 12 s); moving it grabs the page back; leaving the bar releases at once. Under Pages there is **no hover setting**, whatever `onHover` was left at by Continuous |

The page clock restarts only on a new turn, never on a data update. Dwell is a floor of 6 s
by design: nothing on the bar turns faster on its own (a manual step, §P.7a, is the reader's
choice).

### P.7a Manual paging and the pager

SCROLLR-298 (Brandon, 1 Oct 2026: "little buttons or something somewhere that make it easy
to cycle through them"; then, "arrow keys on the far left and far right might be annoying; I
have an ultrawide"). No setting.

- **The pager** sits right after the label, `PAGER_W` = 88px, `shrink-0`, `data-pager`:
  `‹ 7/23 ›`. The middle is always shown: this page's place in the lap and the lap's total,
  `font-mono text-[12px] font-semibold tabular-nums text-fg-3`, centred in a 44px box
  reserved for `99/99` (`data-lap-pos`). The lap is every page of every widget in ticker
  order, the Also page last: `at` = the pages of the widgets before this one + this page's
  index + 1, `of` = the sum of every widget's page count, each from **this window's** plans.
  Both are frozen with the page (§P.8): a re-plan reaches the count on the next page.
  `contentWidth` takes `PAGER_W` off, so columns stay exact (§P.4 for the cost).
- **The arrows** either side of the count are `<button>`s (`data-step="prev"|"next"`,
  `aria-label` "Previous page" / "Next page"), a lucide chevron drawn 18px in a 22px box, in
  the label's ink (`--accent-ink`), hit area 44px wide by the bar's 64px (an `after:` box
  11px either side). `opacity-0`, shown while the pointer is over the bar
  (`group-hover/bar`) or when one has keyboard focus. Together beside the label so neither
  the eye nor the mouse crosses an ultrawide bar; nothing at the far ends.
- **The wheel** over the bar is the primary control (the bar lives at a screen edge where
  the wheel is the natural gesture): down or a sideways swipe left (`deltaY` or `deltaX` >
  0, whichever is larger) is the next page, up or right is the previous. One step per
  gesture: a wheel event steps only after `WHEEL_QUIET_MS` = 200 ms without one, so a flick
  or a trackpad's glide is one page and notches turned one at a time are a page each. The
  listener is native and not passive, and calls `preventDefault`, so a sideways swipe never
  becomes the webview's back gesture; nothing in the ticker scrolls anyway (`overflow:
  hidden` throughout). WebView2 delivers the wheel to the window under the pointer without
  focus; the Rust side does nothing with it. A wheel event counts as pointer activity, so
  the hold (§P.7, Hover) stays while you page.
- **Keys:** `←` and `→` (no modifier) step when the ticker window has focus (it does after
  a click on it; it normally has none, being always on top at a screen edge).
- **A step** is `stepTurn` (`widgetPages.ts`) on the leader's page clock: the next or
  previous page in the same reading order the pager counts; past a widget's last page is
  the next widget's first, before its first page is the previous widget's last, and the lap
  wraps both ways. It is a turn like any other: a new `seq`, the same swipe (always right to
  left, back included) or crossfade, frozen at swipe-in, the edge slots step, and **the
  page's dwell starts again**. A held page stays held. The step is an immediate turn plus
  a move of that widget's cursor (§P.6) to the page after the one stepped to, so the
  clock's next turn moves on to the next widget as after any turn, and the widget's next
  turn does not show that page again.
- **Monitors:** a follower's step is sent to the leader as `pages:step` (`{dir}`); the
  leader applies it and broadcasts the turn, so every window turns together (§P.14).

### P.8 The freeze

A page on screen is a `FrozenPage` (`freezePage`): its `keys` (which items, in what order)
and its column width (the bar width and edge width the page was planned with) are fixed at
swipe-in. Later data goes through `refreshPage` and changes **values only**:

- an item that drops out of the pool keeps its last value until the page leaves;
- a new item, a re-rank, a game turning close or live, a resize, an edge growing: none of
  them reaches the page up; all reach the next one (a resize measured: the current page kept
  7 columns, the next had 4);
- the label's fact line is not a layout and does update live.

Call `freezePage` after `planWidget` has ranked and split. Never read the live pool to place
a cell. `refreshPage` is fed the pool **and** the fill, so a fill cell's price still moves
in place.

### P.9 The cells

All cells sit straight on the bar: no shell, `h-full w-full min-w-0`, `<button type="button"
data-chip data-item>`, `text-left`. The widget's colour reaches a cell only through
`--accent` (`accentStyle(accentFor(mode, hex, dark))`), read through `mix(pct)` (§P.13).
`data-pin-subject` sits on the column wrapper (`PagedBar`), not on the cell.

| Cell | Grammar | Layout choice |
|---|---|---|
| **GameCell** | Stacked: away over home, each row crest, name (14.5px) and score (18px); the home row carries an `@`, hung in the gutter before its crest (away at home). No stadium and no third line (SCROLLR-296: "it adds nothing"; the type is bigger instead). The clock box sits **left-aligned right after the scores, with no rule**, and its 16px gutters (the left one holding the `@`) put the page's column rule between one game and the next, so a clock is never read as the next game's. Wide: one scoreboard line centred on its content, names (15px) and records either side, the scores (22px) with the clock box **between them** (centred), the `@` before the home crest. The clock: live `Q4` over `2:14` (baseball `7th` over `INN`), `FINAL`, `PPD`, today's kick-off over `in 3h05` (ten hours or more out: `TODAY`), a later day's weekday over its time | Wide from a column of 430px (`WIDE_GAME_PX`). A name is the full short name when it sets whole in the room the layout leaves it (`nameRoom`, `nameFits`: measured off-screen on a canvas at the bold weight before paint, never after), else the nickname in US pro leagues (`cellName`) |
| **NewsCell** | A fixed grid, top-anchored: the headline (15px at every width, up to 2 lines, `font-sans font-semibold`) always starts on the first line, and the meta line (12px) sits at the same y under a one-line and a two-line headline: the age (`9m`, `4h`, `3d`, mono in a 3ch box, `AGE_CH`) then the summary, or the feed's name when there is none. The headline has the column's whole width (the old 26px age column and its gap cost 36px). Real news columns are 426 to 584px, so the old 560px switch to 15px almost never fired | One layout |
| **QuoteCell** | Price first (SCROLLR-296, three rounds; Brandon: "name top left, value under in large letters, with sparkline and day range on the right"). Two zones read as one cell: the price zone is as wide as the price's reservation (its length plus one), and the day zone takes the rest after a 12px gap (round 4, Brandon: "too much padding between the number and the line"; half and half left 54-63px). Left: the symbol (14px, `fg-2`; a popular fill prefixes it with a `fg-3` `+`, as the label says `+4 POPULAR`), **the price under it, the largest thing in the cell** (20px bold), the change under that (12px), all three on one left edge (round 5: "align left"; a fill's `+` hangs in the gutter): `up`/`down` with its arrow, flat `0.00%` in `fg-3` with none. Right: the day's line across the zone (70%), a 3px track under it filled up to the price in the direction's colour with a 2px marker, and the day's low and high (12px, `fg-3`, whole units from 1,000 so each is at most seven characters, `rangeText`) right under it at the zone's two edges, on the change's baseline | One layout |
| **AlsoCell** | A code tag (12px) in the widget's colour, then the status text (13px) on one truncating line | One layout (§P.12) |

**Type on a cell** (SCROLLR-296): nothing under 12px, and at most three sizes per cell
(game: names, scores, everything else at 12px; news: headline 15, meta 12; quote: price 20,
symbol 14, change and range 12).

**Times and dates** are the bar's one format family (`barTime`, `statusDate` in
`datawidgets/ticker.ts`): a time is `6:30P` (a 24-hour locale keeps `18:30`); a day is the
weekday in capitals (`FRI`), a date adds the month and day (`SAT OCT 17`). Game cells, the
Also page and the Continuous status chip all print through them.

Reservations (the Pages form of §4, enforced by `cells.spec.ts`):

- Game scores hold `max(2, reservationFor(league).score)` `ch`, even before kick-off, in `font-mono tabular-nums`. The clock box is a **fixed** `STATUS_WIDTH = calc(7ch + 22px)` at 12px (the 22px of air in front holds the live dot and, with the 6px gap, puts the clock 28px from the scores: round 3, 14px read as touching; `STATUS_WIDE = calc(7ch + 44px)` between the scores of a wide cell): a `min-width` that included its padding grew for "12:00P" and moved every name left of it. The live dot and both marks (`mine`, `close`) are always mounted and invisible or transparent when off. Names sit in `minmax(0,1fr)` (stacked) or `minmax(0,max-content)` (wide) tracks and truncate rather than push.
- Quotes: the price holds `priceReserve(price)` characters, taken once when the cell mounts (a page mounts its cells at swipe-in, so this is the freeze; an edge pin re-takes it at each swipe): its own length plus one, and two where the format itself jumps near the price (999.99 to 1,000.00 adds a comma, 1.00 to 0.9900 two decimals). So a digit-boundary crossing either way while the page is up moves nothing (`cells.spec.ts`, `quote-cross`), and the line sits one character further from the price than the price alone, about 24px. The change holds `CHANGE_CH = 8`. The range ends need no reservation because each sits alone at an edge of its row (a new low or high grows inward and moves nothing else); the sparkline is the chips' own `pushPrice` history, which needs two points and draws nothing below that. A missing range or change renders empty, never a dash (invariant 7).
- News: the age is a fixed `AGE_CH = 3` box at the head of the meta line, so `9m` turning `1h` never moves the summary; the rows are fixed (`38px` for the headline, `15px` for the meta), so a one-line headline never drops lower.
- A `Crest` always holds its box (16px, 22px at `lg`), so a missing logo does not pull the name sideways.

Marks: your team's game carries a solid 2px accent line at the top (`data-part="mine"`); a
close live game is marked **on itself** by a 2px accent line along its foot
(`data-part="close"`, `data-close` on the cell), never by tinting the cell (SCROLLR-296: with
four of five games close, a 10% tint made the fifth look highlighted on light themes and
striped the bar on dark); a pin on the edge carries a **dashed** top line, so it is not read
as your team. A result reads as clearly as a fixture: the winner in `text-fg` bold, only the
loser steps down to `text-fg-3` (never an opacity: it cost every text contrast,
SCROLLR-287). A score change flashes `--color-live` at 18%, keyed on the game id
(`useScoreFlash`). Red is the live dot and the live clock only (invariant 6).

Greys on a cell: `fg` for what leads, `fg-2` for a quieter lead (a symbol, a pre-game
clock), `fg-3` for everything secondary (the trailing team, records, the `@`, `FINAL`, range
ends, ages, summaries, a flat change). **`fg-4` never carries text on the bar**: it is under
4.5:1 in every palette (§P.13).

Reused helpers, unchanged from the chips: `teamShortName` (§5.4), `plainText` and
`sourceTab` (§5.5), `reservationFor` (§4.3), `liftForTint` (§7.2), `recordText`, `ordinal`,
`pushPrice`, `Sparkline`, `rangePosition`.

### P.10 The edge zone: utilities

`EdgeZone.tsx`. A fixed block at the **right** of the bar, `border-l border-edge`, holding in
this order: one **slot** per utility on the ticker (clock, timer, weather, sysmon, uptime,
GitHub), then one cell per pin. With no utility and no pin it renders nothing and takes no
width.

**Cycle** (canvas "8c · Edge with several clocks", option A, picked by Brandon 1 Oct 2026):
a utility is **one slot** showing **one zone, city or metric at a time**, and it steps to
the next on **each page swipe**. Three clocks and a weather widget with two cities are two
slots, not five.

- The step is `item = items[turn.seq mod items.length]`. `seq` is the page clock's turn
  counter, which every ticker window shares, so all monitors step together. The slot rolls
  (0.45 s, §P.7) only as the page swipes; it never changes between swipes.
- **Widest-first reservation.** A slot renders an invisible **sizer for every item it can
  show** (label, plus the value at its widest) stacked in one grid cell, so it is as wide as
  its widest item from the first frame, whichever item is up and whatever the clock reads.
  `reserveOf(value, digits)` turns every digit into `0` and pads the first digit run to
  `digits` (clock 2, timer 3, weather 3, sysmon 3, GitHub 2; uptime `000.00%`). The edge's
  width is therefore constant for as long as the set of zones and cities is unchanged
  (measured: 101.8px with 1, 4 or 6 clocks, 406.3px with three zones, weather and a pin,
  0 empty; zero slot changes outside a swipe in 15 to 19 per 60 s run).
- A slot is at most `max-w-[180px]`; the label is 9.5px caps, the value 16px bold
  `tabular-nums`, the detail 9.5px; tones: timer urgent `text-live`, weather alert
  `text-warning` bold caps, sysmon hot `text-error`, uptime or GitHub down `text-down`; a
  night zone or paused timer draws its value in `text-fg-2` (no opacity, SCROLLR-287), a
  night clock carries `☾`. Label and detail are `text-fg-3`.
- Clicking a slot opens that widget (`onChipClick(tab, id)`).

Clock and Weather are free of widget slots, so they cost the user none of their plan's
widget count.

### P.11 The edge zone: pins

A pin is a **subject** (§8.5), not a widget. Under Pages it lives on the edge, after the
utilities, as one **cell at its family's minimum column** (`gameMinCol`, `QUOTE_MIN_COL`,
`NEWS_MIN_COL`), marked by a dashed 2px accent line on top (dashed so it is not your team's
solid line, SCROLLR-296).

1. **Resolved with no horizon.** The pin is the selection (§8.5 rule 2): a team shows its
   live game, else its next fixture, else its last result (`gamesForTeam`); a symbol its
   latest quote; a feed its newest item. Nothing to show renders nothing (§8.5 rule 3).
2. **Once on the bar.** A pinned subject leaves its widget's pages (`dropPinned` in
   `buildPageWidgets`) so it is never in two places. A widget whose every item is pinned
   says nothing: it has no page and no Also entry.
3. **A pinned utility is already on the edge**; a pin on a widget that is off the ticker
   does not show.
4. **Right-click** works on the edge cell and on every page column through
   `data-pin-subject`, as on chips.
5. **The limit is width, not a count** (`components/pages/edgeRule.ts`): **the edge never
   takes more than 40% of the bar width** (utilities + pins + its 1px border), measured on
   the narrowest ticker window. Every pages bar publishes `{bar, util}` (`lib/edgeMeasure.ts`)
   so the main window and every ticker agree. A pin's width is its family's edge column
   (`pinWidth`): a game `gameMinCol`, a quote `QUOTE_MIN_COL` (260), a headline 260. A pin that would pass 40%
   is refused with a one-line message naming what fills the edge ("No room on the edge at
   this screen size — unpin Chicago Bears first"), from every entry point: the ticker's
   right-click item, a widget page's pin button, the sidebar row. When a screen shrinks and
   the pins pass 40%, the newest pins **step back onto their normal pages** (`stepBack`)
   until there is room; they stay in prefs and return when there is room again. **A pinned
   headline is a narrow cell** (`NEWS_PIN_W = 260`, `NewsCell line`): one line, ellipsis,
   the feed's name beneath, not a 400px news column; clicking it opens the article. With no
   pages bar reporting a width (the Continuous ticker, none running) the old count,
   `MAX_PINS = 2`, stands.
6. Why: at 1280 with local time, 3 zones and weather on the edge, two college-game pins left
   486px (one column) and two headline pins left 174px (unreadable). At 1920 every case keeps
   three or more columns.
7. `pins` still store `side`; Pages ignore it (the edge is on the right).

### P.12 The Also page

Widgets that are on the ticker and have nothing to show do **not** each spend a page saying
so. They share **one page, last in the lap**, titled `ALSO` / `NOTHING ON`. It replaces the
status chip (§8.7); each cell says what the status chip would, in the same words.

- A widget is listed only once the dashboard has loaded and its source answered with an array
  (so "loading" is never mistaken for "empty"), and only if its items were not all pinned.
- Text comes from `TickerSource.status(raw, ctx)` (§8.7 table), else `nothing to show right
  now`. Never a made-up date (invariant 7).
- Tier 4, minimum column 300px, one cell per widget: code tag (the widget's own tab text, in
  its ink on the label's tint, 16/12), then the text on a truncating line. The tag is fixed for the widget's life.
- The Also page is not counted as "data shown" for the presence check-in
  (`onDisplayedWidgetsChange` excludes it; the edge's tabs are included).
- This is the Pages half of "no silent empty widgets": a widget you added never just goes
  missing.

### P.13 Colour and the settings that touch the bar

- A page is painted in **one accent**: `accentFor(hex, dark)`, the catalog colour
  (`catalogItemById(tab).hex`), lifted for the dark bar by `liftForTint` (§7.2), raw on
  light; `--color-fg-3` when there is none. Green, red and amber stay semantic and are never
  the accent.
- Every tint is `mix(pct)` = `color-mix(in srgb, var(--accent) pct%, transparent)`: label
  16/12, label border 40, Also code tag 16/12, `mine` and `close` lines 100 (the close-game tint is gone, SCROLLR-296).
- **Anything that must be read in the widget's colour uses the ink**, `--accent-ink` =
  `inkFor(hex, dark)` (`readableInk` in `utils/chipAccent.ts`), set beside `--accent` by
  `accentStyle(accent, ink)`: the same hue and saturation, HSL lightness moved only until
  relative luminance is at most 0.07 (light) or at least 0.45 (dark), which reads at 4.5:1
  on every palette's bar, bare and under the label's tint (`chipAccent.ink.test.ts` checks
  every catalog colour against every palette). The label's name, `n/m`, the Also code and
  the hairline (ink at 40%, 1.5:1) use it; tints never do. No colour: the ink is `fg`.
- **Contrast floors, every palette** (SCROLLR-287; `pages-themes.spec.ts` asserts every
  reading): text 4.5:1 against what is really behind it (the bar, the label's tint, a close
  game's tint); large text (24px, or 18.66px bold) 3:1; hairlines 1.5:1. So: no opacity on
  text, `fg-4` never carries text, and the semantic `up`, `down`, `live` tokens are defined
  per palette to clear 4.5 on the bar. A palette change that drops a token under its floor
  fails that spec, naming the token and the text.
- **There are no chip colours.** Every widget uses its own colour (`accentFor(hex, dark)`);
  the `widget / theme / subtle` choice is gone (SCROLLR-281). **The theme palettes stay**: the
  10 theme families and light/dark.
- Settings that remain after SCROLLR-281 (Brandon, 1 Oct 2026: "the less settings the
  better"): item order, font weight and start-in-the-background are gone. Speed and On hover
  are shown only under Continuous.
- **Existing users switch to Pages once at the release**, with a one-time notice that
  Continuous is one click away *(lands with SCROLLR-277)*.
- **A new account's first bar** is NPR + Stocks (`finance_stocks`, default watchlist) on
  pages and the Clock on the edge. The server applies NPR + Stocks in one transaction
  (`POST /users/me/widgets/starter`, which also flips `default_widgets_applied`), so there is
  never a half set; the owner window then turns the Clock on, only after that call succeeded
  (`lib/firstRunDefaultWidget.ts`). Once per account: removing everything never brings it back.

### P.14 One clock, every monitor

`App.tsx` renders once per ticker window (AGENTS.md), so the page clock is process-wide
state and one window owns it.

- The **primary** ticker (`isPrimaryTicker`, label `ticker`) runs the page clock and
  broadcasts each turn as the Tauri event `pages:turn` (`{seq, visit, tab, page, pages,
  dwell, held}`). The visit cursors (§P.6) live here too, so every monitor continues from
  the same place. Followers show it. Each window times its own pointer (§P.7) and reports only the
  transitions, as `pages:hover` (`{label, on}`); the leader holds while any window's pointer is
  active, so a hold ends when the last active window's pointer has rested 5 s or left. A starting follower asks `pages:hello` and the leader
  rebroadcasts. A follower's manual step (§P.7a) goes to the leader as `pages:step`
  (`{dir}`) and comes back as the leader's turn.
- Each window plans at **its own** width and edge. A window whose width gives the widget a
  different page count maps the leader's page onto its own: same index when the counts
  agree, else the same share of the way through (`followPage`). Every monitor shows the same
  widget and swipes on the same beat; measured at most 3 ms apart.
- Edge slots step on `turn.seq`, so every window steps together.

### P.15 Verifying Pages

- **Shim:** `desktop/ticker-shim.html`, `?pages=1` (Pages; the shim defaults to Continuous),
  `?live=1` (a live score and price update every 4 s), `?label=ticker-2` (a follower
  window), `?cells=1` (the cell gallery), `?fixture=`, `?colors=`, `?utils=`, `?zones=`.
  `?comfort=1` is a no-op. Measure motion with headless Edge, not the hidden browser pane.
- `e2e/ticker/cells.spec.ts`: every part of every cell across pre, live one digit, live two
  digits and final: nothing moves.
- `e2e/ticker/pages.spec.ts`: per fixture and width under a fake
  clock: no cell moves while its page is up (0.5 px), no cell is cut off, every dwell is 5.98
  to 12.1 s, **one page per widget per lap** with each widget's pages running 1, 2 ... N, 1
(`pageOrder`), **live and yours lead their widget** (`topFirst`: page 1; every live game and
your team from the fixture is drawn and marked), a lap of at most 60 s (never raise it),
  **all shown** (`allShown`: every page of every widget up and dwelt, from the first lap's
  start) within 300 s, two windows in step, the label counts the page
  (`n/m`) and no label fact is cut beside it, and **every page is full** (`unfilled`: one
  page shows `min(columns, available)`; several pages show full pages unless the pool is
  not a multiple of the columns, then the even split). Laps are cut at visit starts
  (`data-visit`), since a visit no longer always opens on page 1. Fixtures: `nflthursday`
  (TNF + Sunday + MNF, your Bears on page 1), `googl` (one symbol + popular), `sparsenews`
  (nine headlines over three days, all shown), `onegame` (truly short: one column,
  left-aligned, measured), `npr` (SCROLLR-293: 30 headlines over six days). `pages+npr30` (SCROLLR-294: the
  `pages` set with NPR's 3 headlines swapped for `npr`'s 30, the worst case for all shown).
  The `npr` checks: visits run 1, 2, 3 ... 8, 1 at 1920 through the live sim's 4 s
  refreshes and an injected refresh with a new headline during visit 4
  (`window.__shimDashboard`, dev and `?live=1` only); every headline is seen within 8 laps; at 1280 the counter reads `10/15`
  and NCAAF on the busy Saturday `10/14` with nothing in the label cut. The shim serves
  `/finance/public` from `market.json`. The scorecard gets a `pages` mode: lap, widget
  share, Also share, cells moved or cut, dwell, dropped swipe frames.

  Measured (SCROLLR-297, fake clock, seconds; sticky + 1 → one page a visit). Before is
  main at SCROLLR-296 (CI, `browser (rest)` on #473); after is this rule. A
  single-widget fixture's lap is one page. Every fixture now shows everything within 300 s;
  **mixed**, **busy** and **pages+npr30** keep their `over5` marks in `RUNS` (measured and
  must finish, not held to 300 s) as decided on SCROLLR-294. Raising a bound is never the fix.

  | Fixture @ width | Lap before | Lap after | All shown before | All shown after |
  |---|---|---|---|---|
  | pages @1920 | 51.8 | 38.2 | 85.0 | 82.6 |
  | pages+npr30 @1920 | 51.8 | 38.2 | 404.2 | 295.4 |
  | mixed @1920 | 42.6 | 27.6 | 314.3 | 248.9 |
  | busy @1280 | 18.6 | 6.6 | 306.6 | 114.6 |
  | longnames @1280 | 36.6 | 36.6 | 66.6 | 66.6 |
  | quiet @1920 | 19.4 | 18.6 | 25.4 | 24.6 |
  | default @1920 | 32.1 | 26.1 | 32.1 | 32.1 |
  | nflthursday @1920 | 14.9 | 8.1 | 29.2 | 21.7 |
  | nflthursday @1280 | 12.6 | 6.6 | 36.6 | 24.6 |
  | googl @1920 | 8.1 | 8.1 | 8.1 | 8.1 |
  | sparsenews @1280 | 6.6 | 6.6 | 30.6 | 30.6 |
  | npr @1920 | 6.6 | 6.6 | 48.6 | 48.6 |
  | npr @1280 | 6.6 | 6.6 | 90.6 | 90.6 |
  | onegame @1920 | 6.6 | 6.6 | 6.6 | 6.6 |

  Why all shown fell when visits got shorter: under sticky + 1 a widget with live pages
  spent most of each visit re-showing them, so its rest came round one page a lap behind
  a long lap. One page a visit makes the lap short, and a widget's N pages take N short laps.

- `e2e/ticker/pages-themes.spec.ts`: one static frame per theme family x light/dark
  (`?theme=<family>-<mode>`), text measured against what is behind it: every reading is
  asserted at its floor (§P.13): fg, fg-2, fg-3, finals, up/down, the live clock and small
  text in the widget's colour at 4.5:1, the label name at 3:1, every hairline at 1.5:1.
- `e2e/ticker/hover.spec.ts`: under the fake clock, a still pointer holds 5 s and then the bar turns, a moving pointer holds the page and the dwell line for 40 s, and moving again after a release grabs the page back.
- `e2e/ticker/paging.spec.ts` (SCROLLR-298), fake clock: the pager sits at x = 112 and
  `PAGER_W` wide and its count's box stays put from `1/n` to `10/n`; wheel down and up, a
  flick of eight events is one step, a sideways swipe counts the same, back from the
  first page wraps to the last, nothing scrolls; the arrows are hidden off the bar, shown on
  it, 44px targets, and step; `←`/`→` step; a step restarts the dwell and the clock then
  carries on past it; a follower's wheel and arrow turn the leader and both windows.
- vitest: `activeHover.test.ts`, `pagePlan.test.ts`, `widgetPages.test.ts`, `pageFill.test.ts` (the pool and the fill per family), `EdgeZone.test.tsx`, one test per cell. `widgetPages.test.ts` rebuilds the widgets from fresh data before every turn and asserts the cursor carries on.

---


## 2. Files and contracts

*Continuous chips, plus the helpers both presentations share (`liftForTint`,
`sportsChipLayout.ts`, `teamShortName.ts`, `rssText.ts`, `Sparkline.tsx`, `priceHistory.ts`,
`TeamLogo.tsx`, `useScoreFlash.ts`, and the selectors behind `datawidgets/ticker.ts`). Page
cells and the edge zone live in `desktop/src/components/pages/` (§P). The rotation helpers
(`rotateSlots`, `tickerRotation.ts`, `useLatchedCap.ts`, `useFitsOneLine.ts`) are Continuous
only.*

### 2.1 Shared modules

| File | Exports you use | Purpose |
|---|---|---|
| `desktop/src/components/chips/chipColors.ts` | `getChipColors(widget): ChipColors`, `STATUS_CHIP_COLORS`, `chipShellClasses(colors, extra?)`, `chipBaseClasses(...)`, `stableNum(chars)`, `NUM_WIDTH` | Palettes and the shell. |
| `desktop/src/components/chips/StatusChip.tsx` | `StatusChip({tab, text, reserve, onClick?})` | The one chip an empty widget shows (§8.7). |
| `desktop/src/components/chips/ChipCap.tsx` | `ChipCap`, `cappedChipClasses`, `CapTone` | Status cap for uptime/GitHub. |
| `desktop/src/components/chips/Sparkline.tsx` | `Sparkline({points, height?, className?})` | viewBox 100×30, `preserveAspectRatio="none"`, `flex-1`, `stroke="currentColor"`. Draws nothing below 2 points. |
| `desktop/src/components/chips/metricHistory.ts` | `recordMetric(id, value, now?)`, `__resetMetricHistory()` | Ring buffer for sysmon, 32 points, 500ms tick guard. |
| `desktop/src/components/chips/priceHistory.ts` | `pushPrice(symbol, price, seed?)` | Ring buffer for trades, seeded from server series, collapses repeats. |
| `desktop/src/components/TeamLogo.tsx` | `TeamLogo({src, alt, size})` | Sizes: `sm` 14px, `md` default, `lg` 20px. Chips use `lg`. |
| `desktop/src/hooks/useLatchedCap.ts` | `useLatchedCap(ref, cap): boolean` | True once measured ≥ cap; latches. |
| `desktop/src/hooks/useFitsOneLine.ts` | `useFitsOneLine(sizerRef, cellRef): boolean \| null` | `sizer.scrollWidth <= cell.clientWidth + 0.5`; re-measures after `document.fonts.ready`; latches. |
| `desktop/src/hooks/useScoreFlash.ts` | `useScoreFlash(away, home, resetKey?): boolean` | 800ms flash on change; `resetKey` change resets silently. |
| `desktop/src/utils/chipAccent.ts` | `liftForTint(hex): hex` | Luminance-gated tint lift (§7.2). |
| `desktop/src/utils/sportsChipLayout.ts` | `reservationFor(league)`, `ordinal`, `recordText`, `metricText`, `ChipReservation` | Per-league reservation table (§4.3). |
| `desktop/src/utils/teamShortName.ts` | `teamShortName(league, name)`, `SHORT_NAME_BUDGET = 20` | Deterministic short names (§5.4). |
| `desktop/src/utils/rssText.ts` | `plainText(s)`, `decodeEntities(s)`, `sourceTab(name)` | Feed text hygiene (§5.5). |
| `desktop/src/datawidgets/ticker.ts` | `TickerSource`, `TickerChip`, `TickerContext`, `scopedRows`, `rotateSlots`, `RotatingSlot` | The source contract and the rotation (§8). |
| `desktop/src/datawidgets/tickerRegistry.ts` | `TICKER_SOURCES` | Register a new source here, one line. |
| `desktop/src/components/tickerRotation.ts` | `visibleSlots(container)`, `advanceCycles(cycles, was, now)` | Off-screen detection (§8.5). |

### 2.2 The source contract

```ts
// desktop/src/datawidgets/ticker.ts
export interface TickerChip {
  key: string;            // stable; for a rotating slot this is the SLOT key
  node: ReactNode;
  rotateSlot?: string;    // set on rotating slots; equals key
}
export interface TickerContext {
  tab: string;            // widget id, e.g. "sports_mlb"
  source: string;         // "sports" | "finance" | "rss" | "predictions" | "fantasy"
  dashboard: DashboardResponse | null;
  widgetDisplay?: WidgetDisplayPrefs;   // DO NOT read for ticker selection (§1.5)
  predictionsWatchlist: ReadonlySet<string>;
  cycles?: Readonly<Record<string, number>>;   // per-slot lap counts
  onChipClick?: (widgetType: string, itemId: string | number, url?: string) => void;
}
export interface TickerSource {
  chips(raw: unknown, ctx: TickerContext): TickerChip[];
  pinnedChip?(raw: unknown, ctx: TickerContext): TickerChip | null;   // §8.5
  status?(raw: unknown, ctx: TickerContext): TickerStatus | null;     // §8.7
}
export function scopedRows<T>(raw: unknown, ctx: TickerContext): T[];   // widget-scoped rows
export function rotateSlots<T, R>(
  pool: T[], slots: number, cycles: Readonly<Record<string, number>>,
  keyPrefix: string, id: (item: T) => string | number, reserve: (cls: T[]) => R,
): RotatingSlot<T, R>[];
```

A source reads widget *config* (symbols, favouriteTeams, feeds) from
`ctx.dashboard.widgets.find(w => w.widget_type === ctx.tab).config`. It never reads
`ctx.widgetDisplay` to decide what is on the rail.

### 2.3 The palette

```ts
export interface ChipColors {
  bg: string;          // "bg-<token>/[0.06]"
  border: string;      // "border-<token>/25"
  hoverBorder: string; // "hover:border-<token>/40"
  text: string;        // "text-<token>"
  textDim: string;     // "text-<token>/70"
  textFaint: string;   // "text-<token>/55"
  divider: string;     // "border-<token>/45"   — inner rules, stronger than the outer border
  tabBg: string;       // "bg-<token>/[0.18]"   — the painted tab
}
getChipColors("clock")             // WIDGET_MAP[widget], PURPLE if unknown
STATUS_CHIP_COLORS                 // MUTED (grey: divider border-fg-3/35, tabBg bg-fg-3/[0.14]), the status chip only
```

Widget → token: `finance→primary #34d399`, `sports→secondary #ff4757` (only when no brand
accent), `rss→info #00d4ff`, `fantasy→accent-purple #a855f7`, `predictions→#1fc9a0`,
`clock→#6366f1`, `timer→#f59e0b`, `weather→#0ea5e9`, `sysmon→#06b6d4`,
`uptime→#10b981`, `github→#f97316`.

Theme tokens (dark, `desktop/src/style.css`): surface `#141420`, edge `#282838`, fg
`#e2e2ec`, fg-2 `#b7b7c6`, fg-3 `#9292a4`, fg-4 `#78788a`, up `#22c55e`, down
`#ef4444`, live `#ff4757`, warning (amber), error `#ef4444`, info `#00d4ff`.

---

## 3. Geometry (Continuous chips)

### 3.1 The shell

Content-sized chips (sports, news, utilities) use `chipShellClasses(colors, extra)`,
which yields `ticker-chip group rounded-sm border transition-colors cursor-pointer
relative overflow-hidden shrink-0 {bg} {border} {hoverBorder} {extra}`. On top of it the
chip adds:

```
grid max-w-[640px]
grid-cols-[<tab> <cells…> <end>]        // literal string, see §3.2
grid-rows-[30px_20px]
```

Fixed-width chips (finance, predictions, fantasy, uptime, GitHub) still use
`chipBaseClasses(colors, extra)` = the 264px flex box (`w-[264px]`, `h-[52px]`). They need no reservations and rotate without a reserve. Rebuilding them onto
the grid is the open work (REL-184); when doing so, follow this spec.

### 3.2 Column templates (literal)

| Chip | `grid-template-columns` |
|---|---|
| Sports | `grid-cols-[max-content_minmax(0,max-content)_minmax(0,max-content)_max-content]` |
| News | `grid-cols-[max-content_minmax(0,max-content)_46px]` |
| Utilities (clock/timer/weather/sysmon) | inline style `gridTemplateColumns: "max-content " + "max-content ".repeat(n)` (allowed: it is a `style`, not a class) |

Rules:
- Tab column: `max-content`.
- Content columns that hold text which must truncate: `minmax(0,max-content)`. **Never**
  plain `max-content` for a truncating column — the grid cannot shrink and the cap slices
  the last cell.
- Fixed right cell: `max-content` sized by its reserved contents, or a literal px
  (`46px` for the news age cell: "Sep 3" at 12px mono + padding).

### 3.3 Rows

- Always `grid-rows-[30px_20px]`.
- Tab and fixed right cell: `row-span-full`.
- Top-row cells: `row-start-1`. Detail-row cells: `row-start-2`.
- Exception: a chip whose detail is a single two-line block (news) uses one
  `row-span-full` cell containing the block, vertically centred (`items-center`).

### 3.4 Cell padding

- Team / item cells: `px-2.5` (10px). At the cap: `px-1.5` (6px), via the `capped` flag.
- Tab: `px-[9px]`. Fixed right cell: `px-[9px]` (sports), `justify-center` with a literal
  width (news), `px-2` (capped chips).
- Full-bleed detail graphics: `px-0`.

### 3.5 The tab

```
col-start-1 row-span-full flex items-center border-r px-[9px]
text-[10px] font-bold tracking-[0.08em]
{colors.divider}   // the border-r colour
{colors.tabBg}     // 18% fill
{colors.text}
```
For a brand-accented chip (sports/news in `widget` mode) the tab uses the CSS variable
instead of the palette:
```
bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]
text-[var(--accent)]
border colour: border-[color-mix(in_srgb,var(--accent)_22%,transparent)]  (close game: 40%)
```
with `style={{ "--accent": liftForTint(accent) }}` on the button.

Tab text: league code (`leagueCode(game.league)`), `sourceTab(feed name)` (§5.5), or
the widget name in caps (`CLOCK`, `TIMER`, `WEATHER`, `SYSMON`).

### 3.6 Dividers

Inner rules between cells: `border-l` + `colors.divider` (`border-<token>/45`), or for
brand-accented chips the `rule` string above. The outer border stays at 25%. Never use
`border-edge` or `border-edge/40` for an inner rule.

### 3.7 The fixed right cell

```
col-start-N row-span-full flex items-center justify-center border-l {rule} px-[9px]
```
Contents reserve width (§4). Text scales to its length (§5.2) but the reservation lives
on the **outer** span at the base size so scaling cannot move the chip.

---

## 4. Width stability (reservations)

*Continuous chips. Page cells keep the same discipline inside fixed columns (§P.9); the
league table in §4.3 is shared by both.*

### 4.1 Rules

1. Every value that can change while the chip is mounted reserves its widest plausible
   width from first render. That includes values that are currently empty.
2. Numbers in a mono face reserve in `ch` (`style={{ minWidth: \`${n}ch\` }}`, or
   `stableNum(n)` which also sets `display:inline-block; text-align:right`). One `ch` is
   exactly one digit under `font-mono tabular-nums`.
3. Proportional text (a name, a headline) reserves with a **hidden sizer**: an
   `aria-hidden` span containing the widest string, in the same grid cell / same column
   as the visible text, `invisible … h-0 overflow-hidden whitespace-nowrap`, same font
   classes as the visible text. Both visible and sizer are `min-w-0` so the cap can
   truncate them.
4. A slot that is sometimes empty still occupies its space: render the element always
   and toggle `invisible`, never conditionally mount it. (The live dot: `h-1.5 w-1.5
   rounded-full bg-live`, `invisible` when not live.)
5. Sizes come from real data, per league / per rotation class — never a theoretical
   maximum. Use the widest thing the source actually produces.
6. At the cap (`useLatchedCap(ref, 640)` returned true), **pin `width: 640px`** and only
   then release the reservations (`minWidth: undefined`), tighten `cellPad` to `px-1.5`
   and switch the content tracks to `minmax(0,1fr)` so they absorb the slack. Pinned, the
   chip cannot move, so the reservation only steals characters from the name. The pin is
   not optional: `max-w` alone stops binding the moment the release drops the content back
   under 640, which is every pairing reserving into (640, 640 + released] — SCROLLR-229.
7. Responsive text size (§5.2) must never change width: reserve on the wrapper.

### 4.2 Verification recipe

Render the same item in every state it can pass through, side by side, and compare
`getBoundingClientRect().width`. In jsdom you cannot measure; instead assert the
reservation props/classes exist (`minWidth` style, sizer text). For real measurement use
a harness (§10.3).

### 4.3 The sports reservation table (`sportsChipLayout.ts`)

```
DEFAULT: score 2ch, status 7ch ("Q4 2:14"), rank 4ch ("10th"), record 8ch, metric 4ch ("−201"), draws false, metricKind "diff", unit "PD"
SOCCER : score 2, status 7, rank 4, record 8, metric 3, draws true, metricKind "pts", unit "PTS"
MLB    : rank 3, record 7, unit "RD"      NFL: rank 3, record 6
NBA    : score 3, record 5                NHL: rank 3, record 7, metric 3, "pts", "PTS"
NCAA Football: record 4                   NCAA Basketball: score 3, record 5
AFL    : score 3, record 6
La Liga / Premier League / Champions League / FIFA World Cup / MLS / Bundesliga / Serie A / Ligue 1: SOCCER
EuroLeague: as NBA            KHL: as NHL            NPB: as MLB
Six Nations / Super Rugby / Premiership Rugby / handball / volleyball: DEFAULT (scores < 100, W-L records)
Formula 1: score 0, single: true   (one cell: grand prix over circuit, no score slot)
```
A new league gets a row here, measured from what it actually produces.

### 4.4 Rotating-slot reservation

`rotateSlots(..., reserve: (cls) => R)` computes `R` over the slot's residue class only.
Sports: `{away: widest teamShortName, home: widest teamShortName}` → `GameChip
reserveNames`. News: longest `plainText(title)` → `RssChip reserveTitle`. Fixed-width
chips: `() => undefined`. The reserve must be **what the chip renders** (post-shortening,
post-decoding), not the raw field.

---

## 5. Text

*Continuous chips. §5.4 (short names) and §5.5 (feed text) are shared with page cells.*

### 5.1 Faces and sizes

| Element | Classes |
|---|---|
| Chip default | `font-mono whitespace-nowrap` on the button |
| Tab text | `text-[10px] font-bold tracking-[0.08em]` |
| Team name | `font-sans`? **No** — sports names are mono: `text-[14px] leading-none`, `font-semibold text-fg` when leading, `font-medium text-fg-2` when behind, `font-medium text-fg` pre-game |
| Score | `text-[15px] leading-none tabular-nums`, `font-bold text-fg` leading / `font-medium text-fg-2` |
| Headline (news) | `font-sans text-[13px] font-semibold text-fg` (`text-fg/55` when stale >2h) |
| Headline summary | `text-[11px] font-medium text-fg-3` |
| Detail row text | `text-[10px] leading-none text-fg-3` / `text-fg-4` |
| Utility label | `text-[10px] uppercase tracking-[0.06em] opacity-80` + `colors.textDim` |
| Utility value | `font-semibold tabular-nums text-[14px] leading-none` + `colors.text` |
| Age / clock cell | `font-mono font-semibold leading-none tracking-[0.04em] text-fg-2` + responsive size |

Mono for every data chip. Sans (`font-sans`) only for the headline chip's prose.

### 5.2 Responsive size for the fixed right cell

Sports status: `len<=2 → text-[16px]`, `<=3 → 15px`, `<=4 → 13px`, `<=6 → 12px`, else
`11px`. News age: `len<=3 → 15px`, `<=4 → 13px`, else `12px`. Reservation on the outer
span at the base size (7ch sports; 46px news column).

### 5.3 Alignment

Every text cell inside a `<button>` that can wrap or truncate carries `text-left`. A
button's UA default is `text-align: center`; a wrapped block centres its shorter line.

### 5.4 Short names (`teamShortName(league, name)`)

- Returns `name` unchanged when `name.length <= 20` (`SHORT_NAME_BUDGET`).
- `KNOWN` map first (two-word nicknames, special cases).
- `UFC`: drop leading given names → surname.
- `Formula 1`: "Grand Prix"→"GP"; strip Autódromo/Circuit/International/Street; then drop
  trailing words.
- "City Nickname" leagues (`MLB NBA NHL NFL MLS AFL NPB`): strip club suffix; if still long,
  the **last word** (the nickname).
- Everything else (NCAA…): strip institutional words (`STRIP`), AP-style abbreviations
  (`ABBREV`), keep a trailing "(KY)" qualifier, then drop trailing words.
- Tested over `utils/__fixtures__/team-names.json` (2,022 names) with
  `institutionKey` duplicate tolerance. Never hand-edit a name; add a rule or a `KNOWN`.

### 5.5 Feed text (`rssText.ts`)

- `plainText(s)`: strip tags, decode entities (`&#39;`, `&#x27;`, named map incl.
  `rsquo`, `mdash`, `hellip`), collapse whitespace, trim. Apply before measuring and
  before rendering.
- `sourceTab(name)`: uppercase, drop leading "The"; if `> 12` chars, first word.
  ("The Hollywood Reporter" → "HOLLYWOOD"; "PBS NewsHour" (12) unchanged.)

### 5.6 Crests

`<TeamLogo size="lg">` = 20px. Never smaller on a 30px row.

---

## 6. The detailed row (Continuous chips)

*Page cells carry the same idea in their own layout (§P.9): the second line is what you
would otherwise open the app to find.*

The detail row content per chip (§6.1) is fixed by design. When adding a chip, the
detailed row must be the single most useful thing the user would otherwise open the app
to find, and must not restate the top row.

### 6.1 Table

| Chip | Detail row cells |
|---|---|
| Sports | per side: `ordinal(rank)` (`font-bold text-fg-2`, `minWidth rank ch`), `recordText` (`text-fg-3 tabular-nums`, `minWidth record ch`), `metricText` (+/− tone, `minWidth metric ch`) with unit |
| Finance | `Sparkline` (intraday, seeded) + `DayRangeRail` |
| News | one two-line block: title, then `<br>` + summary if title fit, else summary inline; `[display:-webkit-box] [-webkit-line-clamp:2] leading-[17px]`; block is `w-0 min-w-full` so it never widens the chip |
| Clock | `[detail, offset].filter(Boolean).join(" · ")` → "Fri, Sep 4 · GMT-5" |
| Timer | full-bleed bar: `h-[3px] w-full bg-fg-3/15` with inner `bg-widget-timer` (`bg-live` if urgent) at `remaining/total`; stopwatch (no total) shows `detail` text instead |
| Weather | `RangeBar` (low · gradient bar with dot at `(t-low)/(high-low)` · high) or, if `alert`, the alert text `font-bold uppercase tracking-wider text-warning` **in that city's cell** |
| Sysmon | `Sparkline` of `recordMetric(id, percent)` full-bleed, `text-widget-sysmon` / `text-error` when hot; below 2 points shows `detail` text |
| Uptime | `HeartbeatBar bleed` (each bar `h-full flex-1`, tones by status code 1/0/2/3) |

### 6.2 Rules

- Detail graphics are full-bleed (`px-0`); text detail keeps `px-2.5`.
- The news fit decision is **measured** (`useFitsOneLine`) never counted.
- When there is no summary and the title fit, show `${source_name} · ${feedCountToday}
  today` (feed volume over the last 24h from all rows the widget holds).
- Sysmon must call `recordMetric` on every render, so the buffer is always filling.

---

## 7. Colour

*The classes here are Continuous chips. Page cells take one `--accent` (§P.13);
§7.2's `liftForTint` is shared.*

### 7.1 One colour per widget

There are no colour modes (SCROLLR-281 removed the Widget / Theme / Subtle setting): every
widget wears its own colour. Brand accents (`accent` prop, a `#rrggbb` from
`catalogItemById(ctx.tab)?.hex`) apply whenever there is one: `branded = !!accent`.

### 7.2 Brand tint

`liftForTint(hex)`: if perceived luminance `0.299R+0.587G+0.114B >= 60` return unchanged;
else HSL lightness `max(l, 0.6)`, saturation `max(s, 0.55)`. Applied once, as the
`--accent` CSS variable on the button. All brand classes use
`color-mix(in_srgb,var(--accent)_N%,transparent)` with N = 6 (bg), 25 (border), 40
(hover), 18 (tab), 22 (rule), 40 (rule when close), 70 (close border), 14 (close bg),
25 (close glow).

### 7.3 Semantic colour

| State | Classes |
|---|---|
| Live dot | `bg-live` |
| Close game, branded | `border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[0_0_14px_color-mix(in_srgb,var(--accent)_25%,transparent)]` |
| Close game, unbranded | `border-live/70 bg-live/[0.13] shadow-[0_0_14px_rgba(255,71,87,0.2)]` |
| Final | `opacity-[0.82]` |
| Score flash | `bg-live/20` |
| Timer urgent (≤60s, not paused) | value `text-live`, chip `border-live/40`, bar `bg-live` |
| Weather alert | chip `border-warning/45`, text `text-warning`; hot temp (≥35°C (95°F) or within 2° of high) `text-warning` |
| Sysmon hot | chip `border-error/30`, value `text-error`, gauge/line `bg-error`/`text-error` |
| Uptime down | chip `border-down/30`, value `text-down`, cap `down` pulses |
| Stale news (>2h) | `border-edge/55`, title `text-fg/55`, tab `opacity-55` |
| Night zone / paused timer | cell `opacity-55`, glyph `☾` / `‖` |

Caps (`ChipCap` tones): `up bg-up/[0.16] border-up/30 text-up`, `down`, `info`,
`warning`, `neutral bg-fg-3/[0.10] border-fg-3/30 text-fg-3`. Uptime: UP/DOWN/MNT/`···`.
GitHub: ✓/✗/●/○. Only `down` and `in_progress` pulse (`data-motion="cap-pulse"`).

---

## 8. What is on the bar

*Both presentations share §8.0, the sort order in §8.1, §8.5 rules 1 to 3 and 5 and the
status words in §8.7. They differ in the window: Continuous takes the horizons and floors of
§8.1; Pages take the widget page's whole pool (§P.4a, SCROLLR-293). And in how the pool
reaches the screen: Pages by columns and visits (§P.4 to §P.6), Continuous by slots and
rotation (§8.1 slots, §8.2 to §8.4). Sections marked Continuous-only below do not apply to
Pages.*

### 8.0 The feed page and the ticker are different products

They render the same `dashboard.data`, through different selectors, for different jobs.
"The ticker" here is either presentation.

| | Feed page (widget page) | Ticker (Pages or Continuous) |
|---|---|---|
| Job | Reading a list the user opened on purpose | Glancing at what is happening now, unattended, all day |
| Selector | `applyXPipeline` / `selectXForFeed` — takes prefs | `selectXForTicker` (Continuous), `selectXForPages` (Pages) — take **no** prefs |
| Amount shown | Whatever the user asks for (all, or "Show N") | Pages: as many as fit the bar, then the next page. Continuous: a fixed number of slots per source; the rest rotate |
| Order | The user's sort | One fixed rule per source |
| Time window | The user's window (`daysBack/daysAhead`, `maxArticleAgeDays`) | Continuous: the source's horizon constant. Pages: none; everything the widget holds at the app's default window (§P.4a) |
| Filters | Source / category / lens filters | None |
| User settings | All of the above are theirs | **None** for selection; presentation only (§8.0.1) |

The rule that follows from the table, stated so it can be enforced in review:

> **Anything about *reading* belongs to the feed page and must not reach the rail.
> Anything about *what is on the rail* is a constant, not a setting.**

Concretely, a ticker source or selector must not read `widgetDisplay.<source>.defaultSort`,
`articlesPerSource`, `maxArticles`, `maxArticleAgeDays`, `feedSort`, or any feed filter
state. It may read widget **config** (the user's inputs — see §8.0.1) and `ctx.cycles`.

The design that makes "no settings" workable answers both questions a setting would
otherwise have to — "how many?" and "which ones?" — with a rule, not a control.

- **Pages:** *how many* is the bar width divided by the family's minimum column (§P.4);
  *which ones* is all of them, through the tier ladder and the visit rule (§P.4a to §P.6):
  one page per widget per lap, live games and your team on page 1, each visit continuing where the
  last one stopped. The bar never grows or jumps because a page is frozen
  while it is up (§P.8).
- **Continuous:** **fixed slots per source** (§8.1) and **rotation inside the same chips**
  (§8.2). The rail's chip count and width stay constant, so the bar never grows, shrinks or
  jumps as a slate fills.

#### 8.0.1 The control inventory

**The user controls their inputs** (widget config; read by ticker sources as data):

| Widget | Inputs the user owns |
|---|---|
| All | Which widgets are on the ticker (`widgetsOnTicker`); which subjects are pinned (to the edge under Pages, §P.11; to the fixed zone under Continuous, §8.5) |
| Finance | `config.symbols` (the watchlist, in the user's order) |
| Sports | `config.favoriteTeams[league]` |
| News | `config.feeds` (custom RSS) |
| Clock | `localTime`, `showTimezones`, `excludedTimezones`, zones |
| Timer | `activeTimer`, pomodoro durations |
| Weather | saved cities, `excludedCities` |
| Sysmon | `cpu`, `memory`, `gpu`, `gpuPower` toggles |
| Uptime | `url`, `excludedMonitors` |
| GitHub | `repos`, `excludedRepos` |

**The user controls presentation** (`TickerPrefs`): `showTicker`, `scrollMode` (pages /
continuous, default pages), `tickerPosition`, `hideOnFullscreen`, and the Size scale.
Continuous adds `tickerSpeed` and `onHover` (keep / slow / pause). Under Pages, Speed and
the hover setting are hidden (SCROLLR-274, SCROLLR-281): a page under an active pointer holds (§P.7, SCROLLR-291).
There is no colour, item-order or font-weight setting and no start-in-the-background setting
(SCROLLR-281): every widget wears its own colour, the marquee weaves widgets together, and the
theme palettes (10 families, light/dark) stay. A login launch starts quietly (the autostart
entry carries `--autostart`); a launch the user makes shows the window.

Pinning is deliberately NOT in either list above: a pin names a subject, so it is an
input, but it also decides that the subject leaves the tape, so it touches selection.
It is the one control that does both, and §8.5 is where it is specified. It does not
open the door to any other selection setting.

**The user does not control selection.** Never add a setting for: how many chips a
widget contributes; which eligible items appear; their order; the horizon or floor;
rotation cadence, slot count or columns per page. The one such control ever added (sports
"N on the bar", 2026-09-04) was removed the same day.

### 8.1 Per-source constants (not settings)

The **Eligible** and **Floor** columns are **Continuous only** since SCROLLR-293: Pages take
the widget page's whole pool instead (`selectSportsForPages`, `selectRssForPages`,
`selectFinanceForTicker`; §P.4a), split it into pages (§P.4), re-rank it with the tier ladder
(§P.5), and the fill tops a short watchlist up. The **Pool order** column applies to both.
The **Slots** and **Reserve** columns are **Continuous only**: Pages have no per-widget slot
counts, and a page cell reserves inside its fixed column (§P.9).

| Source | Eligible (horizon) | Floor | Slots (Continuous only) | Pool order | Reserve (Continuous only) |
|---|---|---|---|---|---|
| Sports | live always; `pre` with `0 <= h <= 24`; `final` with `h >= -18` (from kickoff) | the next matchday: every `pre` on the LOCAL calendar day of the soonest `pre` within 7 days. Never a `final` or a live game. The 7-day cap picks the day, the day picks the fixtures — a late kick-off on that day is in even if it lands hours past the cap | `TICKER_SLOTS = 4` | `sortForDisplay`: live+close 100, live 80, pre 60 (soonest first), final 30 (newest first) | widest short names per class |

Every pool above is first stripped of the widget's pinned subjects (`dropPinned`, §8.5).
| News | items within `TICKER_RSS_HOURS = 6` | newest per feed if within `TICKER_RSS_FLOOR_HOURS = 48`; undated counts as current | `TICKER_RSS_SLOTS = 3` | newest first, **interleaved by feed** (round-robin, feeds ordered by their newest item) | longest `plainText(title)` per class |
| Finance | the widget's `symbols` | — | `TICKER_FINANCE_SLOTS = 4` | watchlist order; unlisted rows trail alphabetically | none |
| Uptime / GitHub | all items | — | `CAPPED_WIDGET_SLOTS = 4` (in `ScrollrTicker.tsx`) | item order | none |
| Clock / Timer / Weather / Sysmon | all items in one chip | — | n/a | config order | n/a |

Under Pages, Clock / Timer / Weather / Sysmon / Uptime / GitHub are not pages: each is one
Cycle slot on the edge zone (§P.10), stepping through its items one per page swipe.

Sports favourites (`config.favoriteTeams[league].teamName` matching either team name)
are **exempt from the slot count** (Continuous): every one is on the rail, keyed
`spo-<tab>-<gameId>`. Under Pages a favourite's game is tier 0: it sorts first and is on
page 1 of its widget, which comes round first after a wrap (§P.5, §P.6).

A favourite is not a pin, and the two do not merge (REL-239). A favourite — like a
finance watchlist entry or a starred market — means *always on the tape, exempt from
slots*. A pin means *out of the tape, parked in the fixed zone*. They compose: pinning a
favourite lifts that team's fixture into the zone, and the rest of the favourites stay
on the tape. Do not rename either one into the other.

### 8.2 `rotateSlots` semantics (Continuous only)

`rotateSlots` takes an optional 7th param, `memo: RotationMemo` (one `Map`, shared by the
whole rail, owned by `ScrollrTicker` as a `useRef` and passed down through
`ctx.rotationMemo`). Every real call site passes it; only unit tests exercising the
plain arithmetic omit it.

**Without `memo`** (pure, for tests):
- If `pool.length <= slots`: return every item keyed `${prefix}-${id(item)}`, no
  `rotateSlot`, no `reserve`.
- Else for `i in 0..k-1`: class `cls = pool.filter((_, idx) => idx % k === i)`; slot key
  `${prefix}-slot-${i}`; `turn = cycles[slotKey] ?? 0`; item `cls[turn % cls.length]`;
  `reserve = reserve(cls)`.

**With `memo`** (real rail traffic — REL-234): every slot, small pool or not, is keyed
`${prefix}-slot-${i}` and resolved the same way. For each `i in 0..k-1`: `slotKey =
${prefix}-slot-${i}`, `turn = cycles[slotKey] ?? 0`. If `memo` already holds an entry
for `slotKey` recorded at this same `turn`, that entry's `item`/`reserve` are reused
**without touching `pool`** — a refetch, a reorder, or a member entering/leaving the
pool changes nothing a slot is currently showing. Only when `turn` has moved past the
memoized value (the slot went fully off screen and back, §8.4) is `cls` recomputed
from the live `pool` and the memo updated. If a slot's `cls` comes back empty (every
member of its residue class left the pool), its memo entry is dropped and it renders
nothing that frame — a corner case (a whole class vacating between two laps of a
`pool.length > slots` source) that isn't itself frozen, since there is no old value to
hold onto.

This is why the small-pool case no longer keys by item id: an item's own identity is
not what has to survive a pool change while it's on screen — a *slot's* is. Keying by
slot, and freezing what a slot resolves to until its own turn advances, is what makes
CHIP_DESIGN.md rule 6 hold for both branches.

Keys must be namespaced by widget: prefixes are `spo-${ctx.tab}`, `rss-${ctx.tab}`,
`fin-${ctx.tab}`, `pred-${ctx.tab}`, `uptime`, `github` — this is also what keeps one
shared `RotationMemo` collision-free across every source on the rail.

### 8.3 Ticker wiring (Continuous only; already done; do not duplicate)

`ScrollrTicker` holds `cycles` state; `wrap(key, node, rotateSlot)` renders
`<div key className="py-1" data-rotate-slot={rotateSlot}>`; passes `cycles` in `ctx` and
to `widgetChipsFor`; an effect polls every 250ms (skipped in `flip` mode or when no slot
exists): `setCycles(prev => advanceCycles(prev, wasVisibleRef.current, visibleSlots(container)))`.

### 8.4 Off-screen rule (Continuous only)

*Pages' equivalent is the freeze (§P.8): a page's contents are fixed while it is up and
change only at the swipe.*

`visibleSlots(container)`: for every `[data-rotate-slot]` descendant (originals **and**
motion-plus clones, class `.ticker-item` / `.clone-item`), a slot is visible if any
instance's rect overlaps the container's rect horizontally. `advanceCycles` increments a
slot only on a visible→hidden transition and returns the same object when nothing
changed.

### 8.5 Pins (the fixed zone under Continuous; the edge under Pages)

**A pin attaches to a SUBJECT, never to a widget** (REL-239, decided with Brandon
2026-09-07). The fixed zone keeps its name and its place — that is what users expect a
pin to mean — but what it holds is one durable thing, and the zone shows that thing's
current chip.

**Under Pages** the pin keeps this meaning and moves to the edge zone, drawn as a page cell
at its family's minimum column (§P.11). Rules 1 to 3 and 5 below hold for both
presentations in spirit (one subject, one cell; bypasses the horizon; nothing to show shows
nothing; on the bar once). Rule 4 (never scrolls or rotates) is satisfied by the edge being
fixed. Rule 6 (the cap) is the 40% edge rule under Pages, see §P.11. The rest of this section describes the Continuous implementation: `pinnedChip`,
`ctx.pinnedSubject`, the fixed zone, `dropPinned` before `rotateSlots`.

`prefs.widgets.pins` is an ordered `WidgetPin[]` of `{widget, subject, side, row?}`.
The subject is the source's own durable id:

| Widget | Subject | Label |
|---|---|---|
| Sports | team name (`home_team_name` from the chip) | `teamShortName(league, name)` |
| Finance | `symbol` | the symbol |
| News | `feed_url` | `source_name` |
| Predictions | market `ticker` (not the row `id`) | `event_title \|\| title` |
| Uptime / GitHub | item `id` | item `label` |
| Clock / Timer / Weather / Sysmon | the widget id | the catalog name |

The last row is why this reads as universal without a multi-item widget eating the bar:
a single-chip utility IS its own subject, so a pinned Clock or Weather looks and behaves
exactly as it did before the model changed.

**Rules:**

1. **One pin, one chip.** `TickerSource.pinnedChip(raw, ctx)` resolves `ctx.pinnedSubject`
   to exactly one chip. Utilities and capped widgets resolve through
   `widgetChipsFor(..., { pinnedSubject })` instead, since they have no `TickerSource`.
2. **A pin bypasses the horizon.** The user already said "this one", so a pinned team
   shows its next fixture past `TICKER_UPCOMING_HOURS` and past `TICKER_FLOOR_DAYS`
   (`gamesForTeam`), and a pinned feed shows its newest item past `TICKER_RSS_HOURS`.
3. **Nothing to show renders nothing.** No placeholder, no dash (§1.7). The pin stays,
   and the chip returns when the subject does.

   The payload guarantees the row (SCROLLR-9). `/dashboard` takes the client's pinned
   subjects as a `pins` parameter -- a JSON array of `[source, subject]` pairs, capped
   server-side -- and appends one row per pinned subject it does not already carry:
   sports = live game, else next fixture, else last result, unbounded by the horizon;
   finance = the symbol's latest quote; rss = the feed's newest item; predictions = the
   market's latest state. Bounded to the user's own leagues and widgets, merged *after*
   the 30s per-user cache, so a just-set pin lands on the next poll and the cache keeps
   its single invalidatable key. Pins stay in desktop prefs; nothing is stored
   server-side.

   So a blank fixed zone now means the subject is genuinely empty -- an off-season team,
   a feed that has never published. That stays blank on the bar, and the pin control on
   the widget page is what says why ("Nothing to show for the Brewers right now"). The
   rule is unchanged; what changed is that it can no longer fire merely because the
   payload's preview was narrow.
4. **It never scrolls and never rotates.** No `cycles`, no `RotationMemo` in the zone.
5. **A pinned subject is excluded from the tape**, so it is on the bar exactly once. Each
   source drops `ctx.pinnedSubjects` from its **pool** via `dropPinned` *before*
   `rotateSlots` — filtering the rendered chips instead would let a slot resolve to a
   pinned item and render a hole.

   One accepted overlap, verified on the running bar: if a slot is *currently showing*
   the subject at the moment it is pinned, that slot keeps it until its own next lap.
   The rotation memo (§8.2, REL-234) freezes a slot's item until it has gone fully off
   screen, and that rule outranks this one — a chip must not vanish from under the
   reader's eyes, not even to enforce de-duplication. It clears itself on the next lap.
6. **The limit refuses, it never evicts.** On the pages bar the limit is WIDTH, not a
   count (SCROLLR-284, `components/pages/edgeRule.ts`): the edge (utilities + pins +
   its border) never takes more than **40% of the bar**, measured on the narrowest ticker
   window (every pages bar publishes `{bar, util}` through `lib/edgeMeasure.ts`, so the
   main window and every ticker agree). A pin's width is its family's edge column: a game
   `gameMinCol`, a quote `QUOTE_MIN_COL` (260), a headline the narrow one-line **260** (`NEWS_PIN_W`, ellipsis,
   the feed's name beneath). A pin that would pass the budget is refused with one line
   naming what fills the edge ("No room on the edge at this screen size — unpin Chicago
   Bears first"); `togglePin` returns the same `prefs` reference and every pin entry point
   (the ticker's right-click item, a widget page's pin button, the sidebar row) says so.
   When a window shrinks past what is pinned, the **newest** pins step back onto their
   normal pages (`stepBack`); they stay in prefs and return when there is room. With no
   ticker reporting a width (the continuous ticker, none running) the old
   `MAX_PINS = 2` count stands (derivation in `preferences.ts`).

**The control is not on the chip.** The hover pin icon is gone. Pins are set from:

- the ticker's native right-click menu — `App.tsx` resolves the chip under the cursor
  through `data-pin-subject` on the existing `data-chip` wrapper (`utils/pinTarget.ts`),
  so the menu names the actual subject ("Pin Yankees", not "Pin MLB");
- a widget page's item rows (`components/PinSubjectButton.tsx`): the finance watchlist,
  the news feed manager, a standings row, an open prediction market;
- the sidebar row's right-click, for single-chip widgets only.

**Nothing is auto-pinned.** A newly added widget used to be pinned to the right so the
user saw something happen; the cue is a toast naming what was added.

`pinnedWidgets` (the old `Record<widgetId, {side}>`) is migrated in `loadPrefs`:
single-chip utilities carry over unchanged, and every data-widget pin is **dropped** —
it meant "park this widget's first N chips", which froze that widget's rotation, and
there is no subject in it to translate to.

### 8.6 Costs to state in any PR that adds rotation (Continuous only)

- A short item sharing a slot with a long one carries the long one's width.
- Full coverage takes `ceil(pool/slots)` laps.

### 8.7 The status chip (no silent empty widgets)

SCROLLR-264. A widget on the ticker that contributes nothing is invisible, and the user
cannot tell "working, nothing now" from "broken". So it says so, once.

**Under Pages the status chip becomes the Also page** (§P.12): the same words, from the
same `TickerSource.status`, one cell per quiet widget on one shared page at the end of the
lap. The trigger, the text table and the no-fabrication rule below apply to both; the chip
shell, grid and reservation paragraphs are Continuous only.

**Trigger** (`ScrollrTicker.tsx`, data-widget branch): the tab's `chips()` returned `[]`,
the dashboard has loaded (`dashboard != null`), the source's payload is an array, and none
of the widget's pins resolves to a chip in the fixed zone. Then exactly ONE chip, keyed
`status-${tab}`, wrapped with `data-chip data-widget={tab} data-status` and no
`data-rotate-slot` / `data-pin-subject`. It is not a slot, it does not rotate, it is not a
pin target, and `displayedWidgetTypes` does not count it (presence measures data shown).
It disappears on the render where `chips()` returns anything. Utilities (clock, timer,
weather, sysmon, uptime, GitHub) are out of scope: their emptiness is setup, not time.

**Text** (`TickerSource.status(raw, ctx) → TickerStatus {tab, text, reserve}`):

| Source | Tab | Text, first that applies |
|---|---|---|
| Sports (`sportsTickerStatus`) | `leagueCode(league)` | a future date from `sports_meta.next_game` or a payload `pre` row (sooner wins): every league off-season → `season starts <day>`, else `next match\|game\|race <day, time>`; no date, all off-season → `off-season`; else `no matches\|games\|races scheduled` |
| News (`rssTickerStatus`) | `sourceTab(feed name)` (one feed) or the catalog name | rows but none in the floor → `no headlines in the last 2 days` (from `TICKER_RSS_FLOOR_HOURS`); no rows → `no headlines yet` |
| Any other source | `sourceTab(catalog name)` | `nothing to show right now` |

Noun: `race` for Formula 1, `match` where `reservationFor(league).draws`, else `game`. Dates
are `statusDate` (`ticker.ts`): the user's locale, `weekday short, day, month short` plus
`hour, 2-digit minute` for a kick-off. Never a fabricated value (§1.7): a league with no known
fixture says "off-season" or "no … scheduled" and nothing more.

**Chip** (`chips/StatusChip.tsx`): `chipShellClasses` + `grid max-w-[640px]
grid-cols-[max-content_minmax(0,max-content)]`, rows as §3.3. Tab as §3.5 with the
grey `STATUS_CHIP_COLORS` palette's `divider`/`tabBg`/`text`, so it reads as the bar
speaking, not as the widget's data. Text `font-mono text-[12px] font-medium leading-none`
+ `textDim`, `text-left`, `min-w-0 truncate`. No fixed right cell (nothing on it ticks) and
no detail row content: the 20px row is there and empty, because anything in it would
restate the top row (§1.3).

**Reservation**: `reserve` is the widest text that widget's status can show (every template,
with `widestStatusDate` = the widest date the locale produces over all months and weekdays),
rendered as a hidden sizer in column 2 (§4.1 rule 3). So the chip is one width from first
render whichever message it is on; verified by `e2e/ticker/status.spec.ts` (`idle` fixture).
Cost accepted: "off-season" carries the width of a dated message.

---

## 9. Motion (Continuous chips)

Pages' motion is §P.7.

- `useScoreFlash(away, home, game.id)`: flash 800ms on a score change **for the same
  id**; an id change resets silently. Any chip that flashes on a changing value and can
  rotate must key its flash on the item's identity.
- `data-motion="cap-pulse"` only on `down` / `in_progress` caps. Paused timers do not
  pulse. Nothing else animates on the chip; the marquee moves, the chip does not.
- `transition-colors duration-700` on the sports shell for the flash fade.

---

## 10. Data and history

### 10.1 Buffers

- `pushPrice(symbol, price, seed)`: seeds from `trade.sparkline` once, collapses
  consecutive identical prices, 32 points, 200 symbols LRU. Safe to call during render
  **because** it collapses repeats.
- `recordMetric(id, value, now)`: keeps repeats (flat history is real), so it is **not**
  safe to call during render without its guard: a reading within `MIN_GAP_MS = 500` of
  the previous one is ignored. 32 points, 40 keys LRU. Non-finite values ignored.
- A sparkline needs ≥ 2 points; below that render the item's `detail` text.

### 10.2 Fixtures

- Design and test against production-shaped data: `make seed` loads
  `scripts/dev/seed.sql.gz` (500 games, 500 trades, 500 markets, real feed items). Fantasy
  and utility data are not in the seed (user / device data); fixtures for those are
  representative and must be labelled so.
- Measure the worst case before choosing a cap or reservation: query `max(length(…))`
  on the real table.

### 10.3 Measuring for real (harness)

Prefer the ticker shim (`desktop/ticker-shim.html`, §P.15): it boots the real bar in a plain
browser from a fixture, and `npm run test:browser` drives it. Only when a property cannot be
seen there either:

When a property cannot be seen (the bar runs in Tauri; the embedded browser pane cannot
run the app shell), mount the real chip + real selector + real rule in a throwaway Vite
entry (`desktop/<name>.html` + `desktop/src/dev/<name>.tsx`, both deleted afterwards),
open it in the browser pane, and log `getBoundingClientRect().width` per state. Drive
any marquee with `setInterval`, not `requestAnimationFrame` (the pane paints on demand;
rAF does not tick between screenshots; timers and layout reads work). Never commit the
harness.

---

## 11. Traps (each cost a review round)

1. **Interpolated Tailwind classes.** `` `grid-cols-[..._${n}px]` `` produces no CSS.
   Tailwind v4 scans source text for literal class strings. Write every branch literally
   (`close ? "border-[…40%…]" : "border-[…22%…]"`). Verify with
   `curl -s "http://localhost:5174/src/style.css?direct" | grep -c "<distinctive fragment>"`
   while `npm run tauri:dev` is running. A test asserting the class string proves nothing.
2. **`<button>` centres text.** Add `text-left` to text cells.
3. **Arbitrary-value classes in tests.** `querySelector(".min-w-\\[5ch\\]")` is invalid;
   use `el.classList.contains("min-w-[5ch]")`.
4. **Recording history during render.** Only with a repeat-collapse or a time guard.
5. **`max-content` truncating tracks.** Use `minmax(0,max-content)`.
6. **Conditionally mounted slots** (dot, badge) change width. Mount always, toggle
   `invisible`.
7. **Flash on identity change.** Key the flash.
8. **HMR on new exports** shows "Something went wrong": restart `npm run tauri:dev`.
9. **jsdom has no layout.** Stub `HTMLElement.prototype.scrollWidth/clientWidth` via
   `Object.defineProperty` for fit tests; `delete` them in `afterEach`.
10. **Reading feed prefs in a ticker selector.** Forbidden (§1.5).

Pages-specific (each caught by `cells.spec.ts` or a review):

11. **A `min-width` that includes padding** grows with its content: the clock box grew for
    "12:00P" and moved every name left of it. Give the box a fixed width
    (`STATUS_WIDTH`), never a minimum.
12. **Ranking a page by a live value** (score closeness, price change) reshuffles it on
    every update. Rank by tier and source order; show closeness as a tint (§P.5).
13. **Planning the first page before the edge has pins.** Read the edge's `offsetWidth` when
    each page is planned (§P.3), not through a ResizeObserver.
14. **Two sources of a column width.** Every `minCol` is the cell family's export; a default
    in `pagePlan.ts` disagrees with the cell and cuts the longest names.
15. **StrictMode double-runs the first-turn effect.** Gate it on the turn ref, not state, or
    page one is skipped.
16. **Running process-wide work in every ticker window.** `App` renders once per window; the
    page clock belongs to the primary (§P.14).
17. **Fake clocks do not carry BroadcastChannel timing.** Test two windows in real time.

---

## 12. Build recipe

Two recipes. **12A** is for anything on the Pages bar (the default): a page cell, a new
widget family on pages, the edge zone. **12B** is for a Continuous chip. A new widget family
needs both until Continuous is retired.

### 12A. A page cell (or a new family on pages)

1. **Read** this file (§P in full), `docs/CHIP_DESIGN.md`, `desktop/src/components/pages/`
   (`pagePlan.ts`, `widgetPages.ts`, `PagedBar.tsx`, `EdgeZone.tsx`, the cell nearest to
   yours) and the source's `view.ts` / `ticker.tsx`.
2. **Query the real data** for the widest value of every field the cell shows
   (`docker exec scrollr-postgres psql … -c "SELECT max(length(col)) …"`), and the
   worst-case names. Record them.
3. **Decide the grammar**: the top line, the one detail line (§1.3), which value changes
   (it gets a reservation), and the **minimum column**: the narrowest width at which the
   cell is still whole, measured in the gallery (`?cells=1`), not guessed. Export it from the
   cell file (`XXX_MIN_COL`); nothing else may hold a column width.
4. **Draw it on the canvas first** with at least four real fixtures across every state and
   the worst cases from step 2, at the narrowest and the widest column. Get a pick before
   writing code.
5. **Write the reservation plan**: for each changing value, `ch` or a fixed-width box, sized
   from step 2. No `min-width` that includes padding (§11.11).
6. **Implement** in `components/pages/cells/`: a `<button type="button" data-chip
   data-item>`, `h-full w-full min-w-0 text-left`, no shell, the accent only through
   `--accent` and `mix(pct)` (never a template-literal class), a layout chosen from the
   column width alone, always-mounted slots (`invisible`, never conditional), `Crest` for
   logos.
7. **Wire the family** in `widgetPages.ts`: build the `PageWidget` from the source's own
   `selectXForTicker` (no prefs; drop pinned subjects with `dropPinned`), assign tiers with
   the ladder in §P.5 (tier 0 only for live and yours: it leads page 1), give each item a
   stable `key` and a `pin` subject, pass the family's min column. Add the `Cell` case in
   `PagedBar.tsx`. If the family can be pinned, add it to `buildEdge` in `EdgeZone.tsx` at
   its minimum column. If it has nothing to show, make sure its `status()` words reach the
   Also page (§P.12).
8. **Memo** the cell and compare every prop that changes rendering.
9. **Tests**: vitest per cell (the detail line, reservations present, flash keyed on id);
   `widgetPages.test.ts` for tiers, order and Also; `pagePlan.test.ts` if arithmetic
   changed; a `cells.spec.ts` entry that measures every part across every state and fails
   if anything moves; `pages.spec.ts` covers the whole page once it is on `main`.
10. **Verify**: `npx tsc --noEmit`; `npx vitest run`; `npm run test:browser`; open
    `?pages=1&live=1` in the shim at 1280 and 1920 and look; check the served CSS for every
    new arbitrary class. Screenshots at both widths and in light and dark go in the PR.
11. **Commit** with the rule being applied and any cost accepted.

### 12B. A new or rebuilt chip (Continuous)

1. **Read** this file, `docs/CHIP_DESIGN.md`, `GameChip.tsx`, `RssChip.tsx`,
   `UtilityChips.tsx`, and the source's `view.ts` / `ticker.tsx`.
2. **Query the real data** for the widest values of every field the chip will show
   (`docker exec scrollr-postgres psql … -c "SELECT max(length(col)) …"`). Record them.
3. **Decide the grammar cells**: what is the tab, what are the content cells, what is the
   one changing value for the fixed right cell, what is the detail row (must satisfy §6).
4. **Draw it on the canvas first** (Claude Design), with ≥ 4 real fixtures
   across every state, plus the worst cases from step 2, and ≥ 3 directions if the design
   is not already settled. Get a pick before writing code.
5. **Write the reservation plan**: for each changing value, `ch` or sizer, sized from
   step 2. For rotation, decide the reserve function.
6. **Implement** with `chipShellClasses` + grid, literal classes, `getChipColors`
   palette fields (`divider`, `tabBg`), `useLatchedCap` if content-sized, `text-left`,
   `TeamLogo size="lg"` if crests, always-mounted slots.
7. **Wire the source**: `selectXForTicker(rows, …)` with no prefs; `rotateSlots(pool,
   SLOTS_CONST, ctx.cycles ?? {}, \`x-${ctx.tab}\`, id, reserve)`; return `{key, node,
   rotateSlot}`; register in `tickerRegistry.ts` if new.
8. **Memo compare** must include every prop that changes rendering (`accent`, `reserve*`, `onClick`, item identity and displayed fields).
9. **Tests** (vitest, `@testing-library/react`): the detail row
   shows the specified content; reservations present (classList / style); flash keyed;
   selector ignores prefs; rotation arrangement (keys, residue classes, reserve equals
   what is rendered); horizon boundaries (`NOW` fixed, `ago(h)` helper).
10. **Verify**: `npx tsc --noEmit`; `npx vitest run`; served-CSS grep for every new
    arbitrary class; restart the app; look at the bar; if width stability matters, run
    the harness (§10.3) and record widths per state.
11. **Commit** with a message that states the rule being applied and any cost accepted.
    Ship whole families together.

---

## 13. Review checklist (answer every line before approving)

### 13A. Page cells, the edge zone, anything on Pages

- [ ] One 64px bar; the cell fills it; no density branch; no card shell.
- [ ] **Nothing on a page moves while it is up:** no value changes its box, no item re-sorts, appears or vanishes on the page in view; `cells.spec.ts` measures every part across every state.
- [ ] The cell's detail line is not derivable from its top line (§1.3).
- [ ] The family exports its own minimum column, measured in the gallery; `columnsFor` is called with it and nothing else holds a width.
- [ ] Columns: equal, `minmax(0,1fr)`, count = items on the page; layout chosen from the column width alone.
- [ ] Every changing value reserves from first render (score `ch`, fixed clock box, price and change `ch`, fixed age column); sometimes-empty parts are always mounted.
- [ ] Tier ladder respected: only live games and your team are tier 0 (they lead page 1; no page is on every lap); order inside a tier is the source's own, never a live value.
- [ ] No per-widget slot count; no new setting for how many or which (§1.4).
- [ ] The pool is the widget page's (§P.4a): no time window under Pages, nothing eligible hidden; the visit cursor continues where the last visit stopped through refreshes and re-plans, leader-owned; the label counts the page (`n/m`) and its fact fits beside it.
- [ ] Every page is full (§P.4a): the family's pool fills its pages (or a fill tops a short one up), `topUp` adds only the last page's empty columns, a fill is never written to the user's config, and a truly short widget is drawn at a page's column width, left-aligned; `pages.spec.ts` `unfilled` green.
- [ ] Every fixture's lap is at most 60 s and everything is shown within 300 s (`pages.spec.ts`); a visit is exactly one page (`nextTurn`, `pageOrder`); never raise a threshold to pass.
- [ ] The ticker selector reads no feed prefs; pinned subjects dropped from the pages with `dropPinned`; the pin is on the bar once.
- [ ] A widget with nothing on reaches the Also page with its status words; nothing fabricated.
- [ ] Edge: one Cycle slot per utility stepping on the turn `seq`; a sizer for every item so the width is constant; edge width read when the page is planned.
- [ ] An active pointer (moved within 5 s) holds the page and the dwell line, a resting one does not (`hover.spec.ts`); reduced motion is a crossfade; dwell is 6 to 12 s; swipe is 0.6 s.
- [ ] Colour only through `--accent` and `mix()`, text in the widget's colour only through `--accent-ink`; red only live or urgent.
- [ ] Contrast (§P.13): no opacity on text, no `fg-4` text, `pages-themes.spec.ts` green in all 20 palettes.
- [ ] Process-wide work (page clock, hover, manual steps) runs in the primary window only; followers follow.
- [ ] The pager (§P.7a) keeps its 88px and the count its reserved box; `contentWidth` still takes `PAGER_W` off; a manual step is a turn (fresh dwell, cursor past it) and reaches every window (`paging.spec.ts`).
- [ ] No template-literal classes; served CSS checked.
- [ ] Verified in the shim at 1280 and 1920 with `?pages=1&live=1`; `npm run test:browser` green.
- [ ] Any rule from §P that this change relies on and that is not on `main` is marked *(lands with SCROLLR-xxx)*, and any mark whose issue just merged is removed.

### 13B. Continuous chips

- [ ] Two rows, 30px + 20px; no density branch anywhere in the chip.
- [ ] Detail row is not derivable from the top row; matches §6 for its family.
- [ ] Every changing value has a reservation; sizes cite real data.
- [ ] Sometimes-empty elements are always mounted (`invisible`), never conditional.
- [ ] Content columns are `minmax(0,max-content)`; cap `max-w-[640px]`; `useLatchedCap` pins `width: 640px` and releases at the cap.
- [ ] Tab painted (`tabBg` or `--accent` 18%); dividers `divider` (45%) or `--accent` rule; never `border-edge`.
- [ ] `text-left` on text cells; mono for data, sans only for prose.
- [ ] Colours only via palette or `--accent`; red only for live/urgent; semantic borders never branded.
- [ ] Flash keyed on identity; only earning states pulse.
- [ ] Ticker selector reads no feed prefs; constants, not settings; rotation via `rotateSlots`; keys namespaced by `ctx.tab`.
- [ ] Reserve for rotation equals what the chip renders.
- [ ] No template-literal classes; served CSS checked for each new arbitrary class.
- [ ] Tests cover the arithmetic (reservations, horizons, rotation, fit/flash guards).
- [ ] Verified on the running bar; widths measured if anything can change.
- [ ] Any accepted cost (whitespace, laps) written in the PR.
