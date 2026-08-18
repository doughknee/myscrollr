/**
 * The two-line fantasy league chip, as a standalone transparent overlay.
 *
 * Renders `FantasyStatChip` from desktop/src — the shipped component,
 * not a recreation — so the overlay cannot drift from the product. What
 * this file owns is the DATA and the TIMING; the design is entirely the
 * app's.
 *
 * THE ONE IDEA WORTH KNOWING: only the score is animated. Win
 * probability, the spine fill and the score's up/down colour are all
 * DERIVED by the real chip from the matchup it is handed, so counting
 * the score up makes every one of them move in step for free. Animating
 * them separately would have meant reimplementing
 * `estimateWinProbability` here, and then watching the two definitions
 * drift apart the first time the real one was tuned.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import type {
  LeagueResponse,
  RosterPlayer,
} from "../../../desktop/src/datawidgets/fantasy/types";
import { Stage } from "./Stage";
import { Reactor } from "./Reactor";
import { countUp, entrance, livePulse } from "./anim";
import {
  type ScoreEvent,
  impact,
  leadChangeFrame,
  leadFlare,
  scoreAt,
} from "./scoring";

/**
 * A type alias, not an interface, and that is load-bearing: Remotion's
 * `Composition` requires props assignable to `Record<string, unknown>`,
 * and TypeScript grants an implicit index signature to type aliases but
 * not to interfaces. As an interface this fails to compile with a
 * `LooseComponentType` mismatch that names neither cause nor fix.
 */
export type LeagueChipProps = {
  leagueName: string;
  teamName: string;
  opponentName: string;
  week: number;
  status: "live" | "final" | "pre";
  myScore: number;
  opponentScore: number;
  projection: number;
  /** Drives the "★ Lastname 28.1" segment on the second row. */
  topScorer: { name: string; team: string; position: string; points: number };
  record: { wins: number; losses: number; ties?: number };
  rank: number;
  numTeams: number;
  streak?: { type: "win" | "loss"; value: number };
  /**
   * Count the score up from here. Omit to hold the final value — a chip
   * that isn't the subject of the shot shouldn't be animating a number
   * nobody is looking at.
   *
   * Ignored when `scoreEvents` is set: a smooth glide and a sequence of
   * discrete plays are two different stories and the chip can only tell
   * one at a time.
   */
  countUpFrom?: number;
  /**
   * Scoring plays, each landing on its own frame. When present the
   * chip STARTS at `myScore` and the events add to it, so `myScore` is
   * the number before kickoff rather than after — otherwise the same
   * total would have to be written twice and kept in sync by hand.
   */
  scoreEvents?: ScoreEvent[];
  /** Multiplier on the chip's real ticker size. */
  scale?: number;
  /** Give the chip an opaque ground — see Stage. */
  plate?: boolean;
  /** `[data-theme]` palette to render under. */
  theme?: string;
}

export function LeagueChip(props: LeagueChipProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const events = props.scoreEvents ?? [];
  const hasEvents = events.length > 0;

  const score = hasEvents
    ? scoreAt(frame, props.myScore, events)
    : countUp(frame, props.myScore, props.countUpFrom);

  const hit = hasEvents ? impact(frame, events) : 0;
  // The crossing is found once from the props, not tracked frame to
  // frame, because Remotion may render frame 200 before frame 3.
  const crossing = hasEvents
    ? leadChangeFrame(
        props.myScore,
        events,
        props.opponentScore,
        durationInFrames,
      )
    : null;
  const flare = leadFlare(frame, crossing);

  return (
    <Stage
      scale={props.scale ?? 2}
      plate={props.plate}
      theme={props.theme}
      // Only a live matchup has a dot to pulse.
      livePulse={props.status === "live" ? livePulse(frame) : undefined}
    >
      <div style={entrance(frame)}>
        <Reactor
          impact={hit}
          // Only the upswing washes the chip; the anticipation dip is
          // motion, not light, and tinting it green would announce the
          // play before it has happened.
          flash={Math.max(0, hit)}
          flare={flare}
        >
        <FantasyStatChip
          league={buildLeague(props, score)}
          prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
          comfort
          colorMode="widget"
          // Left off deliberately. The roll is Motion-driven and Motion
          // animates through WAAPI on the document timeline, which does
          // not advance when Remotion steps frames — the digits would
          // sit frozen mid-roll. `countUp` above does the same job as a
          // pure function of the frame instead.
            rollScore={false}
          />
        </Reactor>
      </div>
    </Stage>
  );
}

/**
 * Flat props in, a real `LeagueResponse` out.
 *
 * The chip reads the MATCHUP for the score and the ROSTER for the top
 * scorer. Those are two independent paths through the same object, so
 * the roster is built to reconcile with the matchup total rather than
 * being invented: the difference lands on a filler bench entry. A chip
 * whose star player total contradicts its own score is the single most
 * obvious tell in a freeze-frame.
 */
export function buildLeague(
  p: LeagueChipProps,
  score: number,
): LeagueResponse {
  // Derived from the name so a rail of chips gets distinct keys. Two
  // chips sharing a league_key made React reuse one chip's roster for
  // the other, which showed up as the wrong top scorer.
  const slug = p.leagueName.toLowerCase().replace(/\W+/g, "").slice(0, 16);
  const teamKey = `449.l.${slug}.t.1`;
  const oppKey = `449.l.${slug}.t.2`;
  const rounded = Math.round(score * 10) / 10;

  return {
    league_key: `449.l.${slug}`,
    name: p.leagueName,
    game_code: "nfl",
    season: "2025",
    team_key: teamKey,
    team_name: p.teamName,
    data: {
      num_teams: p.numTeams,
      is_finished: p.status === "final",
      current_week: p.week,
      scoring_type: "head",
    },
    standings: [
      {
        team_key: teamKey,
        team_id: 1,
        name: p.teamName,
        team_logo: "",
        manager_name: "You",
        rank: p.rank,
        wins: p.record.wins,
        losses: p.record.losses,
        ties: p.record.ties ?? 0,
        points_for: 1500,
        streak_type: p.streak?.type ?? "win",
        streak_value: p.streak?.value ?? 0,
        playoff_seed: p.rank,
        clinched_playoffs: false,
        waiver_priority: 5,
      },
    ],
    matchups: [
      {
        week: p.week,
        status:
          p.status === "final"
            ? "postevent"
            : p.status === "live"
              ? "midevent"
              : "preevent",
        is_playoffs: false,
        is_tied: false,
        winner_team_key:
          p.status === "final"
            ? rounded > p.opponentScore
              ? teamKey
              : oppKey
            : null,
        teams: [
          {
            team_key: teamKey,
            team_id: 1,
            name: p.teamName,
            team_logo: "",
            manager_name: "You",
            points: rounded,
            projected_points: p.projection,
          },
          {
            team_key: oppKey,
            team_id: 2,
            name: p.opponentName,
            team_logo: "",
            manager_name: "Rival",
            points: p.opponentScore,
            projected_points: Math.round(p.opponentScore * 1.08 * 10) / 10,
          },
        ],
      },
    ],
    rosters: [
      {
        team_key: teamKey,
        data: {
          team_key: teamKey,
          team_name: p.teamName,
          players: roster(p, rounded),
        },
      },
    ],
  };
}

function roster(p: LeagueChipProps, score: number): RosterPlayer[] {
  const star = player(
    p.topScorer.name,
    p.topScorer.team,
    p.topScorer.position,
    p.topScorer.points,
  );
  // Whatever the star didn't score, so the roster sums to the matchup.
  // Named rather than blank because the chip's injury/top-scorer passes
  // both walk this list and a nameless entry reads as corrupt data.
  const rest = player(
    "Squad",
    p.topScorer.team,
    "BN",
    Math.max(0, Math.round((score - p.topScorer.points) * 10) / 10),
  );
  return [star, rest];
}

function player(
  last: string,
  team: string,
  position: string,
  points: number,
): RosterPlayer {
  return {
    player_key: `449.p.${last.toLowerCase().replace(/\W/g, "")}`,
    name: { full: last, first: "", last },
    editorial_team_abbr: team,
    display_position: position,
    selected_position: position,
    position_type: "O",
    // Generated monograms only, never synthetic faces — the same rule
    // the demo fixtures hold. Empty means the chip falls back to text.
    image_url: "",
    // No injury: a red "1 IR" segment is off-message on a chip that
    // exists to sell the product.
    status: null,
    status_full: null,
    injury_note: null,
    player_points: points,
  };
}
