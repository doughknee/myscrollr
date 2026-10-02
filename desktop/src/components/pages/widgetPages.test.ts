import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game, RssItem } from "../../types";
import { isLive } from "../../utils/gameHelpers";
import fixture from "../../dev/__fixtures__/dashboard.pages.json";
import busy from "../../dev/__fixtures__/dashboard.busy.json";
import npr from "../../dev/__fixtures__/dashboard.npr.json";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_MIN_COL } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { ALSO_MIN_COL } from "./cells/AlsoCell";
import { dwellFor } from "./pagePlan";
import { ALSO_TAB, buildPageWidgets, followPage, newNav, nextTurn, planAll, stepTurn, type PageWidget, type Turn } from "./widgetPages";

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

  it("every widget shows exactly one page per lap, then the next widget; its pages run 1, 2 ... N, 1 (SCROLLR-297)", () => {
    const turns = run(widgets.length * 20);
    expect(turns.map((t) => t.seq)).toEqual(turns.map((_, i) => i + 1));
    const order = widgets.map((w) => w.tab);
    turns.forEach((t, i) => expect(t.tab).toBe(order[i % order.length]));
    for (const tab of order) {
      const n = plans.get(tab)!.pages.length;
      const pages = turns.filter((t) => t.tab === tab).map((t) => t.page);
      expect(pages).toEqual(pages.map((_, i) => i % n));
    }
    // The fixture has a multi-page widget led by live and yours: page 1 holds them, and it is not on every lap.
    const nfl = plans.get("sports_nfl")!;
    expect(nfl.pages.length).toBeGreaterThan(1);
    expect(nfl.pages[0][0].tier).toBe(0);
  });

  it("a page holds dwellFor its size, 6..12 s", () => {
    for (const t of run(30)) {
      expect(t.dwell).toBe(dwellFor(plans.get(t.tab)!.pages[t.page].length));
      expect(t.dwell).toBeGreaterThanOrEqual(6);
      expect(t.dwell).toBeLessThanOrEqual(12);
    }
  });

  it("a widget that leaves: the next turn starts over at the first widget", () => {
    const nav = newNav();
    const t1 = nextTurn(null, widgets, plans, nav)!;
    const without = widgets.filter((w) => w.tab !== t1.tab);
    const t2 = nextTurn(t1, without, planAll(without, 1280), nav)!;
    expect(t2.tab).toBe(without[0].tab);
    expect(t2.seq).toBe(2);
  });

  it("the cursor survives refreshes and re-plans: rebuilt from fresh data every turn, a feed still continues where it left off (SCROLLR-293)", () => {
    const nav = newNav();
    let t: Turn | null = null;
    const seen: [number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const d = structuredClone(npr) as unknown as DashboardResponse;
      const rss = d.data.rss as RssItem[];
      if (i >= 4) rss.unshift({ ...rss[0], id: 1, guid: "new" }); // a new headline from visit 5 on
      const ws = buildPageWidgets(d, ["news_npr"], Date.parse(npr._captured_at));
      t = nextTurn(t, ws, planAll(ws, 1920), nav);
      seen.push([t!.seq, t!.page]);
    }
    expect(seen).toEqual([[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 7], [9, 0]]);
  });

  it("nothing to show, no turn", () => {
    expect(nextTurn(null, [], new Map(), newNav())).toBeNull();
  });
});

describe("stepTurn (SCROLLR-298)", () => {
  const widgets = buildPageWidgets(dash, TABS, NOW);
  const plans = planAll(widgets, 1280);
  // Reading order: every page of every widget, in ticker order.
  const flat = widgets.flatMap((w) => plans.get(w.tab)!.pages.map((_, p) => `${w.tab}:${p}`));
  const key = (t: Turn) => `${t.tab}:${t.page}`;

  it("forward walks every page of every widget in reading order and wraps; back walks it in reverse", () => {
    const nav = newNav();
    let t = nextTurn(null, widgets, plans, nav)!;
    const fwd = [key(t)];
    for (let i = 0; i < flat.length; i++) fwd.push(key((t = stepTurn(t, 1, widgets, plans, nav)!)));
    expect(fwd).toEqual([...flat, flat[0]]);
    const back = [key(t)];
    for (let i = 0; i < flat.length; i++) back.push(key((t = stepTurn(t, -1, widgets, plans, nav)!)));
    expect(back).toEqual([flat[0], ...[...flat].reverse()]);
  });

  it("back from a widget's first page is the previous widget's last page", () => {
    const tab = widgets[1].tab;
    const onSecond: Turn = { seq: 5, tab, page: 0, pages: plans.get(tab)!.pages.length, dwell: 6 };
    const back = stepTurn(onSecond, -1, widgets, plans, newNav())!;
    expect(back.tab).toBe(widgets[0].tab);
    expect(back.page).toBe(plans.get(widgets[0].tab)!.pages.length - 1);
  });

  it("a step is a new turn with its page's dwell; the clock then moves on to the next widget and the widget's next turn continues after it", () => {
    const ws = buildPageWidgets(npr as unknown as DashboardResponse, ["news_npr", ...TABS], Date.parse(npr._captured_at));
    const ps = planAll(ws, 1920);
    const nav = newNav();
    let t = nextTurn(null, ws, ps, nav)!; // NPR 1
    t = stepTurn(t, 1, ws, ps, nav)!; // NPR 2
    t = stepTurn(t, 1, ws, ps, nav)!; // NPR 3, read by hand
    expect([t.tab, t.page, t.seq]).toEqual(["news_npr", 2, 3]);
    expect(t.dwell).toBe(dwellFor(ps.get("news_npr")!.pages[2].length));
    t = nextTurn(t, ws, ps, nav)!;
    expect(t.tab).not.toBe("news_npr");
    while (t.tab !== "news_npr") t = nextTurn(t, ws, ps, nav)!;
    expect(t.page, "NPR's next turn continues after the page read by hand").toBe(3);
  });

  it("nothing up yet: the first turn; nothing to show: no turn", () => {
    expect(key(stepTurn(null, 1, widgets, plans, newNav())!)).toBe(flat[0]);
    expect(stepTurn(null, -1, [], new Map(), newNav())).toBeNull();
  });

  it("a whole-widget jump (SCROLLR-301): forward to the next widget's next page, back to the previous widget's last-shown page, wrapping both ways", () => {
    const ws = buildPageWidgets(dash, TABS, NOW);
    const ps = planAll(ws, 1920);
    const tabs = ws.map((w) => w.tab);
    const nav = newNav();
    let t = nextTurn(null, ws, ps, nav)!; // first widget, page 1
    t = stepTurn(t, 1, ws, ps, nav, true)!;
    expect([t.tab, t.page, t.back]).toEqual([tabs[1], 0, undefined]);
    t = stepTurn(t, -1, ws, ps, nav, true)!;
    expect([t.tab, t.page, t.back], "down then up: back on the page you were reading, swiped in from the left").toEqual([tabs[0], 0, true]);
    t = stepTurn(t, -1, ws, ps, nav, true)!;
    const last = tabs.at(-1)!;
    expect([t.tab, t.page], "back from the first widget wraps to the last, at its last page (not up yet)").toEqual([last, ps.get(last)!.pages.length - 1]);
    t = stepTurn(t, 1, ws, ps, nav, true)!;
    expect(t.tab, "forward wraps to the first").toBe(tabs[0]);
    expect(t.page, "at the page after the one already read").toBe(1 % ps.get(tabs[0])!.pages.length);
  });
});

describe("planAll with the pager hidden (SCROLLR-301)", () => {
  it("gives the pager's 88px to the columns", () => {
    const ws = buildPageWidgets(dash, TABS, NOW);
    // 1920: at 1280 the 160px label (SCROLLR-301) leaves 3 NFL columns either way.
    const on = planAll(ws, 1920, 102);
    const off = planAll(ws, 1920, 102, false);
    expect(on.get("sports_nfl")!.cols).toBe(5);
    expect(off.get("sports_nfl")!.cols, "1920 with the Clock: 6 NFL columns again").toBe(6);
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
