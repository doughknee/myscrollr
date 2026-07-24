import type { Prediction } from "../../types";
import PredictionChip from "../../components/chips/PredictionChip";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows } from "../ticker";
import { selectPredictionsForTicker } from "./view";

/**
 * Prediction-market ticker chips.
 *
 * Implied probability + ▲/▼ delta is the "heartbeat"; the universal
 * `defaultSort` (movers/volume/closing) governs ordering on both surfaces.
 * v1.1.4 scoping: starred markets only when the watchlist has any, otherwise
 * the selector falls back to the top rank-1 movers — never the whole
 * ingested universe.
 */
export const predictionsTickerSource: TickerSource = {
  chips(raw: unknown, ctx: TickerContext): TickerChip[] {
    const prefs = ctx.widgetDisplay?.predictions;
    if (!prefs) return [];

    const rows = scopedRows<Prediction>(raw, ctx);
    return selectPredictionsForTicker(rows, prefs, ctx.predictionsWatchlist).map(
      (p) => ({
        key: `pred-${p.id}`,
        node: (
          <PredictionChip
            prediction={p}
            comfort={ctx.comfort}
            colorMode={ctx.chipColorMode}
            onClick={() => ctx.onChipClick?.("predictions", p.id, p.link)}
          />
        ),
      }),
    );
  },
};
