/**
 * Fantasy view selectors — shared filter/sort pipeline.
 *
 * Both `FeedTab` and `ScrollrTicker` consume these selectors to apply
 * `enabledLeagueKeys` (hide leagues), `primaryLeagueKey` (promote hero
 * league), and engagement sort. SINGLE SOURCE OF TRUTH for Fantasy
 * display prefs.
 */
import { isMatchupLive, userMatchupContext } from "./types";
import type { LeagueResponse } from "./types";
import type { FantasyDisplayPrefs } from "../../preferences";

// ── Pure: engagement score ──────────────────────────────────────

/**
 * Higher = more prominent. Live > upcoming > finished.
 */
export function fantasyEngagement(league: LeagueResponse): number {
  const ctx = userMatchupContext(league);
  if (!ctx) return league.data.is_finished ? 0 : 5;
  if (isMatchupLive(ctx.matchup)) return 100;
  if (ctx.matchup.status === "preevent") return 40;
  if (ctx.matchup.status === "postevent") return 20;
  return 10;
}

// ── Pure: visibility filter ─────────────────────────────────────

/**
 * Apply the user's per-league visibility filter. Empty `enabledLeagueKeys`
 * means "show all" (default for first-time users).
 */
export function filterEnabledLeagues(
  leagues: LeagueResponse[],
  enabledLeagueKeys: string[] | undefined,
): LeagueResponse[] {
  if (!enabledLeagueKeys || enabledLeagueKeys.length === 0) return leagues;
  const allowed = new Set(enabledLeagueKeys);
  return leagues.filter((l) => allowed.has(l.league_key));
}

// ── Pure: primary league resolution ─────────────────────────────

/**
 * Resolve the "hero" league. Priority:
 *   1. User's configured `primaryLeagueKey` (if it resolves to a visible league)
 *   2. Active league with a live matchup
 *   3. Active league with a scheduled matchup
 *   4. Any non-finished league
 *   5. First league in the list
 *
 * Returns null when there are no leagues.
 */
export function resolvePrimaryLeague(
  leagues: LeagueResponse[],
  configuredKey: string | null | undefined,
): LeagueResponse | null {
  if (!leagues.length) return null;
  if (configuredKey) {
    const match = leagues.find((l) => l.league_key === configuredKey);
    if (match) return match;
  }
  const activeWithLive = leagues.find((l) => {
    const ctx = userMatchupContext(l);
    return ctx && isMatchupLive(ctx.matchup);
  });
  if (activeWithLive) return activeWithLive;
  const activeWithMatchup = leagues.find((l) => userMatchupContext(l));
  if (activeWithMatchup) return activeWithMatchup;
  const active = leagues.find((l) => !l.data.is_finished);
  return active ?? leagues[0];
}

// ── Pure: ranking by engagement with primary on top ─────────────

/**
 * Sort leagues by engagement, with the primary league always first.
 */
export function rankFantasyLeagues(
  leagues: LeagueResponse[],
  primaryKey: string | null | undefined,
): LeagueResponse[] {
  return [...leagues].sort((a, b) => {
    if (primaryKey) {
      if (a.league_key === primaryKey) return -1;
      if (b.league_key === primaryKey) return 1;
    }
    return fantasyEngagement(b) - fantasyEngagement(a);
  });
}

// ── Selector for the ticker ─────────────────────────────────────

import { shouldShowOnTicker } from "../../preferences";

/**
 * Baseline pipeline used by the ticker: applies `enabledLeagueKeys`
 * filter, promotes `primaryLeagueKey` to the front, sorts remaining
 * by engagement.
 *
 * Returns `[]` when NONE of the per-item venue toggles are set to
 * "both" or "ticker" — no point rendering a chip with no content. The
 * per-item filtering (which fields actually render) happens downstream
 * in `FantasyStatChip` / `ScrollrTicker`.
 */
export function selectFantasyForTicker(
  leagues: LeagueResponse[],
  prefs: FantasyDisplayPrefs,
): LeagueResponse[] {
  const anyItemOnTicker =
    shouldShowOnTicker(prefs.matchupScore) ||
    shouldShowOnTicker(prefs.winProbability) ||
    shouldShowOnTicker(prefs.matchupStatus) ||
    shouldShowOnTicker(prefs.projectedPoints) ||
    shouldShowOnTicker(prefs.week) ||
    shouldShowOnTicker(prefs.record) ||
    shouldShowOnTicker(prefs.standingsPosition) ||
    shouldShowOnTicker(prefs.streak) ||
    shouldShowOnTicker(prefs.injuryCount) ||
    shouldShowOnTicker(prefs.topScorer) ||
    // Phase 1 player-stats segments — same OR-gate semantics: if any
    // of these is on the ticker, the league chip should render so
    // FantasyStatChip can compose the enabled segments.
    shouldShowOnTicker(prefs.topThreeScorers) ||
    shouldShowOnTicker(prefs.worstStarter) ||
    shouldShowOnTicker(prefs.benchOpportunity) ||
    shouldShowOnTicker(prefs.injuryDetail);
  if (!anyItemOnTicker) return [];

  const visible = filterEnabledLeagues(leagues, prefs.enabledLeagueKeys);
  if (visible.length === 0) return [];
  const primary = resolvePrimaryLeague(visible, prefs.primaryLeagueKey);
  return rankFantasyLeagues(visible, primary?.league_key ?? null);
}
