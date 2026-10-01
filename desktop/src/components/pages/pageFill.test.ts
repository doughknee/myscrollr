import { describe, expect, it } from "vitest";
import type { DashboardResponse, Game, RssItem, Trade } from "../../types";
import thursday from "../../dev/__fixtures__/dashboard.nflthursday.json";
import googl from "../../dev/__fixtures__/dashboard.googl.json";
import sparse from "../../dev/__fixtures__/dashboard.sparsenews.json";
import market from "../../dev/__fixtures__/market.json";
import { selectFinanceFill } from "../../datawidgets/finance/view";
import { selectRssFill } from "../../datawidgets/rss/view";
import { topUp } from "./pagePlan";
import { buildPageWidgets, labelFact, planAll } from "./widgetPages";

/** SCROLLR-292: every page is full. */

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

describe("sports: a Thursday NFL slate", () => {
  const now = at(thursday);
  const [nfl] = buildPageWidgets(asDash(thursday), ["sports_nfl"], now);
  const plan = planAll([nfl], 1920).get("sports_nfl")!;

  it("page 1 is tonight's game plus Sunday's, one game per column", () => {
    expect(nfl.items).toHaveLength(1);
    expect(plan.cols).toBe(8);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]).toHaveLength(8);
    const keys = plan.pages[0].map((i) => i.key);
    expect(keys).toContain(nfl.items[0].key);
    const kicks = plan.pages[0].map((i) => Date.parse((i.data as Game).start_time));
    expect(kicks.every((t) => t > now && t <= now + 7 * 864e5)).toBe(true);
  });

  it("the ladder holds for the fill: your team first (on every visit), then soonest kick-off", () => {
    const [first, ...rest] = plan.pages[0];
    expect(first.mine).toBe(true);
    expect(first.tier).toBe(0);
    expect(plan.sticky).toBe(1);
    // Tonight's game (inside the horizon) leads the rest, then Sunday in kick-off order.
    expect(rest[0].key).toBe(nfl.items[0].key);
    const others = rest.map((i) => Date.parse((i.data as Game).start_time));
    expect(others).toEqual([...others].sort((a, b) => a - b));
    expect(rest.every((i) => !i.mine)).toBe(true);
  });

  it("a narrower bar needs fewer, and the widest pool is never repeated", () => {
    const narrow = planAll([nfl], 1280).get("sports_nfl")!;
    expect(narrow.pages.flat()).toHaveLength(narrow.cols);
    const ids = plan.pages.flat().map((i) => i.key);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("news: older headlines fill a quiet page", () => {
  const now = at(sparse);
  const rows = sparse.data.rss as unknown as RssItem[];

  it("the fill is the 48 h floor, newest first", () => {
    const ages = selectRssFill(rows, now).map((r) => (now - Date.parse(r.published_at!)) / 36e5);
    expect(ages.length).toBe(7);
    expect(Math.max(...ages)).toBeLessThanOrEqual(48);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });

  it("two fresh headlines and four columns: the page is four headlines, newest first", () => {
    const [bbc] = buildPageWidgets(asDash(sparse), ["news_bbc"], now);
    expect(bbc.items).toHaveLength(2);
    const plan = planAll([bbc], 1920).get("news_bbc")!;
    expect(plan.cols).toBe(4);
    const shown = plan.pages.flat().map((i) => Date.parse((i.data as RssItem).published_at!));
    expect(shown).toHaveLength(4);
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
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
