/**
 * Sports view selectors — shared filter/sort pipeline.
 *
 * Sports display prefs live server-side on the dashboard channel config
 * (not in `prefs.channelDisplay`), so this selector accepts the config
 * blob shape. Both `FeedTab` and `ScrollrTicker` call `selectSportsForTicker`
 * to apply showUpcoming/showFinal filters + engagement sort.
 *
 * SINGLE SOURCE OF TRUTH for Sports display prefs.
 */
import type { Game } from "../../types";
import { isLive, isCloseGame, isFinal, isPre } from "../../utils/gameHelpers";
import { migrateVenue, shouldShowOnFeed, shouldShowOnTicker } from "../../preferences";
import type { Venue } from "../../preferences";

// ── Display prefs shape (mirrors server-side channel config.display) ─
//
// Stored per-user in `user_channels.config.display` as JSONB. v1.0.2
// switched each field from boolean → Venue. Old boolean-era values still
// deserialize correctly because `normalizeSportsDisplayConfig` runs the
// read through `migrateVenue`.

export interface SportsDisplayConfig {
  showUpcoming?: Venue;
  showFinal?: Venue;
  showLogos?: Venue;
  showTimer?: Venue;
}

// ── Pure: engagement score ──────────────────────────────────────

/**
 * Coarse priority bucket for ranking games on the ticker.
 *
 * **Stable across consecutive renders / refetches** — the score for any
 * given game only changes when its `state` transitions (pre → live →
 * final) or its `isCloseGame` status flips. It is NOT a function of
 * `Date.now()`, so dashboard refetches that bring back the same data
 * produce the same sort order, which keeps the ticker rail from
 * snapping every ~30 seconds as games drift across arbitrary clock
 * thresholds (within-1-hour, within-24-hours, within-2-hours-ago).
 *
 * The previous time-bucketed implementation produced 4000-9000px
 * marquee transform jumps on every dashboard refetch when any game
 * crossed a threshold, which the user observed as "weird movement".
 * Continuous time-of-day priority (sooner pre-games surface, more
 * recent finals surface) is now expressed via the secondary sort in
 * `selectSportsForTicker` instead — same UX, no jank.
 */
export function gameEngagement(g: Game): number {
  if (isLive(g)) return isCloseGame(g) ? 100 : 80;
  if (g.state === "pre") return 60;
  if (g.state === "final") return 30;
  return 0;
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Baseline pipeline used by the ticker: applies `showUpcoming`/`showFinal`
 * filters from the channel config.display blob, then sorts by engagement
 * (live games first, then upcoming, then finals) with a deterministic
 * tie-break on `start_time` so the ticker rail stays stable across
 * dashboard refetches.
 *
 * Filters only apply when the venue is `off` or ticker-only-excluded
 * ("feed"). `both` and `ticker` both permit the category to show on the
 * ticker.
 *
 * Tie-break direction is per-state:
 *   - pre/live   → start_time ASC (sooner / more in-progress first)
 *   - final      → start_time DESC (most recently finished first)
 *
 * This preserves the continuous "closer games matter more" priority the
 * old time-bucketed engagement encoded discretely, without producing a
 * different sort order on every refetch as games drift across clock
 * thresholds.
 */
export function selectSportsForTicker(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
): Game[] {
  const cfg = config ?? {};
  const showUpcoming = shouldShowOnTicker(cfg.showUpcoming ?? "both");
  const showFinal = shouldShowOnTicker(cfg.showFinal ?? "both");

  const filtered = games.filter((g) => {
    if (!showUpcoming && isPre(g)) return false;
    if (!showFinal && isFinal(g)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    const eDiff = gameEngagement(b) - gameEngagement(a);
    if (eDiff !== 0) return eDiff;
    // Same engagement bucket — break ties by start_time. Finals sort
    // newest-first; everything else sorts soonest-first.
    const aT = new Date(a.start_time).getTime();
    const bT = new Date(b.start_time).getTime();
    if (a.state === "final" && b.state === "final") return bT - aT;
    return aT - bT;
  });
}

/**
 * Feed-side filter mirroring `selectSportsForTicker`. Filters apply
 * when a category's venue is `off` or ticker-only.
 */
export function selectSportsForFeed(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
): Game[] {
  const cfg = config ?? {};
  const showUpcoming = shouldShowOnFeed(cfg.showUpcoming ?? "both");
  const showFinal = shouldShowOnFeed(cfg.showFinal ?? "both");

  return games.filter((g) => {
    if (!showUpcoming && isPre(g)) return false;
    if (!showFinal && isFinal(g)) return false;
    return true;
  });
}

// ── Helper: extract sports display config from dashboard ────────

import type { DashboardResponse } from "../../types";

/**
 * Read the sports channel's display config from the dashboard payload
 * and normalize every field through `migrateVenue` so old boolean-era
 * configs (stored by clients before v1.0.2) still deserialize to valid
 * Venue values.
 */
export function getSportsDisplayConfig(
  dashboard: DashboardResponse | null | undefined,
): SportsDisplayConfig {
  const channel = dashboard?.channels?.find((c) => c.channel_type === "sports");
  return normalizeSportsDisplayConfig(channel?.config?.display);
}

export function normalizeSportsDisplayConfig(
  raw: unknown,
): SportsDisplayConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    showUpcoming: migrateVenue(obj.showUpcoming),
    showFinal: migrateVenue(obj.showFinal),
    showLogos: migrateVenue(obj.showLogos),
    showTimer: migrateVenue(obj.showTimer),
  };
}
