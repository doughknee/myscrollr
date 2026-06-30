/**
 * Predictions view selectors — shared filter/sort pipeline.
 *
 * Both `FeedTab` and `ScrollrTicker` consume `selectPredictionsForTicker`
 * (or `applyPredictionsPipeline` for interactive filters) to produce a
 * curated market list. SINGLE SOURCE OF TRUTH for Predictions display prefs.
 */
import type { Prediction } from "../../types";
import type { PredictionsDisplayPrefs } from "../../preferences";

export type PredictionsSortKey = "movers" | "volume" | "closing" | "alpha";
export type PredictionsDirectionFilter = "all" | "up" | "down";

// ── Pure: coercion helpers ───────────────────────────────────────

function num(v: number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : 0;
}

/** Signed implied-probability delta (yes_price - prev_yes_price), in cents. */
export function priceDelta(p: Prediction): number {
  return num(p.yes_price) - num(p.prev_yes_price);
}

/** Absolute magnitude of the move — drives the "movers" sort. */
function moverMagnitude(p: Prediction): number {
  return Math.abs(priceDelta(p));
}

function closeTimeMs(p: Prediction): number {
  if (!p.close_time) return Number.POSITIVE_INFINITY;
  const t = new Date(p.close_time).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

// ── Pure: sort ───────────────────────────────────────────────────

export function sortPredictions(
  items: Prediction[],
  key: PredictionsSortKey,
): Prediction[] {
  return [...items].sort((a, b) => {
    let primary = 0;
    switch (key) {
      case "movers":
        primary = moverMagnitude(b) - moverMagnitude(a);
        break;
      case "volume":
        primary = num(b.volume) - num(a.volume);
        break;
      case "closing":
        // Soonest-to-close first; markets with no close_time sink last.
        primary = closeTimeMs(a) - closeTimeMs(b);
        break;
      case "alpha":
        primary = a.title.localeCompare(b.title);
        break;
    }
    if (primary !== 0) return primary;
    // Deterministic identity tiebreak so equal-valued markets never swap
    // between live ticks (prevents jitter when many share a sort value).
    return a.ticker.localeCompare(b.ticker);
  });
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Baseline pipeline used by the ticker: applies the user's `defaultSort`
 * from Display prefs. Ticker does not expose interactive filters.
 */
export function selectPredictionsForTicker(
  items: Prediction[],
  prefs: PredictionsDisplayPrefs,
): Prediction[] {
  const sortKey: PredictionsSortKey = prefs.defaultSort ?? "movers";
  return sortPredictions(items, sortKey);
}

// ── Pipeline for FeedTab ─────────────────────────────────────────

export interface PredictionsPipelineOptions {
  directionFilter: PredictionsDirectionFilter;
  selectedCategories: Set<string>;
  categoryMap: Map<string, string>;
  sortKey: PredictionsSortKey;
}

export function applyPredictionsPipeline(
  items: Prediction[],
  opts: PredictionsPipelineOptions,
): Prediction[] {
  const { directionFilter, selectedCategories, categoryMap, sortKey } = opts;

  let list = items;

  if (directionFilter === "up") {
    list = list.filter((p) => priceDelta(p) > 0);
  } else if (directionFilter === "down") {
    list = list.filter((p) => priceDelta(p) < 0);
  }

  if (selectedCategories.size > 0) {
    list = list.filter((p) => {
      const cat = p.category ?? categoryMap.get(p.id);
      return cat != null && selectedCategories.has(cat);
    });
  }

  return sortPredictions(list, sortKey);
}

// ── Display formatting (cents == implied probability) ────────────

/** Implied probability as a whole-percent string ("62%"). Clamps to 0–100. */
export function formatProbability(yesPrice: number | null | undefined): string {
  return `${clampPct(yesPrice)}%`;
}

/** A price in cents as "62¢" (0–100). */
export function formatCentsPrice(cents: number | null | undefined): string {
  return `${clampPct(cents)}¢`;
}

function clampPct(v: number | null | undefined): number {
  const n = num(v);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/**
 * Bid–ask spread as "61–63¢", or "" when neither side is known. A single
 * known side renders alone ("61¢"). Used in the market-detail view.
 */
export function formatSpread(
  bid: number | null | undefined,
  ask: number | null | undefined,
): string {
  const hasBid = bid != null && Number.isFinite(bid);
  const hasAsk = ask != null && Number.isFinite(ask);
  if (hasBid && hasAsk) return `${clampPct(bid)}–${clampPct(ask)}¢`;
  if (hasBid) return `${clampPct(bid)}¢`;
  if (hasAsk) return `${clampPct(ask)}¢`;
  return "";
}

/**
 * Short, glanceable label for a market. Kalshi event titles are full
 * sentences; the contract already stores a compacted `title`, so we lead with
 * that and append the outcome `subtitle` when it adds signal — truncated so it
 * never overruns a ticker chip or card. (Plan §8.1: title compaction.)
 */
export function marketLabel(p: Prediction, maxLen = 64): string {
  const title = (p.title || p.ticker || "").trim();
  const sub = (p.subtitle ?? "").trim();
  let label = title;
  if (sub && sub.toLowerCase() !== title.toLowerCase() && !title.includes(sub)) {
    label = `${title} · ${sub}`;
  }
  if (label.length <= maxLen) return label;
  return `${label.slice(0, maxLen - 1).trimEnd()}…`;
}

// ── Resolved Today ───────────────────────────────────────────────

const RESOLVED_STATUSES = new Set(["settled", "determined", "finalized"]);

/** A market is "resolved" once it has a settlement status or a yes/no result. */
export function isResolved(p: Prediction): boolean {
  const status = (p.status ?? "").toLowerCase();
  if (RESOLVED_STATUSES.has(status)) return true;
  const result = (p.result ?? "").toLowerCase();
  return result === "yes" || result === "no";
}

/**
 * Markets resolved within the trailing `windowMs` (default 24h), most-recent
 * first. Drives the "Resolved Today" recap — closure no other feed gives.
 * Uses `updated_at` (the settlement write) falling back to `close_time`.
 */
export function selectResolvedToday(
  items: Prediction[],
  now: number,
  windowMs = 24 * 60 * 60 * 1000,
): Prediction[] {
  const resolvedTimeMs = (p: Prediction): number => {
    const stamp = p.updated_at ?? p.close_time;
    if (!stamp) return NaN;
    return new Date(stamp).getTime();
  };
  return items
    .filter(isResolved)
    .filter((p) => {
      const t = resolvedTimeMs(p);
      return Number.isFinite(t) && now - t >= 0 && now - t <= windowMs;
    })
    .sort((a, b) => resolvedTimeMs(b) - resolvedTimeMs(a));
}
