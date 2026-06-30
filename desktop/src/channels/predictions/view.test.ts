import { describe, it, expect } from "vitest";
import {
  sortPredictions,
  applyPredictionsPipeline,
  selectPredictionsForTicker,
  priceDelta,
  formatProbability,
  formatCentsPrice,
  formatSpread,
  marketLabel,
  isResolved,
  selectResolvedToday,
} from "./view";
import type { Prediction } from "../../types";
import type { PredictionsDisplayPrefs } from "../../preferences";

// ── Fixtures ────────────────────────────────────────────────────

function mk(partial: Partial<Prediction> & { id: string }): Prediction {
  return {
    source: "kalshi",
    ticker: partial.id,
    title: partial.id,
    yes_price: 50,
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const DEFAULT_PREFS: PredictionsDisplayPrefs = {
  showDelta: "both",
  showCategory: "both",
  showVolume: "both",
  showCloseTime: "both",
  defaultSort: "movers",
  feedDensity: "comfort",
};

// ── priceDelta ──────────────────────────────────────────────────

describe("priceDelta", () => {
  it("computes signed delta vs prev_yes_price", () => {
    expect(priceDelta(mk({ id: "A", yes_price: 62, prev_yes_price: 55 }))).toBe(7);
    expect(priceDelta(mk({ id: "B", yes_price: 40, prev_yes_price: 55 }))).toBe(-15);
  });

  it("coerces missing prev_yes_price to 0", () => {
    expect(
      priceDelta(mk({ id: "A", yes_price: 30, prev_yes_price: undefined })),
    ).toBe(30);
  });

  it("coerces missing yes_price to 0", () => {
    expect(
      priceDelta(mk({ id: "A", yes_price: undefined as unknown as number, prev_yes_price: 20 })),
    ).toBe(-20);
  });
});

// ── sortPredictions ─────────────────────────────────────────────

describe("sortPredictions", () => {
  it("sorts by movers (largest absolute delta first)", () => {
    const items = [
      mk({ id: "A", yes_price: 52, prev_yes_price: 50 }), // |2|
      mk({ id: "B", yes_price: 30, prev_yes_price: 50 }), // |20|
      mk({ id: "C", yes_price: 55, prev_yes_price: 50 }), // |5|
    ];
    const result = sortPredictions(items, "movers");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sorts by volume descending", () => {
    const items = [
      mk({ id: "A", volume: 100 }),
      mk({ id: "B", volume: 900 }),
      mk({ id: "C", volume: 400 }),
    ];
    const result = sortPredictions(items, "volume");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sorts by closing (soonest close_time first)", () => {
    const items = [
      mk({ id: "A", close_time: "2026-03-01T00:00:00Z" }),
      mk({ id: "B", close_time: "2026-01-15T00:00:00Z" }),
      mk({ id: "C", close_time: "2026-02-01T00:00:00Z" }),
    ];
    const result = sortPredictions(items, "closing");
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("sinks markets with no close_time last under closing sort", () => {
    const items = [
      mk({ id: "A", close_time: undefined }),
      mk({ id: "B", close_time: "2026-02-01T00:00:00Z" }),
    ];
    const result = sortPredictions(items, "closing");
    expect(result.map((p) => p.id)).toEqual(["B", "A"]);
  });

  it("sorts alphabetically by title", () => {
    const items = [
      mk({ id: "1", title: "Zebra wins" }),
      mk({ id: "2", title: "Alpha wins" }),
      mk({ id: "3", title: "Mango wins" }),
    ];
    const result = sortPredictions(items, "alpha");
    expect(result.map((p) => p.title)).toEqual([
      "Alpha wins",
      "Mango wins",
      "Zebra wins",
    ]);
  });

  it("does not mutate the input array", () => {
    const items = [mk({ id: "B" }), mk({ id: "A" })];
    const snapshot = items.map((p) => p.id);
    sortPredictions(items, "alpha");
    expect(items.map((p) => p.id)).toEqual(snapshot);
  });

  it("handles null/undefined volume as 0", () => {
    const items = [
      mk({ id: "A", volume: undefined }),
      mk({ id: "B", volume: 5 }),
      mk({ id: "C", volume: undefined }),
    ];
    const result = sortPredictions(items, "volume");
    expect(result[0]!.id).toBe("B");
  });
});

// ── applyPredictionsPipeline ────────────────────────────────────

describe("applyPredictionsPipeline", () => {
  const categoryMap = new Map<string, string>([
    ["a", "Politics"],
    ["b", "Politics"],
    ["c", "Sports"],
    ["d", "Crypto"],
  ]);

  function makeItems(): Prediction[] {
    return [
      mk({ id: "a", title: "A", yes_price: 60, prev_yes_price: 50, volume: 200, category: "Politics" }),
      mk({ id: "b", title: "B", yes_price: 40, prev_yes_price: 50, volume: 400, category: "Politics" }),
      mk({ id: "c", title: "C", yes_price: 70, prev_yes_price: 50, volume: 150, category: "Sports" }),
      mk({ id: "d", title: "D", yes_price: 50, prev_yes_price: 50, volume: 110, category: "Crypto" }),
    ];
  }

  it("applies direction=up (positive delta only)", () => {
    const result = applyPredictionsPipeline(makeItems(), {
      directionFilter: "up",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("applies direction=down (negative delta only)", () => {
    const result = applyPredictionsPipeline(makeItems(), {
      directionFilter: "down",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((p) => p.id)).toEqual(["b"]);
  });

  it("direction=all keeps everything including unchanged", () => {
    const result = applyPredictionsPipeline(makeItems(), {
      directionFilter: "all",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result).toHaveLength(4);
  });

  it("applies category filter (from prediction.category)", () => {
    const result = applyPredictionsPipeline(makeItems(), {
      directionFilter: "all",
      selectedCategories: new Set(["Politics"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("falls back to categoryMap when prediction.category is absent", () => {
    const items = [
      mk({ id: "a", title: "A", category: undefined }),
      mk({ id: "c", title: "C", category: undefined }),
    ];
    const result = applyPredictionsPipeline(items, {
      directionFilter: "all",
      selectedCategories: new Set(["Sports"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((p) => p.id)).toEqual(["c"]);
  });

  it("drops markets with no category mapping under a category filter", () => {
    const items = [
      mk({ id: "a", title: "A", category: "Politics" }),
      mk({ id: "z", title: "Z", category: undefined }),
    ];
    const result = applyPredictionsPipeline(items, {
      directionFilter: "all",
      selectedCategories: new Set(["Politics"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("combines direction + category filter + sort", () => {
    const result = applyPredictionsPipeline(makeItems(), {
      directionFilter: "up",
      selectedCategories: new Set(["Politics"]),
      categoryMap,
      sortKey: "volume",
    });
    // up + Politics: only "a"
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });
});

// ── selectPredictionsForTicker ──────────────────────────────────

describe("selectPredictionsForTicker", () => {
  it("applies defaultSort=movers from prefs", () => {
    const items = [
      mk({ id: "A", yes_price: 52, prev_yes_price: 50 }),
      mk({ id: "B", yes_price: 30, prev_yes_price: 50 }),
      mk({ id: "C", yes_price: 55, prev_yes_price: 50 }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "movers",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("applies defaultSort=volume from prefs", () => {
    const items = [
      mk({ id: "A", volume: 10 }),
      mk({ id: "B", volume: 30 }),
      mk({ id: "C", volume: 20 }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "volume",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "C", "A"]);
  });

  it("applies defaultSort=alpha from prefs", () => {
    const items = [
      mk({ id: "3", title: "C" }),
      mk({ id: "1", title: "A" }),
      mk({ id: "2", title: "B" }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "alpha",
    });
    expect(result.map((p) => p.title)).toEqual(["A", "B", "C"]);
  });

  it("applies defaultSort=closing from prefs", () => {
    const items = [
      mk({ id: "A", close_time: "2026-06-01T00:00:00Z" }),
      mk({ id: "B", close_time: "2026-01-01T00:00:00Z" }),
    ];
    const result = selectPredictionsForTicker(items, {
      ...DEFAULT_PREFS,
      defaultSort: "closing",
    });
    expect(result.map((p) => p.id)).toEqual(["B", "A"]);
  });
});

// ── Display formatting ──────────────────────────────────────────

describe("formatProbability / formatCentsPrice", () => {
  it("rounds and clamps to 0–100", () => {
    expect(formatProbability(62)).toBe("62%");
    expect(formatProbability(61.6)).toBe("62%");
    expect(formatProbability(-5)).toBe("0%");
    expect(formatProbability(140)).toBe("100%");
    expect(formatProbability(undefined)).toBe("0%");
    expect(formatCentsPrice(38)).toBe("38¢");
  });
});

describe("formatSpread", () => {
  it("renders both sides, one side, or nothing", () => {
    expect(formatSpread(61, 63)).toBe("61–63¢");
    expect(formatSpread(61, undefined)).toBe("61¢");
    expect(formatSpread(undefined, 63)).toBe("63¢");
    expect(formatSpread(undefined, undefined)).toBe("");
    expect(formatSpread(null, null)).toBe("");
  });
});

describe("marketLabel", () => {
  it("uses the title alone when there's no distinct subtitle", () => {
    expect(marketLabel(mk({ id: "A", title: "Fed cuts in July", subtitle: undefined }))).toBe(
      "Fed cuts in July",
    );
  });

  it("appends a distinct subtitle", () => {
    expect(
      marketLabel(mk({ id: "A", title: "NYC high temp", subtitle: "90°F or above" })),
    ).toBe("NYC high temp · 90°F or above");
  });

  it("does not duplicate a subtitle already contained in the title", () => {
    expect(
      marketLabel(mk({ id: "A", title: "Rain in Seattle today", subtitle: "Seattle" })),
    ).toBe("Rain in Seattle today");
  });

  it("truncates overly long labels with an ellipsis", () => {
    const long = "x".repeat(100);
    const out = marketLabel(mk({ id: "A", title: long }), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });
});

// ── Resolved Today ──────────────────────────────────────────────

describe("isResolved / selectResolvedToday", () => {
  it("treats settlement statuses and yes/no results as resolved", () => {
    expect(isResolved(mk({ id: "A", status: "settled" }))).toBe(true);
    expect(isResolved(mk({ id: "B", status: "determined" }))).toBe(true);
    expect(isResolved(mk({ id: "C", status: "active", result: "yes" }))).toBe(true);
    expect(isResolved(mk({ id: "D", status: "active", result: "" }))).toBe(false);
    expect(isResolved(mk({ id: "E", status: "active" }))).toBe(false);
  });

  it("returns resolved markets within the window, most-recent first", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      mk({ id: "old", status: "settled", updated_at: "2026-06-20T00:00:00Z" }), // >24h
      mk({ id: "recent", status: "settled", result: "yes", updated_at: "2026-06-26T06:00:00Z" }),
      mk({ id: "newest", status: "determined", updated_at: "2026-06-26T11:00:00Z" }),
      mk({ id: "active", status: "active", updated_at: "2026-06-26T10:00:00Z" }), // not resolved
    ];
    const result = selectResolvedToday(items, now);
    expect(result.map((p) => p.id)).toEqual(["newest", "recent"]);
  });

  it("ignores future-dated timestamps (clock skew)", () => {
    const now = Date.parse("2026-06-26T12:00:00Z");
    const items = [
      mk({ id: "future", status: "settled", updated_at: "2026-06-26T18:00:00Z" }),
    ];
    expect(selectResolvedToday(items, now)).toHaveLength(0);
  });
});
