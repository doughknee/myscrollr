/**
 * The sports-service join that gives fantasy players a game clock.
 *
 * Yahoo's fantasy payload has no notion of when a player's game is —
 * no kickoff, no quarter, no clock. Every live treatment in the widget
 * (red clocks, in-play chips, the ON THE FIELD strip, the points flash)
 * needs that, so this joins each player to the NFL game their team is
 * in, by team code, and stamps `game_state` onto the player.
 *
 * WHY /sports/public
 * The obvious source is `dashboard.data.sports`, and it's wrong: that
 * slice is gated on `getUserSportsLeagues` server-side, so it's empty
 * unless the user happens to have selected NFL in their *sports widget*.
 * Fantasy would then work for some users and silently not for others,
 * which is worse than not working at all. `/sports/public` is ungated,
 * server-cached, and ordered live-games-first, so the states that drive
 * the live treatments are the ones least likely to fall past its cap.
 *
 * Everything stays optional: no games, no match, or a failed fetch all
 * leave `game_state` unset, and every consumer already renders "—".
 */
import type { Game } from "../../types";
import type { LeagueResponse, RosterPlayer } from "./types";

/**
 * Yahoo team abbreviations vs api-sports team codes. Mostly identical,
 * which is why this is a short exception list rather than a full table —
 * a full table would be another thing to keep in sync for no benefit.
 *
 * Keyed by Yahoo's abbreviation. Add entries when a player shows "—"
 * while their team is clearly playing.
 */
const TEAM_CODE_ALIASES: Record<string, string> = {
  WAS: "WSH",
  JAC: "JAX",
  LA: "LAR",
  SD: "LAC",
  OAK: "LV",
  STL: "LAR",
};

function normalizeCode(code: string | undefined): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  return TEAM_CODE_ALIASES[upper] ?? upper;
}

/** Games indexed by both teams' codes, so a lookup is one map hit. */
function indexByTeam(games: Game[]): Map<string, Game> {
  const index = new Map<string, Game>();
  for (const game of games) {
    // Live games are inserted last-wins so an in-progress game beats a
    // finished one for a team playing twice in the window (preseason
    // doubleheaders, rescheduled games).
    const priority = game.state === "in" ? 2 : game.state === "pre" ? 1 : 0;
    for (const code of [game.home_team_code, game.away_team_code]) {
      const key = normalizeCode(code);
      if (!key) continue;
      const existing = index.get(key);
      if (!existing) {
        index.set(key, game);
        continue;
      }
      const existingPriority =
        existing.state === "in" ? 2 : existing.state === "pre" ? 1 : 0;
      if (priority > existingPriority) index.set(key, game);
    }
  }
  return index;
}

/**
 * Display string for a game, in the vocabulary gameStateForPlayer()
 * parses: a quarter marker means live, "Final…" means final, anything
 * else reads as upcoming.
 */
export function deriveGameState(game: Game): string | null {
  if (game.state === "in") {
    // short_detail is already "Q3 8:42" shaped when the provider sends
    // it; otherwise assemble the same thing from its parts.
    const detail = game.short_detail?.trim();
    if (detail && /^(q[1-4]|ot|h[12])\b/i.test(detail)) return detail;
    const period = game.status_short?.trim();
    const clock = game.timer?.trim();
    if (period && clock) return `${period} ${clock}`;
    // Live but shapeless. "Q1" is a lie we don't need to tell — fall
    // back to a marker the parser still reads as live.
    return period || "Q1";
  }

  if (game.state === "pre") {
    const start = new Date(game.start_time);
    if (Number.isNaN(start.getTime())) return null;
    return start.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // Finished. Name the day when it wasn't today, which is what makes a
  // Thursday-night player legible on a Sunday.
  const start = new Date(game.start_time);
  if (Number.isNaN(start.getTime())) return "Final";
  const today = new Date();
  const sameDay =
    start.getFullYear() === today.getFullYear() &&
    start.getMonth() === today.getMonth() &&
    start.getDate() === today.getDate();
  if (sameDay) return "Final";
  return `Final · ${start.toLocaleDateString(undefined, { weekday: "short" })}`;
}

/**
 * Stamp `game_state` onto every player in every league.
 *
 * Returns a new structure — the dashboard payload is React Query cache
 * state and mutating it in place would make the change invisible to
 * anything comparing references.
 *
 * A player who already carries a `game_state` keeps it: the demo fixture
 * is the only other source, and in the demo there are no real games to
 * join against.
 */
export function stampGameStates(
  leagues: LeagueResponse[],
  games: Game[],
): LeagueResponse[] {
  if (games.length === 0) return leagues;
  const index = indexByTeam(games);
  if (index.size === 0) return leagues;

  let changed = false;

  const next = leagues.map((league) => {
    if (!league.rosters) return league;
    let leagueChanged = false;

    const rosters = league.rosters.map((roster) => {
      let rosterChanged = false;
      const players = roster.data.players.map((player: RosterPlayer) => {
        if (player.game_state) return player;
        const game = index.get(normalizeCode(player.editorial_team_abbr));
        if (!game) return player;
        const state = deriveGameState(game);
        if (!state) return player;
        rosterChanged = true;
        return { ...player, game_state: state };
      });
      if (!rosterChanged) return roster;
      leagueChanged = true;
      return { ...roster, data: { ...roster.data, players } };
    });

    if (!leagueChanged) return league;
    changed = true;
    return { ...league, rosters };
  });

  // Reference stability matters: returning a fresh array every poll
  // would re-render every consumer even when nothing moved.
  return changed ? next : leagues;
}
