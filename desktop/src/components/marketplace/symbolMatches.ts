/**
 * Catalog search → symbols (SCROLLR-285).
 *
 * "AAPL" or "Bitcoin" typed in the catalog also finds the symbol itself,
 * as "Add AAPL to your Stocks". There is no second search: the matching is
 * the Stocks / Crypto config UI's own `searchFinanceCatalog` over the same
 * `/finance/symbols` list (enabled tracked symbols only), so the symbols
 * that can be added are exactly the ones the watchlist can already add.
 */
import type { CatalogItem } from "../../marketplace";
import type { TrackedSymbol } from "../../api/queries";
import { searchFinanceCatalog } from "../../datawidgets/finance/view";
import { normalizeQuery } from "./catalogSearch";

/** Below this a query is noise ("a" matches half the catalog by name). */
export const SYMBOL_MIN_QUERY = 2;
const PER_WIDGET = 4;

export interface SymbolGroup {
  /** The Stocks or Crypto catalog entry the symbols are added to. */
  item: CatalogItem;
  hits: TrackedSymbol[];
}

/** The widgets that hold a watchlist: finance entries with an asset class. */
function watchlistWidgets(items: readonly CatalogItem[]): CatalogItem[] {
  return items.filter(
    (i) =>
      i.source === "finance" &&
      (i.addConfig?.asset_class === "stock" ||
        i.addConfig?.asset_class === "crypto"),
  );
}

export function symbolGroups(
  items: readonly CatalogItem[],
  catalog: readonly TrackedSymbol[],
  query: string,
): SymbolGroup[] {
  const q = normalizeQuery(query);
  if (q.length < SYMBOL_MIN_QUERY) return [];
  return watchlistWidgets(items).flatMap((item) => {
    const hits = searchFinanceCatalog(
      catalog,
      q,
      item.addConfig?.asset_class as string,
    ).slice(0, PER_WIDGET);
    return hits.length ? [{ item, hits }] : [];
  });
}

/** "BTC/USD" → "BTC": the coin, not the quote pair. */
export function symbolLabel(symbol: string): string {
  return symbol.split("/")[0];
}

/** The symbols currently on a widget's watchlist. */
export function watchlistOf(config: unknown): string[] {
  const s = (config as { symbols?: unknown } | null | undefined)?.symbols;
  return Array.isArray(s) ? (s as string[]) : [];
}

export type SymbolAddPlan =
  | { kind: "on-list" }
  /** Widget exists: write the symbol into its watchlist. */
  | { kind: "append"; symbols: string[] }
  /** No widget yet: create it holding just this symbol (no starter list). */
  | { kind: "create"; config: Record<string, unknown> }
  /** Creating would need a sign-in, or a slot the plan doesn't have. */
  | { kind: "gate" };

/**
 * What one click on "Add AAPL to your Stocks" does. Pure so the outcomes
 * (duplicate, existing widget, missing widget, cap) are testable without a UI.
 */
export function planSymbolAdd(args: {
  symbol: string;
  item: CatalogItem;
  /** The user's row for this widget, or undefined when they have none. */
  row: { config?: unknown } | undefined;
  /** Adding the widget is blocked: signed out, tier, or the plan is full. */
  gated: boolean;
}): SymbolAddPlan {
  const { symbol, item, row, gated } = args;
  if (row) {
    const list = watchlistOf(row.config);
    return list.includes(symbol)
      ? { kind: "on-list" }
      : { kind: "append", symbols: [...list, symbol] };
  }
  if (gated) return { kind: "gate" };
  return { kind: "create", config: { ...item.addConfig, symbols: [symbol] } };
}
