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
 * SEEDED FROM THE DEMO RIG. These are the same three leagues
 * serve-fantasy-demo.mjs serves and the same three visible in the screen
 * recording the desk shot is cut from — same keys, same team names, same
 * scores, same records. Invented extras used to sit here and the rail
 * disagreed with the screenshot it was sitting on top of.
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
export const RAIL_LEFT: LeagueResponse[] = [workLeague()];
export const RAIL_RIGHT_TAIL: LeagueResponse[] = [dynasty()];

/**
 * The three players the recording's ticker carries as standalone
 * TOP SCORER chips, in its order. They resolve against the hero league's
 * roster, so their numbers move with it.
 */
export const RAIL_PLAYERS = [
  "449.p.walkeriii",
  "449.p.mcbride",
  "449.p.achane",
];

/** Finished, and won comfortably. 184.5-151.0 in the recording. */
function dynasty(): LeagueResponse {
  return league({
    key: "449.l.220417",
    name: "Dynasty or Bust",
    teamName: "Regression Candidates",
    oppName: "Air Yards Only",
    mine: 184.5,
    theirs: 151.0,
    projected: 184.5,
    status: "postevent",
    rank: 1,
    wins: 9,
    losses: 2,
    streakType: "win",
    streakValue: 1,
  });
}

/** Still live, comfortably ahead. 90.9-83.6 in the recording. */
function workLeague(): LeagueResponse {
  return league({
    key: "449.l.671902",
    name: "Work League (Keeper)",
    teamName: "Third and Inches",
    oppName: "Gridiron Ghosts",
    mine: 90.9,
    theirs: 83.6,
    projected: 101.3,
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
  projected: number;
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
      num_teams: 8,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: [
      {
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
      },
    ],
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
            projected_points: o.projected,
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
