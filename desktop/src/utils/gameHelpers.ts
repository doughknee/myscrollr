/**
 * Shared game state helpers for sports data.
 *
 * Used by GameChip, SportsSummary, and ScrollrTicker to consistently
 * determine game status across the app. Canonical source of truth
 * for game state classification.
 */
import type { Game } from "../types";

// ── State classification ────────────────────────────────────────

export function isLive(game: Game): boolean {
  return game.state === "in_progress" || game.state === "in";
}

export function isFinal(game: Game): boolean {
  return game.state === "final" || game.state === "post";
}

export function isPre(game: Game): boolean {
  return game.state === "pre";
}

// ── Derived helpers ─────────────────────────────────────────────

/** Close-game threshold per sport — roughly "one score" in each sport. */
const CLOSE_THRESHOLDS: Record<string, number> = {
  "american-football": 8,
  "basketball": 6,
  "hockey": 1,
  "baseball": 2,
  "football": 1,
};

/** Check if a score value is present and numeric (not null, undefined, or empty). */
function hasScore(score: number | string | null | undefined): boolean {
  return score != null && score !== "";
}

export function isCloseGame(game: Game): boolean {
  if (!isLive(game)) return false;
  if (!hasScore(game.away_team_score) || !hasScore(game.home_team_score)) return false;
  const away = Number(game.away_team_score);
  const home = Number(game.home_team_score);
  if (isNaN(away) || isNaN(home)) return false;
  return Math.abs(away - home) <= (CLOSE_THRESHOLDS[game.sport] ?? 3);
}

export function getWinner(game: Game): "home" | "away" | null {
  if (!isFinal(game)) return null;
  if (!hasScore(game.away_team_score) || !hasScore(game.home_team_score)) return null;
  const a = Number(game.away_team_score);
  const h = Number(game.home_team_score);
  if (isNaN(a) || isNaN(h) || a === h) return null;
  return h > a ? "home" : "away";
}

// ── Formatting ──────────────────────────────────────────────────

/** Human-readable game status: timer for live, countdown for pre, "Final"/"PPD". */
export function gameStatusLabel(game: Game): string {
  if (isLive(game)) return game.timer || game.status_short || "Live";
  if (isFinal(game)) return game.status_long || "Final";
  if (isPre(game)) return formatCountdown(game.start_time);
  if (game.state === "postponed") return "PPD";
  return "";
}

/** Display a team code, falling back to first 3 chars of name if code is missing. */
export function displayTeamCode(code: string, name: string): string {
  return code || name.slice(0, 3).toUpperCase();
}

export function formatCountdown(startTime: string): string {
  const diff = new Date(startTime).getTime() - Date.now();
  if (diff <= 0) return "Starting";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) {
    return new Date(startTime).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  if (h >= 24) return "Tomorrow";
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m`;
  return "Soon";
}

/**
 * True when every game field either chip or card renders is unchanged.
 *
 * Both `GameChip` (ticker) and `GameItem` (feed card) are memoized on a
 * hand-listed field comparison; they had two near-identical 16-line lists
 * that drifted (one checked sport/league/start_time, the other
 * link/short_detail). One list means a new rendered field can't be added
 * to one comparator and forgotten in the other. The union is all cheap
 * string/number equality on the same object.
 */
export function sameGame(a: Game, b: Game): boolean {
  return (
    a.id === b.id &&
    a.sport === b.sport &&
    a.league === b.league &&
    a.link === b.link &&
    a.away_team_name === b.away_team_name &&
    a.away_team_logo === b.away_team_logo &&
    a.away_team_score === b.away_team_score &&
    a.away_team_code === b.away_team_code &&
    a.home_team_name === b.home_team_name &&
    a.home_team_logo === b.home_team_logo &&
    a.home_team_score === b.home_team_score &&
    a.home_team_code === b.home_team_code &&
    a.state === b.state &&
    a.timer === b.timer &&
    a.status_short === b.status_short &&
    a.status_long === b.status_long &&
    a.short_detail === b.short_detail &&
    a.start_time === b.start_time
  );
}
