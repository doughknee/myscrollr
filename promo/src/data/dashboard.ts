/**
 * The other leagues on the rail, either side of the hero.
 *
 * The promo lays the rail out itself rather than mounting the real
 * ScrollrTicker. That was tried first and the bundling alone took three
 * fixes (see remotion.config.ts) before it rendered an empty bar. It is
 * the wrong thing to be precious about: the CHIPS are the product and
 * they are real here, while the rail is a flex row with a gap. A
 * Remotion-driven scroll is also strictly better for video than the
 * app's CSS marquee, because it is deterministic.
 *
 * What that does cost: chip ORDER and the pinned-zone layout are the
 * promo's here, not ScrollrTicker's. If those change materially in the
 * app this beat won't follow.
 *
 * Same honesty boundary as the rest of the fixtures: real players and
 * real league shapes, representative numbers.
 */
import type {
  LeagueResponse,
  StandingsEntry,
} from "../../../desktop/src/datawidgets/fantasy/types";

/**
 * Split left/right rather than returned as one list, because the hero
 * chip has to stay dead centre through the pull-back — the shot is a
 * reveal only if the chip the camera was already holding is the one left
 * on the rail. Equal COUNTS either side keep it near enough centred.
 *
 * All four are distinct. An earlier version mirrored the same two
 * leagues so the widths matched exactly, and the repeat was obvious on
 * screen: the same "Dynasty or Bust 184.5-151.0" twice in one bar reads
 * as a rendering bug, not as a ticker.
 */
export const RAIL_LEFT: LeagueResponse[] = [workLeague(), dynasty()];
export const RAIL_RIGHT_TAIL: LeagueResponse[] = [familyLeague()];

/** Where the second league starts, and where it ends up. */
export const POOL_BEHIND = 112.4;
export const POOL_AHEAD = 119.4;

/**
 * Parameterised like sundayMoney, so the back half of the film has an
 * EVENT rather than a frozen rail sliding sideways. A second league
 * taking the lead — in the real chip, with the real red-to-green token
 * swap — is what turns "look at this bar" into "it keeps doing this".
 */
export function collegePool(mine: number): LeagueResponse {
  return league({
    key: "449.l.553901",
    name: "Bowl Season Pool",
    teamName: "Bracket Chaos",
    oppName: "Chalk Eaters",
    mine,
    theirs: 118.9,
    status: "midevent",
    rank: 7,
    wins: 5,
    losses: 6,
    streakType: "loss",
    streakValue: 2,
  });
}

/** A comfortable win, for a third tone on the bar. */
function familyLeague(): LeagueResponse {
  return league({
    key: "449.l.118742",
    name: "Thanksgiving Grudge",
    teamName: "Uncle Ray's Revenge",
    oppName: "Cousin Dee",
    mine: 141.2,
    theirs: 126.5,
    status: "midevent",
    rank: 2,
    wins: 8,
    losses: 3,
    streakType: "win",
    streakValue: 2,
  });
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
