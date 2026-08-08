/**
 * The second league — and the whole reason the film stopped being generic.
 *
 * De'Von Achane is on the OPPONENT's roster here. So the same play that
 * pushes Sunday Money from 149.9 to 151.8 pushes this matchup's opponent
 * from 117.7 to 119.6, and one real chip turns green on the exact frame
 * the other turns red.
 *
 * That is the point. "A number gets better" is the payload of every
 * dashboard promo ever cut and a browser tab already delivers it. One
 * player landing in two leagues at once, with opposite consequences,
 * is a thing a tab structurally cannot show you — and rooting against
 * your own guy is about the most-posted feeling in r/fantasyfootball.
 *
 * No component work was needed for any of it: FantasyStatChip already
 * derives its score tone from myPts vs oppPts, so both chips colour
 * themselves. This is a data file.
 *
 * Same honesty boundary as the other fixtures: real player, invented
 * stat line, nothing here claims to be a live game.
 */
import type {
  LeagueResponse,
  StandingsEntry,
} from "../../../desktop/src/datawidgets/fantasy/types";

const KEY = "449.l.771044";
const TEAM_KEY = `${KEY}.t.3`;
const OPP_KEY = `${KEY}.t.7`;

/** Fixed all film. Achane isn't mine here, so my total never moves. */
const MY_POINTS = 118.6;

/** Their total with Achane on 8.3 — i.e. before the play lands. */
const THEIR_POINTS_BASE = 117.7;

/** What Achane has banked at the top of the film, per sundayMoney. */
const ACHANE_BASE = 8.3;

/**
 * Their score, driven by Achane exactly as the hero league's is. Both
 * chips read the same player's points; they just disagree about whether
 * that is good news.
 */
export function badBeats(achanePoints: number): LeagueResponse {
  const theirs = round1(THEIR_POINTS_BASE + (achanePoints - ACHANE_BASE));

  return {
    league_key: KEY,
    name: "Bad Beats",
    game_code: "nfl",
    season: "2025",
    team_key: TEAM_KEY,
    team_name: "Punt Coverage",
    data: {
      num_teams: 10,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: [standing()],
    matchups: [
      {
        week: 12,
        status: "midevent",
        is_playoffs: false,
        is_tied: false,
        winner_team_key: null,
        teams: [
          {
            team_key: TEAM_KEY,
            team_id: 3,
            name: "Punt Coverage",
            team_logo: "",
            manager_name: "You",
            points: MY_POINTS,
            projected_points: 131.4,
          },
          {
            team_key: OPP_KEY,
            team_id: 7,
            name: "Waiver Wire Warriors",
            team_logo: "",
            manager_name: "Rival",
            points: theirs,
            projected_points: 134.2,
          },
        ],
      },
    ],
    // Deliberately null. userRoster() only ever reads MY team, so a roster
    // here would add a "★ top scorer" segment and another total to keep
    // consistent, for a chip whose entire job is the score turning red.
    rosters: null,
  };
}

/**
 * 5-6, 6th of 10, on a two-game slide.
 *
 * Not a brag, on purpose. The hero league's 8-3 / 2nd is a record nobody
 * identifies with; a rail showing one league you are winning and one you
 * are losing is both truer and more recognisable than two victories.
 */
function standing(): StandingsEntry {
  return {
    team_key: TEAM_KEY,
    team_id: 3,
    name: "Punt Coverage",
    team_logo: "",
    manager_name: "You",
    rank: 6,
    wins: 5,
    losses: 6,
    ties: 0,
    points_for: 1188.4,
    streak_type: "loss",
    streak_value: 2,
    playoff_seed: 6,
    clinched_playoffs: false,
    waiver_priority: 3,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The inversion has to actually invert, or the film's whole premise is a
 * caption over two chips that agree with each other. Cheap to assert.
 */
{
  const before = badBeats(ACHANE_BASE).matchups![0].teams;
  const after = badBeats(10.2).matchups![0].teams;
  const leadBefore = (before[0].points ?? 0) - (before[1].points ?? 0);
  const leadAfter = (after[0].points ?? 0) - (after[1].points ?? 0);
  if (!(leadBefore > 0 && leadAfter < 0)) {
    throw new Error(
      `[promo] Bad Beats must go from winning to losing when Achane scores — ` +
        `lead goes ${leadBefore} to ${leadAfter}. Fix MY_POINTS/THEIR_POINTS_BASE.`,
    );
  }
}
