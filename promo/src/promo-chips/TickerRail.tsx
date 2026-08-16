/**
 * A row of real chips, drifting, with one of them scoring.
 *
 * The single-chip comps sell the CHIP. This one sells the PRODUCT: a
 * bar you can lay along the top of a screen capture, where the thing
 * that matters is that the other leagues carry on while one of them
 * erupts. A chip on its own can look like a notification; a rail that
 * keeps moving while one cell reacts looks like a live feed.
 *
 * Drift is linear and slow on purpose. This is an overlay that will sit
 * under cuts and titles, so it has no business easing, pulsing or
 * drawing the eye on its own — the score does that.
 */
import { useCurrentFrame } from "remotion";
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

export type TickerRailProps = {
  /** The chip that scores. Rendered in the middle of the rail. */
  hero: LeagueChipProps;
  /** Its scoring plays. */
  scoreEvents: ScoreEvent[];
  /** The leagues either side, which just sit there being alive. */
  others: LeagueChipProps[];
  /** Pixels per frame the rail travels left. */
  drift?: number;
  /** Gap between chips, in pre-scale pixels — the app's own is 8. */
  gap?: number;
  scale?: number;
  plate?: boolean;
};

export function TickerRail({
  hero,
  scoreEvents,
  others,
  drift = 0.35,
  gap = 8,
  scale = 2,
  plate = false,
}: TickerRailProps) {
  const frame = useCurrentFrame();
  const score = scoreAt(frame, hero.myScore, scoreEvents);
  const hit = impact(frame, scoreEvents);
  // Duration is not needed here: the crossing can only happen inside the
  // events, so scanning to the last one plus its count is sufficient and
  // avoids making this depend on the composition's length.
  const lastEvent = scoreEvents.reduce((n, e) => Math.max(n, e.at), 0);
  const crossing = leadChangeFrame(
    hero.myScore,
    scoreEvents,
    hero.opponentScore,
    lastEvent + 60,
  );
  const flare = leadFlare(frame, crossing);

  // The hero sits in the middle so there is always something either
  // side of the reaction. A rail that erupts at its own edge reads as
  // the bar ending rather than the league scoring.
  const middle = Math.ceil(others.length / 2);
  const before = others.slice(0, middle);
  const after = others.slice(middle);

  return (
    <Stage
      scale={scale}
      plate={plate}
      livePulse={livePulse(frame)}
    >
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
        {before.map((l) => (
          <Chip key={l.leagueName} league={l} />
        ))}
        {/* Only the hero reacts. The rail around it holding steady is
            what makes this read as one league scoring rather than an
            app-wide alert. */}
        <Reactor impact={hit} flash={Math.max(0, hit)} flare={flare}>
          <Chip league={hero} score={score} />
        </Reactor>
        {after.map((l) => (
          <Chip key={l.leagueName} league={l} />
        ))}
      </div>
    </Stage>
  );
}

function Chip({
  league,
  score,
}: {
  league: LeagueChipProps;
  /** Overrides the static score — only the hero passes one. */
  score?: number;
}) {
  return (
    <FantasyStatChip
      league={buildLeague(league, score ?? league.myScore)}
      prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
      comfort
      colorMode="widget"
      rollScore={false}
    />
  );
}
