/**
 * Beat 1's league, mirroring desktop/fixtures/serve-fantasy-demo.mjs.
 *
 * Mirrors the demo rig's league, teams and roster, so a screen recording
 * of the app and a rendered promo frame sit together without an obvious
 * seam. The OPENING SCORE deliberately differs — see below — so the two
 * are no longer frame-identical at the start of the beat. Match them
 * again by moving the rig to 151.6, not by moving this back.
 *
 * Same honesty boundary as the fixture: the players are real, the stat
 * lines are REPRESENTATIVE, not a verified box score. Nothing rendered
 * from this gets captioned "live", "no edits", or a real date.
 */
import type {
  LeagueResponse,
  RosterEntry,
  RosterPlayer,
  StandingsEntry,
} from "../../../desktop/src/datawidgets/fantasy/types";

/**
 * Where the beat opens: a TENTH behind, not 1.8.
 *
 * Chosen for the roll, and it's a real constraint rather than a taste
 * call. AnimateNumber rolls every digit column that changes, through
 * every glyph between — so 149.9 to 151.8 moves three columns at once
 * and at 215px renders as a stack of overlapping numerals instead of an
 * odometer. Opening at 151.6 moves ONE column, which reads clean at any
 * size. It is also a tenser number to be losing by.
 */
export const OPENING_SCORE = 151.6;
export const OPPONENT_SCORE = 151.7;
/** Where it lands — one score past them. */
export const CLOSING_SCORE = 151.8;

const TEAM_KEY = "449.l.884213.t.4";
const OPP_KEY = "449.l.884213.t.9";
const TEAM_NAME = "Brunch Money";
const OPP_NAME = "Fourth and Long";

/**
 * Every starter except Achane. Fixed for the whole beat — their games
 * are done, which is exactly why the one live player decides it.
 */
const SETTLED_STARTERS: readonly (readonly [
  last: string,
  first: string,
  team: string,
  pos: string,
  points: number,
])[] = [
  ["Hurts", "Jalen", "PHI", "QB", 21.4],
  ["Chase", "Ja'Marr", "CIN", "WR", 19.8],
  ["Robinson", "Bijan", "ATL", "RB", 18.1],
  ["Nacua", "Puka", "LAR", "WR", 16.2],
  ["Smith-Njigba", "Jaxon", "SEA", "W/R/T", 14.6],
  ["McBride", "Trey", "ARI", "TE", 13.5],
  ["Texans", "Houston", "HOU", "DEF", 12.6],
  ["Aubrey", "Brandon", "DAL", "K", 11.0],
];

const SETTLED_TOTAL = round1(
  SETTLED_STARTERS.reduce((sum, [, , , , pts]) => sum + pts, 0),
);

/**
 * Build the league at a given user score, so a composition can drive the
 * number from the frame and let the REAL chip re-render. That's the
 * whole point of this project: the thing on screen is the product, not a
 * drawing of it.
 *
 * Achane absorbs the difference rather than the total being typed twice.
 * The chip reads the MATCHUP for the score and the ROSTER for the top
 * scorer, so if those were independent they could drift apart and the
 * chip would contradict itself on camera. The demo rig holds the same
 * invariant for the same reason.
 */
export function sundayMoney(userPoints: number): LeagueResponse {
  const achanePoints = round1(userPoints - SETTLED_TOTAL);

  return {
    league_key: "449.l.884213",
    name: "The Sunday Money League",
    game_code: "nfl",
    season: "2025",
    team_key: TEAM_KEY,
    team_name: TEAM_NAME,
    data: {
      num_teams: 8,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: standings(),
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
            team_id: 4,
            name: TEAM_NAME,
            team_logo: "",
            manager_name: "You",
            points: round1(userPoints),
            // Projection stays put as the banked score climbs — the
            // points are arriving, not being forecast twice.
            projected_points: 168.8,
          },
          {
            team_key: OPP_KEY,
            team_id: 9,
            name: OPP_NAME,
            team_logo: "",
            manager_name: "D. Ramos",
            points: OPPONENT_SCORE,
            projected_points: 164.5,
          },
        ],
      },
    ],
    rosters: [roster(achanePoints)],
  };
}

/**
 * Row 2 of the comfort chip is built from standings and roster, so a
 * league with both null renders a chip that is mostly empty space —
 * which is exactly what the first cut of this beat showed. Record, rank
 * and streak all come from here.
 */
function standings(): StandingsEntry[] {
  return [
    {
      team_key: TEAM_KEY,
      team_id: 4,
      name: TEAM_NAME,
      team_logo: "",
      manager_name: "You",
      rank: 2,
      wins: 8,
      losses: 3,
      ties: 0,
      points_for: 1584.2,
      streak_type: "win",
      streak_value: 3,
      playoff_seed: 2,
      clinched_playoffs: false,
      waiver_priority: 6,
    },
    {
      team_key: OPP_KEY,
      team_id: 9,
      name: OPP_NAME,
      team_logo: "",
      manager_name: "D. Ramos",
      rank: 3,
      wins: 7,
      losses: 4,
      ties: 0,
      points_for: 1552.7,
      streak_type: "loss",
      streak_value: 1,
      playoff_seed: 3,
      clinched_playoffs: false,
      waiver_priority: 5,
    },
  ];
}

function roster(achanePoints: number): RosterEntry {
  return {
    team_key: TEAM_KEY,
    data: {
      team_key: TEAM_KEY,
      team_name: TEAM_NAME,
      players: [
        // The one still on the field, and the top scorer either way.
        player("Achane", "De'Von", "MIA", "RB", achanePoints),
        ...SETTLED_STARTERS.map(([last, first, team, pos, pts]) =>
          player(last, first, team, pos, pts),
        ),
      ],
    },
  };
}

function player(
  last: string,
  first: string,
  team: string,
  position: string,
  points: number,
): RosterPlayer {
  return {
    player_key: `449.p.${last.toLowerCase().replace(/\W/g, "")}`,
    name: { full: `${first} ${last}`, first, last },
    editorial_team_abbr: team,
    display_position: position,
    selected_position: position,
    position_type: position === "DEF" ? "D" : position === "K" ? "K" : "O",
    // Generated monograms only, never synthetic faces. Inventing a stat
    // line for a real player is a demo; inventing their photograph is
    // something else.
    image_url: "",
    // No injuries on purpose: countInjuries() would push a red "1 IR"
    // segment, which is off-message in a beat about winning.
    status: null,
    status_full: null,
    injury_note: null,
    player_points: points,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Achane has to stay the top scorer for the whole beat — the chip picks
 * the top scorer from the roster, and if a settled starter outscored him
 * the "★" segment would silently change player mid-shot. Cheap to
 * assert, and it fires at import rather than on camera.
 */
{
  const best = Math.max(...SETTLED_STARTERS.map(([, , , , pts]) => pts));
  const lowestAchane = round1(OPENING_SCORE - SETTLED_TOTAL);
  if (lowestAchane <= best) {
    throw new Error(
      `[promo] Achane opens on ${lowestAchane} but ${best} is already on ` +
        `the roster, so he is not the top scorer. Adjust SETTLED_STARTERS.`,
    );
  }
}
