/**
 * Sports view selectors — shared filter/sort pipeline.
 *
 * Sports display prefs live server-side on the dashboard widget config
 * (not in `prefs.widgetDisplay`), so this selector accepts the config
 * blob shape. Both `FeedTab` and `ScrollrTicker` call `selectSportsForTicker`
 * to apply the day window (v1.1.3 Time Controls) + engagement sort.
 *
 * SINGLE SOURCE OF TRUTH for Sports display prefs.
 */
import type { Game } from "../../types";
import { isLive, isCloseGame } from "../../utils/gameHelpers";
import { migrateVenue } from "../../preferences";

// ── Display prefs shape (mirrors server-side widget config.display) ─
//
// Stored per-user in `user_widgets.config.display` as JSONB.

export interface SportsDisplayConfig {
  /**
   * Day window (v1.1.3 Time Controls): show games whose start_time falls
   * between `daysBack` days ago and `daysAhead` days ahead. LIVE games
   * always show regardless of the window — a live game is definitionally
   * "now". Replaces the retired showUpcoming/showFinal venue toggles
   * (normalizeSportsDisplayConfig still maps legacy stored values).
   */
  daysBack?: number;
  daysAhead?: number;
}

/** Defaults: yesterday's finals through next week's slate. */
export const SPORTS_WINDOW_DEFAULTS = { daysBack: 1, daysAhead: 7 } as const;

/**
 * Hard ceiling for both steppers — the server only retains games ±7 days
 * (cleanup_old_games in the sports service), so offering more would show
 * windows with no data in them.
 */
export const SPORTS_WINDOW_MAX_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Window predicate shared by the ticker + feed selectors.
 *
 * Bounds are anchored to LOCAL CALENDAR DAYS, not rolling 24h periods:
 * "Today" (0 back / 0 ahead) means all of today — a 7pm tip-off must
 * not vanish from the window at 3pm. daysBack counts whole days before
 * today; daysAhead counts whole days after today (inclusive of their
 * full span).
 */
function inDayWindow(
  g: Game,
  daysBack: number,
  daysAhead: number,
  now: number,
): boolean {
  if (isLive(g)) return true;
  const t = new Date(g.start_time).getTime();
  // Defensive: an unparseable start_time stays visible rather than
  // silently vanishing from every surface.
  if (!Number.isFinite(t)) return true;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const lower = dayStart.getTime() - daysBack * DAY_MS;
  const upper = dayStart.getTime() + (daysAhead + 1) * DAY_MS;
  return t >= lower && t < upper;
}

function clampWindowDays(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(SPORTS_WINDOW_MAX_DAYS, Math.max(0, Math.round(v)))
    : fallback;
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
 * Baseline pipeline used by the ticker: applies the day window from the
 * widget config.display blob (v1.1.3 Time Controls — live games always
 * pass), then sorts by engagement (live games first, then upcoming, then
 * finals) with a deterministic tie-break on `start_time` so the ticker
 * rail stays stable across dashboard refetches.
 *
 * Tie-break direction is per-state:
 *   - pre/live   → start_time ASC (sooner / more in-progress first)
 *   - final      → start_time DESC (most recently finished first)
 *
 * This preserves the continuous "closer games matter more" priority the
 * old time-bucketed engagement encoded discretely, without producing a
 * different sort order on every refetch as games drift across clock
 * thresholds.
 *
 * `now` is injectable for tests; production callers omit it.
 */
export function selectSportsForTicker(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
  now: number = Date.now(),
): Game[] {
  const cfg = config ?? {};
  const daysBack = cfg.daysBack ?? SPORTS_WINDOW_DEFAULTS.daysBack;
  const daysAhead = cfg.daysAhead ?? SPORTS_WINDOW_DEFAULTS.daysAhead;

  const filtered = games.filter((g) => inDayWindow(g, daysBack, daysAhead, now));

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
 * Feed-side selector: the same useful default order as the ticker, with
 * favorite teams promoted ahead of live, upcoming, and recent finals.
 */
export function selectSportsForFeed(
  games: Game[],
  config: SportsDisplayConfig | null | undefined,
  favoriteTeams: ReadonlySet<string>,
  now: number = Date.now(),
): Game[] {
  return selectSportsForTicker(games, config, now).sort((a, b) => {
    const aFavorite =
      favoriteTeams.has(a.home_team_name) || favoriteTeams.has(a.away_team_name);
    const bFavorite =
      favoriteTeams.has(b.home_team_name) || favoriteTeams.has(b.away_team_name);
    return Number(bFavorite) - Number(aFavorite);
  });
}

// ── Helper: extract sports display config from dashboard ────────

import type { DashboardResponse } from "../../types";

/**
 * Read a sports widget's display config from the dashboard payload.
 *
 * Post-split (migration 000014) each sports league is its own row
 * (sports_nfl, sports_nba, ...) carrying its own display toggles, so the
 * caller passes the widget id it's rendering. The bare "sports" row only
 * exists for legacy un-split configs -- it's the fallback, not the target.
 */
export function getSportsDisplayConfig(
  dashboard: DashboardResponse | null | undefined,
  widgetType?: string,
): SportsDisplayConfig {
  const widgets = dashboard?.widgets ?? [];
  const widget =
    (widgetType
      ? widgets.find((c) => c.widget_type === widgetType)
      : undefined) ?? widgets.find((c) => c.widget_type === "sports");
  return normalizeSportsDisplayConfig(widget?.config?.display);
}

export function normalizeSportsDisplayConfig(
  raw: unknown,
): SportsDisplayConfig {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Legacy mapping (v1.1.3): the retired showUpcoming/showFinal venue
  // toggles collapse into the day window. Only "off" ever hid a category
  // on every surface, so it's the only value whose intent survives:
  //   showFinal: "off"    → daysBack 0  (user didn't want past games)
  //   showUpcoming: "off" → daysAhead 0 (user didn't want future games)
  // Explicit stored day values always win over the legacy inference.
  const legacyUpcoming = migrateVenue(obj.showUpcoming);
  const legacyFinal = migrateVenue(obj.showFinal);

  return {
    daysBack: clampWindowDays(
      obj.daysBack,
      legacyFinal === "off" ? 0 : SPORTS_WINDOW_DEFAULTS.daysBack,
    ),
    daysAhead: clampWindowDays(
      obj.daysAhead,
      legacyUpcoming === "off" ? 0 : SPORTS_WINDOW_DEFAULTS.daysAhead,
    ),
  };
}
