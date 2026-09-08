import type { Prediction } from "../../types";
import PredictionChip from "../../components/chips/PredictionChip";
import type { TickerChip, TickerContext, TickerSource } from "../ticker";
import { scopedRows, rotateSlots, dropPinned } from "../ticker";
import { selectPredictionsForTicker, TICKER_PREDICTIONS_SLOTS } from "./view";

/** What a market is called in a menu: the event question if the sweep has
 *  backfilled one, else this leg's own title. */
function labelFor(p: Prediction): string {
  return p.event_title || p.title;
}

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
      // Subject is the market TICKER, not the row id: it is what the
      // watchlist keys on and what survives a re-ingest of the same
      // market, so a pin outlives the row it was made from.
      dropPinned(
        selectPredictionsForTicker(rows, ctx.predictionsWatchlist),
        ctx,
        (p) => p.ticker,
      ),
      TICKER_PREDICTIONS_SLOTS,
      ctx.cycles ?? {},
      `pred-${ctx.tab}`,
      (p) => p.id,
      () => undefined,
      ctx.rotationMemo,
    );
    return slots.map(({ key, item: p, rotateSlot }) => ({
      key,
      rotateSlot,
      subject: p.ticker,
      pinLabel: labelFor(p),
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

  // Stars and the trending fallback both come off: a pinned market is on
  // the bar because the user parked it there, not because it is moving.
  // A market that has resolved out of the payload renders nothing.
  pinnedChip(raw: unknown, ctx: TickerContext): TickerChip | null {
    const p = scopedRows<Prediction>(raw, ctx).find(
      (m) => m.ticker === ctx.pinnedSubject,
    );
    if (!p) return null;
    return {
      key: `pin-pred-${ctx.tab}-${p.ticker}`,
      subject: p.ticker,
      pinLabel: labelFor(p),
      node: (
        <PredictionChip
          prediction={p}
          comfort={ctx.comfort}
          colorMode={ctx.chipColorMode}
          onClick={() => ctx.onChipClick?.("predictions", p.id, p.link)}
        />
      ),
    };
  },

  subjects(raw: unknown, ctx: TickerContext) {
    return selectPredictionsForTicker(
      scopedRows<Prediction>(raw, ctx),
      ctx.predictionsWatchlist,
    ).map((p) => ({ subject: p.ticker, label: labelFor(p) }));
  },
};
