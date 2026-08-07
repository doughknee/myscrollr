/**
 * Win probability for a game, as a share belonging to the AWAY team.
 *
 * The seam. Everything visual — the tilt bar, its lean, which side gets
 * the emphasis — reads this one function, so when a real source arrives
 * this is the only place that changes.
 *
 * WHAT IT IS TODAY: score share, not win probability. The handoff wants
 * odds pre-game and a live model in play, and neither exists in the
 * sports payload. Score share is the agreed fallback, and it is worth
 * being precise about how weak it is:
 *
 *   - it has no idea about time remaining, so 24-21 in the first
 *     quarter and 24-21 with a minute left read identically
 *   - it has no idea about possession, field position, or who the teams
 *     are
 *   - it is symmetric around 50%, so a blowout tops out around 75-80%
 *     rather than the 95%+ a real model would give
 *
 * So the bar means "who is ahead, and by how much, relative to the
 * points scored" — a momentum lean, which is what the design calls it.
 * It should not be labelled as a probability anywhere in the UI until
 * this returns one. `isRealProbability` exists so callers can tell.
 */
import type { Game } from "../types";

export interface WinProbability {
  /** 0–1 share belonging to the away team. */
  away: number;
  /**
   * False while this is score share rather than a modelled probability.
   * Callers use it to decide whether they're allowed to print a
   * percentage and call it a win chance.
   */
  isRealProbability: boolean;
}

/** Even split — the honest answer before anyone has scored. */
const EVEN: WinProbability = { away: 0.5, isRealProbability: false };

export function winProbabilityForGame(game: Game): WinProbability {
  const away = toScore(game.away_team_score);
  const home = toScore(game.home_team_score);

  // Nothing to divide. A 0-0 game genuinely is a coin flip as far as
  // this function can tell.
  const total = away + home;
  if (total <= 0) return EVEN;

  // Damped toward even so a 7-0 first quarter doesn't render as a
  // near-certain win. The raw share is far too confident early, when
  // the denominator is tiny — this pulls it back toward 50% in
  // proportion to how few points are on the board.
  //
  // 45 is roughly a full NFL game's combined score; by then the damping
  // is negligible and the bar tracks the raw share.
  const confidence = total / (total + 45);
  const rawShare = away / total;
  const damped = 0.5 + (rawShare - 0.5) * confidence;

  return { away: clamp01(damped), isRealProbability: false };
}

function toScore(value: number | string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
