/**
 * Personal watchlist + local price alerts for the predictions channel.
 *
 * Entirely local + account-free: the watchlist is a list of starred market
 * tickers and alerts are "ticker crosses N%" rules, both persisted via the
 * single-key pref store (localStorage-backed). Alert evaluation is pure and
 * edge-triggered (fires only when a price *crosses* the threshold), so it's
 * unit-tested in isolation and never spams on every tick.
 */
import { loadPref, savePref } from "../../preferences";
import { onStoreChange } from "../../lib/store";

const WATCHLIST_KEY = "predictions.watchlist";
const ALERTS_KEY = "predictions.alerts";

// ── Watchlist ────────────────────────────────────────────────────

export function getWatchlist(): string[] {
  const raw = loadPref<unknown>(WATCHLIST_KEY, []);
  return Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
}

/**
 * Subscribe to watchlist changes from ANY webview. The pref store's cache
 * is per-window — the ticker window never sees stars toggled in the main
 * window unless it subscribes to the underlying Tauri-store key. Returns
 * an unsubscribe function. (`loadPref` prefixes keys with "scrollr:", so
 * the raw store key is spelled out here to match.)
 */
export function onWatchlistChange(callback: (list: string[]) => void): () => void {
  return onStoreChange<unknown>(`scrollr:${WATCHLIST_KEY}`, () => {
    callback(getWatchlist());
  });
}

export function saveWatchlist(list: string[]): void {
  savePref(WATCHLIST_KEY, list);
}

/** Pure: toggle membership of `ticker` in `list`. */
export function withToggled(list: string[], ticker: string): string[] {
  return list.includes(ticker)
    ? list.filter((t) => t !== ticker)
    : [...list, ticker];
}

/** Toggle + persist; returns the new list. */
export function toggleWatch(ticker: string): string[] {
  const next = withToggled(getWatchlist(), ticker);
  saveWatchlist(next);
  return next;
}

export function isWatched(ticker: string, list: string[]): boolean {
  return list.includes(ticker);
}

// ── Alerts ───────────────────────────────────────────────────────

export type AlertComparator = "above" | "below";

export interface PredictionAlert {
  id: string;
  ticker: string;
  /** Human label for the notification (market title at creation time). */
  label: string;
  comparator: AlertComparator;
  /** Implied-probability threshold in cents (0–100). */
  threshold: number;
  enabled: boolean;
  /** Epoch-ms of the last time this alert fired (for de-dupe/UX). */
  lastTriggeredAt?: number;
}

export function getAlerts(): PredictionAlert[] {
  const raw = loadPref<unknown>(ALERTS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidAlert);
}

export function saveAlerts(alerts: PredictionAlert[]): void {
  savePref(ALERTS_KEY, alerts);
}

function isValidAlert(a: unknown): a is PredictionAlert {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.ticker === "string" &&
    (o.comparator === "above" || o.comparator === "below") &&
    typeof o.threshold === "number"
  );
}

/** Pure: add an alert to a list. */
export function withAlertAdded(list: PredictionAlert[], alert: PredictionAlert): PredictionAlert[] {
  return [...list, alert];
}

/** Pure: remove an alert by id. */
export function withAlertRemoved(list: PredictionAlert[], id: string): PredictionAlert[] {
  return list.filter((a) => a.id !== id);
}

/** Pure: patch one alert by id. */
export function withAlertPatched(
  list: PredictionAlert[],
  id: string,
  patch: Partial<PredictionAlert>,
): PredictionAlert[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

/** Create + persist a new alert; returns the new list. */
export function addAlert(input: {
  ticker: string;
  label: string;
  comparator: AlertComparator;
  threshold: number;
}): PredictionAlert[] {
  const alert: PredictionAlert = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${input.ticker}-${input.comparator}-${input.threshold}`,
    ticker: input.ticker,
    label: input.label,
    comparator: input.comparator,
    threshold: input.threshold,
    enabled: true,
  };
  const next = withAlertAdded(getAlerts(), alert);
  saveAlerts(next);
  return next;
}

export function removeAlert(id: string): PredictionAlert[] {
  const next = withAlertRemoved(getAlerts(), id);
  saveAlerts(next);
  return next;
}

// ── Evaluation (pure, edge-triggered) ────────────────────────────

export interface AlertTrigger {
  alert: PredictionAlert;
  /** The price (cents) that satisfied the alert. */
  price: number;
}

/**
 * True when `curr` crossed `threshold` in the alert's direction relative to
 * `prev`. Edge-triggered: we need a previous observation on the other side of
 * the line, so the first time we see a market we never fire (avoids alerting on
 * load just because a price is already past the threshold).
 */
export function crossed(
  comparator: AlertComparator,
  threshold: number,
  prev: number | undefined,
  curr: number,
): boolean {
  if (prev == null || !Number.isFinite(prev)) return false;
  if (comparator === "above") return prev < threshold && curr >= threshold;
  return prev > threshold && curr <= threshold;
}

/**
 * Evaluate all enabled alerts against current vs previous prices (ticker →
 * cents). Returns the alerts that fired this tick.
 */
export function evaluateAlerts(
  alerts: PredictionAlert[],
  prices: Map<string, number>,
  prevPrices: Map<string, number>,
): AlertTrigger[] {
  const out: AlertTrigger[] = [];
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    const curr = prices.get(alert.ticker);
    if (curr == null || !Number.isFinite(curr)) continue;
    const prev = prevPrices.get(alert.ticker);
    if (crossed(alert.comparator, alert.threshold, prev, curr)) {
      out.push({ alert, price: curr });
    }
  }
  return out;
}

/** Human-readable description of an alert ("Above 50%"). */
export function describeAlert(a: PredictionAlert): string {
  return `${a.comparator === "above" ? "Above" : "Below"} ${a.threshold}%`;
}
