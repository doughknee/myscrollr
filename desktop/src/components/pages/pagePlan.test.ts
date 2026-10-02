import { describe, expect, it } from "vitest";
import {
  LABEL_W,
  PAGER_W,
  TIER,
  columnsFor,
  contentWidth,
  dwellFor,
  freezePage,
  pageItems,
  paginate,
  planWidget,
  refreshPage,
  type Tier,
} from "./pagePlan";

// The cell families' minimums (cells/*: quote, game US-pro, game other, also, news).
const MINS = [172, 212, 244, 300, 400];
const range = (n: number) => [...Array(n).keys()];

describe("columns", () => {
  it("come from the content width and the family's minimum", () => {
    expect(columnsFor(1920 - LABEL_W, 212)).toBe(8);
    expect(columnsFor(1280 - LABEL_W, 400)).toBe(2);
    expect(columnsFor(0, 172)).toBe(1);
    expect(contentWidth(1920, 300)).toBe(1920 - LABEL_W - PAGER_W - 300);
    expect(contentWidth(50)).toBe(0);
  });

  it("every width 1280..3440 fits its columns, never starves them, and only grows", () => {
    for (const min of MINS) {
      let prev = 0;
      for (let bar = 1280; bar <= 3440; bar++) {
        const w = contentWidth(bar);
        const c = columnsFor(w, min);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c * min).toBeLessThanOrEqual(w); // each column is wide enough
        expect((c + 1) * min).toBeGreaterThan(w); // and one more would not be
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
    }
  });

  it("a wider family minimum takes a column fewer", () => {
    expect(columnsFor(contentWidth(1280), 212)).toBe(5);
    expect(columnsFor(contentWidth(1280), 244)).toBe(4);
  });
});

describe("paginate", () => {
  it("handles 0, 1 and many items", () => {
    expect(paginate([], 5)).toEqual([]);
    expect(paginate([7], 5)).toEqual([[7]]);
    expect(paginate(range(5), 5)).toHaveLength(1);
    expect(paginate(range(6), 5).map((p) => p.length)).toEqual([3, 3]);
  });

  it("is balanced, ordered and lossless for every size and width", () => {
    for (let n = 0; n <= 120; n++) {
      for (const cols of [1, 2, 3, 4, 5, 8, 12, 16]) {
        const pages = paginate(range(n), cols);
        expect(pages.flat()).toEqual(range(n));
        expect(pages.length).toBe(Math.ceil(n / cols));
        const sizes = pages.map((p) => p.length);
        if (n === 0) continue;
        expect(Math.max(...sizes)).toBeLessThanOrEqual(cols);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(sizes).toEqual([...sizes].sort((a, b) => b - a)); // larger pages first
      }
    }
    expect(paginate(range(14), 12).map((p) => p.length)).toEqual([7, 7]);
    expect(paginate(range(56), 5).map((p) => p.length)).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4]);
  });

  it("the 56-game busy Saturday is 14 pages of 4 at 1280", () => {
    const cols = columnsFor(contentWidth(1280), 244);
    const pages = paginate(range(56), cols);
    expect(pages).toHaveLength(14);
    expect(pages.every((p) => p.length === 4)).toBe(true);
  });
});

describe("planWidget", () => {
  type G = { id: number; tier: Tier };
  const tierOf = (g: G) => g.tier;
  const games = (tiers: Tier[]): G[] => tiers.map((tier, id) => ({ id, tier }));

  it("orders by tier and keeps source order inside a tier", () => {
    const plan = planWidget(games([2, 0, 1, 0, 3, 1]), tierOf, 6);
    expect(plan.pages[0].map((g) => g.id)).toEqual([1, 3, 2, 5, 0, 4]);
  });

  it("live and yours lead: page 1 first, spilling onto page 2", () => {
    const live = Array(5).fill(TIER.live);
    const rest = Array(7).fill(TIER.recent);
    const plan = planWidget(games([...rest, ...live]), tierOf, 4); // 12 items, 3 pages of 4
    expect(plan.pages.map((p) => p.map((g) => g.tier))).toEqual([[0, 0, 0, 0], [0, 2, 2, 2], [2, 2, 2, 2]]);
    expect(planWidget([], tierOf, 4)).toEqual({ pages: [] });
  });
});

describe("dwellFor", () => {
  it("stays within 6..12 s and grows with the page", () => {
    expect(dwellFor(0)).toBe(6);
    expect(dwellFor(1)).toBe(6);
    expect(dwellFor(8)).toBe(9);
    expect(dwellFor(100)).toBe(12);
    for (let n = 0; n < 40; n++) {
      expect(dwellFor(n + 1)).toBeGreaterThanOrEqual(dwellFor(n));
      expect(dwellFor(n)).toBeGreaterThanOrEqual(6);
      expect(dwellFor(n)).toBeLessThanOrEqual(12);
    }
  });
});

describe("freeze", () => {
  type G = { id: string; score: number };
  const key = (g: G) => g.id;
  const pool = (...scores: [string, number][]): G[] => scores.map(([id, score]) => ({ id, score }));

  it("a refresh that reorders the pool changes values only, never keys or order", () => {
    const frozen = freezePage(pool(["a", 0], ["b", 0], ["c", 0]), key);
    // b turns close and a new game d jumps to the front of the live pool.
    const next = refreshPage(frozen, pool(["d", 9], ["b", 7], ["c", 1], ["a", 2]), key);
    expect(next.keys).toEqual(["a", "b", "c"]);
    expect(pageItems(next)).toEqual(pool(["a", 2], ["b", 7], ["c", 1]));
  });

  it("an item that drops out of the pool keeps its last value", () => {
    const frozen = freezePage(pool(["a", 1], ["b", 2]), key);
    const next = refreshPage(frozen, pool(["b", 5]), key);
    expect(pageItems(next)).toEqual(pool(["a", 1], ["b", 5]));
  });

  it("does not mutate the page it was given", () => {
    const frozen = freezePage(pool(["a", 1]), key);
    refreshPage(frozen, pool(["a", 9]), key);
    expect(pageItems(frozen)).toEqual(pool(["a", 1]));
  });

  it("the next page freezes from the re-ranked pool", () => {
    const first = freezePage(pool(["a", 0], ["b", 0]), key);
    const reranked = planWidget(pool(["b", 5], ["a", 0], ["c", 0]), () => TIER.live, 2).pages[0];
    expect(first.keys).toEqual(["a", "b"]); // old page untouched
    expect(freezePage(reranked, key).keys).toEqual(["b", "a"]); // new page uses the new order
  });
});
