/**
 * source → ticker-renderer registry.
 *
 * Separate from `ticker.ts` so the source modules can import the shared
 * contract without a cycle back through the registry that imports them.
 *
 * Adding a data source is: a folder with a `ticker.tsx`, plus one line here.
 * ScrollrTicker never changes.
 */
import type { TickerSource } from "./ticker";
import { financeTickerSource } from "./finance/ticker";
import { sportsTickerSource } from "./sports/ticker";
import { rssTickerSource } from "./rss/ticker";
import { predictionsTickerSource } from "./predictions/ticker";
import { fantasyTickerSource } from "./fantasy/ticker";

/** Chip renderers by data source. Indexing an unknown source yields
 *  undefined, so it renders nothing rather than throwing. */
export const TICKER_SOURCES: Record<string, TickerSource | undefined> = {
  finance: financeTickerSource,
  sports: sportsTickerSource,
  rss: rssTickerSource,
  predictions: predictionsTickerSource,
  fantasy: fantasyTickerSource,
};
