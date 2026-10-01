/**
 * Widget pages for the marketing demo bar (SCROLLR-198): the desktop
 * ticker's page engine, ported line for line from
 * desktop/src/components/pages/{pagePlan,widgetPages,EdgeZone}.ts and
 * cells/parts.tsx. Pure functions and types only: no React, no DOM.
 *
 * Ported, not imported: the website's Docker build copies only
 * myscrollr.com/, the desktop files import Tauri and the desktop's own
 * types and Tailwind tokens, and the two projects keep different style
 * rules (AGENTS.md). When the desktop's numbers change, change them here
 * too; docs/CHIP_SPEC.md §P is the contract both follow.
 *
 * A page is ONE widget laid across the bar in EQUAL columns that fill the
 * width. The column count comes from the width and the cell family's
 * minimum, never from the content, so a value change cannot move a cell.
 */

// ── Importance ladder (CHIP_SPEC §P.5) ─────────────────────────────

export const TIER = {
  live: 0,
  fresh: 1,
  recent: 2,
  quiet: 3,
  status: 4,
} as const
export type Tier = (typeof TIER)[keyof typeof TIER]

// ── Geometry (CHIP_SPEC §P.3, §P.4, §P.9) ─────────────────────────

/** Width of the label block on the left of every page. */
export const LABEL_W = 112
/** Pages shown per visit: the sticky ones, then two more of the rest. */
export const MAX_PAGES_PER_VISIT = 3

/** Narrowest column per cell family (the cells' exports on desktop). */
export const QUOTE_MIN_COL = 172
export const NEWS_MIN_COL = 400
export const ALSO_MIN_COL = 300
/** A game column this wide is one scoreboard line. */
export const WIDE_GAME_PX = 430
/** A game column this wide has room for the full short name. */
export const ROOMY_GAME_PX = 340
/** A headline column this wide sets the headline larger. */
export const BIG_HEADLINE_PX = 560

const US_PRO = new Set(['NFL', 'MLB', 'NBA', 'NHL', 'MLS', 'WNBA'])

export function gameMinCol(league: string): number {
  return US_PRO.has(league) ? 212 : 244
}

export function contentWidth(barWidth: number, edgeWidth = 0): number {
  return Math.max(0, barWidth - LABEL_W - edgeWidth)
}

export function columnsFor(contentW: number, minCol: number): number {
  return Math.max(1, Math.floor(contentW / minCol))
}

/**
 * The fewest pages of at most `cols`, evenly: sizes differ by at most one,
 * larger pages first, order kept (14 at 12 is 7 + 7; 56 at 5 is 8x5 + 4x4).
 */
export function paginate<T>(
  items: ReadonlyArray<T>,
  cols: number,
): Array<Array<T>> {
  if (items.length === 0) return []
  const pages = Math.ceil(items.length / Math.max(1, Math.floor(cols)))
  const base = Math.floor(items.length / pages)
  const extra = items.length % pages
  const out: Array<Array<T>> = []
  let at = 0
  for (let p = 0; p < pages; p++) {
    const size = base + (p < extra ? 1 : 0)
    out.push(items.slice(at, at + size))
    at += size
  }
  return out
}

export interface WidgetPlan<T> {
  pages: Array<Array<T>>
  /** Leading pages that hold live items (at least 1 when there is any page). */
  sticky: number
}

/** Rank by tier (stable), split at `cols`, and count the sticky pages. */
export function planWidget<T>(
  items: ReadonlyArray<T>,
  tierOf: (item: T) => Tier,
  cols: number,
): WidgetPlan<T> {
  const ranked = items
    .map((item, i) => ({ item, i, t: tierOf(item) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
  const pages = paginate(
    ranked.map((r) => r.item),
    cols,
  )
  const top = ranked.filter((r) => r.t === TIER.live).length
  let sticky = 0
  for (let covered = 0; covered < top; sticky++) covered += pages[sticky].length
  return { pages, sticky: pages.length ? Math.max(1, sticky) : 0 }
}

/** Seconds a page holds: longer for a fuller page, within 6..12 s. */
export function dwellFor(itemsOnPage: number): number {
  return Math.min(12, Math.max(6, 3 + itemsOnPage * 0.75))
}

export interface Visit {
  pages: Array<number>
  next: number
}

/**
 * One visit: the sticky pages every time, then up to two more of the rest
 * from `cursor`, wrapping; a widget small enough to show whole does.
 */
export function visitPages(
  pageCount: number,
  cursor: number,
  sticky = 1,
): Visit {
  if (pageCount <= 0) return { pages: [], next: 0 }
  const s = Math.max(1, Math.min(sticky, pageCount))
  if (pageCount <= s + MAX_PAGES_PER_VISIT - 1) {
    return { pages: Array.from({ length: pageCount }, (_, i) => i), next: s }
  }
  const rest = pageCount - s
  const pages = Array.from({ length: s }, (_, i) => i)
  let c = (((cursor - s) % rest) + rest) % rest
  for (let k = 0; k < MAX_PAGES_PER_VISIT - 1; k++) {
    pages.push(s + c)
    c = (c + 1) % rest
  }
  return { pages, next: s + c }
}

// ── Freeze (CHIP_SPEC §P.8) ────────────────────────────────────────

export interface FrozenPage<T> {
  readonly keys: ReadonlyArray<string>
  readonly latest: ReadonlyMap<string, T>
}

export function freezePage<T>(
  page: ReadonlyArray<T>,
  keyOf: (item: T) => string,
): FrozenPage<T> {
  return {
    keys: page.map(keyOf),
    latest: new Map(page.map((item) => [keyOf(item), item])),
  }
}

/** Fold in fresh data: values update in place, keys and order never change. */
export function refreshPage<T>(
  frozen: FrozenPage<T>,
  pool: ReadonlyArray<T>,
  keyOf: (item: T) => string,
): FrozenPage<T> {
  const latest = new Map(frozen.latest)
  for (const item of pool) {
    const k = keyOf(item)
    if (latest.has(k)) latest.set(k, item)
  }
  return { keys: frozen.keys, latest }
}

export function pageItems<T>(frozen: FrozenPage<T>): Array<T> {
  return frozen.keys.map((k) => frozen.latest.get(k) as T)
}

// ── What a page holds ──────────────────────────────────────────────

export interface DemoTeam {
  /** Full name, e.g. "Chicago Bears". */
  name: string
  /** Record line, e.g. "2-1". */
  record: string
}

export interface DemoGame {
  kind: 'game'
  league: string
  away: DemoTeam
  home: DemoTeam
  awayScore: string
  homeScore: string
  state: 'pre' | 'live' | 'final'
  /** The clock box: "Q4" over "2:14", "FINAL", "SUN" over "1:00P". */
  top: string
  bottom: string
  venue: string
  /** A live game within one score: a 10% tint. */
  close?: boolean
}

export interface DemoQuote {
  kind: 'quote'
  symbol: string
  price: number
  pct: number
  low: number
  high: number
  series: Array<number>
}

export interface DemoNews {
  kind: 'news'
  title: string
  summary: string
  source: string
  /** "12m", "4h". */
  age: string
}

export interface DemoAlso {
  kind: 'also'
  code: string
  text: string
  hex?: string
}

export type DemoCell = DemoGame | DemoQuote | DemoNews | DemoAlso

export interface DemoItem {
  key: string
  tier: Tier
  /** One of your teams is playing: the 2px line on top. */
  mine?: boolean
  cell: DemoCell
}

export interface DemoPageWidget {
  /** Widget id (sports_nfl, news_bbc), or "also". */
  tab: string
  /** The label's name: "NFL", "BBC", "STOCKS", "ALSO". */
  code: string
  /** The label's one fact: "9 LIVE", "▲4  ▼6", "HEADLINES". */
  sub: string
  /** Catalog colour; `accentFor` turns it into `--accent`. */
  hex?: string
  minCol: number
  items: Array<DemoItem>
}

/** One thing an edge slot can show (EdgeZone's SlotItem). */
export interface DemoSlot {
  id: string
  label: string
  icon?: string
  value: string
  /** The value at its widest: what the slot reserves. */
  reserve: string
  detail?: string
  dim?: boolean
  tone?: 'live' | 'warning' | 'error' | 'down'
}

export interface DemoUtility {
  tab: string
  hex?: string
  items: Array<DemoSlot>
}

export interface DemoBarData {
  widgets: Array<DemoPageWidget>
  edge: Array<DemoUtility>
}

export const ALSO_TAB = 'also'

/**
 * `value` at its widest: every digit becomes 0 and the first run of
 * digits is padded to `digits`, so "7:21 PM" reserves "00:00 PM".
 */
export function reserveOf(value: string, digits: number): string {
  return value
    .replace(/\d+/, (m) => m.padStart(digits, '0'))
    .replace(/\d/g, '0')
}

// ── The page clock (widgetPages.ts nextTurn, one window) ───────────

export function planAll(
  widgets: ReadonlyArray<DemoPageWidget>,
  barWidth: number,
  edgeWidth = 0,
): Map<string, WidgetPlan<DemoItem>> {
  const content = contentWidth(barWidth, edgeWidth)
  return new Map(
    widgets.map((w) => [
      w.tab,
      planWidget(w.items, (i) => i.tier, columnsFor(content, w.minCol)),
    ]),
  )
}

export interface Turn {
  seq: number
  tab: string
  page: number
  dwell: number
}

export interface Nav {
  visit: Array<number>
  k: number
  cursors: Map<string, number>
}

export function newNav(): Nav {
  return { visit: [], k: 0, cursors: new Map() }
}

/** The next turn. Mutates `nav`. Null when there is nothing to show. */
export function nextTurn(
  prev: Turn | null,
  widgets: ReadonlyArray<DemoPageWidget>,
  plans: ReadonlyMap<string, WidgetPlan<DemoItem>>,
  nav: Nav,
): Turn | null {
  if (widgets.length === 0) return null
  let tab = prev?.tab ?? ''
  const plan = plans.get(tab)
  const nextInVisit = nav.visit[nav.k + 1] as number | undefined
  if (
    prev &&
    plan &&
    nextInVisit !== undefined &&
    nextInVisit < plan.pages.length
  ) {
    nav.k += 1
  } else {
    // Next widget, found by name, so one appearing or leaving never skips another.
    const at = widgets.findIndex((w) => w.tab === tab)
    tab = widgets[prev && at >= 0 ? (at + 1) % widgets.length : 0].tab
    return visitTurn(prev, tab, plans, nav)
  }
  const page = nav.visit[nav.k]
  return {
    seq: prev.seq + 1,
    tab,
    page,
    dwell: dwellFor(plan.pages[page].length),
  }
}

/**
 * Start a visit to `tab` now. The site only: a widget switched on in the
 * catalog picker is shown straight away ("watch the bar change"); the app
 * has no picker beside its bar and always waits its turn.
 */
export function visitTurn(
  prev: Turn | null,
  tab: string,
  plans: ReadonlyMap<string, WidgetPlan<DemoItem>>,
  nav: Nav,
): Turn | null {
  const plan = plans.get(tab)
  if (!plan || plan.pages.length === 0) return null
  const v = visitPages(
    plan.pages.length,
    nav.cursors.get(tab) ?? plan.sticky,
    plan.sticky,
  )
  nav.cursors.set(tab, v.next)
  nav.visit = v.pages
  nav.k = 0
  const page = nav.visit[0]
  return {
    seq: (prev?.seq ?? 0) + 1,
    tab,
    page,
    dwell: dwellFor(plan.pages[page].length),
  }
}

// ── Colour (cells/parts.tsx, utils/chipAccent.ts) ──────────────────

const L_FLOOR = 0.6
const S_FLOOR = 0.55
const LUM_DARK = 60

/** A brand colour lifted so a tint of it shows on the dark bar. */
export function liftForTint(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
  if (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 >= LUM_DARK) return hex
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  if (l < L_FLOOR) l = L_FLOOR
  if (s < S_FLOOR) s = S_FLOOR
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return (
    '#' +
    [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

/** The widget's own colour, lifted on dark; grey when there is none. */
export function accentFor(hex: string | undefined, dark: boolean): string {
  if (!hex) return 'var(--fg-3)'
  return dark ? liftForTint(hex) : hex
}

/** `--accent` at `pct`% over whatever is behind it. */
export function mix(pct: number): string {
  return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`
}
