import type { Prediction } from "../../types";
import PredictionChip from "../../components/chips/PredictionChip";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows, rotateSlots } from "../ticker";
import { selectPredictionsForTicker, TICKER_PREDICTIONS_SLOTS } from "./view";

/**
 * Prediction-market ticker chips.
 *
 * v1.1.4 scoping stays: starred markets only when the watchlist has any,
 * otherwise the top rank-1 movers -- never the whole ingested universe.
 * The feed page's sort no longer reaches the rail; the pool is ordered by
 * one fixed rule and rotates through a fixed number of slots. The chip
 * is fixed-width, so a slot needs no reservation.
 */
export const predictionsTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const rows = scopedRows<Prediction>(raw, ctx);
    const slots = rotateSlots(
      selectPredictionsForTicker(rows, ctx.predictionsWatchlist),
      TICKER_PREDICTIONS_SLOTS,
      ctx.cycles ?? {},
      `pred-${ctx.tab}`,
      (p) => p.id,
      () => undefined,
    );
    return slots.map(({ key, item: p, rotateSlot }) => ({
      key,
      rotateSlot,
      node: (
        <PredictionChip
          prediction={p}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          onClick={() => ctx.onChipClick?.("predictions", p.id, p.link)}
        />
      ),
    }));
  },
};
