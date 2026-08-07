/**
 * Beat 1's league, mirroring desktop/fixtures/serve-fantasy-demo.mjs.
 *
 * The numbers are deliberately the SAME ones the demo rig serves —
 * 149.9 vs 151.7, a 1.8 deficit with Achane still on the field — so a
 * screen recording of the app and a rendered promo frame can be cut
 * together without the audience noticing a seam.
 *
 * Same honesty boundary as the fixture: the players are real, the stat
 * lines are representative. This is a demo league, and any caption on
 * footage built from it has to say so.
 */
import type { LeagueResponse } from "../../../desktop/src/datawidgets/fantasy/types";

/** Where the beat opens. Achane has 8.3 of a 14.2 projection. */
export const OPENING_SCORE = 149.9;
export const OPPONENT_SCORE = 151.7;
/**
 * Drift before the play that matters — a couple of receptions. Keeps
 * the number alive without giving the lead away early.
 */
export const DRIFT_SCORE = 150.4;
/** Where it lands — one score past them. */
export const CLOSING_SCORE = 151.8;

/**
 * Build the league at a given user score, so a composition can drive
 * the number from the frame and let the REAL chip re-render. That's the
 * whole point of this project: the thing on screen is the product, not
 * a drawing of it.
 */
export function sundayMoney(userPoints: number): LeagueResponse {
  return {
    league_key: "449.l.884213",
    name: "The Sunday Money League",
    game_code: "nfl",
    season: "2025",
    team_key: "449.l.884213.t.4",
    team_name: "Brunch Money",
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
            team_key: "449.l.884213.t.4",
            team_id: 4,
            name: "Brunch Money",
            team_logo: "",
            manager_name: "You",
            points: round1(userPoints),
            // Projection stays put as the banked score climbs — the
            // points are arriving, not being forecast twice.
            projected_points: 168.8,
          },
          {
            team_key: "449.l.884213.t.9",
            team_id: 9,
            name: "Fourth and Long",
            team_logo: "",
            manager_name: "D. Ramos",
            points: OPPONENT_SCORE,
            projected_points: 164.5,
          },
        ],
      },
    ],
    rosters: null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
