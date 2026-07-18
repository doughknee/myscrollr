import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MatchupHero } from "./MatchupHero";
import type { LeagueResponse } from "./types";

const league: LeagueResponse = {
  league_key: "league-1",
  name: "Stanton Again A Fuck League",
  game_code: "mlb",
  season: "2026",
  team_key: "team-user",
  team_name: "Big Dumps",
  data: {
    num_teams: 10,
    is_finished: false,
    current_week: 7,
    scoring_type: "head",
  },
  standings: null,
  rosters: null,
  matchups: [
    {
      week: 7,
      status: "midevent",
      is_playoffs: false,
      winner_team_key: null,
      teams: [
        {
          team_key: "team-user",
          name: "Big Dumps",
          team_logo: "",
          manager_name: "Philip",
          points: 7,
          projected_points: null,
        },
        {
          team_key: "team-opponent",
          name: "Pasquatch & the Beaned Up Boyz",
          team_logo: "",
          manager_name: "Jack",
          points: 3,
          projected_points: null,
        },
      ],
    },
  ],
  previous_matchups: null,
};

describe("MatchupHero", () => {
  it("constrains long matchup team names so the center score keeps its lane", () => {
    render(<MatchupHero league={league} />);

    expect(screen.getByText("Pasquatch & the Beaned Up Boyz")).toHaveClass(
      "block",
      "max-w-full",
      "truncate",
    );
  });
});
