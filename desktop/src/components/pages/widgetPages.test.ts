import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game } from "../../types";
import { isLive } from "../../utils/gameHelpers";
import fixture from "../../dev/__fixtures__/dashboard.pages.json";
import busy from "../../dev/__fixtures__/dashboard.busy.json";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_MIN_COL } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { ALSO_MIN_COL } from "./cells/AlsoCell";
import { MAX_PAGES_PER_VISIT, dwellFor } from "./pagePlan";
import { ALSO_TAB, buildPageWidgets, followPage, newNav, nextTurn, planAll, type PageWidget, type Turn } from "./widgetPages";

const dash = fixture as unknown as DashboardResponse;
const NOW = Date.parse(fixture._captured_at);
const TABS = (fixture.widgets as { widget_type: string }[]).map((w) => w.widget_type);

describe("buildPageWidgets", () => {
  const widgets = buildPageWidgets(dash, ["clock", ...TABS], NOW);

  it("one widget per data widget in ticker order, utilities left to the edge zone, quiet ones on one Also page last", () => {
    expect(widgets.map((w) => w.tab)).toEqual(["sports_nfl", "finance_stocks", "finance_crypto", "news_bbc", "news_npr", ALSO_TAB]);
    const also = widgets.at(-1)!;
    expect(also.items.map((i) => (i.data as { tab: string }).tab)).toEqual(["sports_premierleague"]);
    expect((also.items[0].data as { text: string }).text).toMatch(/^next match /);
  });

  it("every widget takes its cell family's minimum column", () => {
    const min = Object.fromEntries(widgets.map((w) => [w.tab, w.minCol]));
    expect(min).toEqual({
      sports_nfl: gameMinCol("NFL"),
      finance_stocks: QUOTE_MIN_COL,
      finance_crypto: QUOTE_MIN_COL,
      news_bbc: NEWS_MIN_COL,
      news_npr: NEWS_MIN_COL,
      [ALSO_TAB]: ALSO_MIN_COL,
    });
    const ncaa = buildPageWidgets(busy as unknown as DashboardResponse, ["sports_ncaaf"], Date.parse(busy._captured_at));
    expect(ncaa[0].minCol).toBe(gameMinCol("NCAAF"));
    expect(ncaa[0].minCol).toBeGreaterThan(gameMinCol("NFL"));
  });

  it("sports: yours first, then live, both live tier; the rest after; every game pinnable by its home team", () => {
    const nfl = widgets[0];
    const games = nfl.items.map((i) => i.data as Game);
    const mine = nfl.items.filter((i) => i.mine);
    expect(mine.length).toBeGreaterThan(0);
    expect(nfl.items.slice(0, mine.length)).toEqual(mine);
    const firstNotLive = nfl.items.findIndex((i) => i.tier !== 0);
    expect(nfl.items.slice(0, firstNotLive).every((i) => i.mine || isLive(i.data as Game))).toBe(true);
    expect(games.slice(firstNotLive).some(isLive)).toBe(false);
    expect(JSON.parse(nfl.items[0].pin!)).toMatchObject({ widget: "sports_nfl", subject: games[0].home_team_name });
    expect(nfl.sub).toMatch(/^\d+ LIVE$/);
  });

  it("before the dashboard is in, no Also page (nothing is known yet)", () => {
    expect(buildPageWidgets(null, TABS, NOW)).toEqual([]);
  });
});

describe("nextTurn", () => {
  const widgets = buildPageWidgets(dash, TABS, NOW);
  const plans = planAll(widgets, 1280);

  function run(n: number, ws: PageWidget[] = widgets) {
    const nav = newNav();
    const turns: Turn[] = [];
    let t: Turn | null = null;
    for (let i = 0; i < n; i++) {
      t = nextTurn(t, ws, planAll(ws, 1280), nav);
      turns.push(t!);
    }
    return turns;
  }

  it("each widget gets one visit (its sticky pages, then two more), then the next widget, then around again", () => {
    const turns = run(60);
    expect(turns.map((t) => t.seq)).toEqual(turns.map((_, i) => i + 1));
    // Group consecutive turns into visits.
    const visits: { tab: string; pages: number[] }[] = [];
    for (const t of turns) {
      const last = visits.at(-1);
      if (last?.tab === t.tab) last.pages.push(t.page);
      else visits.push({ tab: t.tab, pages: [t.page] });
    }
    const order = widgets.map((w) => w.tab);
    visits.forEach((v, i) => expect(v.tab).toBe(order[i % order.length]));
    for (const v of visits.slice(0, -1)) {
      const plan = plans.get(v.tab)!;
      expect(v.pages.slice(0, plan.sticky)).toEqual([...Array(plan.sticky).keys()]);
      expect(v.pages.length).toBe(Math.min(plan.pages.length, plan.sticky + MAX_PAGES_PER_VISIT - 1));
    }
  });

  it("a page holds dwellFor its size, 6..12 s", () => {
    for (const t of run(30)) {
      expect(t.dwell).toBe(dwellFor(plans.get(t.tab)!.pages[t.page].length));
      expect(t.dwell).toBeGreaterThanOrEqual(6);
      expect(t.dwell).toBeLessThanOrEqual(12);
    }
  });

  it("a widget that leaves mid-visit: the next turn starts over at the first widget", () => {
    const nav = newNav();
    const t1 = nextTurn(null, widgets, plans, nav)!;
    const without = widgets.filter((w) => w.tab !== t1.tab);
    const t2 = nextTurn(t1, without, planAll(without, 1280), nav)!;
    expect(t2.tab).toBe(without[0].tab);
    expect(t2.seq).toBe(2);
  });

  it("nothing to show, no turn", () => {
    expect(nextTurn(null, [], new Map(), newNav())).toBeNull();
  });
});

describe("followPage", () => {
  it("same count: the same page; different width: the same share of the way through", () => {
    expect(followPage({ page: 2, pages: 5 }, 5)).toBe(2);
    expect(followPage({ page: 4, pages: 5 }, 3)).toBe(2);
    expect(followPage({ page: 1, pages: 2 }, 6)).toBe(3);
    expect(followPage({ page: 3, pages: 4 }, 1)).toBe(0);
    expect(followPage({ page: 0, pages: 3 }, 0)).toBe(0);
  });
});
