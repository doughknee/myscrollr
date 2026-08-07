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
import { AnimateNumber } from "motion-plus/react";
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
 * How long the digits take to climb. Short on purpose.
 *
 * The anticipation in this beat is the 2.2s of deficit BEFORE the play,
 * not the climb itself. A long roll actively hurts: 149.9 to 151.8
 * changes three digit columns at once, and AnimateNumber rolls each one
 * through every glyph between, so at 215px a slow version is a stack of
 * overlapping numerals rather than an odometer. Quick reads as a hit.
 */
const ROLL_SECONDS = 0.45;

/** Chip is supporting cast under the scoreboard, not the hero. */
const CHIP_SCALE = 2.6;

const MONO = "var(--font-mono, ui-monospace, monospace)";

/**
 * AnimateNumber owns this roll, and it does advance under Remotion —
 * the manual clock in motionClock.ts is what makes that true.
 *
 * bounce: 0 because a settled score that overshoots and wobbles reads as
 * the number being unsure of itself.
 *
 * The value it animates BETWEEN must be stepped, not interpolated per
 * frame. Feeding it a fresh number every frame restarts the slide every
 * frame and leaves every digit stuck between glyphs — a smear, not a
 * roll.
 */
const ROLL = {
  format: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  locales: "en-US",
  transition: { type: "spring" as const, visualDuration: ROLL_SECONDS, bounce: 0 },
};

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
  // Waits for the DIGITS, not the data. The score steps instantly but
  // takes ROLL_SECONDS to visibly climb, so flipping on the step turns
  // everything green over a number still reading 149-something.
  const ahead = frame >= stepFrame + Math.round(fps * ROLL_SECONDS);
  const margin = Math.abs(round1((ahead ? CLOSING_SCORE : OPENING_SCORE) - OPPONENT_SCORE));

  // Critically damped on purpose — see ROLL. This drives the lift and
  // the ring, and an oscillating spring would put the wobble straight
  // back in by another route.
  const pop = spring({
    frame: frame - (stepFrame + Math.round(fps * ROLL_SECONDS)),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.45),
  });

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
        <Scoreboard points={userPoints} ahead={ahead} pop={pop} />
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
  pop,
}: {
  points: number;
  ahead: boolean;
  pop: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 110,
        // The go-ahead lands with a small lift, so the roll reads as an
        // event rather than a value edit.
        transform: `scale(${1 + (ahead ? pop * 0.03 : 0)})`,
      }}
    >
      <Side
        team="Brunch Money"
        you
        points={points}
        color={ahead ? "var(--color-up)" : "var(--color-down)"}
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

/**
 * NOT memoised, and that's deliberate — React.memo here silently kills
 * the roll. AnimateNumber needs the per-frame re-renders to advance;
 * bail out of them and the number snaps straight to its new value in a
 * single frame. Memoising looked right (the parent re-renders 60 times a
 * second to drive the lift) and cost the entire animation.
 */
function Side({
  team,
  points,
  color,
  you = false,
}: {
  team: string;
  points: number;
  color: string;
  you?: boolean;
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
        Fixed width, and it matters more than it looks. The row is
        centre-justified, so if the number's box changes width by even a
        pixel mid-transition the whole scoreboard re-centres and every
        element on the row twitches sideways.
      */}
      <div
        style={{
          width: 640,
          display: "flex",
          justifyContent: "center",
        }}
      >
      <AnimateNumber
        {...ROLL}
        style={{
          fontSize: 215,
          lineHeight: 1,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          fontFamily: MONO,
          color,
        }}
      >
        {points}
      </AnimateNumber>
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
