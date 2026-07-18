import { describe, it, expect } from "vitest";
import { sortTrades, applyFinancePipeline, selectFinanceForTicker } from "./view";
import type { Trade } from "../../types";
import type { FinanceDisplayPrefs } from "../../preferences";

// ── Fixtures ────────────────────────────────────────────────────

function mk(partial: Partial<Trade> & { symbol: string }): Trade {
  return {
    price: 0,
    percentage_change: 0,
    last_updated: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

const DEFAULT_PREFS: FinanceDisplayPrefs = {
  showChange: "both",
  showPrevClose: "both",
  showLastUpdated: "both",
  defaultSort: "alpha",
  tickerDirectionMarker: "arrow",
};

// ── sortTrades ──────────────────────────────────────────────────

describe("sortTrades", () => {
  it("sorts alphabetically by symbol", () => {
    const trades = [
      mk({ symbol: "TSLA" }),
      mk({ symbol: "AAPL" }),
      mk({ symbol: "MSFT" }),
    ];
    const result = sortTrades(trades, "alpha");
    expect(result.map((t) => t.symbol)).toEqual(["AAPL", "MSFT", "TSLA"]);
  });

  it("sorts by price descending with numeric prices", () => {
    const trades = [
      mk({ symbol: "A", price: 100 }),
      mk({ symbol: "B", price: 250 }),
      mk({ symbol: "C", price: 50 }),
    ];
    const result = sortTrades(trades, "price");
    expect(result.map((t) => t.symbol)).toEqual(["B", "A", "C"]);
  });

  it("sorts by price with string prices", () => {
    const trades = [
      mk({ symbol: "A", price: "100.50" }),
      mk({ symbol: "B", price: "250.00" }),
      mk({ symbol: "C", price: "50.25" }),
    ];
    const result = sortTrades(trades, "price");
    expect(result.map((t) => t.symbol)).toEqual(["B", "A", "C"]);
  });

  it("sorts by change (percentage_change) descending", () => {
    const trades = [
      mk({ symbol: "A", percentage_change: -2.5 }),
      mk({ symbol: "B", percentage_change: 4.0 }),
      mk({ symbol: "C", percentage_change: 0 }),
      mk({ symbol: "D", percentage_change: "-5.1" }),
    ];
    const result = sortTrades(trades, "change");
    expect(result.map((t) => t.symbol)).toEqual(["B", "C", "A", "D"]);
  });

  it("sorts by updated (last_updated) descending", () => {
    const trades = [
      mk({ symbol: "A", last_updated: "2026-01-01T00:00:00Z" }),
      mk({ symbol: "B", last_updated: "2026-03-01T00:00:00Z" }),
      mk({ symbol: "C", last_updated: "2026-02-01T00:00:00Z" }),
    ];
    const result = sortTrades(trades, "updated");
    expect(result.map((t) => t.symbol)).toEqual(["B", "C", "A"]);
  });

  it("treats missing last_updated as empty string (sorts last under desc)", () => {
    const trades = [
      mk({ symbol: "A" }),
      mk({ symbol: "B", last_updated: undefined }),
      mk({ symbol: "C", last_updated: "2026-05-01T00:00:00Z" }),
    ];
    const result = sortTrades(trades, "updated");
    // C first; A and B tie on empty string — stable order preserves input (A before B)
    expect(result[0]!.symbol).toBe("C");
  });

  it("does not mutate the input array", () => {
    const trades = [mk({ symbol: "B" }), mk({ symbol: "A" })];
    const snapshot = trades.map((t) => t.symbol);
    sortTrades(trades, "alpha");
    expect(trades.map((t) => t.symbol)).toEqual(snapshot);
  });

  it("handles null/undefined percentage_change as 0", () => {
    const trades = [
      mk({ symbol: "A", percentage_change: undefined }),
      mk({ symbol: "B", percentage_change: 3 }),
      mk({ symbol: "C", percentage_change: -1 }),
    ];
    const result = sortTrades(trades, "change");
    expect(result.map((t) => t.symbol)).toEqual(["B", "A", "C"]);
  });
});

// ── applyFinancePipeline ────────────────────────────────────────

describe("applyFinancePipeline", () => {
  const categoryMap = new Map<string, string>([
    ["AAPL", "tech"],
    ["MSFT", "tech"],
    ["JPM", "finance"],
    ["XOM", "energy"],
  ]);

  function makeTrades(): Trade[] {
    return [
      mk({ symbol: "AAPL", price: 200, percentage_change: 1.5 }),
      mk({ symbol: "MSFT", price: 400, percentage_change: -0.8 }),
      mk({ symbol: "JPM", price: 150, percentage_change: 2.0 }),
      mk({ symbol: "XOM", price: 110, percentage_change: 0 }),
    ];
  }

  it("applies direction=gainers", () => {
    const result = applyFinancePipeline(makeTrades(), {
      directionFilter: "gainers",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((t) => t.symbol)).toEqual(["AAPL", "JPM"]);
  });

  it("applies direction=losers", () => {
    const result = applyFinancePipeline(makeTrades(), {
      directionFilter: "losers",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((t) => t.symbol)).toEqual(["MSFT"]);
  });

  it("direction=all keeps everything including zero-change", () => {
    const result = applyFinancePipeline(makeTrades(), {
      directionFilter: "all",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result).toHaveLength(4);
  });

  it("applies category filter", () => {
    const result = applyFinancePipeline(makeTrades(), {
      directionFilter: "all",
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((t) => t.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("drops trades with no category mapping under a category filter", () => {
    const trades = [
      mk({ symbol: "AAPL" }),
      mk({ symbol: "UNKNOWN" }),
    ];
    const result = applyFinancePipeline(trades, {
      directionFilter: "all",
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((t) => t.symbol)).toEqual(["AAPL"]);
  });

  it("combines direction + category filter + sort", () => {
    const result = applyFinancePipeline(makeTrades(), {
      directionFilter: "gainers",
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortKey: "price",
    });
    // gainers in tech: AAPL only
    expect(result.map((t) => t.symbol)).toEqual(["AAPL"]);
  });
});

// ── selectFinanceForTicker ──────────────────────────────────────

describe("selectFinanceForTicker", () => {
  it("applies defaultSort=alpha from prefs", () => {
    const trades = [mk({ symbol: "C" }), mk({ symbol: "A" }), mk({ symbol: "B" })];
    const result = selectFinanceForTicker(trades, { ...DEFAULT_PREFS, defaultSort: "alpha" });
    expect(result.map((t) => t.symbol)).toEqual(["A", "B", "C"]);
  });

  it("applies defaultSort=price from prefs", () => {
    const trades = [
      mk({ symbol: "A", price: 10 }),
      mk({ symbol: "B", price: 30 }),
      mk({ symbol: "C", price: 20 }),
    ];
    const result = selectFinanceForTicker(trades, { ...DEFAULT_PREFS, defaultSort: "price" });
    expect(result.map((t) => t.symbol)).toEqual(["B", "C", "A"]);
  });

  it("applies defaultSort=change from prefs", () => {
    const trades = [
      mk({ symbol: "A", percentage_change: -2 }),
      mk({ symbol: "B", percentage_change: 5 }),
      mk({ symbol: "C", percentage_change: 1 }),
    ];
    const result = selectFinanceForTicker(trades, { ...DEFAULT_PREFS, defaultSort: "change" });
    expect(result.map((t) => t.symbol)).toEqual(["B", "C", "A"]);
  });

  it("applies defaultSort=updated from prefs", () => {
    const trades = [
      mk({ symbol: "A", last_updated: "2026-01-01T00:00:00Z" }),
      mk({ symbol: "B", last_updated: "2026-06-01T00:00:00Z" }),
    ];
    const result = selectFinanceForTicker(trades, { ...DEFAULT_PREFS, defaultSort: "updated" });
    expect(result.map((t) => t.symbol)).toEqual(["B", "A"]);
  });
});
