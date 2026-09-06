# Ticker chip specification (for AI agents)

This is the complete, exact specification for building or changing a chip on the Scrollr
ticker. It is written for a model: every number, class, file path, contract and test
pattern is stated literally so nothing has to be inferred. The human summary is
`docs/CHIP_DESIGN.md`. When the two disagree, this file wins, and the disagreement is a
bug to fix in the other.

Read all of it before touching `desktop/src/components/chips/` or any
`desktop/src/datawidgets/*/ticker.tsx`. Then follow §12 (build recipe) and §13 (review
checklist) literally.

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| **chip** | One `<button>` on the ticker rail representing one item (game, symbol, headline, …) or one widget (clock, weather, …). |
| **rail** | The scrolling marquee. `desktop/src/components/ScrollrTicker.tsx`, rendered by motion-plus `<Ticker>`. |
| **compact** | The single-row density. `comfort === false`. Row height 28px. |
| **detailed** | The two-row density. `comfort === true`. Rows 30px + 20px. Also called "comfort" in code. |
| **tab** | The left cell naming the source: league code, feed name, widget name, or status cap. Spans both rows. |
| **fixed right cell** | The rightmost cell holding the one value that changes on screen. Bordered on its left. |
| **reservation** | Width held from first render for a value that will change, so the chip never resizes. |
| **cap** | The chip's max width: `CHIP_MAX_PX = 640`, class `max-w-[640px]`. |
| **slot** | One rail position that cycles through several items. Keeps its React key while its content changes. |
| **pool** | Everything eligible for the rail from one source, in display order. |
| **lap / cycle** | One complete trip of a slot off the right edge, across, and off the left. A slot's content advances once per lap. |
| **horizon** | The per-source time rule deciding what is eligible. |
| **floor** | The one item a quiet source still shows when nothing is inside its horizon. |
| **palette** | The `ChipColors` object for a chip's colour mode and widget. |
| **source** | A `TickerSource` in `desktop/src/datawidgets/<source>/ticker.tsx`, registered in `tickerRegistry.ts`. |

---

## 1. The invariants (never violate)

1. **Compact is the chip. Detailed is compact plus exactly one 20px row underneath. Every element of the top row keeps its position, size and content across both densities.** Verify: render the same item with `comfort={false}` and `comfort={true}`; the top row must be pixel-identical.
2. **A chip never changes width while on screen.** Every value that can change reserves its widest plausible width from first render (§4). Verify: render the same fixture in every state it can pass through (pre / live / final; no-score / one-digit / two-digit; short / long swap) side by side; widths must be identical.
3. **The detailed row is never derivable from the top row.** It is what the user would otherwise open the app to find (§6).
4. **Nothing on the ticker is user-configurable.** No per-widget or global setting decides what is on the rail or how many. Horizons, floors and slot counts are constants (§8).
5. **The rail is independent of the widget page.** A source's `chips()` must not read any feed-page display preference (`defaultSort`, `articlesPerSource`, `maxArticles`, `maxArticleAgeDays`, filters). Verify: `selectXForTicker` takes no prefs argument.
6. **Red means live or urgent, and nothing else.** Never use `live`, `down`, `error` or `warning` tokens for brand or emphasis.
7. **Never fabricate a value.** Missing data reserves its space and renders empty. No "—" placeholders for scores. No single-point sparklines. No synthetic history.
8. **Tailwind classes are literal strings in source.** Never build a class with a template literal or string concatenation (§11).

---

## 2. Files and contracts

### 2.1 Shared modules

| File | Exports you use | Purpose |
|---|---|---|
| `desktop/src/components/chips/chipColors.ts` | `getChipColors(mode, widget): ChipColors`, `chipShellClasses(colors, extra?)`, `chipBaseClasses(...)`, `stableNum(chars)`, `NUM_WIDTH` | Palettes and the shell. |
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
| `desktop/src/components/tickerStep.ts` | `stepItemIndex(step, count, direction)` | Step-mode measurement; do not touch. |

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
  comfort: boolean;
  chipColorMode: ChipColorMode;   // "widget" | "accent" | "muted"
  widgetDisplay?: WidgetDisplayPrefs;   // DO NOT read for ticker selection (§1.5)
  predictionsWatchlist: ReadonlySet<string>;
  cycles?: Readonly<Record<string, number>>;   // per-slot lap counts
  onChipClick?: (widgetType: string, itemId: string | number, url?: string) => void;
}
export interface TickerSource { chips(raw: unknown, ctx: TickerContext): TickerChip[]; }
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
getChipColors("widget", "clock")   // WIDGET_MAP[widget], PURPLE if unknown
getChipColors("accent", any)       // PRIMARY (emerald)
getChipColors("muted", any)        // MUTED (grey: divider border-fg-3/35, tabBg bg-fg-3/[0.14])
```

Widget → token: `finance→primary #34d399`, `sports→secondary #ff4757` (only when no brand
accent), `rss→info #00d4ff`, `fantasy→accent-purple #a855f7`, `predictions→#1fc9a0`,
`clock→#6366f1`, `timer→#f59e0b`, `weather→#0ea5e9`, `sysmon→#06b6d4`,
`uptime→#10b981`, `github→#f97316`.

Theme tokens (dark, `desktop/src/style.css`): surface `#141420`, edge `#282838`, fg
`#e2e2ec`, fg-2 `#b7b7c6`, fg-3 `#9292a4`, fg-4 `#78788a`, up `#22c55e`, down
`#ef4444`, live `#ff4757`, warning (amber), error `#ef4444`, info `#00d4ff`.

---

## 3. Geometry

### 3.1 The shell

Content-sized chips (sports, news, utilities) use `chipShellClasses(colors, extra)`,
which yields `ticker-chip group rounded-sm border transition-colors cursor-pointer
relative overflow-hidden shrink-0 {bg} {border} {hoverBorder} {extra}`. On top of it the
chip adds:

```
grid max-w-[640px]
grid-cols-[<tab> <cells…> <end>]        // literal string, see §3.2
comfort ? "grid-rows-[30px_20px]" : "grid-rows-[28px]"
```

Fixed-width chips (finance, predictions, fantasy, uptime, GitHub) still use
`chipBaseClasses(comfort, colors, extra)` = the 264px flex box (`w-[264px]`, comfort
`h-[52px]`). They need no reservations and rotate without a reserve. Rebuilding them onto
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

- Compact: `grid-rows-[28px]`. Detailed: `grid-rows-[30px_20px]`.
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
6. At the cap (`useLatchedCap(ref, 640)` returned true), release the reservations
   (`minWidth: undefined`) and tighten `cellPad` to `px-1.5`. The chip cannot move at the
   cap, so the reservation only steals characters from the name.
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
La Liga / Premier League / Champions League / FIFA World Cup / MLS: SOCCER
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
- US pro (`MLB NBA NHL NFL MLS AFL`): strip club suffix; if still long, the **last word**
  (the nickname).
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

## 6. The detailed row

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
- Sysmon must call `recordMetric` on every render including compact, so the buffer fills
  before the user switches density.

---

## 7. Colour

### 7.1 Modes

`ctx.chipColorMode`: `"widget"` (brand / widget token), `"accent"` (PRIMARY for all),
`"muted"` (grey for all). Brand accents (`accent` prop, a `#rrggbb` from
`catalogItemById(ctx.tab)?.hex`) apply only in `widget` mode: `branded = colorMode ===
"widget" && !!accent`.

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
| Weather alert | chip `border-warning/45`, text `text-warning`; hot temp (≥95 or within 2° of high) `text-warning` |
| Sysmon hot | chip `border-error/30`, value `text-error`, gauge/line `bg-error`/`text-error` |
| Uptime down | chip `border-down/30`, value `text-down`, cap `down` pulses |
| Stale news (>2h) | `border-edge/55`, title `text-fg/55`, tab `opacity-55` |
| Night zone / paused timer | cell `opacity-55`, glyph `☾` / `‖` |

Caps (`ChipCap` tones): `up bg-up/[0.16] border-up/30 text-up`, `down`, `info`,
`warning`, `neutral bg-fg-3/[0.10] border-fg-3/30 text-fg-3`. Uptime: UP/DOWN/MNT/`···`.
GitHub: ✓/✗/●/○. Only `down` and `in_progress` pulse (`data-motion="cap-pulse"`).

---

## 8. What is on the rail

### 8.0 The feed page and the ticker are different products

They render the same `dashboard.data`, through different selectors, for different jobs.

| | Feed page (widget page) | Ticker (rail) |
|---|---|---|
| Job | Reading a list the user opened on purpose | Glancing at what is happening now, unattended, all day |
| Selector | `applyXPipeline` / `selectXForFeed` — takes prefs | `selectXForTicker` — takes **no** prefs |
| Amount shown | Whatever the user asks for (all, or "Show N") | A fixed number of slots per source; the rest rotate |
| Order | The user's sort | One fixed rule per source |
| Time window | The user's window (`daysBack/daysAhead`, `maxArticleAgeDays`) | The source's horizon constant |
| Filters | Source / category / lens filters | None |
| User settings | All of the above are theirs | **None** for selection; presentation only (§8.0.1) |

The rule that follows from the table, stated so it can be enforced in review:

> **Anything about *reading* belongs to the feed page and must not reach the rail.
> Anything about *what is on the rail* is a constant, not a setting.**

Concretely, a ticker source or selector must not read `widgetDisplay.<source>.defaultSort`,
`articlesPerSource`, `maxArticles`, `maxArticleAgeDays`, `feedSort`, or any feed filter
state. It may read widget **config** (the user's inputs — see §8.0.1) and `ctx.cycles`.

The design that makes "no settings" workable is the pair introduced together: **fixed
slots per source** (§8.1) and **rotation inside the same chips** (§8.2). Together they
remove both questions a setting would otherwise have to answer — "how many?" and "which
ones?" — and they keep the rail's chip count and width constant, so the bar never grows,
shrinks or jumps as a slate fills.

#### 8.0.1 The control inventory

**The user controls their inputs** (widget config; read by ticker sources as data):

| Widget | Inputs the user owns |
|---|---|
| All | Which widgets are on the ticker (`widgetsOnTicker`); pinned widgets |
| Finance | `config.symbols` (the watchlist, in the user's order) |
| Predictions | starred markets (`predictionsWatchlist`) |
| Sports | `config.favoriteTeams[league]` |
| News | `config.feeds` (custom RSS) |
| Clock | `localTime`, `showTimezones`, `excludedTimezones`, zones |
| Timer | `activeTimer`, pomodoro durations |
| Weather | saved cities, `excludedCities` |
| Sysmon | `cpu`, `memory`, `gpu`, `gpuPower` toggles |
| Uptime | `url`, `excludedMonitors` |
| GitHub | `repos`, `excludedRepos` |

**The user controls presentation** (`TickerPrefs`): `showTicker`, `tickerSpeed`,
`onHover` (keep / slow / pause), `tickerMode` (compact / detailed),
`mixMode` (grouped / mixed), `chipColors` (widget / theme / subtle),
`scrollMode` (continuous / page), `stepPause`, `tickerPosition`,
`hideOnFullscreen`, pinning.

**The user does not control selection.** Never add a setting for: how many chips a
widget contributes; which eligible items appear; their order; the horizon or floor;
rotation cadence or slot count. The one such control ever added (sports "N on the
bar", 2026-09-04) was removed the same day.

**Documented exception, to be reconciled:** fantasy's `tickerMode` dial (essential /
standard / everything) is a selection control that predates this rule. Its per-item
venue toggles and the 14 venue prefs behind them went in REL-208 (2026-09-06); each
dial position is now a fixed set built in the fantasy ticker source. When fantasy is
rebuilt (REL-184), the dial becomes the fixed `standard` rule; followed players remain,
since they are an input.

### 8.1 Per-source constants (not settings)

| Source | Eligible (horizon) | Floor | Slots | Pool order | Reserve |
|---|---|---|---|---|---|
| Sports | live always; `pre` with `0 <= h <= 24`; `final` with `h >= -18` (from kickoff) | soonest `pre` within 7 days | `TICKER_SLOTS = 4` | `sortForDisplay`: live+close 100, live 80, pre 60 (soonest first), final 30 (newest first) | widest short names per class |
| News | items within `TICKER_RSS_HOURS = 6` | newest per feed if within `TICKER_RSS_FLOOR_HOURS = 48`; undated counts as current | `TICKER_RSS_SLOTS = 3` | newest first, **interleaved by feed** (round-robin, feeds ordered by their newest item) | longest `plainText(title)` per class |
| Finance | the widget's `symbols` | — | `TICKER_FINANCE_SLOTS = 4` | watchlist order; unlisted rows trail alphabetically | none |
| Predictions | stars if any (drop `in_sweep===false` unless resolved); else top `TICKER_FALLBACK_LIMIT = 15` rank-1 by trailing volume | — | `TICKER_PREDICTIONS_SLOTS = 4` | `sortPredictions(..., "trending")` | none |
| Uptime / GitHub | all items | — | `CAPPED_WIDGET_SLOTS = 4` (in `ScrollrTicker.tsx`) | item order | none |
| Clock / Timer / Weather / Sysmon | all items in one chip | — | n/a | config order | n/a |
| Fantasy | bounded by the fantasy ticker dial | — | n/a | as built | n/a |

Sports favourites (`config.favoriteTeams[league].teamName` matching either team name)
are **pinned**: every one is on the rail, keyed `spo-<tab>-<gameId>`, exempt from the
slot count.

### 8.2 `rotateSlots` semantics

- If `pool.length <= slots`: return every item keyed `${prefix}-${id(item)}`, no
  `rotateSlot`, no `reserve`.
- Else for `i in 0..k-1`: class `cls = pool.filter((_, idx) => idx % k === i)`; slot key
  `${prefix}-slot-${i}`; `turn = cycles[slotKey] ?? 0`; item `cls[turn % cls.length]`;
  `reserve = reserve(cls)`.
- Keys must be namespaced by widget: prefixes are `spo-${ctx.tab}`, `rss-${ctx.tab}`,
  `fin-${ctx.tab}`, `pred-${ctx.tab}`, `uptime`, `github`.

### 8.3 Ticker wiring (already done; do not duplicate)

`ScrollrTicker` holds `cycles` state; `wrap(key, node, rotateSlot)` renders
`<div key className="py-1" data-rotate-slot={rotateSlot}>`; passes `cycles` in `ctx` and
to `widgetChipsFor`; an effect polls every 250ms (skipped in `flip` mode or when no slot
exists): `setCycles(prev => advanceCycles(prev, wasVisibleRef.current, visibleSlots(container)))`.

### 8.4 Off-screen rule

`visibleSlots(container)`: for every `[data-rotate-slot]` descendant (originals **and**
motion-plus clones, class `.ticker-item` / `.clone-item`), a slot is visible if any
instance's rect overlaps the container's rect horizontally. `advanceCycles` increments a
slot only on a visible→hidden transition and returns the same object when nothing
changed.

### 8.5 Pinned widgets

`pinnedWidgets[tab]` render in a static zone via `widgetChipsFor(..., { pinned: true })`;
they never scroll, so `cycles` stays `{}` there and the first `slots` items hold.

### 8.6 Costs to state in any PR that adds rotation

- A short item sharing a slot with a long one carries the long one's width.
- Full coverage takes `ceil(pool/slots)` laps.

---

## 9. Motion

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

---

## 12. Build recipe for a new or rebuilt chip

1. **Read** this file, `docs/CHIP_DESIGN.md`, `GameChip.tsx`, `RssChip.tsx`,
   `UtilityChips.tsx`, and the source's `view.ts` / `ticker.tsx`.
2. **Query the real data** for the widest values of every field the chip will show
   (`docker exec scrollr-postgres psql … -c "SELECT max(length(col)) …"`). Record them.
3. **Decide the grammar cells**: what is the tab, what are the content cells, what is the
   one changing value for the fixed right cell, what is the detail row (must satisfy §6).
4. **Draw it on the canvas first** (Claude Design), compact first, with ≥ 4 real fixtures
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
8. **Memo compare** must include every prop that changes rendering (`comfort`,
   `colorMode`, `accent`, `reserve*`, `onClick`, item identity and displayed fields).
9. **Tests** (vitest, `@testing-library/react`): compact hides the detail row; detailed
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

- [ ] Top row identical in compact and detailed (position, size, content).
- [ ] Detail row is not derivable from the top row; matches §6 for its family.
- [ ] Every changing value has a reservation; sizes cite real data.
- [ ] Sometimes-empty elements are always mounted (`invisible`), never conditional.
- [ ] Content columns are `minmax(0,max-content)`; cap `max-w-[640px]`; `useLatchedCap` releases at the cap.
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
