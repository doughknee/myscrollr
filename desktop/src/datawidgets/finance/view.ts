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
export type FinanceDirectionFilter = "all" | "gainers" | "losers";

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

export function sortTrades(trades: Trade[], key: FinanceSortKey): Trade[] {
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
}

export function applyFinancePipeline(
  trades: Trade[],
  opts: FinancePipelineOptions,
): Trade[] {
  const { directionFilter, selectedCategories, categoryMap, sortKey } = opts;

  let items = trades;

  if (directionFilter === "gainers") {
    items = items.filter((t) => parsePct(t.percentage_change) > 0);
  } else if (directionFilter === "losers") {
    items = items.filter((t) => parsePct(t.percentage_change) < 0);
  }

  if (selectedCategories.size > 0) {
    items = items.filter((t) => {
      const cat = categoryMap.get(t.symbol);
      return cat != null && selectedCategories.has(cat);
    });
  }

  return sortTrades(items, sortKey);
}
