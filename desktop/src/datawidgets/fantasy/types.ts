/**
 * Fantasy channel types — canonical source of truth.
 *
 * Mirrors the Go API's MyLeaguesResponse shape. Fields are nullable
 * where the API may omit them (e.g. during discovery, before import,
 * or for finished leagues with no active matchups/rosters).
 */

// ── Constants ────────────────────────────────────────────────────

export const SPORT_EMOJI: Record<string, string> = {
  nfl: "\u{1F3C8}",
  nba: "\u{1F3C0}",
  nhl: "\u{1F3D2}",
  mlb: "\u26BE",
};

export const GAME_CODE_LABELS: Record<string, string> = {
  nfl: "Football",
  nba: "Basketball",
  nhl: "Hockey",
  mlb: "Baseball",
};

/** Human-readable sport label from a game code (e.g. "nfl" → "Football"). */
export function sportLabel(gameCode: string): string {
  return GAME_CODE_LABELS[gameCode] || gameCode || "Fantasy";
}

/** True if the selected position keeps the player out of the starting lineup. */
export function isBenchPosition(pos: string): boolean {
  if (!pos) return true;
  const p = pos.toUpperCase();
  return p === "BN" || p === "IR" || p === "IL" || p === "NA" || p.startsWith("IR") || p.startsWith("IL");
}

// ── Types ────────────────────────────────────────────────────────

export interface MatchupTeam {
  team_key: string;
  team_id?: number;
  name: string;
  team_logo: string;
  manager_name: string;
  points: number | null;
  projected_points: number | null;
}

export interface Matchup {
  week: number;
  week_start?: string;
  week_end?: string;
  status: string;
  is_playoffs: boolean;
  is_consolation?: boolean;
  is_tied?: boolean;
  winner_team_key: string | null;
  teams: MatchupTeam[];
}

export interface StandingsEntry {
  team_key: string;
  team_id?: number;
  name: string;
  url?: string;
  team_logo: string;
  manager_name: string;
  rank: number | null;
  wins: number;
  losses: number;
  ties: number;
  percentage?: string;
  games_back?: string;
  points_for: number | string;
  points_against?: string;
  streak_type: string;
  streak_value: number;
  playoff_seed: number | null;
  clinched_playoffs: boolean;
  waiver_priority: number | null;
}

export interface RosterPlayer {
  player_key: string;
  player_id?: number;
  name: { full: string; first: string; last: string };
  editorial_team_abbr: string;
  editorial_team_full_name?: string;
  display_position: string;
  selected_position: string;
  eligible_positions?: string[];
  position_type?: string;
  image_url: string;
  status: string | null;
  status_full: string | null;
  injury_note: string | null;
  /**
   * Either Yahoo's native <player_points> total (NFL-style points leagues)
   * or a synthetic total the API computes from player_stats × league stat
   * modifiers (points leagues). Null when neither is available (pure
   * categories leagues like MLB H2H cats).
   */
  player_points: number | null;
  /**
   * Raw stat_id → value map for the current scoring window (week or
   * season, depending on league coverage). Values are STRINGS, not
   * numbers, because Yahoo ships formats that don't parse as floats:
   *   - "5/17"  hits/at-bats ratio
   *   - "3.2"   innings pitched (fractional part encodes thirds, not tenths)
   *   - ".686"  OPS with leading period
   *   - "-"     no data for this coverage window (bench/IL/pre-game)
   * Render these verbatim. Never `parseFloat` them for display.
   */
  player_stats?: Record<string, string> | null;
  /**
   * Same shape as `player_stats`, but scoped to today (Eastern Time).
   * Populated when the backend successfully fetched the daily coverage
   * for this player's team. Absent for inactive teams or when Yahoo's
   * daily endpoint isn't available.
   */
  player_stats_today?: Record<string, string> | null;
}

export interface RosterEntry {
  team_key: string;
  data: {
    team_key: string;
    team_name: string;
    players: RosterPlayer[];
  };
}

/**
 * Authoritative stat definition for a single stat_id in a given league.
 * Sourced from Yahoo's `<stat_categories>` element under
 * `league/{key}/settings`. This is the ONLY truthful source for stat
 * labels — stat_ids are not globally consistent across sports and
 * leagues can customize their category selection.
 */
export interface StatCatalogEntry {
  stat_id: string;
  display_name: string;
  name?: string;
  /** "B" (batter), "P" (pitcher), "O" (offense), "D" (defense), or "" (any). */
  position_type: string;
  sort_order: number;
  /** Display-only stats (e.g. MLB H/AB, IP) are shown but not scored. */
  display_only: boolean;
}

export interface StatCatalog {
  stats: StatCatalogEntry[];
  /** stat_id → point multiplier. Empty for categories-only leagues. */
  modifiers: Record<string, number>;
}

export interface LeagueResponse {
  league_key: string;
  name: string;
  game_code: string;
  season: string;
  team_key: string | null;
  team_name: string | null;
  data: {
    num_teams: number;
    is_finished: boolean;
    current_week: number | null;
    scoring_type: string;
    /** Persisted league stat catalog — Yahoo's authoritative labels. */
    stat_catalog?: StatCatalog | null;
    [k: string]: unknown;
  };
  standings: StandingsEntry[] | null;
  matchups: Matchup[] | null;
  previous_matchups?: Matchup[] | null;
  rosters: RosterEntry[] | null;
}

export interface MyLeaguesResponse {
  leagues: LeagueResponse[];
}

// ── Matchup status helpers ───────────────────────────────────────

export function isMatchupLive(matchup: Matchup): boolean {
  return matchup.status === "midevent";
}

export function isMatchupFinal(matchup: Matchup): boolean {
  return matchup.status === "postevent";
}

export function isMatchupPre(matchup: Matchup): boolean {
  return matchup.status === "preevent";
}

/** Return the user's matchup in a given week, or the single current matchup. */
export function findUserMatchup(
  league: LeagueResponse,
  matchups: Matchup[] | null | undefined,
): Matchup | null {
  if (!matchups || !league.team_key) return null;
  return (
    matchups.find((m) => m.teams.some((t) => t.team_key === league.team_key)) ?? null
  );
}

/** Orient a matchup around the user: [userTeam, opponent]. Returns null if not resolvable. */
export function orientMatchup(
  matchup: Matchup | null,
  userTeamKey: string | null | undefined,
): { user: MatchupTeam; opponent: MatchupTeam } | null {
  if (!matchup || !userTeamKey || matchup.teams.length < 2) return null;
  const user = matchup.teams.find((t) => t.team_key === userTeamKey);
  const opponent = matchup.teams.find((t) => t.team_key !== userTeamKey);
  if (!user || !opponent) return null;
  return { user, opponent };
}

/** Numeric score for a team, safely coerced from nullable float to 0. */
export function teamScore(team: MatchupTeam): number {
  return typeof team.points === "number" ? team.points : 0;
}

/**
 * Rudimentary win-probability estimate.
 *
 * During a live matchup we blend actual points with projected remaining
 * points. The longer the week runs, the more actual points dominate.
 *
 * Returns a fraction in [0, 1] representing the user's chance of winning.
 * Returns null if we don't have enough data to judge (pre-event or missing
 * projections).
 */
export function estimateWinProbability(
  matchup: Matchup | null,
  userTeamKey: string | null | undefined,
): number | null {
  const oriented = orientMatchup(matchup, userTeamKey);
  if (!oriented || !matchup) return null;
  const { user, opponent } = oriented;

  const uProj = typeof user.projected_points === "number" ? user.projected_points : null;
  const oProj = typeof opponent.projected_points === "number" ? opponent.projected_points : null;

  if (isMatchupPre(matchup)) {
    if (uProj === null || oProj === null) return null;
    const diff = uProj - oProj;
    return sigmoid(diff / 15); // ~stdev 15 points in typical fantasy football
  }

  if (isMatchupFinal(matchup)) {
    const diff = teamScore(user) - teamScore(opponent);
    if (diff > 0) return 1;
    if (diff < 0) return 0;
    return 0.5;
  }

  // Live. Blend actual + expected remaining.
  const uActual = teamScore(user);
  const oActual = teamScore(opponent);
  if (uProj === null || oProj === null) {
    const diff = uActual - oActual;
    return sigmoid(diff / 10);
  }
  // Fraction of the projected total that's been scored — used as a crude
  // "how far through the week" estimate.
  const totalProj = Math.max(uProj + oProj, 1);
  const completion = clamp((uActual + oActual) / totalProj, 0, 1);
  const remainingU = Math.max(uProj - uActual, 0) * (1 - completion * 0.5);
  const remainingO = Math.max(oProj - oActual, 0) * (1 - completion * 0.5);
  const projFinalU = uActual + remainingU;
  const projFinalO = oActual + remainingO;
  const diff = projFinalU - projFinalO;
  // Remaining uncertainty shrinks as the week progresses.
  const stdDev = Math.max(12 * (1 - completion), 2.5);
  return sigmoid(diff / stdDev);
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ── Standings helpers ───────────────────────────────────────────

/** Number of playoff spots a league awards (best-effort inference). */
export function playoffSpotCount(league: LeagueResponse): number {
  // Yahoo doesn't cleanly expose this, but most head-to-head leagues use
  // 4 or 6 playoff spots. We infer: if any team has clinched_playoffs or
  // playoff_seed is set, count the distinct seeds. Fall back by league size.
  const seeds = league.standings
    ?.map((s) => s.playoff_seed)
    .filter((x): x is number => typeof x === "number");
  if (seeds && seeds.length > 0) return Math.max(...seeds);
  const numTeams = league.data.num_teams ?? 0;
  if (numTeams >= 12) return 6;
  if (numTeams >= 10) return 6;
  if (numTeams >= 8) return 4;
  return Math.max(1, Math.min(numTeams, 4));
}

/** Distinguish playoff-track teams from elimination-track teams. */
export function isPlayoffBound(entry: StandingsEntry, spots: number): boolean {
  if (entry.clinched_playoffs) return true;
  if (typeof entry.playoff_seed === "number") return entry.playoff_seed <= spots;
  if (typeof entry.rank === "number") return entry.rank <= spots;
  return false;
}

/** Nicely formatted points-for value (supports numeric or Yahoo string form). */
export function fmtPoints(pf: number | string | undefined | null): string {
  if (pf === undefined || pf === null) return "—";
  const n = typeof pf === "number" ? pf : parseFloat(pf);
  if (!Number.isFinite(n)) return String(pf);
  return n.toFixed(1);
}

/**
 * Format a player's points for display. Returns "—" when the value is null
 * (category leagues with no scoring modifiers, or genuinely unscored games),
 * signalling to the UI that 0.0 is not the correct answer.
 */
export function fmtPlayerPoints(pts: number | null | undefined): string {
  if (typeof pts !== "number" || !Number.isFinite(pts)) return "—";
  return pts.toFixed(1);
}

/**
 * Return the league's stat columns for a given position type, sorted by
 * Yahoo's own sort_order. Used as table column definitions in the
 * Roster and Matchup views.
 */
export function statColumnsForPosition(
  catalog: StatCatalog | null | undefined,
  positionType: string | undefined,
): StatCatalogEntry[] {
  if (!catalog || catalog.stats.length === 0) return [];
  return catalog.stats
    .filter((def) => {
      if (!def.position_type) return true;
      if (!positionType) return true;
      return def.position_type === positionType;
    })
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Read a single stat value from a player's raw stats map, returning "—"
 * for missing or empty values.
 */
export function statValue(
  stats: Record<string, string> | null | undefined,
  statId: string,
): string {
  if (!stats) return "—";
  const v = stats[statId];
  if (v === undefined || v === null || v === "") return "—";
  if (v === "-") return "—";
  return v;
}

/** Short "W3" / "L2" / "T1" badge. */
export function streakLabel(type: string, value: number): string {
  if (!type || value <= 0) return "—";
  const prefix = type.charAt(0).toUpperCase();
  return `${prefix}${value}`;
}

// ── Roster helpers ─────────────────────────────────────────────

/** Status badge color class (Tailwind). */
export function statusColorClass(status: string | null | undefined): string {
  if (!status) return "";
  const s = status.toUpperCase();
  if (s === "O" || s === "IR" || s === "SUSP" || s === "DL" || s === "IL") return "bg-error/20 text-error border-error/40";
  if (s === "D" || s === "DTD") return "bg-warn/20 text-warn border-warn/40";
  if (s === "Q" || s === "P") return "bg-amber-500/20 text-amber-500 border-amber-500/40";
  if (s === "NA") return "bg-fg-3/20 text-fg-3 border-fg-3/40";
  return "bg-fg-3/20 text-fg-3 border-fg-3/40";
}

/** True if the player status represents any kind of injury/availability issue. */
export function isInjuryStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s.length > 0 && s !== "ACTIVE";
}

/** Count injured players in a roster entry. */
export function countInjuries(roster: RosterEntry | null | undefined): number {
  if (!roster) return 0;
  return roster.data.players.filter((p) => isInjuryStatus(p.status)).length;
}

// ── League-level helpers ───────────────────────────────────────

/** Return the user's current matchup and its oriented teams, if resolvable. */
export function userMatchupContext(league: LeagueResponse): {
  matchup: Matchup;
  user: MatchupTeam;
  opponent: MatchupTeam;
} | null {
  const current = findUserMatchup(league, league.matchups);
  if (!current) return null;
  const oriented = orientMatchup(current, league.team_key);
  if (!oriented) return null;
  return { matchup: current, user: oriented.user, opponent: oriented.opponent };
}

/** Return the user's previous-week matchup, if it's in `previous_matchups`. */
export function userPreviousMatchup(league: LeagueResponse): {
  matchup: Matchup;
  user: MatchupTeam;
  opponent: MatchupTeam;
} | null {
  const previous = findUserMatchup(league, league.previous_matchups);
  if (!previous) return null;
  const oriented = orientMatchup(previous, league.team_key);
  if (!oriented) return null;
  return { matchup: previous, user: oriented.user, opponent: oriented.opponent };
}

/** Return the user's standings entry, if present. */
export function userStanding(league: LeagueResponse): StandingsEntry | null {
  if (!league.team_key) return null;
  return league.standings?.find((s) => s.team_key === league.team_key) ?? null;
}

/** Return the user's roster entry, if present. */
export function userRoster(league: LeagueResponse): RosterEntry | null {
  if (!league.team_key) return null;
  return league.rosters?.find((r) => r.team_key === league.team_key) ?? null;
}

// ── Discovery type ────────────────────────────────────────────

export interface DiscoveredLeague {
  league_key: string;
  name: string;
  game_code: string;
  season: number;
  num_teams: number;
  is_finished: boolean;
  logo_url?: string;
  url?: string;
}
