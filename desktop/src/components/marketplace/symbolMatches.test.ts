import { describe, expect, it } from "vitest";

import { getCatalogItems } from "../../marketplace";
import type { TrackedSymbol } from "../../api/queries";
import {
  planSymbolAdd,
  symbolGroups,
  symbolLabel,
  watchlistOf,
} from "./symbolMatches";

const items = getCatalogItems();
const stocks = items.find((i) => i.id === "finance_stocks")!;
const crypto = items.find((i) => i.id === "finance_crypto")!;

const catalog: TrackedSymbol[] = [
  { symbol: "AAPL", name: "Apple Inc.", category: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corp.", category: "Technology" },
  { symbol: "BTC/USD", name: "Bitcoin", category: "Crypto" },
  { symbol: "ETH/USD", name: "Ethereum", category: "Crypto" },
];

describe("symbolGroups", () => {
  it("matches a stock by ticker, under Stocks", () => {
    const g = symbolGroups(items, catalog, "aapl");
    expect(g.map((x) => x.item.id)).toEqual(["finance_stocks"]);
    expect(g[0].hits.map((h) => h.symbol)).toEqual(["AAPL"]);
  });

  it("matches by name", () => {
    expect(symbolGroups(items, catalog, "Apple")[0].hits[0].symbol).toBe("AAPL");
    const btc = symbolGroups(items, catalog, "Bitcoin");
    expect(btc.map((x) => x.item.id)).toEqual(["finance_crypto"]);
    expect(btc[0].hits[0].symbol).toBe("BTC/USD");
  });

  it("matches a coin by ticker, under Crypto", () => {
    expect(symbolGroups(items, catalog, "BTC")[0].item.id).toBe("finance_crypto");
  });

  it("keeps stocks and coins apart", () => {
    // "in" is in Apple Inc. and Bitcoin: one hit under each widget.
    const g = symbolGroups(items, catalog, "in");
    expect(g.map((x) => x.item.id)).toEqual(["finance_stocks", "finance_crypto"]);
    expect(g[0].hits.every((h) => h.category !== "Crypto")).toBe(true);
  });

  it("ignores one-character queries and queries that match nothing", () => {
    expect(symbolGroups(items, catalog, "a")).toEqual([]);
    expect(symbolGroups(items, catalog, "zzzz")).toEqual([]);
    expect(symbolGroups(items, [], "aapl")).toEqual([]);
  });
});

describe("symbolLabel", () => {
  it("shows the coin, not the quote pair", () => {
    expect(symbolLabel("BTC/USD")).toBe("BTC");
    expect(symbolLabel("AAPL")).toBe("AAPL");
  });
});

describe("planSymbolAdd", () => {
  const base = { symbol: "AAPL", item: stocks, gated: false };

  it("adds to the watchlist of a widget the user already has", () => {
    const row = { config: { asset_class: "stock", symbols: ["MSFT"] } };
    expect(planSymbolAdd({ ...base, row })).toEqual({
      kind: "append",
      symbols: ["MSFT", "AAPL"],
    });
  });

  it("recognises a symbol already on the watchlist", () => {
    const row = { config: { symbols: ["AAPL", "MSFT"] } };
    expect(planSymbolAdd({ ...base, row })).toEqual({ kind: "on-list" });
  });

  it("creates the widget with only the asked-for symbol, not the starter list", () => {
    const plan = planSymbolAdd({ ...base, row: undefined });
    expect(plan.kind).toBe("create");
    expect(stocks.addConfig?.symbols).toContain("MSFT"); // starter exists...
    expect(plan).toEqual({
      kind: "create",
      config: { asset_class: "stock", symbols: ["AAPL"] }, // ...and is not used
    });
  });

  it("keeps the crypto pair intact when creating Crypto", () => {
    const plan = planSymbolAdd({
      symbol: "BTC/USD",
      item: crypto,
      row: undefined,
      gated: false,
    });
    expect(plan).toEqual({
      kind: "create",
      config: { asset_class: "crypto", symbols: ["BTC/USD"] },
    });
  });

  it("takes the usual cap path when the widget would need a slot the plan lacks", () => {
    expect(planSymbolAdd({ ...base, row: undefined, gated: true })).toEqual({
      kind: "gate",
    });
  });

  it("never gates adding to a widget they already have", () => {
    const row = { config: { symbols: [] } };
    expect(planSymbolAdd({ ...base, row, gated: true }).kind).toBe("append");
  });
});

describe("watchlistOf", () => {
  it("tolerates a missing or odd config", () => {
    expect(watchlistOf(undefined)).toEqual([]);
    expect(watchlistOf({})).toEqual([]);
    expect(watchlistOf({ symbols: "AAPL" })).toEqual([]);
  });
});
