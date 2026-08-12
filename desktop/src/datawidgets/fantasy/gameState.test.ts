import { describe, expect, it } from "vitest";
import { deriveGameState, stampGameStates } from "./gameState";
import { gameStateForPlayer } from "./types";
import type { Game } from "../../types";
import type { LeagueResponse, RosterPlayer } from "./types";

function game(over: Partial<Game>): Game {
  return {
    id: 1,
    league: "NFL",
    sport: "american-football",
    external_game_id: "x",
    link: "",
    home_team_name: "Philadelphia Eagles",
    home_team_logo: "",
    home_team_score: "21",
    home_team_code: "PHI",
    away_team_name: "Dallas Cowboys",
    away_team_logo: "",
    away_team_score: "17",
    away_team_code: "DAL",
    start_time: "2025-11-23T18:00:00Z",
    state: "post",
    ...over,
  };
}

function player(over: Partial<RosterPlayer>): RosterPlayer {
  return {
    player_key: "p1",
    name: { full: "Jalen Hurts", first: "Jalen", last: "Hurts" },
    editorial_team_abbr: "PHI",
    display_position: "QB",
    selected_position: "QB",
    image_url: "",
    status: null,
    status_full: null,
    injury_note: null,
    player_points: 28.1,
    ...over,
  };
}

function league(players: RosterPlayer[]): LeagueResponse {
  return {
    league_key: "l1",
    name: "Test",
    game_code: "nfl",
    season: "2025",
    team_key: "t1",
    team_name: "Mine",
    data: {
      num_teams: 8,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: null,
    matchups: null,
    rosters: [
      { team_key: "t1", data: { team_key: "t1", team_name: "Mine", players } },
    ],
  };
}

describe("deriveGameState", () => {
  it("reads a live game as a clock the parser recognises", () => {
    const state = deriveGameState(
      game({ state: "in", short_detail: "Q3 8:42" }),
    );
    expect(state).toBe("Q3 8:42");
    expect(gameStateForPlayer(player({ game_state: state })).kind).toBe("live");
  });

  it("assembles a clock from parts when short_detail is unusable", () => {
    const state = deriveGameState(
      game({
        state: "in",
        short_detail: "In Progress",
        status_short: "Q2",
        timer: "3:15",
      }),
    );
    expect(state).toBe("Q2 3:15");
    expect(gameStateForPlayer(player({ game_state: state })).kind).toBe("live");
  });

  it("still reads as live when the provider sends no clock at all", () => {
    const state = deriveGameState(
      game({ state: "in", short_detail: "", status_short: "" }),
    );
    expect(gameStateForPlayer(player({ game_state: state })).kind).toBe("live");
  });

  it("reads an upcoming game as a kickoff time, not a clock", () => {
    const state = deriveGameState(game({ state: "pre" }));
    expect(gameStateForPlayer(player({ game_state: state })).kind).toBe(
      "upcoming",
    );
  });

  it("names the day for a game that finished on another day", () => {
    const state = deriveGameState(game({ state: "post" }));
    expect(state).toMatch(/^Final · /);
    expect(gameStateForPlayer(player({ game_state: state })).kind).toBe(
      "final",
    );
  });
});

describe("stampGameStates", () => {
  it("joins a player to their team's game", () => {
    const out = stampGameStates(
      [league([player({})])],
      [game({ state: "in", short_detail: "Q3 8:42" })],
    );
    expect(out[0].rosters![0].data.players[0].game_state).toBe("Q3 8:42");
  });

  it("translates Yahoo abbreviations that differ from the feed's codes", () => {
    const out = stampGameStates(
      [league([player({ editorial_team_abbr: "WAS" })])],
      [game({ state: "in", short_detail: "Q1 12:00", home_team_code: "WSH" })],
    );
    expect(out[0].rosters![0].data.players[0].game_state).toBe("Q1 12:00");
  });

  it("prefers a live game over a finished one for the same team", () => {
    const out = stampGameStates(
      [league([player({})])],
      [
        game({ state: "post" }),
        game({ id: 2, state: "in", short_detail: "Q4 0:32" }),
      ],
    );
    expect(out[0].rosters![0].data.players[0].game_state).toBe("Q4 0:32");
  });

  it("leaves an existing game_state alone — the fixture is authoritative in demos", () => {
    const out = stampGameStates(
      [league([player({ game_state: "Q3 8:42" })])],
      [game({ state: "post" })],
    );
    expect(out[0].rosters![0].data.players[0].game_state).toBe("Q3 8:42");
  });

  it("degrades to no game state rather than guessing when nothing matches", () => {
    const out = stampGameStates(
      [league([player({ editorial_team_abbr: "SEA" })])],
      [game({ state: "in" })],
    );
    const p = out[0].rosters![0].data.players[0];
    expect(p.game_state).toBeUndefined();
    expect(gameStateForPlayer(p)).toEqual({ kind: "unknown", label: "—" });
  });

  it("returns the same reference when nothing changed, so consumers don't re-render", () => {
    const input = [league([player({ editorial_team_abbr: "SEA" })])];
    expect(stampGameStates(input, [game({ state: "in" })])).toBe(input);
    expect(stampGameStates(input, [])).toBe(input);
  });
});
