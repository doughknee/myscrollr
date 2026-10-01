/**
 * What the pages bar shows, and in what order (SCROLLR-272, design SCROLLR-268).
 * No React here: PagedBar renders what these functions decide.
 *
 *  - `buildPageWidgets` turns the dashboard into one entry per widget, using
 *    the ticker's own selectors (the same horizons, floors and sort the chips
 *    use). Widgets with nothing to show share ONE "Also" page at the end,
 *    each saying why with its status chip's words (CHIP_SPEC §8.7).
 *  - `planAll` splits every widget into pages at a bar width, with the
 *    widget's own cell minimum (the cells' exports are the only source of
 *    column widths).
 *  - `nextTurn` is the page clock's step: the next page of this visit, or
 *    the next widget's first visit page. Only the primary ticker window runs
 *    it; the others follow its turns (PagedBar).
 */
import type { DashboardResponse, Game, RssItem, Trade } from "../../types";
import type { TickerContext } from "../../datawidgets/ticker";
import { dropPinned, scopedRows } from "../../datawidgets/ticker";
import type { WidgetPin } from "../../preferences";
import { TICKER_SOURCES } from "../../datawidgets/tickerRegistry";
import { getSportsDisplayConfig, selectSportsForTicker } from "../../datawidgets/sports/view";
import { selectRssForTicker } from "../../datawidgets/rss/view";
import { selectFinanceForTicker } from "../../datawidgets/finance/view";
import { catalogItemById, sourceForWidget } from "../../marketplace";
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
  visitPages,
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
}

export interface PageWidget {
  /** Widget id (sports_nfl, news_bbc, finance_stocks), or "also". */
  tab: string;
  kind: PageWidgetKind;
  /** The label's name: "NFL", "BBC", "STOCKS", "ALSO". */
  code: string;
  /** The label's one fact: "6 LIVE", "SUN 4 OCT", "▲6 ▼4", "HEADLINES". */
  sub: string;
  /** Catalog colour; `accentFor` turns it into `--accent`. */
  hex?: string;
  /** Narrowest column, from the cell family (never a local default). */
  minCol: number;
  items: PageItem[];
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
  return TIER.recent; // a result inside the ticker's 18 h window
}

function newsTier(item: RssItem, now: number): Tier {
  const h = (now - Date.parse(item.published_at ?? item.created_at)) / HOUR;
  return h < 2 ? TIER.fresh : h < 6 ? TIER.recent : TIER.quiet;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const mon = d.toLocaleDateString(undefined, { month: "short" });
  return `${wd} ${d.getDate()} ${mon}`.toUpperCase();
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
    const ctx = { tab, source, dashboard, chipColorMode: "widget", pinnedSubjects } as TickerContext;
    let pinnedAll = false;
    const config = dashboard?.widgets?.find((w) => w.widget_type === tab)?.config as
      | { favoriteTeams?: Record<string, { teamName?: string }>; leagues?: string[]; symbols?: string[] }
      | undefined;

    let widget: PageWidget | null = null;
    if (source === "sports") {
      const rows = scopedRows<Game>(raw, ctx);
      const pool = selectSportsForTicker(rows, getSportsDisplayConfig(dashboard, tab), now);
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
        const liveCount = ordered.filter(isLive).length;
        widget = {
          tab, kind: "sports", hex,
          code: leagueCode(league),
          sub: liveCount ? `${liveCount} LIVE` : dayLabel(ordered[0].start_time),
          minCol: gameMinCol(leagueCode(ordered[0].league)),
          items: ordered.map((g) => ({
            key: `g:${g.id}`,
            tier: gameTier(g, isMine(g), now),
            data: g,
            mine: isMine(g),
            // As on the chip: the home team is the subject a right-click offers.
            pin: pinOf(tab, g.home_team_name, teamShortName(g.league, g.home_team_name)),
          })),
        };
      }
    } else if (source === "rss") {
      const rows = scopedRows<RssItem>(raw, ctx);
      const pool = selectRssForTicker(rows, now);
      const items = dropPinned(pool, ctx, (r) => r.feed_url);
      pinnedAll = pool.length > 0 && items.length === 0;
      if (items.length) {
        widget = {
          tab, kind: "news", hex,
          code: sourceTab(rows[0]?.source_name ?? cat?.name ?? tab).split(" ")[0],
          sub: "HEADLINES",
          minCol: NEWS_MIN_COL,
          items: items.map((r) => ({
            key: `n:${r.id}`,
            tier: newsTier(r, now),
            data: r,
            pin: pinOf(tab, r.feed_url, r.source_name),
          })),
        };
      }
    } else if (source === "finance") {
      const listed = new Set(config?.symbols ?? []);
      const pool = selectFinanceForTicker(scopedRows<Trade>(raw, ctx), config?.symbols ?? []);
      const items = dropPinned(pool, ctx, (t) => t.symbol);
      pinnedAll = pool.length > 0 && items.length === 0;
      if (items.length) {
        const up = items.filter((t) => !(Number(t.percentage_change) < 0)).length;
        widget = {
          tab, kind: "finance", hex,
          code: (cat?.name ?? tab).toUpperCase(),
          sub: `▲${up}  ▼${items.length - up}`,
          minCol: QUOTE_MIN_COL,
          // Watchlist first in the user's order. Not "live" tier: a long
          // watchlist takes turns like any other widget instead of putting
          // every one of its pages on every visit (the prototype's rule).
          items: items.map((t) => ({
            key: `f:${t.symbol}`,
            tier: listed.has(t.symbol) ? TIER.fresh : TIER.recent,
            data: t,
            pin: pinOf(tab, t.symbol, t.symbol),
          })),
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
    out.push({ tab: ALSO_TAB, kind: "also", code: "ALSO", sub: "NOTHING ON", minCol: ALSO_MIN_COL, items: also });
  }
  return out;
}

/** Every widget's pages at this bar width. `edgeWidth` is the fixed edge zone's measured width (0 when it is empty). */
export function planAll(widgets: readonly PageWidget[], barWidth: number, edgeWidth = 0): Map<string, WidgetPlan<PageItem>> {
  const content = contentWidth(barWidth, edgeWidth);
  return new Map(widgets.map((w) => [w.tab, planWidget(w.items, (i) => i.tier, columnsFor(content, w.minCol))]));
}

/**
 * One page turn, as the primary window broadcasts it. A window whose own
 * width gives this widget a different page count maps `page` onto its own
 * pages (`followPage`), so every window shows the same widget and swipes on
 * the same beat.
 */
export interface Turn {
  seq: number;
  tab: string;
  /** Page index in the leader's plan. */
  page: number;
  /** The leader's page count for this widget. */
  pages: number;
  /** Seconds this page holds (before any hover). */
  dwell: number;
}

/** Where the leader is inside a visit, and each widget's rotation cursor. */
export interface Nav {
  visit: number[];
  k: number;
  cursors: Map<string, number>;
}

export function newNav(): Nav {
  return { visit: [], k: 0, cursors: new Map() };
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
  let tab = prev?.tab ?? "";
  let plan = plans.get(tab);
  const nextInVisit = nav.visit[nav.k + 1];
  if (prev && plan && nextInVisit !== undefined && nextInVisit < plan.pages.length) {
    nav.k += 1;
  } else {
    // Next widget, found by name so a widget appearing or leaving never
    // skips one. A widget that left: start over from the first.
    const at = widgets.findIndex((w) => w.tab === tab);
    tab = widgets[prev && at >= 0 ? (at + 1) % widgets.length : 0].tab;
    plan = plans.get(tab);
    if (!plan || plan.pages.length === 0) return null;
    const v = visitPages(plan.pages.length, nav.cursors.get(tab) ?? plan.sticky, plan.sticky);
    nav.cursors.set(tab, v.next);
    nav.visit = v.pages;
    nav.k = 0;
  }
  const page = nav.visit[nav.k];
  return {
    seq: (prev?.seq ?? 0) + 1,
    tab,
    page,
    pages: plan!.pages.length,
    dwell: dwellFor(plan!.pages[page].length),
  };
}

/** This window's page for a turn: the same index when the counts agree, else the same share of the way through. */
export function followPage(turn: Pick<Turn, "page" | "pages">, ownPages: number): number {
  if (ownPages <= 0) return 0;
  if (ownPages === turn.pages) return turn.page;
  return Math.min(ownPages - 1, Math.floor((turn.page * ownPages) / Math.max(1, turn.pages)));
}
