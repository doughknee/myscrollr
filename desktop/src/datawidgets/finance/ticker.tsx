import type { Trade } from "../../types";
import TradeChip from "../../components/chips/TradeChip";
import { chipUrlForFinance } from "../../utils/chipUrl";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectFinanceForTicker } from "./view";

/**
 * Finance ticker chips.
 *
 * Display prefs: `defaultSort` affects both feed and ticker (universal
 * sort).
 */
export const financeTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const prefs = ctx.widgetDisplay?.finance;
    if (!prefs) return [];

    const rows = scopedRows<Trade>(raw, ctx);
    return selectFinanceForTicker(rows, prefs).map((trade) => ({
      key: `fin-${trade.symbol}`,
      node: (
        <TradeChip
          trade={trade}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          directionMarker={prefs.tickerDirectionMarker ?? "arrow"}
          onClick={() =>
            ctx.onChipClick?.("finance", trade.symbol, chipUrlForFinance(trade))
          }
        />
      ),
    }));
  },
};
