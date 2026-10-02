import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game, RssItem } from "../../types";
import { isLive } from "../../utils/gameHelpers";
import fixture from "../../dev/__fixtures__/dashboard.pages.json";
import busy from "../../dev/__fixtures__/dashboard.busy.json";
import npr from "../../dev/__fixtures__/dashboard.npr.json";
import gh from "../../dev/__fixtures__/github.prs.json";
import type { GitHubChipData } from "../../types";
import { GITHUB_BAR_DEFAULTS, pagePRs, type GitHubPagePR, type GitHubRepo } from "../../widgets/github/types";
import { PR_MIN_COL } from "./cells/PRCell";
import { gameMinCol } from "./cells/GameCell";
import { NEWS_MIN_COL } from "./cells/NewsCell";
import { QUOTE_MIN_COL } from "./cells/QuoteCell";
import { ALSO_MIN_COL } from "./cells/AlsoCell";
import { dwellFor } from "./pagePlan";
import { ALSO_TAB, buildPageWidgets, chip, followPage, newNav, nextTurn, planAll, stepTurn, usMarketOpen, type PageWidget, type Turn } from "./widgetPages";

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

describe("stepTurn (SCROLLR-298, SCROLLR-303)", () => {
  const widgets = buildPageWidgets(dash, TABS, NOW);
  const plans = planAll(widgets, 1280);
  const key = (t: Turn) => `${t.tab}:${t.page}`;
  const multi = widgets.find((w) => plans.get(w.tab)!.pages.length >= 3)!;
  const pages = plans.get(multi.tab)!.pages.length;
  const on = (page: number): Turn => ({ seq: 5, tab: multi.tab, page, pages, dwell: 6 });

  it("‹ › turn this widget's page, then read on into the next widget's first page (back: the previous one's last)", () => {
    const nav = newNav();
    let t = on(0);
    const fwd = [];
    for (let i = 0; i < pages - 1; i++) fwd.push((t = stepTurn(t, { dir: 1 }, widgets, plans, nav)!).page);
    expect(fwd).toEqual([...Array(pages - 1).keys()].map((i) => i + 1));
    expect(t.tab).toBe(multi.tab);
    const at = widgets.indexOf(multi);
    const next = widgets[(at + 1) % widgets.length];
    t = stepTurn(t, { dir: 1 }, widgets, plans, nav)!;
    expect([t.tab, t.page, t.back], "past the last page: the next widget, page 1").toEqual([next.tab, 0, undefined]);
    const before = widgets[(at - 1 + widgets.length) % widgets.length];
    t = stepTurn(on(0), { dir: -1 }, widgets, plans, nav)!;
    expect([t.tab, t.page, t.back], "back from page 1: the previous widget's last page, swiped in from the left").toEqual([before.tab, plans.get(before.tab)!.pages.length - 1, true]);
  });

  it("a page turn on a one-page widget reads on to the next widget; alone, a one-page widget is nothing, a many-page one wraps", () => {
    const one = widgets.find((w) => plans.get(w.tab)!.pages.length === 1)!;
    const t = stepTurn({ seq: 1, tab: one.tab, page: 0, pages: 1, dwell: 6 }, { dir: 1 }, widgets, plans, newNav())!;
    expect(t.tab).toBe(widgets[(widgets.indexOf(one) + 1) % widgets.length].tab);
    expect(stepTurn({ seq: 1, tab: one.tab, page: 0, pages: 1, dwell: 6 }, { dir: 1 }, [one], plans, newNav())).toBeNull();
    expect(stepTurn(on(pages - 1), { dir: 1 }, [multi], plans, newNav())!.page, "one widget: wraps inside").toBe(0);
    expect(stepTurn(on(0), { dir: 1, whole: true }, [multi], plans, newNav())).toBeNull();
  });

  it("a turn is a new turn with its page's dwell; the clock then moves on to the next widget and the widget's next turn continues after it", () => {
    const ws = buildPageWidgets(npr as unknown as DashboardResponse, ["news_npr", ...TABS], Date.parse(npr._captured_at));
    const ps = planAll(ws, 1920);
    const nav = newNav();
    let t = nextTurn(null, ws, ps, nav)!; // NPR 1
    t = stepTurn(t, { dir: 1 }, ws, ps, nav)!; // NPR 2
    t = stepTurn(t, { dir: 1 }, ws, ps, nav)!; // NPR 3, read by hand
    expect([t.tab, t.page, t.seq]).toEqual(["news_npr", 2, 3]);
    expect(t.dwell).toBe(dwellFor(ps.get("news_npr")!.pages[2].length));
    t = nextTurn(t, ws, ps, nav)!;
    expect(t.tab).not.toBe("news_npr");
    while (t.tab !== "news_npr") t = nextTurn(t, ws, ps, nav)!;
    expect(t.page, "NPR's next turn continues after the page read by hand").toBe(3);
  });

  it("a pill shows that page, back when it is before this one; the sender's count maps by share", () => {
    const nav = newNav();
    const t = stepTurn(on(2), { page: 0, of: pages }, widgets, plans, nav)!;
    expect([t.tab, t.page, t.back]).toEqual([multi.tab, 0, true]);
    expect(stepTurn(on(0), { page: 2, of: pages }, widgets, plans, nav)!.back).toBeUndefined();
    expect(stepTurn(on(0), { page: 0, of: pages }, widgets, plans, nav), "the lit pill is nothing").toBeNull();
    expect(stepTurn(on(0), { page: 1, of: 2 }, widgets, plans, nav)!.page, "half way on the sender is half way here").toBe(Math.floor(pages / 2));
  });

  it("nothing up yet: the first turn; nothing to show: no turn", () => {
    expect(key(stepTurn(null, { dir: 1 }, widgets, plans, newNav())!)).toBe(`${widgets[0].tab}:0`);
    expect(stepTurn(null, { dir: -1 }, [], new Map(), newNav())).toBeNull();
  });

  it("˄ ˅ (SCROLLR-301): forward to the next widget's next page, back to the previous widget's last-shown page, wrapping both ways", () => {
    const ws = buildPageWidgets(dash, TABS, NOW);
    const ps = planAll(ws, 1920);
    const tabs = ws.map((w) => w.tab);
    const nav = newNav();
    let t = nextTurn(null, ws, ps, nav)!; // first widget, page 1
    t = stepTurn(t, { dir: 1, whole: true }, ws, ps, nav)!;
    expect([t.tab, t.page, t.back]).toEqual([tabs[1], 0, undefined]);
    t = stepTurn(t, { dir: -1, whole: true }, ws, ps, nav)!;
    expect([t.tab, t.page, t.back], "down then up: back on the page you were reading, swiped in from the left").toEqual([tabs[0], 0, true]);
    t = stepTurn(t, { dir: -1, whole: true }, ws, ps, nav)!;
    const last = tabs.at(-1)!;
    expect([t.tab, t.page], "back from the first widget wraps to the last, at its last page (not up yet)").toEqual([last, ps.get(last)!.pages.length - 1]);
    t = stepTurn(t, { dir: 1, whole: true }, ws, ps, nav)!;
    expect(t.tab, "forward wraps to the first").toBe(tabs[0]);
    expect(t.page, "at the page after the one already read").toBe(1 % ps.get(tabs[0])!.pages.length);
  });

  it("an edge-bar segment jumps the shortest way round: forward lands on the next page, back on the last shown", () => {
    const tabs = widgets.map((w) => w.tab);
    expect(tabs.length).toBe(6);
    const nav = newNav();
    const first = nextTurn(null, widgets, plans, nav)!;
    const fwd = stepTurn(first, { tab: tabs[2] }, widgets, plans, nav)!;
    expect([fwd.tab, fwd.page, fwd.back]).toEqual([tabs[2], 0, undefined]);
    const back = stepTurn(first, { tab: tabs[5] }, widgets, plans, nav)!;
    expect([back.tab, back.back], "five ahead is one behind: a jump back").toEqual([tabs[5], true]);
    expect(stepTurn(first, { tab: tabs[0] }, widgets, plans, nav), "the widget already up").toBeNull();
  });
});

describe("chip (SCROLLR-303)", () => {
  const widgets = buildPageWidgets(dash, TABS, NOW);
  const nfl = widgets.find((w) => w.tab === "sports_nfl")!;
  // Thursday 1 Oct 2026: 14:00 ET is 18:00 UTC; Saturday 3 Oct is a weekend.
  const OPEN = Date.parse("2026-10-01T18:00:00Z");
  const CLOSED = Date.parse("2026-10-01T21:30:00Z");
  const WEEKEND = Date.parse("2026-10-03T18:00:00Z");

  it("sports: red, counting the games live now; nothing when none is", () => {
    const live = nfl.items.filter((i) => isLive(i.data as Game)).length;
    expect(live).toBeGreaterThan(0);
    expect(chip(nfl)).toEqual({ kind: "live", count: live });
    expect(chip({ ...nfl, items: nfl.items.filter((i) => !isLive(i.data as Game)) })).toBeNull();
  });

  it("finance: open in US regular hours, no count; never for crypto", () => {
    const stocks = widgets.find((w) => w.tab === "finance_stocks")!;
    const crypto = widgets.find((w) => w.tab === "finance_crypto")!;
    expect(usMarketOpen(OPEN)).toBe(true);
    expect(usMarketOpen(Date.parse("2026-10-01T13:29:00Z")), "09:29 ET").toBe(false);
    expect(usMarketOpen(Date.parse("2026-10-01T13:30:00Z")), "09:30 ET").toBe(true);
    expect(usMarketOpen(CLOSED)).toBe(false);
    expect(usMarketOpen(WEEKEND)).toBe(false);
    expect(chip(stocks, OPEN)).toEqual({ kind: "open" });
    expect(chip(stocks, CLOSED)).toBeNull();
    expect(chip(crypto, OPEN)).toBeNull();
  });

  it("news: the stories published in the last hour", () => {
    const bbc = widgets.find((w) => w.tab === "news_bbc")!;
    const at = (i: number) => Date.parse((bbc.items[i].data as RssItem).published_at!);
    const newest = Math.max(...bbc.items.map((_, i) => at(i)));
    expect(chip(bbc, newest + 1000)?.kind).toBe("fresh");
    const n = bbc.items.filter((_, i) => newest + 1000 - at(i) < 3_600_000).length;
    expect(chip(bbc, newest + 1000)).toEqual({ kind: "fresh", count: n });
    expect(chip(bbc, newest + 2 * 3_600_000)).toBeNull();
  });

  it("the Also page has none", () => {
    expect(chip(widgets.at(-1)!)).toBeNull();
  });
});

describe("column counts with the band (SCROLLR-303)", () => {
  it("1920 with the Clock: one more NFL column than with the pager; 1280 loses nothing", () => {
    const ws = buildPageWidgets(dash, TABS, NOW);
    expect(planAll(ws, 1920, 102).get("sports_nfl")!.cols, "1920 - 192 - 102 = 1626: 6 (5 with the 88px pager)").toBe(6);
    expect(planAll(ws, 1280, 102).get("sports_nfl")!.cols, "1280 - 192 - 102 = 986: 3, as before").toBe(3);
    expect(planAll(ws, 1280).get("sports_nfl")!.cols, "1280 bare: 1088, 4 (3 with the pager)").toBe(4);
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

describe("the GitHub page (SCROLLR-309)", () => {
  const repos = gh.repos as unknown as GitHubRepo[];
  const chips = (bar = GITHUB_BAR_DEFAULTS, quiet = false) =>
    repos.map((r) => ({ id: `github-${r.owner}/${r.repo}`, label: r.repo, status: "success", workflowName: "CI", page: pagePRs(r, bar, quiet) }) as GitHubChipData);
  const page = (bar = GITHUB_BAR_DEFAULTS, quiet = false) => buildPageWidgets(null, ["clock", "github"], NOW, [], [], chips(bar, quiet));
  const nums = (w: PageWidget) => w.items.map((i) => (i.data as GitHubPagePR).number);

  it("a column per PR that needs you across every repo: review requests, then changes requested, then failing checks", () => {
    const [w] = page();
    expect(w).toMatchObject({ tab: "github", kind: "github", code: "GITHUB", minCol: PR_MIN_COL });
    expect(nums(w)).toEqual([478, 212, 479, 215]);
    expect(chip(w)).toEqual({ kind: "needs", count: 4 });
  });

  it("'My other open PRs' adds yours after them; the band's count stays the needs-you count", () => {
    const [w] = page({ ...GITHUB_BAR_DEFAULTS, otherPRs: true });
    expect(nums(w)).toEqual([478, 212, 479, 215, 480, 220]);
    expect(chip(w)).toEqual({ kind: "needs", count: 4 });
    // The ladder keeps the order: planWidget sorts by tier, needs you before the rest.
    const plan = planAll([w], 1920, 0).get("github")!;
    expect(plan.pages.flat().map((i) => (i.data as GitHubPagePR).number)).toEqual([478, 212, 479, 215, 480, 220]);
  });

  it("nothing needing you, or quiet hours: no page and no Also entry", () => {
    expect(page({ ...GITHUB_BAR_DEFAULTS, reviews: false, changes: false, failingChecks: false })).toEqual([]);
    expect(page(GITHUB_BAR_DEFAULTS, true)).toEqual([]);
    expect(buildPageWidgets(null, ["github"], NOW)).toEqual([]);
  });

  it("columns of at least PR_MIN_COL at 1280 and 1920", () => {
    const [w] = page();
    for (const width of [1280, 1920]) {
      const plan = planAll([w], width, 300).get("github")!;
      expect((width - 192 - 300) / plan.cols, `@${width}`).toBeGreaterThanOrEqual(PR_MIN_COL);
    }
  });
});
