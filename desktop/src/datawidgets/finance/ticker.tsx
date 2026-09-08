import type { Trade } from "../../types";
import TradeChip from "../../components/chips/TradeChip";
import { chipUrlForFinance } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows, rotateSlots, dropPinned } from "../ticker";
import { selectFinanceForTicker, TICKER_FINANCE_SLOTS } from "./view";

/** The finance subject is the symbol: durable, and what the user typed. */
function watchlistOf(ctx: TickerContext): string[] {
  const config = ctx.dashboard?.widgets?.find((c) => c.widget_type === ctx.tab)?.config as
    | { symbols?: unknown }
    | undefined;
  return Array.isArray(config?.symbols)
    ? config.symbols.filter((s): s is string => typeof s === "string")
    : [];
}

/**
 * Finance ticker chips.
 *
 * Independent of the feed page: the pool is the widget's watchlist in
 * the order the user built it, rotating through a fixed number of slots.
 * A list of three shows three; a list of thirty still shows four and
 * every symbol comes round. The chip is fixed-width, so a slot needs no
 * reservation to hold its size across swaps.
 */
export const financeTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const rows = scopedRows<Trade>(raw, ctx);
    const pool = dropPinned(
      selectFinanceForTicker(rows, watchlistOf(ctx)),
      ctx,
      (t) => t.symbol,
    );
    const slots = rotateSlots(
      pool,
      TICKER_FINANCE_SLOTS,
      ctx.cycles ?? {},
      `fin-${ctx.tab}`,
      (t) => t.symbol,
      () => undefined,
      ctx.rotationMemo,
    );
    return slots.map(({ key, item: trade, rotateSlot }) => ({
      key,
      rotateSlot,
      subject: trade.symbol,
      pinLabel: trade.symbol,
      node: (
        <TradeChip
          trade={trade}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          onClick={() => ctx.onChipClick?.("finance", trade.symbol, chipUrlForFinance(trade))}
        />
      ),
    }));
  },

  // No horizon to bypass: finance shows whatever the server last traded
  // for the symbol. Nothing quoted yet -> nothing rendered.
  pinnedChip(raw: unknown, ctx: TickerContext): TickerChip | null {
    const trade = scopedRows<Trade>(raw, ctx).find(
      (t) => t.symbol === ctx.pinnedSubject,
    );
    if (!trade) return null;
    return {
      key: `pin-fin-${ctx.tab}-${trade.symbol}`,
      subject: trade.symbol,
      pinLabel: trade.symbol,
      node: (
        <TradeChip
          trade={trade}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          onClick={() => ctx.onChipClick?.("finance", trade.symbol, chipUrlForFinance(trade))}
        />
      ),
    };
  },

  subjects(_raw: unknown, ctx: TickerContext) {
    return watchlistOf(ctx).map((symbol) => ({ subject: symbol, label: symbol }));
  },
};
