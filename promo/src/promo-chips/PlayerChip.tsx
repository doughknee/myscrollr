/**
 * The single-player chip, as a standalone transparent overlay.
 *
 * Renders `FollowedPlayerChip` from desktop/src — again the shipped
 * component. It looks a player up by key out of a list of leagues, so
 * this file's job is to hand it a one-player league that resolves.
 *
 * Same idea as LeagueChip: only the points are animated, and the
 * underline bar follows on its own. That bar is `ChipSpine` measuring
 * points against the player's projection, so counting the points up
 * fills the bar in step. Driving the bar separately would mean owning a
 * second definition of "how is he doing", and two definitions of one
 * thing always end up disagreeing.
 */
import { useCurrentFrame } from "remotion";
import FollowedPlayerChip from "../../../desktop/src/components/chips/FollowedPlayerChip";
import type {
  LeagueResponse,
  RosterPlayer,
} from "../../../desktop/src/datawidgets/fantasy/types";
import { Stage } from "./Stage";
import { Reactor } from "./Reactor";
import { countUp, entrance } from "./anim";
import { type ScoreEvent, impact, scoreAt } from "./scoring";

/**
 * A type alias, not an interface, and that is load-bearing: Remotion's
 * `Composition` requires props assignable to `Record<string, unknown>`,
 * and TypeScript grants an implicit index signature to type aliases but
 * not to interfaces. As an interface this fails to compile with a
 * `LooseComponentType` mismatch that names neither cause nor fix.
 */
export type PlayerChipProps = {
  name: string;
  /** Real-team abbreviation, e.g. "MIA". */
  team: string;
  /** Roster slot, e.g. "RB" or "W/R/T" — drives the position badge. */
  position: string;
  points: number;
  /** Fills the underline bar: points as a share of this. */
  projection: number;
  /**
   * The labelled band under the name. `top` renders "TOP SCORER",
   * `bench` "BENCH LEADER", `worst` and `injury` their own. Omit for a
   * plain followed-player chip with no leading badge.
   */
  accent?: "top" | "worst" | "bench" | "injury";
  /** Is his game running — drives the live treatment on the bar. */
  live?: boolean;
  countUpFrom?: number;
  /**
   * Scoring plays for this player. Same contract as LeagueChip:
   * `points` is the value BEFORE the events, and each one adds to it.
   */
  scoreEvents?: ScoreEvent[];
  scale?: number;
  /** Give the chip an opaque ground — see Stage. */
  plate?: boolean;
  /** `[data-theme]` palette to render under. */
  theme?: string;
}

const PLAYER_KEY = "449.p.promo";
const LEAGUE_KEY = "449.l.promo";

export function PlayerChip(props: PlayerChipProps) {
  const frame = useCurrentFrame();
  const events = props.scoreEvents ?? [];
  const hasEvents = events.length > 0;
  const points = hasEvents
    ? scoreAt(frame, props.points, events)
    : countUp(frame, props.points, props.countUpFrom);
  const hit = hasEvents ? impact(frame, events) : 0;

  return (
    <Stage
      scale={props.scale ?? 2}
      plate={props.plate}
      theme={props.theme}
    >
      <div style={entrance(frame)}>
        <Reactor impact={hit} flash={Math.max(0, hit)}>
        <FollowedPlayerChip
          playerKey={PLAYER_KEY}
          leagueKey={LEAGUE_KEY}
          leagues={[buildLeague(props, points)]}
          comfort
          colorMode="widget"
            accent={props.accent}
          />
        </Reactor>
      </div>
    </Stage>
  );
}

function buildLeague(p: PlayerChipProps, points: number): LeagueResponse {
  const teamKey = `${LEAGUE_KEY}.t.1`;
  return {
    league_key: LEAGUE_KEY,
    name: "Promo",
    game_code: "nfl",
    season: "2025",
    team_key: teamKey,
    team_name: "Promo",
    data: {
      num_teams: 8,
      is_finished: false,
      current_week: 12,
      scoring_type: "head",
    },
    standings: null,
    matchups: null,
    rosters: [
      {
        team_key: teamKey,
        data: {
          team_key: teamKey,
          team_name: "Promo",
          players: [buildPlayer(p, points)],
        },
      },
    ],
  };
}

function buildPlayer(p: PlayerChipProps, points: number): RosterPlayer {
  return {
    player_key: PLAYER_KEY,
    name: { full: p.name, first: "", last: p.name },
    editorial_team_abbr: p.team,
    display_position: p.position,
    selected_position: p.position,
    position_type: "O",
    image_url: "",
    // `game_state` is what the chip reads to decide live vs final, and
    // it drives the bar's treatment. Not a Yahoo field — the fixtures
    // are its only provider, same as in the demo rig.
    game_state: p.live ? "Q4 2:00" : "Final",
    status: p.accent === "injury" ? "O" : null,
    status_full: p.accent === "injury" ? "Out" : null,
    injury_note: null,
    player_points: Math.round(points * 10) / 10,
    projected_points: p.projection,
  };
}
