/**
 * Finance view selectors — shared filter/sort pipeline.
 *
 * Both `FeedTab` and `ScrollrTicker` consume `selectFinanceForTicker`
 * (or `applyFinancePipeline` for interactive filters) to produce a
 * curated trade list. SINGLE SOURCE OF TRUTH for Finance display prefs.
 */
import type { Trade } from "../../types";
import type { FinanceDisplayPrefs } from "../../preferences";

export type FinanceSortKey = "alpha" | "price" | "change" | "updated";
export type FinanceView = "all" | "watchlist";
export const STOCK_SECTORS = [
  "Basic Materials",
  "Communication Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Energy",
  "Financial Services",
  "Healthcare",
  "Industrials",
  "Real Estate",
  "Technology",
  "Utilities",
] as const;

interface FinanceCatalogItem {
  symbol: string;
  name: string;
  category: string;
}

/** Catalog search for watchlist management, ranked by relevance. */
export function searchFinanceCatalog(
  catalog: readonly FinanceCatalogItem[],
  query: string,
  assetClass: string | undefined,
  watchlist: ReadonlySet<string>,
): FinanceCatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const relevance = (item: FinanceCatalogItem) => {
    const symbol = item.symbol.toLowerCase();
    const name = item.name.toLowerCase();
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (symbol.includes(q)) return 3;
    return 4;
  };

  return catalog
    .filter((item) =>
      assetClass === "crypto"
        ? item.category === "Crypto"
        : assetClass === "stock"
          ? item.category !== "Crypto"
          : true,
    )
    .filter(
      (item) =>
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        relevance(a) - relevance(b) ||
        Number(watchlist.has(a.symbol)) - Number(watchlist.has(b.symbol)) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 8);
}

// ── Pure: parse percentage change ───────────────────────────────

function parsePct(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

function parsePrice(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "string" ? parseFloat(v) : v;
}

// ── Pure: sort ───────────────────────────────────────────────────

export function sortTrades(
  trades: Trade[],
  key: FinanceSortKey,
): Trade[] {
  return [...trades].sort((a, b) => {
    switch (key) {
      case "alpha":
        return a.symbol.localeCompare(b.symbol);
      case "price":
        return parsePrice(b.price) - parsePrice(a.price);
      case "change":
        return parsePct(b.percentage_change) - parsePct(a.percentage_change);
      case "updated": {
        const at = a.last_updated ?? "";
        const bt = b.last_updated ?? "";
        return bt.localeCompare(at);
      }
      default:
        return 0;
    }
  });
}

export interface StockViewOptions {
  view: FinanceView;
  watchlist: ReadonlySet<string>;
  selectedSectors: ReadonlySet<string>;
  categoryMap: ReadonlyMap<string, string>;
  sortKey: FinanceSortKey;
}

/** Stock-only market lenses. Crypto continues through its own pipeline. */
export function selectStockView(
  trades: Trade[],
  options: StockViewOptions,
): Trade[] {
  const { view, watchlist, selectedSectors, categoryMap, sortKey } = options;
  const sectors = new Set<string>(STOCK_SECTORS);
  let items =
    view === "watchlist"
      ? trades.filter((trade) => watchlist.has(trade.symbol))
      : trades.filter((trade) => {
          const sector = categoryMap.get(trade.symbol);
          return sector != null && sectors.has(sector);
        });
  if (selectedSectors.size > 0) {
    items = items.filter((trade) => {
      const sector = categoryMap.get(trade.symbol);
      return sector != null && selectedSectors.has(sector);
    });
  }

  return sortTrades(items, sortKey);
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Baseline pipeline used by the ticker: applies the user's `defaultSort`
 * from Display prefs. Ticker does not expose interactive filters.
 */
export function selectFinanceForTicker(
  trades: Trade[],
  prefs: FinanceDisplayPrefs,
): Trade[] {
  const sortKey: FinanceSortKey = prefs.defaultSort ?? "alpha";
  return sortTrades(trades, sortKey);
}

// ── Pipeline for FeedTab ─────────────────────────────────────────

export interface FinancePipelineOptions {
  view: FinanceView;
  selectedCategories: Set<string>;
  categoryMap: Map<string, string>;
  sortKey: FinanceSortKey;
  watchlist?: ReadonlySet<string>;
}

export function applyFinancePipeline(
  trades: Trade[],
  opts: FinancePipelineOptions,
): Trade[] {
  const { view, selectedCategories, categoryMap, sortKey, watchlist } = opts;

  let items = trades;

  if (view === "watchlist") {
    items = items.filter((t) => watchlist?.has(t.symbol));
  }

  if (selectedCategories.size > 0) {
    items = items.filter((t) => {
      const cat = categoryMap.get(t.symbol);
      return cat != null && selectedCategories.has(cat);
    });
  }

  return sortTrades(items, sortKey);
}
