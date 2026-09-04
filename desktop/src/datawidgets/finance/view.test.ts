import { describe, it, expect } from "vitest";
import {
  sortTrades,
  applyFinancePipeline,
  searchFinanceCatalog,
  selectFinanceForTicker,
  selectStockView,
} from "./view";
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
  defaultSort: "alpha",
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

describe("selectStockView", () => {
  const trades = [
    mk({ symbol: "SPY", day_volume: 10 }),
    mk({ symbol: "QQQ", day_volume: 20 }),
    mk({ symbol: "AAPL", day_volume: 30 }),
    mk({ symbol: "MSFT", day_volume: 40 }),
    mk({ symbol: "JPM", day_volume: 50 }),
    mk({ symbol: "XOM", day_volume: 60 }),
  ];
  const categoryMap = new Map([
    ["AAPL", "Technology"],
    ["MSFT", "Technology"],
    ["JPM", "Financial Services"],
    ["XOM", "Energy"],
  ]);
  const base = {
    watchlist: new Set<string>(["MSFT", "JPM"]),
    selectedSectors: new Set<string>(),
    categoryMap,
    sortKey: "alpha" as const,
  };

  it("defaults All to the sector-based stock universe", () => {
    expect(
      selectStockView(trades, { ...base, view: "all" }).map(
        (trade) => trade.symbol,
      ),
    ).toEqual(["AAPL", "JPM", "MSFT", "XOM"]);
  });

  it("filters both All and Watchlist by category", () => {
    expect(
      selectStockView(trades, {
        ...base,
        view: "all",
        selectedSectors: new Set(["Energy"]),
      }).map((trade) => trade.symbol),
    ).toEqual(["XOM"]);
    expect(
      selectStockView(trades, {
        ...base,
        view: "watchlist",
        selectedSectors: new Set(["Technology"]),
      }).map((trade) => trade.symbol),
    ).toEqual(["MSFT"]);
  });
});

describe("searchFinanceCatalog", () => {
  const catalog = [
    { symbol: "AAPL", name: "Apple Inc.", category: "Technology" },
    { symbol: "AAP", name: "Advance Auto Parts", category: "Consumer Cyclical" },
    { symbol: "BTC/USD", name: "Bitcoin", category: "Crypto" },
    { symbol: "ETH/USD", name: "Ethereum", category: "Crypto" },
  ];

  it("scopes results and ranks relevant symbols first", () => {
    expect(
      searchFinanceCatalog(catalog, "aap", "stock").map((item) => item.symbol),
    ).toEqual(["AAP", "AAPL"]);
    expect(
      searchFinanceCatalog(catalog, "a", "stock").map((item) => item.symbol),
    ).toEqual(["AAP", "AAPL"]);
    expect(
      searchFinanceCatalog(catalog, "bit", "crypto").map((item) => item.symbol),
    ).toEqual(["BTC/USD"]);
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

  it("view=all keeps everything", () => {
    const result = applyFinancePipeline(makeTrades(), {
      view: "all",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result).toHaveLength(4);
  });

  it("view=watchlist keeps tracked symbols", () => {
    const result = applyFinancePipeline(makeTrades(), {
      view: "watchlist",
      selectedCategories: new Set(),
      categoryMap,
      sortKey: "alpha",
      watchlist: new Set(["MSFT", "XOM"]),
    });
    expect(result.map((t) => t.symbol)).toEqual(["MSFT", "XOM"]);
  });

  it("applies category filter", () => {
    const result = applyFinancePipeline(makeTrades(), {
      view: "all",
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
      view: "all",
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortKey: "alpha",
    });
    expect(result.map((t) => t.symbol)).toEqual(["AAPL"]);
  });

  it("combines watchlist + category filter + sort", () => {
    const result = applyFinancePipeline(makeTrades(), {
      view: "watchlist",
      selectedCategories: new Set(["tech"]),
      categoryMap,
      sortKey: "price",
      watchlist: new Set(["AAPL", "MSFT", "JPM"]),
    });
    expect(result.map((t) => t.symbol)).toEqual(["MSFT", "AAPL"]);
  });
});

// ── selectFinanceForTicker ──────────────────────────────────────

describe("selectFinanceForTicker", () => {
  it("orders by the watchlist as the user built it, not by any sort", () => {
    const trades = [mk({ symbol: "C", price: 1 }), mk({ symbol: "A", price: 30 }), mk({ symbol: "B", price: 20 })];
    expect(selectFinanceForTicker(trades, ["B", "C", "A"]).map((t) => t.symbol)).toEqual(["B", "C", "A"]);
  });

  it("drops nothing the watchlist names but the payload lacks, silently", () => {
    const trades = [mk({ symbol: "A" })];
    expect(selectFinanceForTicker(trades, ["Z", "A"]).map((t) => t.symbol)).toEqual(["A"]);
  });

  it("trails unlisted rows alphabetically so a legacy widget still shows everything", () => {
    const trades = [mk({ symbol: "Z" }), mk({ symbol: "M" }), mk({ symbol: "A" })];
    expect(selectFinanceForTicker(trades, ["M"]).map((t) => t.symbol)).toEqual(["M", "A", "Z"]);
    expect(selectFinanceForTicker(trades, []).map((t) => t.symbol)).toEqual(["A", "M", "Z"]);
  });
});

