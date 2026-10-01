import { describe, expect, it } from "vitest";
import {
  LABEL_W,
  MAX_PAGES_PER_VISIT,
  MIN_COL,
  TIER,
  columnsFor,
  contentWidth,
  dwellFor,
  freezePage,
  pageItems,
  paginate,
  planWidget,
  refreshPage,
  visitPages,
  type PageKind,
  type Tier,
} from "./pagePlan";

const KINDS = Object.keys(MIN_COL) as PageKind[];
const range = (n: number) => [...Array(n).keys()];

describe("columns", () => {
  it("come from the content width and the kind", () => {
    expect(columnsFor("sports", 1920 - LABEL_W)).toBe(8);
    expect(columnsFor("news", 1280 - LABEL_W)).toBe(2);
    expect(columnsFor("finance", 0)).toBe(1);
    expect(contentWidth(1920, 300)).toBe(1920 - LABEL_W - 300);
    expect(contentWidth(50)).toBe(0);
  });

  it("every width 1280..3440 fits its columns, never starves them, and only grows", () => {
    for (const kind of KINDS) {
      let prev = 0;
      for (let bar = 1280; bar <= 3440; bar++) {
        const w = contentWidth(bar);
        const c = columnsFor(kind, w);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c * MIN_COL[kind]).toBeLessThanOrEqual(w); // each column is wide enough
        expect((c + 1) * MIN_COL[kind]).toBeGreaterThan(w); // and one more would not be
        expect(c).toBeGreaterThanOrEqual(prev);
        prev = c;
      }
    }
  });

  it("a per-widget minCol replaces the kind default", () => {
    expect(columnsFor("sports", contentWidth(1280))).toBe(5);
    expect(columnsFor("sports", contentWidth(1280), 244)).toBe(4);
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
    const cols = columnsFor("sports", contentWidth(1280), 244);
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

  it("counts sticky pages: live and yours spill onto page 2", () => {
    const live = Array(5).fill(TIER.live);
    const rest = Array(7).fill(TIER.recent);
    const plan = planWidget(games([...rest, ...live]), tierOf, 4); // 12 items, 3 pages of 4
    expect(plan.pages.map((p) => p.length)).toEqual([4, 4, 4]);
    expect(plan.sticky).toBe(2);
  });

  it("sticky is at least one page, and zero for no items", () => {
    expect(planWidget(games([3, 3, 3]), tierOf, 4).sticky).toBe(1);
    expect(planWidget([], tierOf, 4)).toEqual({ pages: [], sticky: 0 });
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

describe("visitPages", () => {
  it("shows a small widget whole", () => {
    expect(visitPages(0, 1)).toEqual({ pages: [], next: 0 });
    expect(visitPages(1, 1)).toEqual({ pages: [0], next: 1 });
    expect(visitPages(2, 1)).toEqual({ pages: [0, 1], next: 1 });
    expect(visitPages(3, 1)).toEqual({ pages: [0, 1, 2], next: 1 });
  });

  it("is page 1 plus the next two, wrapping", () => {
    expect(visitPages(6, 1)).toEqual({ pages: [0, 1, 2], next: 3 });
    expect(visitPages(6, 3)).toEqual({ pages: [0, 3, 4], next: 5 });
    expect(visitPages(6, 5)).toEqual({ pages: [0, 5, 1], next: 2 });
    expect(visitPages(12, 2, 2)).toEqual({ pages: [0, 1, 2, 3], next: 4 });
    expect(visitPages(12, 11, 2)).toEqual({ pages: [0, 1, 11, 2], next: 3 });
  });

  it("sticky pages show every visit, however many; two more of the rest", () => {
    const v = visitPages(10, 5, 4);
    expect(v.pages.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(v.pages).toHaveLength(4 + MAX_PAGES_PER_VISIT - 1);
    expect(visitPages(5, 5, 9).pages).toEqual([0, 1, 2, 3, 4]); // all sticky: whole widget
  });

  it("across laps: sticky every lap, every other page comes round fairly, no repeats in a visit", () => {
    for (const [count, sticky] of [[14, 1], [14, 3], [8, 2], [20, 1]] as const) {
      let cursor: number = sticky;
      const seen = new Map<number, number>();
      for (let lap = 0; lap < count * 2; lap++) {
        const v = visitPages(count, cursor, sticky);
        cursor = v.next;
        expect(new Set(v.pages).size).toBe(v.pages.length);
        for (let i = 0; i < sticky; i++) expect(v.pages[i]).toBe(i);
        for (const p of v.pages.slice(sticky)) {
          expect(p).toBeGreaterThanOrEqual(sticky);
          expect(p).toBeLessThan(count);
          seen.set(p, (seen.get(p) ?? 0) + 1);
        }
      }
      expect([...seen.keys()].sort((a, b) => a - b)).toEqual(range(count - sticky).map((i) => i + sticky));
      const counts = [...seen.values()];
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it("the busy Saturday (14 pages, 1 sticky) has shown every page after 7 visits", () => {
    let cursor = 1;
    const seen = new Set<number>();
    for (let lap = 0; lap < 7; lap++) {
      const v = visitPages(14, cursor, 1);
      cursor = v.next;
      v.pages.forEach((p) => seen.add(p));
    }
    expect(seen.size).toBe(14);
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
