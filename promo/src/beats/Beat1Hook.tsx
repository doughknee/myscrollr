/**
 * Beat 01 — the hook. 3 seconds, locked camera.
 *
 * You are a tenth of a point down with a player still on the field, and
 * the number crosses while you watch. Every fantasy player has lived this
 * exact number, and the storyboard is right that the feeling has to land
 * before the product does.
 *
 * Read as a BROADCAST SCOREBOARD, not as one number. The first cut was a
 * single hero figure and it was impossible to tell what was happening: a
 * viewer needs both teams, both scores, and the state in words to follow
 * "losing → winning" in three seconds. So:
 *
 *   context     which league, which week, that it's live
 *   scoreboard  both teams, both scores, yours coloured by the lead
 *   state       "TRAILING BY 1.8" → "AHEAD BY 0.1", the story in words
 *   chip        the REAL FantasyStatChip, rolling its own digits
 *
 * The scoreboard is a promo graphic — it isn't claiming the app renders
 * a 180px score. The chip underneath is the actual component, so when
 * the chip design changes this re-renders instead of going stale.
 *
 * Layout is explicit inline style rather than AbsoluteFill defaults or
 * Tailwind utilities: the composition renders at a fixed 2560x1440 where
 * responsive utilities buy nothing. Styling the CHIP is Tailwind's job;
 * placing it in frame is not.
 */
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import {
  CLOSING_SCORE,
  OPENING_SCORE,
  OPPONENT_SCORE,
  sundayMoney,
} from "../data/sundayMoney";
import { useMotionClock } from "../motionClock";

/**
 * When the play lands. Late on purpose: the whole first half of the beat
 * is the deficit sitting there doing nothing, which is what makes the
 * climb worth watching. An earlier cut stepped at 2.0s of a 3s shot and
 * the number moved before anyone had read what it was.
 */
const STEP_AT_SECONDS = 2.2;

/**
 * How long the hit takes to settle.
 *
 * The score does not roll or count — it SWAPS, under a flash that covers
 * the frame it changes on. AnimateNumber was the obvious tool and it
 * fought this shot the whole way: it rolls every digit column that
 * changes through every glyph between, so at 215px the transition was a
 * stack of overlapping numerals. Hiding the swap behind a hit is both
 * cleaner to look at and truer to the product, where a score arrives
 * when a poll lands rather than counting up to itself.
 */
const HIT_SECONDS = 0.4;

/** Chip is supporting cast under the scoreboard, not the hero. */
const CHIP_SCALE = 2.6;

const MONO = "var(--font-mono, ui-monospace, monospace)";

/** The go-ahead flash. Green, because it only ever fires on a lead. */
const GLOW = "rgba(34, 197, 94, 0.55)";


export function Beat1Hook() {
  // Above every Motion component in this tree. Without it AnimateNumber
  // advances on wall clock, not video time — see motionClock.ts.
  useMotionClock();

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stepFrame = Math.round(STEP_AT_SECONDS * fps);

  // Stepped, because the roll belongs to AnimateNumber. Interpolating
  // this per frame restarts its slide on every frame and smears every
  // digit permanently between glyphs.
  const landed = frame >= stepFrame;
  const userPoints = landed ? CLOSING_SCORE : OPENING_SCORE;

  // Tone flips with the DATA, on the same frame the chip's does. An
  // earlier cut delayed it to where the digits were expected to finish
  // climbing, and the estimate was wrong — the scoreboard sat red under
  // a settled 151.8, reading "TRAILING BY 1.8", while the chip beside it
  // had already gone green. Two clocks, one of them guessed. The short
  // overlap where the number is green and still climbing reads as the
  // lead landing, which is the point of the shot.
  // Nothing lags now: the number swaps on the same frame the tone and
  // the words do, and the flash covers all three changing at once.
  const ahead = landed;
  const margin = Math.abs(round1(userPoints - OPPONENT_SCORE));

  // The hit. Scale overshoots once and settles — the flash peaks on the
  // swap frame itself, so the eye never resolves the old digits.
  const hit = spring({
    frame: frame - stepFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * HIT_SECONDS),
  });
  const hitScale = landed ? interpolate(hit, [0, 1], [1.22, 1]) : 1;
  const flash = landed
    ? interpolate(frame - stepFrame, [0, 4, Math.round(fps * 0.45)], [1, 0.55, 0], {
        extrapolateRight: "clamp",
      })
    : 0;

  // Critically damped on purpose — see ROLL. This drives the lift and
  // the ring, and an oscillating spring would put the wobble straight
  // back in by another route.
  const pop = hit;


  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#05070a",
        overflow: "hidden",
      }}
    >
      {/*
        NO shell wrapper, deliberately.

        The obvious move is to wrap this in #desktop-shell so the theme
        applies — and it's a trap. style.css gives that id a real layout:
        `height: 100vh`, its own `background: var(--color-surface)`, and
        `width: 100% !important` on its last child (style.css ~1233 and
        ~1251, both there to make the app's ticker + feed stack behave).
        In a video frame that silently stretched this wrapper to full
        width, so scaling it up magnified empty chip interior — three
        blank renders before the CSS explained itself.

        Not needed anyway: style.css's default @theme block IS the
        scrollr-dark palette, applied at :root.
      */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 52,
        }}
      >
        <Context />
        <Scoreboard
          points={userPoints}
          ahead={ahead}
          hitScale={hitScale}
          flash={flash}
        />
        <State ahead={ahead} margin={margin} />

        <div
          style={{
            position: "relative",
            width: "max-content",
            transform: `scale(${CHIP_SCALE})`,
            marginTop: 28,
          }}
        >
          <FantasyStatChip
            league={sundayMoney(userPoints)}
            prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
            comfort
            // NOT rollScore here. The chip renders at ticker size, and
            // a digit roller that small is unreadable mid-transition —
            // it came out as "1 4 ? . 1" rather than a number. The
            // capability is right for the app, where the chip is the
            // only thing moving; under a 215px scoreboard doing the same
            // move it is noise. Its score snaps, which at this size
            // nobody sees.
          />
          {/*
            Inside the scaled wrapper on purpose. Sized against the FRAME
            it fired within the chip's own bounds once the chip got big;
            inset off the chip, it wraps whatever size the chip is.
          */}
          {ahead && <FlashRing progress={pop} />}
        </div>
      </div>
    </div>
  );
}

/** Which league, which week, and that this is happening now. */
function Context() {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 36,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        gap: 22,
      }}
    >
      <span style={{ color: "var(--color-live, #ef4444)" }}>● Live</span>
      <span>The Sunday Money League · Week 12</span>
    </div>
  );
}

function Scoreboard({
  points,
  ahead,
  hitScale,
  flash,
}: {
  points: number;
  ahead: boolean;
  hitScale: number;
  flash: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 110,
      }}
    >
      <Side
        team="Brunch Money"
        you
        points={points}
        color={ahead ? "var(--color-up)" : "var(--color-down)"}
        hitScale={hitScale}
        flash={flash}
      />
      {/*
        Bottom-aligned so it spans the NUMBERS, not the whole column. A
        centred divider drifts up into the team labels, because the
        column is label + number and the row centres on that full height.
      */}
      <div
        style={{
          alignSelf: "flex-end",
          width: 2,
          height: 215,
          background: "#2b3441",
        }}
      />
      <Side team="Fourth and Long" points={OPPONENT_SCORE} color="#9ca3af" />
    </div>
  );
}

function Side({
  team,
  points,
  color,
  you = false,
  hitScale = 1,
  flash = 0,
}: {
  team: string;
  points: number;
  color: string;
  you?: boolean;
  hitScale?: number;
  flash?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 34,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: you ? "#e5e7eb" : "#6b7280",
          whiteSpace: "nowrap",
        }}
      >
        {team}
        {you && <span style={{ color: "#6b7280" }}> (you)</span>}
      </div>
      {/*
        Fixed width so the row can't re-centre. The row is
        centre-justified, so a number whose box changes width by a pixel
        drags every element on the row sideways with it.
      */}
      <div
        style={{
          position: "relative",
          width: 640,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {/*
          The flash. Peaks on the exact frame the number swaps and is
          gone in under half a second, so the eye never gets to resolve
          the old digits — which is the entire job. Behind the number,
          not over it, so the number stays legible throughout.
        */}
        {flash > 0 && (
          <div
            style={{
              position: "absolute",
              inset: "-8% -6%",
              borderRadius: 32,
              background: `radial-gradient(ellipse at center, ${GLOW} 0%, transparent 70%)`,
              opacity: flash,
              pointerEvents: "none",
            }}
          />
        )}
        <span
          style={{
            position: "relative",
            fontSize: 215,
            lineHeight: 1,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            fontFamily: MONO,
            color,
            transform: `scale(${hitScale})`,
            display: "inline-block",
          }}
        >
          {points.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

/**
 * The story in words. Without this a viewer sees two numbers a tenth
 * apart and has to do the arithmetic themselves, which in a 3-second
 * shot means they don't.
 */
function State({ ahead, margin }: { ahead: boolean; margin: number }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 50,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: ahead ? "var(--color-up)" : "var(--color-down)",
      }}
    >
      {ahead ? "▲ Ahead by " : "▼ Trailing by "}
      {margin.toFixed(1)}
    </div>
  );
}

function FlashRing({ progress }: { progress: number }) {
  // Expands past the chip and is gone inside half a second.
  const scale = interpolate(progress, [0, 1], [1, 1.05]);
  const opacity = interpolate(progress, [0, 0.25, 1], [0, 0.55, 0]);
  return (
    <div
      style={{
        position: "absolute",
        inset: -3,
        border: "1px solid var(--color-up)",
        borderRadius: 7,
        transform: `scale(${scale})`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
