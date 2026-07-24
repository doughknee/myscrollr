import { describe, it, expect } from "vitest";
import {
  limitPerSource,
  applyRssPipeline,
  selectRssForTicker,
  distinctSourceCount,
  filterByArticleAge,
} from "./view";
import type { RssItem } from "../../types";
import type { RssDisplayPrefs } from "../../preferences";

// ── Fixtures ────────────────────────────────────────────────────

function mk(
  id: number,
  source: string,
  publishedAt: string | null = "2026-01-01T00:00:00Z",
  feedUrl?: string,
): RssItem {
  return {
    id,
    feed_url: feedUrl ?? `https://${source}.example.com/feed`,
    guid: `guid-${id}`,
    title: `Article ${id}`,
    link: `https://${source}.example.com/${id}`,
    description: `Description ${id}`,
    source_name: source,
    published_at: publishedAt,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const DEFAULT_PREFS: RssDisplayPrefs = {
  feedSort: "newest",
  articlesPerSource: 4,
  maxArticleAgeDays: 0,
};

// ── filterByArticleAge (v1.1.3 Time Controls) ───────────────────

describe("filterByArticleAge", () => {
  // Noon local time, so calendar-day math has slack on both sides.
  const NOW = new Date("2026-06-10T12:00:00").getTime();
  const hoursAgo = (h: number) =>
    new Date(NOW - h * 3_600_000).toISOString();

  it("passes everything through when maxAgeDays is 0", () => {
    const items = [mk(1, "a", hoursAgo(24 * 30))];
    expect(filterByArticleAge(items, 0, NOW)).toBe(items);
  });

  it("'today' (1 day) keeps this morning's article, drops yesterday's", () => {
    const items = [
      mk(1, "a", hoursAgo(3)), // 9am today
      mk(2, "a", hoursAgo(20)), // 4pm yesterday
    ];
    const result = filterByArticleAge(items, 1, NOW);
    expect(result.map((i) => i.id)).toEqual([1]);
  });

  it("counts calendar days including today", () => {
    const items = [
      mk(1, "a", hoursAgo(30)), // yesterday morning — inside 2 days
      mk(2, "a", hoursAgo(3 * 24)), // three days back — outside 2 days
    ];
    const result = filterByArticleAge(items, 2, NOW);
    expect(result.map((i) => i.id)).toEqual([1]);
  });

  it("falls back to created_at when published_at is null", () => {
    const fresh = { ...mk(1, "a", null), created_at: hoursAgo(2) };
    const stale = { ...mk(2, "a", null), created_at: hoursAgo(24 * 10) };
    const result = filterByArticleAge([fresh, stale], 3, NOW);
    expect(result.map((i) => i.id)).toEqual([1]);
  });

  it("keeps items with unparseable timestamps visible", () => {
    const weird = { ...mk(1, "a", "not-a-date"), created_at: "also-bad" };
    expect(filterByArticleAge([weird], 1, NOW)).toHaveLength(1);
  });

  it("applies inside the ticker selector via prefs", () => {
    const items = [
      mk(1, "a", hoursAgo(2)),
      mk(2, "b", hoursAgo(24 * 5)),
    ];
    const result = selectRssForTicker(
      items,
      { ...DEFAULT_PREFS, maxArticleAgeDays: 2 },
      NOW,
    );
    expect(result.map((i) => i.id)).toEqual([1]);
  });

  it("applies inside applyRssPipeline before per-source limiting", () => {
    const items = [
      mk(1, "a", hoursAgo(1)),
      mk(2, "a", hoursAgo(24 * 9)), // stale — must not consume a slot
      mk(3, "b", hoursAgo(2)),
    ];
    const result = applyRssPipeline(items, {
      categoryMap: new Map(),
      sortOrder: "newest",
      articlesPerSource: 1,
      maxArticleAgeDays: 2,
      now: NOW,
    });
    expect(result.visibleItems.map((i) => i.id)).toEqual([1, 3]);
    expect(result.totalHidden).toBe(0);
  });
});

// ── limitPerSource ──────────────────────────────────────────────

describe("limitPerSource", () => {
  it("returns all items when limit is 0", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "b")];
    const result = limitPerSource(items, 0);
    expect(result).toHaveLength(3);
    // returns same reference when limit is zero
    expect(result).toBe(items);
  });

  it("returns all items when limit is negative", () => {
    const items = [mk(1, "a"), mk(2, "a")];
    expect(limitPerSource(items, -1)).toBe(items);
  });

  it("caps items per source at the given limit", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "a"), mk(4, "b"), mk(5, "b")];
    const result = limitPerSource(items, 2);
    expect(result).toHaveLength(4);
    expect(result.filter((i) => i.source_name === "a")).toHaveLength(2);
    expect(result.filter((i) => i.source_name === "b")).toHaveLength(2);
  });

  it("keeps the first N items per source in input order", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "a")];
    const result = limitPerSource(items, 2);
    expect(result.map((i) => i.id)).toEqual([1, 2]);
  });

  it("preserves interleaved input order", () => {
    const items = [mk(1, "a"), mk(2, "b"), mk(3, "a"), mk(4, "b"), mk(5, "a")];
    const result = limitPerSource(items, 2);
    expect(result.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it("handles a single-source dataset", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "a"), mk(4, "a")];
    expect(limitPerSource(items, 2).map((i) => i.id)).toEqual([1, 2]);
  });

  it("handles an empty input", () => {
    expect(limitPerSource([], 5)).toEqual([]);
  });
});

// ── applyRssPipeline ────────────────────────────────────────────

describe("applyRssPipeline", () => {
  const categoryMap = new Map<string, string>([
    ["https://a.example.com/feed", "tech"],
    ["https://b.example.com/feed", "news"],
    ["https://c.example.com/feed", "tech"],
  ]);

  function makeItems(): RssItem[] {
    return [
      mk(1, "a", "2026-02-01T10:00:00Z"),
      mk(2, "a", "2026-01-15T10:00:00Z"),
      mk(3, "b", "2026-03-01T10:00:00Z"),
      mk(4, "b", "2026-01-01T10:00:00Z"),
      mk(5, "c", "2026-02-15T10:00:00Z"),
    ];
  }

  it("filters by selectedSources when non-empty", () => {
    const result = applyRssPipeline(makeItems(), {
      selectedSources: new Set(["a"]),
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 0,
    });
    expect(result.visibleItems.map((i) => i.source_name)).toEqual(["a", "a"]);
  });

  it("ignores selectedSources when empty", () => {
    const result = applyRssPipeline(makeItems(), {
      selectedSources: new Set(),
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 0,
    });
    expect(result.visibleItems).toHaveLength(5);
  });

  it("filters by selectedCategories when non-empty", () => {
    const result = applyRssPipeline(makeItems(), {
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 0,
    });
    // tech = feeds a + c, so ids 1, 2, 5
    expect(result.visibleItems.map((i) => i.id).sort()).toEqual([1, 2, 5]);
  });

  it("drops items whose feed is not in the category map under a category filter", () => {
    const items = [
      mk(1, "a"),
      mk(2, "unknown", null, "https://unknown.example.com/feed"),
    ];
    const result = applyRssPipeline(items, {
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 0,
    });
    expect(result.visibleItems.map((i) => i.id)).toEqual([1]);
  });

  it("leaves input order untouched when sortOrder=newest", () => {
    // Default CDC order is newest-first; sortRssItems returns items as-is.
    const items = makeItems();
    const result = applyRssPipeline(items, {
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 0,
    });
    expect(result.visibleItems.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("sorts oldest-first by published_at when sortOrder=oldest", () => {
    const result = applyRssPipeline(makeItems(), {
      categoryMap,
      sortOrder: "oldest",
      articlesPerSource: 0,
    });
    // ids by date ascending: 4 (2026-01-01), 2 (2026-01-15), 1 (2026-02-01), 5 (2026-02-15), 3 (2026-03-01)
    expect(result.visibleItems.map((i) => i.id)).toEqual([4, 2, 1, 5, 3]);
  });

  it("groups by source then newest-first within source when sortOrder=by-source", () => {
    const result = applyRssPipeline(makeItems(), {
      categoryMap,
      sortOrder: "by-source",
      articlesPerSource: 0,
    });
    const sources = result.visibleItems.map((i) => i.source_name);
    // stable: a, a, b, b, c
    expect(sources).toEqual(["a", "a", "b", "b", "c"]);
    // within source a: newest first = id 1 (Feb) before id 2 (Jan)
    const aIds = result.visibleItems.filter((i) => i.source_name === "a").map((i) => i.id);
    expect(aIds).toEqual([1, 2]);
    // within source b: id 3 (Mar) before id 4 (Jan)
    const bIds = result.visibleItems.filter((i) => i.source_name === "b").map((i) => i.id);
    expect(bIds).toEqual([3, 4]);
  });

  it("applies per-source limit and reports overflow counts", () => {
    const result = applyRssPipeline(makeItems(), {
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 1,
    });
    expect(result.visibleItems).toHaveLength(3); // one per source
    expect(result.overflowCounts.get("a")).toBe(1);
    expect(result.overflowCounts.get("b")).toBe(1);
    expect(result.overflowCounts.get("c")).toBeUndefined();
    expect(result.totalHidden).toBe(2);
  });

  it("bypasses per-source limit when showAll=true", () => {
    const result = applyRssPipeline(makeItems(), {
      categoryMap,
      sortOrder: "newest",
      articlesPerSource: 1,
      showAll: true,
    });
    expect(result.visibleItems).toHaveLength(5);
    expect(result.totalHidden).toBe(0);
  });

  it("expands a specific source under by-source sort via expandedSources", () => {
    // Three from "a" (ids 1,2 + extra 6), two from "b". Limit = 1.
    // Expand only "a" → all 3 items of "a", 1 of "b".
    const items = [
      ...makeItems(),
      mk(6, "a", "2026-02-10T10:00:00Z"),
    ];
    const result = applyRssPipeline(items, {
      categoryMap,
      sortOrder: "by-source",
      articlesPerSource: 1,
      expandedSources: new Set(["a"]),
    });
    const aItems = result.visibleItems.filter((i) => i.source_name === "a");
    const bItems = result.visibleItems.filter((i) => i.source_name === "b");
    expect(aItems).toHaveLength(3);
    expect(bItems).toHaveLength(1);
    // Expanded source should not be counted as overflow
    expect(result.overflowCounts.has("a")).toBe(false);
    expect(result.overflowCounts.get("b")).toBe(1);
    expect(result.totalHidden).toBe(1);
  });

  it("falls back to created_at when published_at is null (oldest sort)", () => {
    const items = [
      mk(1, "a", null),
      mk(2, "a", "2026-05-01T00:00:00Z"),
    ];
    // item 1 has published_at=null, created_at="2026-01-01T00:00:00Z"
    // item 2 published_at=2026-05-01 — so 1 is older
    const result = applyRssPipeline(items, {
      categoryMap,
      sortOrder: "oldest",
      articlesPerSource: 0,
    });
    expect(result.visibleItems.map((i) => i.id)).toEqual([1, 2]);
  });
});

// ── selectRssForTicker ──────────────────────────────────────────

describe("selectRssForTicker", () => {
  it("applies articlesPerSource from prefs", () => {
    const items = [
      mk(1, "a"),
      mk(2, "a"),
      mk(3, "a"),
      mk(4, "b"),
    ];
    const result = selectRssForTicker(items, { ...DEFAULT_PREFS, articlesPerSource: 2 });
    expect(result).toHaveLength(3);
    expect(result.filter((i) => i.source_name === "a")).toHaveLength(2);
  });

  it("returns all items when articlesPerSource is 0", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "b")];
    const result = selectRssForTicker(items, { ...DEFAULT_PREFS, articlesPerSource: 0 });
    expect(result).toHaveLength(3);
  });

  it("preserves input (newest-first) order", () => {
    const items = [mk(1, "a"), mk(2, "b"), mk(3, "a")];
    const result = selectRssForTicker(items, { ...DEFAULT_PREFS, articlesPerSource: 10 });
    expect(result.map((i) => i.id)).toEqual([1, 2, 3]);
  });
});

// ── v1.1.1 smart removal: single-source payloads skip the cap ───

describe("single-source smart removal (v1.1.1)", () => {
  const capped: RssDisplayPrefs = { ...DEFAULT_PREFS, articlesPerSource: 2 };

  it("distinctSourceCount counts unique sources", () => {
    expect(distinctSourceCount([])).toBe(0);
    expect(distinctSourceCount([mk(1, "a"), mk(2, "a")])).toBe(1);
    expect(distinctSourceCount([mk(1, "a"), mk(2, "b"), mk(3, "a")])).toBe(2);
  });

  it("ticker: a single-outlet widget shows its whole feed despite a cap", () => {
    const items = [mk(1, "bbc"), mk(2, "bbc"), mk(3, "bbc"), mk(4, "bbc")];
    expect(selectRssForTicker(items, capped)).toHaveLength(4);
  });

  it("ticker: multi-source payloads still balance per source", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "a"), mk(4, "b")];
    const result = selectRssForTicker(items, capped);
    expect(result.filter((i) => i.source_name === "a")).toHaveLength(2);
    expect(result.filter((i) => i.source_name === "b")).toHaveLength(1);
  });

  it("pipeline: single-source ignores the cap and reports nothing hidden", () => {
    const items = [mk(1, "bbc"), mk(2, "bbc"), mk(3, "bbc")];
    const { visibleItems, totalHidden } = applyRssPipeline(items, {
      categoryMap: new Map(),
      sortOrder: "newest",
      articlesPerSource: 2,
    });
    expect(visibleItems).toHaveLength(3);
    expect(totalHidden).toBe(0);
  });

  it("pipeline: multi-source still caps and reports overflow", () => {
    const items = [mk(1, "a"), mk(2, "a"), mk(3, "a"), mk(4, "b")];
    const { visibleItems, totalHidden, overflowCounts } = applyRssPipeline(items, {
      categoryMap: new Map(),
      sortOrder: "newest",
      articlesPerSource: 2,
    });
    expect(visibleItems).toHaveLength(3);
    expect(totalHidden).toBe(1);
    expect(overflowCounts.get("a")).toBe(1);
  });
});
