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
export type FinanceDirectionFilter = "all" | "gainers" | "losers" | "watchlist";
export type StockView =
  | "overview"
  | "big-tech"
  | "sectors"
  | "active"
  | "watchlist";

export const MARKET_OVERVIEW_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM"] as const;
export const BIG_TECH_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
] as const;
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
  key: FinanceSortKey | "volume",
): Trade[] {
  return [...trades].sort((a, b) => {
    switch (key) {
      case "alpha":
        return a.symbol.localeCompare(b.symbol);
      case "price":
        return parsePrice(b.price) - parsePrice(a.price);
      case "change":
        return parsePct(b.percentage_change) - parsePct(a.percentage_change);
      case "volume":
        return (b.day_volume ?? 0) - (a.day_volume ?? 0);
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
  view: StockView;
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
  let items: Trade[];

  switch (view) {
    case "overview": {
      const symbols = new Set<string>(MARKET_OVERVIEW_SYMBOLS);
      items = trades.filter((trade) => symbols.has(trade.symbol));
      break;
    }
    case "big-tech": {
      const symbols = new Set<string>(BIG_TECH_SYMBOLS);
      items = trades.filter((trade) => symbols.has(trade.symbol));
      break;
    }
    case "sectors": {
      const sectors = new Set<string>(STOCK_SECTORS);
      items = trades.filter((trade) => {
        const sector = categoryMap.get(trade.symbol);
        return (
          sector != null &&
          sectors.has(sector) &&
          (selectedSectors.size === 0 || selectedSectors.has(sector))
        );
      });
      break;
    }
    case "active":
      return sortTrades(trades, "volume");
    case "watchlist":
      items = trades.filter((trade) => watchlist.has(trade.symbol));
      break;
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
  directionFilter: FinanceDirectionFilter;
  selectedCategories: Set<string>;
  categoryMap: Map<string, string>;
  sortKey: FinanceSortKey;
  watchlist?: ReadonlySet<string>;
}

export function applyFinancePipeline(
  trades: Trade[],
  opts: FinancePipelineOptions,
): Trade[] {
  const { directionFilter, selectedCategories, categoryMap, sortKey, watchlist } = opts;

  let items = trades;

  if (directionFilter === "gainers") {
    items = items.filter((t) => parsePct(t.percentage_change) > 0);
  } else if (directionFilter === "losers") {
    items = items.filter((t) => parsePct(t.percentage_change) < 0);
  } else if (directionFilter === "watchlist") {
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
