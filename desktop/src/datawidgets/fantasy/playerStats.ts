/**
 * Per-player selection helpers shared between the league summary chip
 * (FantasyStatChip) and the ticker rail composer (ScrollrTicker).
 *
 * The "Player stats" venue toggles in Display preferences each emit a
 * specific player or set of players from the user's roster. These
 * helpers pick those players using the same rules as the legacy inline
 * segments did, so the output is identical between the old summary-
 * embedded display and the new individual-chip display.
 *
 * Each function:
 *   - Returns null / [] when there's no meaningful pick (e.g. roster
 *     all-zero, single-starter team, healthy roster).
 *   - Filters out players with null `player_points` because they
 *     haven't recorded yet — including them as 0 would mislead.
 *   - Treats bench positions consistently with `isBenchPosition`.
 */
import { isBenchPosition, type RosterPlayer } from "./types";

/**
 * Top-N players by `player_points`, descending. Ties broken by Yahoo's
 * natural roster order. Filters out null-points players. When
 * `startersOnly: true`, bench positions are excluded.
 */
export function findTopN(
  players: RosterPlayer[],
  n: number,
  opts: { startersOnly?: boolean } = {},
): RosterPlayer[] {
  const candidates = players.filter((p) => {
    if (p.player_points === null || p.player_points === undefined) return false;
    if (opts.startersOnly && isBenchPosition(p.selected_position)) return false;
    return true;
  });
  candidates.sort((a, b) => (b.player_points ?? 0) - (a.player_points ?? 0));
  return candidates.slice(0, n);
}

/**
 * Highest-`player_points` active-roster (non-bench) player. Surfaces
 * the user's MVP for the current matchup.
 */
export function findTopScorer(players: RosterPlayer[]): RosterPlayer | null {
  let best: RosterPlayer | null = null;
  let bestPoints = -Infinity;
  for (const p of players) {
    if (isBenchPosition(p.selected_position)) continue;
    if (p.player_points === null || p.player_points === undefined) continue;
    if (p.player_points > bestPoints) {
      best = p;
      bestPoints = p.player_points;
    }
  }
  return best;
}

/**
 * Lowest-`player_points` active-roster (non-bench) player. Returns
 * null when there are fewer than 2 starters with scores — at that
 * point "worst" overlaps with `topScorer` and is redundant noise.
 */
export function findWorstStarter(
  players: RosterPlayer[],
): RosterPlayer | null {
  const starters = players.filter(
    (p) =>
      !isBenchPosition(p.selected_position) &&
      p.player_points !== null &&
      p.player_points !== undefined,
  );
  if (starters.length < 2) return null;
  starters.sort((a, b) => (a.player_points ?? 0) - (b.player_points ?? 0));
  return starters[0];
}

/**
 * Highest-`player_points` REAL bench player (BN only — explicitly NOT
 * IR/IL/NA). Used to surface sit/start regret: "you could have started
 * this benched player instead." Injured-reserve slots aren't sittable
 * in the conventional sense, so including them in the comparison would
 * mislead. Returns null when no eligible bench player has a positive
 * score.
 */
export function findTopBench(players: RosterPlayer[]): RosterPlayer | null {
  let best: RosterPlayer | null = null;
  let bestPoints = -Infinity;
  for (const p of players) {
    if (!isStrictBench(p.selected_position)) continue;
    if (p.player_points === null || p.player_points === undefined) continue;
    if (p.player_points > bestPoints) {
      best = p;
      bestPoints = p.player_points;
    }
  }
  if (!best || (best.player_points ?? 0) <= 0) return null;
  return best;
}

/**
 * All injured (or otherwise unavailable) players on the roster, in
 * Yahoo's natural roster order. Caller decides how many to render
 * (e.g. cap at 2 with overflow message, or render every one as its
 * own chip). Returns [] when the roster is healthy.
 */
export function findInjuredPlayers(players: RosterPlayer[]): RosterPlayer[] {
  return players.filter((p) => isInjured(p.status));
}

// ── Position helpers ─────────────────────────────────────────────

/**
 * Stricter than `isBenchPosition` — returns true only for actual bench
 * slots ("BN"), not injured-reserve / not-active slots. Use this when
 * the question is "could the user have started this player?"
 */
export function isStrictBench(pos: string): boolean {
  return pos.toUpperCase() === "BN";
}

// ── Status helpers ───────────────────────────────────────────────

/**
 * Yahoo injury-status strings indicating the player isn't fully
 * available. Matches what users see in the UI: OUT, DTD, IR, IR-R,
 * PUP, NA, SUSP, etc. Empty / null = healthy.
 */
export function isInjured(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  if (s === "" || s === "HEALTHY" || s === "P") return false;
  return true;
}

/**
 * Squash long Yahoo status codes (IR-R, IR-LT, NA, etc) into the
 * short form users recognize. Unknown values pass through unchanged.
 */
export function shortStatus(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.trim().toUpperCase();
  if (s.startsWith("IR")) return "IR";
  return s;
}

/**
 * Compact one-decimal fixed-point that matches `fmtPlayerPoints` for
 * individual-player segments. Centralized so all per-player segments
 * format identically.
 */
export function formatPts(points: number): string {
  return points.toFixed(1);
}
