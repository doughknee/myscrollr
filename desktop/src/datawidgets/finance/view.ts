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
 * Symbols on the rail at once. Beyond this the watchlist rotates through
 * the same four positions one lap at a time, so a list of three and a
 * list of thirty take the same width. Not a setting.
 */
export const TICKER_FINANCE_SLOTS = 4;

/**
 * The ticker's pool: the widget's watchlist, in the order the user built
 * it. Independent of the feed page -- its sort is about reading a list,
 * and re-sorting a list must not rearrange the rail. A symbol the
 * watchlist names but the payload lacks is simply absent; a payload row
 * the watchlist does not name trails, alphabetically, so a legacy widget
 * with no symbol list still shows everything.
 */
export function selectFinanceForTicker(trades: Trade[], watchlist: readonly string[]): Trade[] {
  const rank = new Map(watchlist.map((s, i) => [s, i] as const));
  const listed = trades
    .filter((t) => rank.has(t.symbol))
    .sort((a, b) => rank.get(a.symbol)! - rank.get(b.symbol)!);
  const rest = sortTrades(trades.filter((t) => !rank.has(t.symbol)), "alpha");
  return [...listed, ...rest];
}

/**
 * Widely held symbols, after a widget's own starter list (SCROLLR-259), for
 * the empty columns of a short watchlist under Pages (SCROLLR-292). Nothing
 * counts how many users track a symbol, so this is a constant; every one is
 * in the ingester's tracked list. Past it, the rest of the market by today's
 * volume, so even a 19-column ultrawide page fills.
 */
export const POPULAR_SYMBOLS: Record<"stock" | "crypto", readonly string[]> = {
  stock: ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA", "GOOGL", "META", "SPY", "QQQ", "AVGO", "NFLX", "AMD", "JPM", "V", "COST", "WMT", "DIS", "KO", "MA", "XOM"],
  crypto: ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "DOGE/USD", "ADA/USD", "BNB/USD", "AVAX/USD", "LINK/USD", "DOT/USD", "LTC/USD", "SHIB/USD", "TRX/USD", "BCH/USD", "XLM/USD", "SUI/USD", "NEAR/USD", "UNI/USD", "ATOM/USD", "HBAR/USD"],
};

/** How many symbols (the watchlist plus popular fills) the watchlist screen assumes a bar shows when no pages bar reports its width: about a 1920 px bar's columns. */
export const WATCHLIST_FILL_SHOWN = 10;

/**
 * Pages only (SCROLLR-292): quotes that may fill a short watchlist's page,
 * from the whole market (`/finance/public`). The widget's starter list,
 * then POPULAR_SYMBOLS, then the rest by today's volume; never one of the
 * user's own, and only the widget's asset class. Fills are NOT added to the
 * watchlist: each symbol the user adds pushes one fill out.
 */
export function selectFinanceFill(
  market: readonly Trade[],
  watchlist: readonly string[],
  starters: readonly string[],
  assetClass: string | undefined,
): Trade[] {
  const crypto = (s: string) => s.includes("/");
  const bySym = new Map(
    market
      .filter((t) => !assetClass || (assetClass === "crypto") === crypto(t.symbol))
      .map((t) => [t.symbol, t] as const),
  );
  const byVolume = [...bySym.values()]
    .sort((a, b) => (b.day_volume ?? 0) - (a.day_volume ?? 0) || a.symbol.localeCompare(b.symbol))
    .map((t) => t.symbol);
  const popular = assetClass === "stock" || assetClass === "crypto" ? POPULAR_SYMBOLS[assetClass] : [];
  const mine = new Set(watchlist);
  return [...new Set([...starters, ...popular, ...byVolume])]
    .filter((s) => !mine.has(s) && bySym.has(s))
    .map((s) => bySym.get(s)!);
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
