import { describe, expect, it } from "vitest";
import { fantasyTickerSource } from "./ticker";
import type { TickerContext } from "../ticker";
import type { LeagueResponse, RosterPlayer } from "./types";
import { DEFAULT_WIDGET_DISPLAY } from "../../preferences";
import type { FantasyTickerMode } from "../../preferences";

// The dial's three positions are FIXED sets (docs/CHIP_SPEC.md §8);
// there is no per-item pref underneath. This pins what each one emits.

function player(
  key: string,
  overrides: Partial<RosterPlayer>,
): RosterPlayer {
  return {
    player_key: key,
    name: { full: `P ${key}`, first: "P", last: key },
    editorial_team_abbr: "KC",
    display_position: "RB",
    selected_position: "RB",
    image_url: "",
    status: null,
    status_full: null,
    injury_note: null,
    player_points: 10,
    ...overrides,
  } as RosterPlayer;
}

function league(): LeagueResponse {
  return {
    league_key: "449.l.1",
    name: "Test League",
    game_code: "nfl",
    season: "2025",
    team_key: "449.l.1.t.4",
    team_name: "Mine",
    data: { num_teams: 8, is_finished: false, current_week: 12, scoring_type: "head" },
    standings: null,
    matchups: [],
    rosters: [
      {
        team_key: "449.l.1.t.4",
        data: {
          team_key: "449.l.1.t.4",
          team_name: "Mine",
          players: [
            player("qb", { selected_position: "QB", player_points: 30, game_state: "Q3 8:42" }),
            player("rb", { player_points: 20 }),
            player("wr", { selected_position: "WR", player_points: 5, status: "OUT" }),
            player("bn", { selected_position: "BN", player_points: 18 }),
          ],
        },
      },
    ],
  } as LeagueResponse;
}

function chipKeys(tickerMode: FantasyTickerMode): string[] {
  const ctx = {
    widgetDisplay: {
      fantasy: { ...DEFAULT_WIDGET_DISPLAY.fantasy, tickerMode },
    },
    comfort: false,
    chipColorMode: "widget",
  } as unknown as TickerContext;
  return fantasyTickerSource.chips({ leagues: [league()] }, ctx).map((c) => c.key);
}

describe("fantasy ticker dial", () => {
  it("essential: the league chip only", () => {
    expect(chipKeys("essential")).toEqual(["fan-449.l.1"]);
  });

  it("standard: + the player in play (a first-seen injury is not news)", () => {
    expect(chipKeys("standard")).toEqual(["fan-449.l.1", "fan-449.l.1-live-qb"]);
  });

  it("everything: + starters 2-3, worst starter, bench top, injury report", () => {
    expect(chipKeys("everything")).toEqual([
      "fan-449.l.1",
      "fan-449.l.1-live-qb",
      "fan-449.l.1-top-rb",
      "fan-449.l.1-top-wr",
      "fan-449.l.1-worst-wr",
      "fan-449.l.1-bench-bn",
      "fan-449.l.1-inj-wr",
    ]);
  });
});
