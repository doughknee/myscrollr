/**
 * The rail: every league the ticker shows once the camera pulls back.
 *
 * `ScrollrTicker` is prop-driven — `dashboard` plus `activeTabs`, no
 * queries, no router, no store — so the promo can render the REAL ticker
 * rather than a row of chips arranged to look like one. Chip order,
 * spacing, the marquee and the pinned-zone layout are all the product's,
 * which means this beat can't drift from what ships.
 *
 * `activeTabs: ["fantasy"]` works because ScrollrTicker resolves a tab to
 * a source via `sourceForWidget` and falls back to the tab name when the
 * catalog has no entry — landing on TICKER_SOURCES.fantasy either way.
 *
 * Same honesty boundary as the rest of the fixtures: real players and
 * real league shapes, representative numbers.
 */
import type { DashboardResponse } from "../../../desktop/src/types";
import type {
  LeagueResponse,
  StandingsEntry,
} from "../../../desktop/src/datawidgets/fantasy/types";
import { sundayMoney } from "./sundayMoney";

export function rail(userPoints: number): DashboardResponse {
  return {
    data: {
      // The hero league stays FIRST so the chip the camera was holding
      // is the chip that ends up on the rail — the pull-back has to land
      // on the same object it started on or the shot is a cut, not a
      // reveal.
      fantasy: [sundayMoney(userPoints), dynasty(), workLeague()],
    },
  };
}

/** A blowout, to contrast with the hero league's one-tenth margin. */
function dynasty(): LeagueResponse {
  return league({
    key: "449.l.220188",
    name: "Dynasty or Bust",
    teamName: "Regret Machine",
    oppName: "Waiver Wire Warriors",
    mine: 184.5,
    theirs: 151.0,
    status: "postevent",
    rank: 1,
    wins: 9,
    losses: 2,
    streakType: "win",
    streakValue: 5,
  });
}

/** Still early, so its chip reads quiet next to two live ones. */
function workLeague(): LeagueResponse {
  return league({
    key: "449.l.771043",
    name: "Cubicle Warfare",
    teamName: "Out of Office",
    oppName: "The Interns",
    mine: 90.9,
    theirs: 83.6,
    status: "midevent",
    rank: 4,
    wins: 6,
    losses: 5,
    streakType: "loss",
    streakValue: 1,
  });
}

function league(o: {
  key: string;
  name: string;
  teamName: string;
  oppName: string;
  mine: number;
  theirs: number;
  status: string;
  rank: number;
  wins: number;
  losses: number;
  streakType: string;
  streakValue: number;
}): LeagueResponse {
  const teamKey = `${o.key}.t.1`;
  const oppKey = `${o.key}.t.2`;
  return {
    league_key: o.key,
    name: o.name,
    game_code: "nfl",
    season: "2025",
    team_key: teamKey,
    team_name: o.teamName,
    data: {
      num_teams: 12,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: [standing(teamKey, o)],
    matchups: [
      {
        week: 12,
        status: o.status,
        is_playoffs: false,
        is_tied: false,
        winner_team_key: null,
        teams: [
          {
            team_key: teamKey,
            team_id: 1,
            name: o.teamName,
            team_logo: "",
            manager_name: "You",
            points: o.mine,
            projected_points: round1(o.mine * 1.08),
          },
          {
            team_key: oppKey,
            team_id: 2,
            name: o.oppName,
            team_logo: "",
            manager_name: "Rival",
            points: o.theirs,
            projected_points: round1(o.theirs * 1.08),
          },
        ],
      },
    ],
    rosters: null,
  };
}

function standing(
  teamKey: string,
  o: {
    teamName: string;
    rank: number;
    wins: number;
    losses: number;
    streakType: string;
    streakValue: number;
  },
): StandingsEntry {
  return {
    team_key: teamKey,
    team_id: 1,
    name: o.teamName,
    team_logo: "",
    manager_name: "You",
    rank: o.rank,
    wins: o.wins,
    losses: o.losses,
    ties: 0,
    points_for: 1500,
    streak_type: o.streakType,
    streak_value: o.streakValue,
    playoff_seed: o.rank,
    clinched_playoffs: false,
    waiver_priority: 5,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
