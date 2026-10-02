/**
 * What the pages bar shows, and in what order (SCROLLR-272, design SCROLLR-268).
 * No React here: PagedBar renders what these functions decide.
 *
 *  - `buildPageWidgets` turns the dashboard into one entry per widget, from
 *    the same pool the app's widget page shows (no ticker horizon, SCROLLR-293)
 *    in the ticker's own order and with no display prefs. Widgets with nothing to show share ONE "Also" page at the end,
 *    each saying why with its status chip's words (CHIP_SPEC §8.7).
 *  - `planAll` splits every widget into pages at a bar width, with the
 *    widget's own cell minimum (the cells' exports are the only source of
 *    column widths).
 *  - `nextTurn` is the page clock's step: the next widget, at its next page
 *    (one page per widget per lap, SCROLLR-297). Only the primary ticker
 *    window runs it; the others follow its turns (PagedBar). `stepTurn` is a
 *    manual move (wheel, keypad, keys, a pill or an edge-bar segment) on the
 *    same clock (SCROLLR-298, SCROLLR-303).
 *  - `chip` is the band's "something is happening now" mark (SCROLLR-303).
 */
import type { DashboardResponse, Game, RssItem, Trade } from "../../types";
import type { TickerContext } from "../../datawidgets/ticker";
import { dropPinned, scopedRows } from "../../datawidgets/ticker";
import type { WidgetPin } from "../../preferences";
import { TICKER_SOURCES } from "../../datawidgets/tickerRegistry";
import { TICKER_FINAL_HOURS, selectSportsForPages } from "../../datawidgets/sports/view";
import { selectRssForPages } from "../../datawidgets/rss/view";
import { selectFinanceFill, selectFinanceForTicker } from "../../datawidgets/finance/view";
import { addConfigForWidget, assetClassForWidget, catalogItemById, sourceForWidget } from "../../marketplace";
import { isLive, isPre, leagueCode } from "../../utils/gameHelpers";
import { teamShortName } from "../../utils/teamShortName";
import { sourceTab } from "../../utils/rssText";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_MIN_COL } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { ALSO_MIN_COL } from "./cells/AlsoCell";
import {
  TIER,
  columnsFor,
  contentWidth,
  dwellFor,
  planWidget,
  topUp,
  type Tier,
  type WidgetPlan,
} from "./pagePlan";

export type PageWidgetKind = "sports" | "news" | "finance" | "also";

/** One quiet widget on the Also page. */
export interface AlsoItem {
  tab: string;
  code: string;
  text: string;
  hex?: string;
}

/** One cell's worth of data, with what the engine needs to freeze and pin it. */
export interface PageItem {
  /** Stable across refetches: game id, article id, symbol, widget id. */
  key: string;
  tier: Tier;
  data: Game | RssItem | Trade | AlsoItem;
  /** One of the user's favourite teams is playing (GameCell's top line). */
  mine?: boolean;
  /** `data-pin-subject` JSON for the right-click menu (utils/pinTarget). */
  pin?: string;
  /** Not the user's own: a popular symbol filling a short watchlist's page (SCROLLR-292). */
  fill?: boolean;
}

export interface PageWidget {
  /** Widget id (sports_nfl, news_bbc, finance_stocks), or "also". */
  tab: string;
  kind: PageWidgetKind;
  /** The band's name: "NFL", "BBC", "STOCKS", "ALSO". */
  code: string;
  /** Catalog colour; `accentFor` turns it into `--accent`. */
  hex?: string;
  /** Narrowest column, from the cell family (never a local default). */
  minCol: number;
  items: PageItem[];
  /**
   * What may fill the last page's empty columns, in order (SCROLLR-292): the
   * next games, older headlines, popular symbols. `planAll` takes only as
   * many as the bar's width leaves empty.
   */
  fill: PageItem[];
}

export const ALSO_TAB = "also";

const HOUR = 3_600_000;

function pinOf(widget: string, subject: string, label: string): string {
  return JSON.stringify({ widget, subject, label });
}

/** Ladder for a game (pagePlan's SCROLLR-267 tiers). */
function gameTier(g: Game, mine: boolean, now: number): Tier {
  if (mine || isLive(g)) return TIER.live;
  if (isPre(g)) {
    const h = (Date.parse(g.start_time) - now) / HOUR;
    if (h <= 3) return TIER.fresh;
    return new Date(g.start_time).toDateString() === new Date(now).toDateString() ? TIER.recent : TIER.quiet;
  }
  // A result inside the ticker's 18 h window is recent; an older one (the
  // widget page still shows yesterday's) trails after every fixture.
  const ago = (now - Date.parse(g.start_time)) / HOUR;
  return ago > TICKER_FINAL_HOURS ? TIER.quiet : TIER.recent;
}

function newsTier(item: RssItem, now: number): Tier {
  const h = (now - Date.parse(item.published_at ?? item.created_at)) / HOUR;
  return h < 2 ? TIER.fresh : h < 6 ? TIER.recent : TIER.quiet;
}

/**
 * Every widget on the ticker as a page widget, in ticker order, then one
 * Also widget for the quiet ones. Utilities (clock, weather, …) are not
 * pages: they live on the fixed edge zone (EdgeZone). So do pinned
 * subjects, which leave the pages (`dropPinned`, CHIP_SPEC §8.5) so each is
 * on the bar once; a widget whose every item is pinned says nothing.
 */
export function buildPageWidgets(
  dashboard: DashboardResponse | null,
  activeTabs: readonly string[],
  now: number = Date.now(),
  pins: readonly WidgetPin[] = [],
  /** Every tracked symbol's latest quote (`/finance/public`), for a short watchlist's fills. */
  market: readonly Trade[] = [],
): PageWidget[] {
  const out: PageWidget[] = [];
  const also: PageItem[] = [];

  for (const tab of activeTabs) {
    const source = sourceForWidget(tab);
    const tickerSource = source ? TICKER_SOURCES[source] : undefined;
    if (!source || !tickerSource) continue; // a utility, or a source this client cannot draw
    const raw = dashboard?.data?.[source];
    const cat = catalogItemById(tab);
    const hex = cat?.hex;
    const pinnedSubjects = new Set(pins.filter((p) => p.widget === tab).map((p) => p.subject));
    const ctx = { tab, source, dashboard, pinnedSubjects } as TickerContext;
    let pinnedAll = false;
    const config = dashboard?.widgets?.find((w) => w.widget_type === tab)?.config as
      | { favoriteTeams?: Record<string, { teamName?: string }>; leagues?: string[]; symbols?: string[] }
      | undefined;

    let widget: PageWidget | null = null;
    if (source === "sports") {
      const rows = scopedRows<Game>(raw, ctx);
      // Everything the widget page shows by default (§P.4a, SCROLLR-293).
      const pool = selectSportsForPages(rows, now);
      const eligible = dropPinned(pool, ctx, (g) => [g.home_team_name, g.away_team_name]);
      pinnedAll = pool.length > 0 && eligible.length === 0;
      if (eligible.length) {
        const favs = new Set(Object.values(config?.favoriteTeams ?? {}).map((f) => f?.teamName).filter(Boolean));
        const isMine = (g: Game) => favs.has(g.home_team_name) || favs.has(g.away_team_name);
        // Yours first, then every other live game, both in kick-off order:
        // closeness changes with every score and would reshuffle a page (it
        // is shown as a tint). Then the ticker's own order.
        const byKick = (a: Game, b: Game) => a.start_time.localeCompare(b.start_time) || Number(a.id) - Number(b.id);
        const mine = eligible.filter(isMine).sort(byKick);
        const live = eligible.filter((g) => isLive(g) && !isMine(g)).sort(byKick);
        const rest = eligible.filter((g) => !isLive(g) && !isMine(g));
        const ordered = [...mine, ...live, ...rest];
        const league = config?.leagues?.[0] ?? ordered[0].league;
        const item = (g: Game, tier: Tier): PageItem => ({
          key: `g:${g.id}`,
          tier,
          data: g,
          mine: isMine(g),
          // As on the chip: the home team is the subject a right-click offers.
          pin: pinOf(tab, g.home_team_name, teamShortName(g.league, g.home_team_name)),
        });
        widget = {
          tab, kind: "sports", hex,
          code: leagueCode(league),
          minCol: gameMinCol(leagueCode(ordered[0].league)),
          items: ordered.map((g) => item(g, gameTier(g, isMine(g), now))),
          fill: [], // the pool is already the whole week
        };
      }
    } else if (source === "rss") {
      const rows = scopedRows<RssItem>(raw, ctx);
      const pool = selectRssForPages(rows);
      const items = dropPinned(pool, ctx, (r) => r.feed_url);
      pinnedAll = pool.length > 0 && items.length === 0;
      if (items.length) {
        const item = (r: RssItem, tier: Tier): PageItem => ({ key: `n:${r.id}`, tier, data: r, pin: pinOf(tab, r.feed_url, r.source_name) });
        widget = {
          tab, kind: "news", hex,
          code: sourceTab(rows[0]?.source_name ?? cat?.name ?? tab).split(" ")[0],
          minCol: NEWS_MIN_COL,
          items: items.map((r) => item(r, newsTier(r, now))),
          fill: [], // the pool is already every headline the widget holds
        };
      }
    } else if (source === "finance") {
      const listed = new Set(config?.symbols ?? []);
      const pool = selectFinanceForTicker(scopedRows<Trade>(raw, ctx), config?.symbols ?? []);
      const items = dropPinned(pool, ctx, (t) => t.symbol);
      pinnedAll = pool.length > 0 && items.length === 0;
      // A short watchlist's empty columns: popular symbols, never one of the
      // user's, never added to the watchlist, never pinnable (not theirs).
      const starters = addConfigForWidget(tab)?.symbols;
      const popular = Array.isArray(raw) && !pinnedAll
        ? selectFinanceFill(market, pool.map((t) => t.symbol).concat(config?.symbols ?? []), Array.isArray(starters) ? (starters as string[]) : [], assetClassForWidget(tab))
        : [];
      if (items.length || popular.length) {
        widget = {
          tab, kind: "finance", hex,
          code: (cat?.name ?? tab).toUpperCase(),
          minCol: QUOTE_MIN_COL,
          // Watchlist first in the user's order. Not "live" tier: that is
          // for live games and your team.
          items: items.map((t) => ({
            key: `f:${t.symbol}`,
            tier: listed.has(t.symbol) ? TIER.fresh : TIER.recent,
            data: t,
            pin: pinOf(tab, t.symbol, t.symbol),
          })),
          fill: popular.map((t) => ({ key: `f:${t.symbol}`, tier: TIER.quiet, data: t, fill: true })),
        };
      }
    }
    if (widget) {
      out.push(widget);
      continue;
    }
    // Nothing on: the same words the status chip would say, once the
    // dashboard is in and the source answered (CHIP_SPEC §8.7).
    if (pinnedAll || !dashboard || !Array.isArray(raw)) continue;
    const st = tickerSource.status
      ? tickerSource.status(raw, ctx)
      : { tab: sourceTab(cat?.name ?? tab), text: "nothing to show right now" };
    if (st) {
      also.push({ key: `q:${tab}`, tier: TIER.status, data: { tab, code: st.tab, text: st.text, hex } });
    }
  }

  if (also.length) {
    out.push({ tab: ALSO_TAB, kind: "also", code: "ALSO", minCol: ALSO_MIN_COL, items: also, fill: [] });
  }
  return out;
}

/** A widget's pages at this bar width, how many columns a full page has, and how many items it could have shown. */
export interface PagePlan extends WidgetPlan<PageItem> {
  cols: number;
  /** Its own items plus every fill it may use: a single page holds `min(cols, avail)` (the browser checks assert it). */
  avail: number;
}

/**
 * Every widget's pages at this bar width. `edgeWidth` is the fixed edge
 * zone's measured width (0 when it is empty). Every page is full
 * (SCROLLR-292): the pool is topped up from the widget's fill until the last
 * page has a column for every item.
 */
export function planAll(widgets: readonly PageWidget[], barWidth: number, edgeWidth = 0): Map<string, PagePlan> {
  const content = contentWidth(barWidth, edgeWidth);
  return new Map(
    widgets.map((w) => {
      const cols = columnsFor(content, w.minCol);
      // Popular symbols fill a watchlist SHORTER than a page, never the tail of a long one
      // (10 symbols at 9 columns are two pages of 5, not 9 of yours and 1 of yours + 8 of theirs).
      const fill = w.kind === "finance" && w.items.length >= cols ? [] : w.fill;
      return [w.tab, { ...planWidget(topUp(w.items, fill, cols), (i) => i.tier, cols), cols, avail: w.items.length + fill.length }];
    }),
  );
}

/** The band's chip (SCROLLR-303): something is happening now. `live` games (counted), the stock market `open`, `fresh` stories (the last hour's, counted). */
export interface Chip {
  kind: "live" | "open" | "fresh";
  count?: number;
}

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/**
 * US regular trading hours, 09:30 to 16:00 ET, Monday to Friday.
 * ponytail: no exchange holidays (a holiday shows the chip); read a market-status feed if that matters.
 */
export function usMarketOpen(now: number): boolean {
  const p = Object.fromEntries(ET.formatToParts(now).map((x) => [x.type, x.value]));
  const m = Number(p.hour) * 60 + Number(p.minute);
  return p.weekday !== "Sat" && p.weekday !== "Sun" && m >= 570 && m < 960;
}

/**
 * The chip, or null when nothing is happening. Sports: games live now.
 * Finance: the US market is open (never for crypto). News: stories published in
 * the last hour (the honest "new since you looked" needs a last-seen
 * timestamp; the hour stands in for it).
 */
export function chip(widget: PageWidget, now: number = Date.now()): Chip | null {
  switch (widget.kind) {
    case "sports": {
      const count = widget.items.filter((i) => isLive(i.data as Game)).length;
      return count ? { kind: "live", count } : null;
    }
    case "finance":
      return assetClassForWidget(widget.tab) !== "crypto" && usMarketOpen(now) ? { kind: "open" } : null;
    case "news": {
      const count = widget.items.filter((i) => {
        const r = i.data as RssItem;
        return now - Date.parse(r.published_at ?? r.created_at) < HOUR;
      }).length;
      return count ? { kind: "fresh", count } : null;
    }
    default:
      return null;
  }
}

/**
 * One page turn, as the primary window broadcasts it. A window whose own
 * width gives this widget a different page count maps `page` onto its own
 * pages (`followPage`), so every window shows the same widget and swipes on
 * the same beat.
 */
export interface Turn {
  /** Counts turns; a visit is one page of one widget (SCROLLR-297), so the page publishes it as `data-visit` for the browser checks. */
  seq: number;
  tab: string;
  /** Page index in the leader's plan. */
  page: number;
  /** The leader's page count for this widget. */
  pages: number;
  /** Seconds this page holds (before any hover). */
  dwell: number;
  /** A manual step back: the page swipes in from the left (SCROLLR-300). Absent on every other turn. */
  back?: true;
}

/** Each widget's next page: the leader's rotation cursors. */
export interface Nav {
  cursors: Map<string, number>;
}

export function newNav(): Nav {
  return { cursors: new Map() };
}

/**
 * The next turn. Mutates `nav` (it is the leader's private clock state).
 * Null when there is nothing to show.
 */
export function nextTurn(
  prev: Turn | null,
  widgets: readonly PageWidget[],
  plans: ReadonlyMap<string, WidgetPlan<PageItem>>,
  nav: Nav,
): Turn | null {
  if (widgets.length === 0) return null;
  // Next widget, found by name so a widget appearing or leaving never
  // skips one. A widget that left: start over from the first.
  const at = widgets.findIndex((w) => w.tab === prev?.tab);
  const tab = widgets[prev && at >= 0 ? (at + 1) % widgets.length : 0].tab;
  const plan = plans.get(tab);
  if (!plan || plan.pages.length === 0) return null;
  // One page, then the bar moves on; the cursor wraps on the current count,
  // so a re-plan that adds or drops a page never sends the widget back to 1.
  const page = (nav.cursors.get(tab) ?? 0) % plan.pages.length;
  nav.cursors.set(tab, (page + 1) % plan.pages.length);
  return {
    seq: (prev?.seq ?? 0) + 1,
    tab,
    page,
    pages: plan.pages.length,
    dwell: dwellFor(plan.pages[page].length),
  };
}

/**
 * A manual move (SCROLLR-303's band): `dir` turns this widget's page (‹ ›,
 * ←/→, the wheel), or with `whole` a widget (˄ ˅, ↑/↓, Shift+wheel); `tab`
 * jumps to a widget the shortest way round (an edge-bar segment); `page` shows
 * this widget's page `page` of `of` (a pill; `of` is the sender's count, so a
 * follower of another width lands on the same share of the way through).
 */
export type Move = { dir: 1 | -1; whole?: boolean } | { tab: string } | { page: number; of: number };

/**
 * A manual move (SCROLLR-298, SCROLLR-303). Mutates `nav`: an immediate turn
 * plus a move of that widget's cursor to the page after the one shown, so the
 * clock's next turn moves on to the next widget and the widget's next turn
 * does not show that page again. Null when there is nothing to move to (a page
 * turn on a one-page widget, a widget change with one widget).
 *
 * A page turn stays in the widget and wraps inside it; the lap's order is
 * unchanged. A widget change lands forward on the widget's next page (what the
 * clock would show it next) and back on the page it showed last (its last page
 * if it has not been up yet), so ↓ then ↑ returns to what you were reading.
 */
export function stepTurn(
  prev: Turn | null,
  move: Move,
  widgets: readonly PageWidget[],
  plans: ReadonlyMap<string, WidgetPlan<PageItem>>,
  nav: Nav,
): Turn | null {
  if (!prev) return nextTurn(prev, widgets, plans, nav);
  const land = (tab: string, page: number, pages: number, back: boolean): Turn => {
    nav.cursors.set(tab, (page + 1) % pages);
    const t: Turn = { seq: prev.seq + 1, tab, page, pages, dwell: dwellFor(plans.get(tab)!.pages[page].length) };
    if (back) t.back = true;
    return t;
  };
  const at = widgets.findIndex((w) => w.tab === prev.tab);

  if ("page" in move || ("dir" in move && !move.whole)) {
    const n = plans.get(prev.tab)?.pages.length ?? 0;
    if (at < 0 || n === 0) return null;
    // The plan may have changed since the turn (a refresh, a resize): the same share of the way through.
    const cur = followPage(prev, n);
    const page = "page" in move ? followPage({ page: move.page, pages: move.of }, n) : (cur + move.dir + n) % n;
    if (page === cur) return null;
    return land(prev.tab, page, n, "page" in move ? page < cur : move.dir < 0);
  }

  const count = widgets.length;
  if (count === 0) return null;
  let to: number;
  let back: boolean;
  if ("tab" in move) {
    to = widgets.findIndex((w) => w.tab === move.tab);
    if (to < 0) return null;
    const delta = (((to - Math.max(0, at)) % count) + count) % count;
    back = at >= 0 && delta > count / 2;
  } else {
    to = at < 0 ? 0 : (at + move.dir + count) % count;
    back = move.dir < 0;
  }
  const tab = widgets[to].tab;
  const n = plans.get(tab)?.pages.length ?? 0;
  if (tab === prev.tab || n === 0) return null;
  const cursor = nav.cursors.get(tab) ?? 0;
  return land(tab, back ? (cursor - 1 + n) % n : cursor % n, n, back);
}

/** This window's page for a turn: the same index when the counts agree, else the same share of the way through. */
export function followPage(turn: Pick<Turn, "page" | "pages">, ownPages: number): number {
  if (ownPages <= 0) return 0;
  if (ownPages === turn.pages) return turn.page;
  return Math.min(ownPages - 1, Math.floor((turn.page * ownPages) / Math.max(1, turn.pages)));
}
