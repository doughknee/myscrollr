/**
 * Widget pages arithmetic (SCROLLR-270, ported from the SCROLLR-268 prototype).
 * Pure functions and types only: no React, no DOM, no clock. The page engine
 * (SCROLLR-272), the cells (SCROLLR-271) and the browser checks (SCROLLR-276)
 * all share this file, so every number the bar uses lives here.
 *
 * A page is ONE widget laid across the bar in EQUAL columns that fill the
 * width. The column count comes from the width and the kind, never from the
 * content, so a score change cannot move a cell.
 *
 * Interfaces defined here (the contract for the other pieces):
 *
 *  - WIDTHS. Every width in this file is in CSS pixels. `barWidth` is the full
 *    width of the ticker window. `contentWidth(barWidth, edgeWidth)` is what is
 *    left for columns after the label block (LABEL_W), the pager (PAGER_W) and the fixed edge zone
 *    (`edgeWidth`, 0 until the edge zone ships). `columnsFor` takes the CONTENT
 *    width. Height does not enter: comfort mode changes the row height, not how
 *    many columns fit.
 *  - MINIMUM COLUMN. The caller always passes the cell family's own minimum
 *    width (`gameMinCol(league)`, `QUOTE_MIN_COL`, `NEWS_MIN_COL`,
 *    `ALSO_MIN_COL` in ./cells). Those exports are the one source of truth;
 *    this file holds no per-kind defaults to disagree with them.
 *  - ITEMS. A page holds opaque items `T`. The caller supplies `tierOf(item)`
 *    (the SCROLLR-267 importance ladder below) and `keyOf(item)` (a stable id:
 *    game id, symbol, article url) for freezing.
 *  - ORDER. `planWidget` sorts by tier, STABLY: inside a tier the caller's own
 *    order is kept (soonest kick-off, newest headline), so give it the source
 *    order. The ladder has no per-score ranking on purpose: closeness changes
 *    with every score and would reshuffle a page (it is shown as a tint).
 *  - VISITS. Every widget shows exactly ONE page per lap, then the bar moves
 *    on; its cursor continues on the next lap (SCROLLR-297, `nextTurn`). The
 *    ladder only orders: tier 0 (live, yours) fills page 1, so it comes round
 *    first after a wrap, but it is not on every lap.
 *  - FREEZE. A page on screen is a `FrozenPage`: its keys and their order are
 *    fixed at swipe-in; later data only updates values in place.
 */

export type PageKind = "sports" | "news" | "finance" | "clock" | "weather" | "quiet";

// ── Importance ladder (SCROLLR-267) ────────────────────────────────

/**
 * One ladder for the whole bar, lowest number first:
 *  0 live:   live games, alerts, favourite teams, watchlist symbols
 *  1 fresh:  headlines < 2 h old, games starting within 3 h
 *  2 recent: games later today, results < 18 h, headlines 2-6 h old
 *  3 quiet:  fixtures > 1 day out, headlines 6-48 h old
 *  4 status: "NBA - off-season" (one chip, only when nothing else)
 */
export const TIER = { live: 0, fresh: 1, recent: 2, quiet: 3, status: 4 } as const;
export type Tier = (typeof TIER)[keyof typeof TIER];

// ── Columns ────────────────────────────────────────────────────────

/** Width of the label block on the left of every page. */
export const LABEL_W = 112;

/**
 * Width of the pager at the bar's left end, before the label, `‹ 7/23 ›`
 * (SCROLLR-298, SCROLLR-300): two 22px arrows
 * around a counter reserved for `99/99` at 12px mono.
 */
export const PAGER_W = 88;

/** Width left for columns once the label, the pager and the edge zone are taken. */
export function contentWidth(barWidth: number, edgeWidth = 0): number {
  return Math.max(0, barWidth - LABEL_W - PAGER_W - edgeWidth);
}

/**
 * Columns of at least `minCol` px that fit `contentW` (never fewer than one).
 * `minCol` is the cell family's exported minimum (see the header).
 */
export function columnsFor(contentW: number, minCol: number): number {
  return Math.max(1, Math.floor(contentW / minCol));
}

// ── Pages ──────────────────────────────────────────────────────────

/**
 * Split an ordered list into the fewest pages of at most `cols`, evenly: page
 * sizes differ by at most one, larger pages first, so there is never a lonely
 * one-item last page (14 at 12 columns is 7 + 7; 56 at 5 is 8x5 + 4x4).
 * Order is kept, so what the caller ranked first is page 1.
 */
export function paginate<T>(items: readonly T[], cols: number): T[][] {
  if (items.length === 0) return [];
  const pages = Math.ceil(items.length / Math.max(1, Math.floor(cols)));
  const base = Math.floor(items.length / pages);
  const extra = items.length % pages;
  const out: T[][] = [];
  let at = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < extra ? 1 : 0);
    out.push(items.slice(at, at + size));
    at += size;
  }
  return out;
}

/**
 * Every page is full (SCROLLR-292). `items` (the widget's own pool, ranked)
 * is topped up from `fill` (what lies past the horizon, in its own order)
 * until the last page has as many items as there are columns: a short pool
 * gains exactly the empty columns and never a whole extra page, so the
 * visit rule and the lap are unchanged. With no fill left the pool stays
 * short, and paginate's even split (or a short page, PagedBar) takes over.
 */
export function topUp<T>(items: readonly T[], fill: readonly T[], cols: number): T[] {
  const c = Math.max(1, Math.floor(cols));
  const want = Math.max(1, Math.ceil(items.length / c)) * c;
  return [...items, ...fill.slice(0, Math.max(0, want - items.length))];
}

export interface WidgetPlan<T> {
  /** Items split into pages, tier order kept. */
  pages: T[][];
}

/** Rank by tier (stable) and split at `cols`. */
export function planWidget<T>(
  items: readonly T[],
  tierOf: (item: T) => Tier,
  cols: number,
): WidgetPlan<T> {
  const ranked = items
    .map((item, i) => ({ item, i, t: tierOf(item) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  return { pages: paginate(ranked.map((r) => r.item), cols) };
}

/** Seconds a page holds: longer for a fuller page, within 6..12 s. */
export function dwellFor(itemsOnPage: number): number {
  return Math.min(12, Math.max(6, 3 + itemsOnPage * 0.75));
}

// ── Freeze ─────────────────────────────────────────────────────────

/**
 * A page on screen. `keys` (which items, in what order) is fixed when the page
 * swipes in; `latest` holds the newest value seen for each key. Data updates go
 * through `refreshPage` and change values only, so a game turning close or a
 * new headline never re-sorts or re-columns a page being read. An item that
 * drops out of the pool keeps its last value until the page leaves.
 */
export interface FrozenPage<T> {
  readonly keys: readonly string[];
  readonly latest: ReadonlyMap<string, T>;
}

export function freezePage<T>(page: readonly T[], keyOf: (item: T) => string): FrozenPage<T> {
  return {
    keys: page.map(keyOf),
    latest: new Map(page.map((item) => [keyOf(item), item])),
  };
}

/** Fold in fresh data: values update in place, keys and order never change. */
export function refreshPage<T>(
  frozen: FrozenPage<T>,
  pool: readonly T[],
  keyOf: (item: T) => string,
): FrozenPage<T> {
  const latest = new Map(frozen.latest);
  for (const item of pool) {
    const k = keyOf(item);
    if (latest.has(k)) latest.set(k, item);
  }
  return { keys: frozen.keys, latest };
}

/** The items to draw, in frozen order. */
export function pageItems<T>(frozen: FrozenPage<T>): T[] {
  return frozen.keys.map((k) => frozen.latest.get(k) as T);
}
