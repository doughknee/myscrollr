import type { Trade } from "../../types";
import TradeChip from "../../components/chips/TradeChip";
import { chipUrlForFinance } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows, rotateSlots } from "../ticker";
import { selectFinanceForTicker, TICKER_FINANCE_SLOTS } from "./view";

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
    const config = ctx.dashboard?.widgets?.find((c) => c.widget_type === ctx.tab)?.config as
      | { symbols?: unknown }
      | undefined;
    const watchlist = Array.isArray(config?.symbols)
      ? config.symbols.filter((s): s is string => typeof s === "string")
      : [];
    const slots = rotateSlots(
      selectFinanceForTicker(rows, watchlist),
      TICKER_FINANCE_SLOTS,
      ctx.cycles ?? {},
      `fin-${ctx.tab}`,
      (t) => t.symbol,
      () => undefined,
    );
    return slots.map(({ key, item: trade, rotateSlot }) => ({
      key,
      rotateSlot,
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
};
