/**
 * Beat 01 — the hook. 3 seconds, locked camera.
 *
 * You are 1.8 points down with a player still on the field, and the
 * number crosses while you watch. Every fantasy player has lived this
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

/** The second the lead changes hands. Everything keys off this. */
const FLIP_AT_SECONDS = 2;

/** Chip is supporting cast under the scoreboard, not the hero. */
const CHIP_SCALE = 2.6;

const MONO = "var(--font-mono, ui-monospace, monospace)";

/**
 * Shared by the scoreboard and the chip so they roll in step.
 *
 * bounce: 0 is deliberate. A spring that overshoots makes a settled
 * score wobble after it lands, which reads as the number being unsure of
 * itself — that was the "shaking" in the first cut.
 *
 * 0.28s because the chip below shows the same score: at 0.5s the
 * scoreboard still read 150.5 while the chip already said 151.8.
 */
const ROLL = {
  format: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  locales: "en-US",
  transition: {
    type: "spring" as const,
    visualDuration: 0.28,
    bounce: 0,
    opacity: { duration: 0.15, ease: "linear" as const },
  },
};

export function Beat1Hook() {
  // Above every Motion component in this tree. Without it AnimateNumber
  // advances on wall clock, not video time — see motionClock.ts.
  useMotionClock();

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flipFrame = FLIP_AT_SECONDS * fps;

  // One event, not a ramp. An earlier cut had a small "drift" score at
  // 0.8s to keep the number alive; it read as a twitch before the real
  // moment and muddied what the shot was about.
  const ahead = frame >= flipFrame;
  const userPoints = ahead ? CLOSING_SCORE : OPENING_SCORE;
  const margin = Math.abs(round1(userPoints - OPPONENT_SCORE));

  // Critically damped on purpose — see ROLL. This drives the lift and
  // the ring, and an oscillating spring would put the wobble straight
  // back in by another route.
  const pop = spring({
    frame: frame - flipFrame,
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
            // The product's own digits roll too, in step with the
            // scoreboard above. Off by default so the main window keeps
            // its steady bar — see FantasyStatChip.
            rollScore
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
