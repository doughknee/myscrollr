/**
 * Predictions view selectors — shared filter/sort pipeline.
 *
 * Both `FeedTab` and `ScrollrTicker` consume `selectPredictionsForTicker`
 * (or `applyPredictionsPipeline` for interactive filters) to produce a
 * curated market list. SINGLE SOURCE OF TRUTH for Predictions display prefs.
 */
import type { Prediction } from "../../types";
import type { PredictionsDisplayPrefs } from "../../preferences";
import { formatCloseCountdown } from "../../utils/format";

/** "trending" = trailing-24h volume (v1.1.5) — falls back to all-time
 *  volume on old payloads that don't carry `volume_24h`. */
export type PredictionsSortKey = "trending" | "movers" | "closing" | "alpha";

/** The feed's ways of looking at the market universe (v1.1.5).
 *  One lens row replaces the old direction filter + category config.
 *  "resolved" is the trailing-24h settlement recap as a first-class view
 *  (full cards) — it replaced the cramped chip strip. */
export type PredictionsLens =
  | "trending"
  | "movers"
  | "closing"
  | "resolved"
  | "watchlist";

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

/** Trending weight: trailing-24h volume, falling back to all-time volume
 *  for old payloads (pre-v1.1.5 API / demo bridge). */
function trendingVolume(p: Prediction): number {
  return num(p.volume_24h) || num(p.volume);
}

/**
 * Whether a market belongs in LIVE surfaces (feed grids, ticker fallback).
 * `in_sweep === false` means the server's sweep dropped it (settled,
 * delisted, or out-ranked) — its price is frozen, so rendering it as live
 * is exactly the stale-data bug v1.1.5 fixes. Resolved markets are also
 * excluded here; they surface via the "Resolved today" strip instead.
 * Undefined `in_sweep` (old payloads) counts as live.
 */
export function isDisplayable(p: Prediction): boolean {
  return p.in_sweep !== false && !isResolved(p);
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
      case "trending":
        primary = trendingVolume(b) - trendingVolume(a);
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

// ── Pure: feed lenses (v1.1.5) ───────────────────────────────────

/**
 * The single entry point for the feed's market list. Applies the liveness
 * guard, then the lens's own filter + ordering:
 *   - trending: everything live, hottest (24h volume) first.
 *   - movers: only markets whose price actually moved, biggest move first.
 *   - closing: only markets with a future close, soonest first.
 *   - resolved: settled within the trailing 24h, most recent first
 *     (`now` anchors the window — pass the shared useNow() tick).
 *   - watchlist: starred markets (any rank). Resolved stars stay visible
 *     here — a star means "always show me this", and a just-settled
 *     watched market is exactly what the user wants closure on.
 */
export function selectLens(
  items: Prediction[],
  lens: PredictionsLens,
  watchlist: ReadonlySet<string>,
  now: number = Date.now(),
): Prediction[] {
  switch (lens) {
    case "trending":
      return sortPredictions(items.filter(isDisplayable), "trending");
    case "movers":
      return sortPredictions(
        items.filter((p) => isDisplayable(p) && priceDelta(p) !== 0),
        "movers",
      );
    case "closing":
      return sortPredictions(
        items.filter(
          (p) => isDisplayable(p) && Number.isFinite(closeTimeMs(p)),
        ),
        "closing",
      );
    case "resolved":
      return selectResolvedToday(items, now);
    case "watchlist":
      return sortPredictions(
        items.filter(
          (p) =>
            watchlist.has(p.ticker) &&
            (p.in_sweep !== false || isResolved(p)),
        ),
        "trending",
      );
  }
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Ticker chip budget when the user has no watchlist (v1.1.4): the top N
 * rank-1 markets by the chosen sort — a briefing, not the old firehose
 * of every ingested market. One star flips the rail to watchlist-only.
 */
export const TICKER_FALLBACK_LIMIT = 15;

/**
 * Baseline pipeline used by the ticker (v1.1.4 scoping):
 *   - Watchlist non-empty → starred markets only (any event rank).
 *   - Otherwise → the top TICKER_FALLBACK_LIMIT rank-1 legs (one per
 *     event) by the user's `defaultSort`.
 */
export function selectPredictionsForTicker(
  items: Prediction[],
  prefs: PredictionsDisplayPrefs,
  watchlist?: ReadonlySet<string>,
): Prediction[] {
  const sortKey: PredictionsSortKey = prefs.defaultSort ?? "trending";
  if (watchlist && watchlist.size > 0) {
    // Starred markets only. Dropped-but-unresolved stars are excluded —
    // their frozen price scrolling by forever IS the stale-data bug.
    // Resolved stars stay (final odds are closure, and the resolved-today
    // payload window bounds how long they linger).
    return sortPredictions(
      items.filter(
        (p) =>
          watchlist.has(p.ticker) &&
          (p.in_sweep !== false || isResolved(p)),
      ),
      sortKey,
    );
  }
  const primaries = items.filter(
    (p) => isDisplayable(p) && (p.event_rank ?? 1) === 1,
  );
  return sortPredictions(primaries, sortKey).slice(0, TICKER_FALLBACK_LIMIT);
}

// ── Pure: event grouping (v1.1.4 Kalshi-style cards) ─────────────

export interface PredictionEvent {
  eventTicker: string;
  /** The event's human question; falls back to the lead leg's title for
   *  rows ingested before the event_title backfill. */
  title: string;
  category?: string;
  /** Rank-ordered legs (the server sends at most two per event). */
  outcomes: Prediction[];
  /** Summed across legs — the card's volume line. */
  volume: number;
  /** Summed trailing-24h volume across legs — orders category sections
   *  and the card footer (v1.1.5). Falls back to all-time volume. */
  volume24h: number;
  closeTime?: string | null;
}

/**
 * Group a market list into events, preserving the input ordering by each
 * event's LEAD leg (so an upstream sort applies to the cards). Markets
 * without an event_ticker become single-outcome events keyed by ticker.
 */
export function groupByEvent(items: Prediction[]): PredictionEvent[] {
  const byEvent = new Map<string, PredictionEvent>();
  for (const p of items) {
    const key = p.event_ticker || p.ticker;
    const existing = byEvent.get(key);
    if (!existing) {
      byEvent.set(key, {
        eventTicker: key,
        title: p.event_title || p.title,
        category: p.category,
        outcomes: [p],
        volume: num(p.volume),
        volume24h: trendingVolume(p),
        closeTime: p.close_time ?? null,
      });
      continue;
    }
    existing.outcomes.push(p);
    existing.volume += num(p.volume);
    existing.volume24h += trendingVolume(p);
    if (!existing.title && (p.event_title || p.title)) {
      existing.title = p.event_title || p.title;
    }
  }
  for (const ev of byEvent.values()) {
    ev.outcomes.sort((a, b) => (a.event_rank ?? 1) - (b.event_rank ?? 1));
  }
  return Array.from(byEvent.values());
}

// ── Pure: category sections (v1.1.5 Kalshi-style browse) ─────────

export interface CategorySection {
  category: string;
  /** Events in input order (already lens-sorted upstream). */
  events: PredictionEvent[];
  /** Summed 24h volume across the section's events — section order. */
  volume24h: number;
}

/**
 * Stable-group an (already sorted) event list into category sections,
 * hottest section first. Events without a category land in "Other".
 */
export function groupEventsByCategory(
  events: PredictionEvent[],
): CategorySection[] {
  const byCategory = new Map<string, CategorySection>();
  for (const ev of events) {
    const key = ev.category || "Other";
    const existing = byCategory.get(key);
    if (!existing) {
      byCategory.set(key, {
        category: key,
        events: [ev],
        volume24h: ev.volume24h,
      });
      continue;
    }
    existing.events.push(ev);
    existing.volume24h += ev.volume24h;
  }
  return Array.from(byCategory.values()).sort(
    (a, b) => b.volume24h - a.volume24h,
  );
}

// ── Multi-outcome cards (B2, version-bump pass) ──────────────────

/** Outcome rows a card shows before "+N more" takes over. */
export const CARD_OUTCOME_LIMIT = 2;

/**
 * Real legs ordered by implied probability, highest first. Ties break by
 * event rank (most-liquid first) then ticker, so equal prices never jitter
 * between live ticks. Used by cards (top slice) and the detail view (full
 * list).
 */
export function outcomesByPrice(outcomes: Prediction[]): Prediction[] {
  return [...outcomes].sort(
    (a, b) =>
      num(b.yes_price) - num(a.yes_price) ||
      (a.event_rank ?? 1) - (b.event_rank ?? 1) ||
      a.ticker.localeCompare(b.ticker),
  );
}

/**
 * The card's outcome slice: top `limit` legs by price plus how many were
 * hidden ("+N more"). Today the server ships at most two legs per event, so
 * `extra` is always 0 in prod — the mechanism is tested and ready for the
 * leg-cap lift (ui-review/NOTES.md, shared-code log #3).
 */
export function cardOutcomes(
  outcomes: Prediction[],
  limit: number = CARD_OUTCOME_LIMIT,
): { visible: Prediction[]; extra: number } {
  const sorted = outcomesByPrice(outcomes);
  return {
    visible: sorted.slice(0, limit),
    extra: Math.max(0, sorted.length - limit),
  };
}

// ── Time indicators (B3, version-bump pass) ──────────────────────

export type TimeIndicator =
  | { kind: "closes"; label: string }
  | { kind: "closed" }
  | { kind: "none" };

/**
 * Pick the card's time indicator: "Closes 5d" while trading, "Closed"
 * once the close has passed. Resolved markets get "none" — settlement
 * stamps are their own row.
 */
export function timeIndicator(p: Prediction, now: number): TimeIndicator {
  if (isResolved(p)) return { kind: "none" };

  const closeLabel = formatCloseCountdown(p.close_time, now);
  if (closeLabel === "Closed") return { kind: "closed" };

  return closeLabel
    ? { kind: "closes", label: `Closes ${closeLabel}` }
    : { kind: "none" };
}

// ── Display formatting (cents == implied probability) ────────────

/** Implied probability as a whole-percent string ("62%"). Clamps to 0–100. */
export function formatProbability(yesPrice: number | null | undefined): string {
  return `${clampPct(yesPrice)}%`;
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
 * Prefers `settled_at` (the once-stamped resolution transition, v1.1.5);
 * `updated_at`/`close_time` are legacy fallbacks for old payloads where
 * they were the best approximation available.
 */
export function selectResolvedToday(
  items: Prediction[],
  now: number,
  windowMs = 24 * 60 * 60 * 1000,
): Prediction[] {
  const resolvedTimeMs = (p: Prediction): number => {
    const stamp = p.settled_at ?? p.updated_at ?? p.close_time;
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
