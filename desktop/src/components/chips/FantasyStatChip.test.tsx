import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FantasyStatChip from "./FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../preferences";
import type { LeagueResponse } from "../../datawidgets/fantasy/types";

const prefs = DEFAULT_WIDGET_DISPLAY.fantasy;

function league(): LeagueResponse {
  return {
    league_key: "449.l.1",
    name: "Test League",
    game_code: "nfl",
    season: "2025",
    team_key: "449.l.1.t.4",
    team_name: "Mine",
    data: {
      num_teams: 8,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: null,
    matchups: [
      {
        week: 12,
        status: "midevent",
        is_playoffs: false,
        is_tied: false,
        winner_team_key: null,
        teams: [
          {
            team_key: "449.l.1.t.4",
            team_id: 4,
            name: "Mine",
            team_logo: "",
            manager_name: "You",
            points: 149.9,
            projected_points: null,
          },
          {
            team_key: "449.l.1.t.9",
            team_id: 9,
            name: "Theirs",
            team_logo: "",
            manager_name: "Them",
            points: 151.7,
            projected_points: null,
          },
        ],
      },
    ],
    rosters: null,
  };
}

describe("FantasyStatChip score rolling", () => {
  /**
   * The important one. `#app-shell` stills every animation so the main
   * window shows a steady bar, but that rule is CSS and AnimateNumber
   * animates through WAAPI, which `animation: none` cannot touch. If this
   * default ever flips to true the app silently starts animating and no
   * stylesheet will stop it.
   */
  it("renders the score as one plain string by default", () => {
    const { container } = render(
      <FantasyStatChip league={league()} prefs={prefs} />,
    );
    expect(screen.getByText("149.9–151.7")).toBeTruthy();
    // No roller mounted, so no digit columns in the markup.
    expect(container.textContent).not.toContain("0123456789");
  });

  /**
   * AnimateNumber renders every digit 0-9 in each column and slides the
   * right one into view, so the roller's own text content is meaningless
   * ("2345678901234567890…"). Left alone that becomes the chip's
   * accessible name — this asserts the real score survives beside it.
   */
  it("rolls the digits when opted in without losing the accessible score", () => {
    const { container } = render(
      <FantasyStatChip league={league()} prefs={prefs} rollScore />,
    );
    expect(container.textContent).toContain("0123456789");
    expect(screen.getByText("149.9–151.7")).toBeTruthy();
  });
});
