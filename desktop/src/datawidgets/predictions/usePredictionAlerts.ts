/**
 * usePredictionAlerts — records live prices for sparklines and fires local
 * price alerts as the feed updates.
 *
 * Account-free and fully local: every time the market list changes we append
 * each market's `yes_price` to the rolling sparkline history and evaluate the
 * user's alert rules against the previous snapshot. Alerts are edge-triggered
 * (see watchlist.crossed), so each crossing notifies exactly once via a toast.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { recordPrice } from "./sparkline";
import { evaluateAlerts, describeAlert, type PredictionAlert } from "./watchlist";
import type { Prediction } from "../../types";

export function usePredictionAlerts(
  markets: Prediction[],
  alerts: PredictionAlert[],
  enabled = true,
): void {
  // Previous ticker→price snapshot, for edge-triggered crossing detection.
  const prevPricesRef = useRef<Map<string, number>>(new Map());
  // Keep the latest alerts in a ref so the effect can depend only on `markets`
  // (prices) — we don't want to re-run the whole pass just because an unrelated
  // alert field changed; we always read the current rules at tick time.
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  useEffect(() => {
    if (!enabled) return;
    if (markets.length === 0) return;

    // 1) Record prices for the sparkline history.
    for (const m of markets) {
      recordPrice(m.ticker, m.yes_price);
    }

    // 2) Evaluate alerts against the previous snapshot.
    const prices = buildPriceMapByTicker(markets);
    const triggers = evaluateAlerts(alertsRef.current, prices, prevPricesRef.current);
    for (const t of triggers) {
      toast(`${t.alert.label || t.alert.ticker}`, {
        description: `Now ${t.price}% — your alert (${describeAlert(t.alert)}) just triggered.`,
      });
    }

    // 3) Roll the snapshot forward.
    prevPricesRef.current = prices;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, enabled]);
}

/** Ticker→yes_price map (cents). Separate from positions' id-keyed map. */
function buildPriceMapByTicker(markets: Prediction[]): Map<string, number> {
  const byTicker = new Map<string, number>();
  for (const m of markets) {
    if (typeof m.yes_price === "number") byTicker.set(m.ticker, m.yes_price);
  }
  return byTicker;
}
