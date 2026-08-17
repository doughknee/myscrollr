/**
 * A row of real chips, drifting, with plays landing across the whole
 * length of it.
 *
 * The single-chip comps sell the CHIP. This one sells the PRODUCT: a
 * bar you can lay along the top of a screen capture, where the thing
 * that matters is that the other leagues carry on while one of them
 * erupts. A chip on its own can look like a notification; a rail that
 * keeps moving while one cell reacts looks like a live feed.
 *
 * EVERY CHIP CAN SCORE. This started with one designated hero and a
 * list of inert neighbours, which is fine for six seconds and wrong for
 * thirty — a bar where the same cell is the only one that ever moves
 * reads as a mock-up of a ticker rather than a ticker. Each league now
 * carries its own `scoreEvents` and its own reaction, so the rail has a
 * rhythm instead of a single event.
 *
 * Drift is linear and slow on purpose. This is an overlay that will sit
 * under cuts and titles, so it has no business easing, pulsing or
 * drawing the eye on its own — the scores do that.
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import { Stage } from "./Stage";
import { Reactor } from "./Reactor";
import { buildLeague, type LeagueChipProps } from "./LeagueChip";
import { entrance, livePulse } from "./anim";
import {
  type ScoreEvent,
  impact,
  leadChangeFrame,
  leadFlare,
  scoreAt,
} from "./scoring";

/** A league on the rail, with its own plays. */
export type RailLeague = LeagueChipProps & {
  /**
   * Plays for THIS league. Omit for a chip that just sits there being
   * alive — most of them should, most of the time, or the bar turns
   * into a fireworks display and nothing reads as significant.
   */
  scoreEvents?: ScoreEvent[];
};

export type TickerRailProps = {
  leagues: RailLeague[];
  /** Pixels per frame the rail travels left, in pre-scale units. */
  drift?: number;
  /** Gap between chips, pre-scale — the app's own is 8. */
  gap?: number;
  scale?: number;
  plate?: boolean;
};

export function TickerRail({
  leagues,
  drift = 0.35,
  gap = 8,
  scale = 2,
  plate = false,
}: TickerRailProps) {
  const frame = useCurrentFrame();

  return (
    <Stage scale={scale} plate={plate} livePulse={livePulse(frame)}>
      <div
        style={{
          ...entrance(frame),
          display: "flex",
          alignItems: "center",
          gap,
          // Whole pixels. A rail drifting on fractional offsets shimmers
          // as the text re-hints every frame, which is invisible in
          // isolation and obvious once it is sitting over footage.
          transform: `translateX(${-Math.round(frame * drift)}px)`,
        }}
      >
        {leagues.map((league) => (
          <RailChip key={league.leagueName} league={league} />
        ))}
      </div>
    </Stage>
  );
}

/**
 * One cell. Owns its own score, its own reaction and its own lead
 * change, so two leagues scoring near each other stay independent
 * rather than sharing one envelope.
 */
function RailChip({ league }: { league: RailLeague }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const events = league.scoreEvents ?? [];

  if (events.length === 0) {
    // No plays: render flat and skip the wrapper entirely. A Reactor
    // that never fires is a transform and an overlay span per chip per
    // frame, and on a rail this is most of them.
    return <Chip league={league} score={league.myScore} />;
  }

  const score = scoreAt(frame, league.myScore, events);
  const hit = impact(frame, events);
  const crossing = leadChangeFrame(
    league.myScore,
    events,
    league.opponentScore,
    durationInFrames,
  );

  return (
    <Reactor
      impact={hit}
      flash={Math.max(0, hit)}
      flare={leadFlare(frame, crossing)}
    >
      <Chip league={league} score={score} />
    </Reactor>
  );
}

function Chip({
  league,
  score,
}: {
  league: LeagueChipProps;
  score: number;
}) {
  return (
    <FantasyStatChip
      league={buildLeague(league, score)}
      prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
      comfort
      colorMode="widget"
      rollScore={false}
    />
  );
}
