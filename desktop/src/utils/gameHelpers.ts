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

/**
 * A status short enough for the chip's 34px status column.
 *
 * `gameStatusLabel` is the roomy version — it returns "Finished" and
 * "in 3h 20m", which overflow a column sized for "88'" and "FT". This trades
 * words for glyphs at the same information: the period, the wait, or that it
 * is over.
 */
export function gameStatusCompact(game: Game): string {
  if (isLive(game)) return game.timer || game.status_short || "LIVE";
  if (isFinal(game)) return "FT";
  if (isPre(game)) return formatCountdownCompact(game.start_time);
  if (game.state === "postponed") return "PPD";
  return "";
}

/**
 * A countdown that fits four characters: "3h05", "22h", "45m", "2d", "Sep 9".
 *
 * Same thresholds as formatCountdown, without the words. Minutes are dropped
 * past ten hours: "22h28" is five characters and 30px at 10px mono, which is
 * the entire usable width of the chip's status column, and at that range the
 * minutes are noise anyway.
 */
export function formatCountdownCompact(startTime: string): string {
  const diff = new Date(startTime).getTime() - Date.now();
  if (diff <= 0) return "NOW";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 48) {
    return new Date(startTime).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  if (h >= 24) return `${Math.floor(h / 24)}d`;
  if (h >= 10) return `${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m}m`;
  return "SOON";
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

/**
 * League codes for the chip's 34px status column.
 *
 * The chip rendered `game.league` raw, which is fine for the leagues whose
 * names are already codes (MLS, NFL, UFC) and clips everything else:
 * "FORMULA 1" is nine characters and needs ~55px at 8px uppercase with
 * 0.08em tracking, in a column 34px wide. The column cannot grow -- it is
 * paid for out of the 164px the team names need, which were sized against
 * the real catalog in REL-158.
 *
 * ~5 characters fit. Codes are the ones a viewer of that sport would
 * recognise (UCL, EPL, F1) rather than mechanical truncation, because
 * "FORMU" identifies nothing. Every league in tracked_leagues as of
 * 2026-09 is listed; the fallback below covers a league added later.
 */
const LEAGUE_CODES: Record<string, string> = {
  AFL: "AFL",
  "Champions League": "UCL",
  "FIFA World Cup": "WC",
  "Formula 1": "F1",
  "Handball Bundesliga": "HBL",
  "Handball Champions League": "HCL",
  "La Liga": "LIGA",
  MLB: "MLB",
  MLS: "MLS",
  NBA: "NBA",
  "NCAA Basketball": "NCAAB",
  "NCAA Football": "NCAAF",
  NFL: "NFL",
  NHL: "NHL",
  "Premier League": "EPL",
  // Distinct from the football Premier League above, which takes EPL.
  "Premiership Rugby": "PREM",
  "Six Nations": "6N",
  Starligue: "SLG",
  "Super Rugby": "SUPER",
  UFC: "UFC",
  "Volleyball Champions League": "VCL",
  "Volleyball Nations League": "VNL",
};

/** Longest code the 34px column fits. Enforced by the tests. */
export const LEAGUE_CODE_MAX = 5;

/**
 * A short, recognisable code for `league`, guaranteed to fit the column.
 *
 * Unmapped leagues fall back to initials ("Super Duper League" -> "SDL"),
 * which is right far more often than truncation for the multi-word names
 * that are the only ones too long in the first place.
 */
export function leagueCode(league: string): string {
  const known = LEAGUE_CODES[league];
  if (known) return known;

  const trimmed = league.trim();
  if (trimmed.length <= LEAGUE_CODE_MAX) return trimmed.toUpperCase();

  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    const initials = words
      .map((w) => w[0])
      .join("")
      .toUpperCase();
    if (initials.length <= LEAGUE_CODE_MAX) return initials;
    return initials.slice(0, LEAGUE_CODE_MAX);
  }
  // One long word, no initials to take: clipping is all that is left.
  return trimmed.slice(0, LEAGUE_CODE_MAX).toUpperCase();
}
