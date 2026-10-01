import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game, RssItem, Trade } from "../../types";
import thursday from "../../dev/__fixtures__/dashboard.nflthursday.json";
import googl from "../../dev/__fixtures__/dashboard.googl.json";
import sparse from "../../dev/__fixtures__/dashboard.sparsenews.json";
import npr from "../../dev/__fixtures__/dashboard.npr.json";
import market from "../../dev/__fixtures__/market.json";
import { selectFinanceFill } from "../../datawidgets/finance/view";
import { topUp } from "./pagePlan";
import { buildPageWidgets, labelFact, planAll } from "./widgetPages";

/** SCROLLR-292: every page is full. SCROLLR-293: sports and news fill from their whole pool, so only a short watchlist takes a fill. */

const asDash = (f: unknown) => f as DashboardResponse;
const at = (f: { _captured_at: string }) => Date.parse(f._captured_at);
const quotes = market.trades as unknown as Trade[];

describe("topUp", () => {
  const fill = ["a", "b", "c", "d", "e", "f"];

  it("gives a short pool exactly its empty columns, never a whole extra page", () => {
    expect(topUp<number | string>([1, 2], fill, 4)).toEqual([1, 2, "a", "b"]);
    expect(topUp<number | string>([1, 2, 3, 4, 5], fill, 4)).toEqual([1, 2, 3, 4, 5, "a", "b", "c"]);
  });

  it("leaves a full pool alone and a pool with nothing to fill from short", () => {
    expect(topUp<number | string>([1, 2, 3, 4], fill, 4)).toEqual([1, 2, 3, 4]);
    expect(topUp<number | string>([1, 2], [], 4)).toEqual([1, 2]);
    expect(topUp<number | string>([1, 2], ["a"], 4)).toEqual([1, 2, "a"]);
  });
});

describe("sports: the whole week, as the widget page shows it (SCROLLR-293)", () => {
  const now = at(thursday);
  const [nfl] = buildPageWidgets(asDash(thursday), ["sports_nfl"], now);
  const plan = planAll([nfl], 1920).get("sports_nfl")!;

  it("every game in the week is in the pool: TNF, Sunday and MNF, nothing to fill", () => {
    expect(nfl.items).toHaveLength(thursday.data.sports.length);
    expect(nfl.fill).toEqual([]);
    expect(plan.cols).toBe(8);
    expect(plan.pages.map((p) => p.length)).toEqual([8, 8]);
  });

  it("the ladder: your team first (on every visit), then tonight, then soonest kick-off", () => {
    const [first, ...rest] = plan.pages.flat();
    expect(first.mine).toBe(true);
    expect(first.tier).toBe(0);
    expect(plan.sticky).toBe(1);
    expect(rest[0].key).toBe("g:10097632"); // TNF tonight
    const kicks = rest.map((i) => Date.parse((i.data as Game).start_time));
    expect(kicks).toEqual([...kicks].sort((a, b) => a - b));
  });

  it("a narrower bar has more pages of the same pool, none repeated", () => {
    const narrow = planAll([nfl], 1280).get("sports_nfl")!;
    expect(narrow.pages.flat()).toHaveLength(nfl.items.length);
    const ids = narrow.pages.flat().map((i) => i.key);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads no display prefs: a one-day window on the widget page does not shrink the bar", () => {
    const d = structuredClone(thursday) as unknown as DashboardResponse;
    (d.widgets![0].config as Record<string, unknown>).display = { daysBack: 0, daysAhead: 0 };
    expect(buildPageWidgets(d, ["sports_nfl"], now)[0].items).toHaveLength(nfl.items.length);
  });
});

describe("news: every headline the widget holds (SCROLLR-293)", () => {
  it("a quiet feed shows all of it, past the old 6 h window and 48 h floor, newest first", () => {
    const now = at(sparse);
    const [bbc] = buildPageWidgets(asDash(sparse), ["news_bbc"], now);
    expect(bbc.items).toHaveLength(sparse.data.rss.length);
    expect(bbc.fill).toEqual([]);
    const shown = planAll([bbc], 1920).get("news_bbc")!.pages.flat().map((i) => Date.parse((i.data as RssItem).published_at!));
    expect(shown).toHaveLength(sparse.data.rss.length);
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
    expect((now - Math.min(...shown)) / 36e5).toBeGreaterThan(48);
  });

  it("30 NPR headlines are 8 pages at 1920, nothing sticky, so visits run 1, 2, 3 ... 8, 1", () => {
    const [w] = buildPageWidgets(asDash(npr), ["news_npr"], at(npr));
    const plan = planAll([w], 1920).get("news_npr")!;
    expect(plan.pages.map((p) => p.length)).toEqual([4, 4, 4, 4, 4, 4, 3, 3]);
    expect(plan.sticky).toBe(0);
  });
});

describe("finance: popular symbols fill a short watchlist", () => {
  const now = at(googl);
  const withWatchlist = (symbols: string[]) => {
    const d = structuredClone(googl) as unknown as DashboardResponse;
    d.widgets![0].config = { asset_class: "stock", symbols };
    d.data.finance = quotes.filter((q) => symbols.includes(q.symbol));
    return d;
  };

  it("GOOGL alone: GOOGL first, the rest popular stocks, never GOOGL twice, never a coin", () => {
    const [w] = buildPageWidgets(asDash(googl), ["finance_stocks"], now, [], quotes);
    const plan = planAll([w], 1920).get("finance_stocks")!;
    const page = plan.pages[0];
    expect(plan.pages).toHaveLength(1);
    expect(page).toHaveLength(plan.cols);
    expect((page[0].data as Trade).symbol).toBe("GOOGL");
    const syms = page.map((i) => (i.data as Trade).symbol);
    expect(new Set(syms).size).toBe(syms.length);
    expect(syms.some((s) => s.includes("/"))).toBe(false);
    expect(page.slice(1).every((i) => i.fill && !i.pin)).toBe(true);
    expect(labelFact(w, plan)).toBe(`+${plan.cols - 1} POPULAR`);
  });

  it("each symbol the user adds pushes one fill out", () => {
    const one = planAll(buildPageWidgets(asDash(googl), ["finance_stocks"], now, [], quotes), 1920).get("finance_stocks")!;
    const two = buildPageWidgets(asDash(withWatchlist(["GOOGL", "MSFT"])), ["finance_stocks"], now, [], quotes);
    const plan = planAll(two, 1920).get("finance_stocks")!;
    const syms = plan.pages[0].map((i) => (i.data as Trade).symbol);
    expect(syms.slice(0, 2).sort()).toEqual(["GOOGL", "MSFT"]);
    expect(syms.filter((s) => s === "MSFT")).toHaveLength(1);
    expect(plan.pages[0]).toHaveLength(one.pages[0].length);
    expect(plan.pages[0].filter((i) => i.fill)).toHaveLength(one.pages[0].filter((i) => i.fill).length - 1);
  });

  it("a watchlist as long as a page takes no fill, and neither does one longer than it", () => {
    const syms = ["GOOGL", "AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "META", "SPY", "QQQ", "AVGO", "NFLX", "AMD"];
    const plan = planAll(buildPageWidgets(asDash(withWatchlist(syms)), ["finance_stocks"], now, [], quotes), 1920).get("finance_stocks")!;
    expect(plan.cols).toBe(10);
    expect(plan.pages.flat().every((i) => !i.fill)).toBe(true);
    expect(plan.pages.map((p) => p.length)).toEqual([6, 6]);
  });

  it("with no market yet, a short watchlist is just itself", () => {
    const [w] = buildPageWidgets(asDash(googl), ["finance_stocks"], now);
    expect(w.fill).toEqual([]);
    expect(planAll([w], 1920).get("finance_stocks")!.pages[0]).toHaveLength(1);
  });

  it("the fill is the widget's own asset class: crypto fills with coins", () => {
    const syms = selectFinanceFill(quotes, ["BTC/USD"], [], "crypto").map((t) => t.symbol);
    expect(syms.length).toBeGreaterThan(5);
    expect(syms.every((s) => s.includes("/"))).toBe(true);
    expect(syms).not.toContain("BTC/USD");
  });

  it("the widget's starter list comes first, then the popular list", () => {
    const syms = selectFinanceFill(quotes, [], ["NVDA", "AAPL"], "stock").map((t) => t.symbol);
    expect(syms.slice(0, 2)).toEqual(["NVDA", "AAPL"]);
    expect(syms[2]).toBe("MSFT");
  });
});

describe("a widget with fewer items than a page, after filling", () => {
  it("stays one short page (PagedBar draws it at a full page's column width, left-aligned)", () => {
    const d = structuredClone(thursday) as unknown as DashboardResponse;
    d.data.sports = (d.data.sports as Game[]).sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 2);
    const [w] = buildPageWidgets(d, ["sports_nfl"], at(thursday));
    const plan = planAll([w], 1920).get("sports_nfl")!;
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].length).toBeLessThan(plan.cols);
  });
});
