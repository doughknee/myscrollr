/**
 * Beat 01 — the hook. 3 seconds, locked camera.
 *
 * You are 1.8 points down with a player still on the field, and the
 * number crosses while you watch. No supers, no explanation: every
 * fantasy player has lived this exact number, and the storyboard is
 * right that the feeling has to land before the product does.
 *
 * Two layers, deliberately:
 *
 *   the score   a promo-native hero number, rolling on AnimateNumber.
 *               This is a graphic, not a screenshot — it is not
 *               claiming the app renders a 260px score.
 *   the chip    the REAL FantasyStatChip with real league data, so the
 *               beat proves the product underneath the graphic. When
 *               the chip design changes this re-renders instead of
 *               going stale.
 *
 * Layout is explicit inline style rather than AbsoluteFill defaults or
 * Tailwind utilities: the composition renders at a fixed 2560x1440
 * where responsive utilities buy nothing. Styling the CHIP is
 * Tailwind's job; placing it in frame is not.
 */
import { AnimateNumber } from "motion-plus/react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import {
  CLOSING_SCORE,
  DRIFT_SCORE,
  OPENING_SCORE,
  OPPONENT_SCORE,
  sundayMoney,
} from "../data/sundayMoney";

import { useMotionClock } from "../motionClock";

/** The second the lead changes hands. Everything keys off this. */
const FLIP_AT_SECONDS = 2;

/** Chip is supporting cast now, not the hero. */
const CHIP_SCALE = 2.4;

/**
 * Points land as PLAYS, not as a ramp — the app's number jumps when a
 * poll lands, so the beat does too, and each landing is what
 * AnimateNumber rolls.
 *
 * A linear ramp was the first instinct and it desyncs the shot: with
 * 1.8 of the 1.9-point climb happening before the lead actually
 * changes, the crossing lands ~14 frames after the spring fires, so the
 * flash reads as a separate event from the number. Discrete plays put
 * the number, the colour flip and the ring on one frame.
 *
 * Frame-keyed rather than second-keyed so the beat is deterministic.
 */
const PLAYS: readonly (readonly [frame: number, score: number])[] = [
  [0, OPENING_SCORE], // 149.9 — where the beat opens
  [48, DRIFT_SCORE], // 150.4 — a catch, keeps the number alive
  [FLIP_AT_SECONDS * 60, CLOSING_SCORE], // 151.8 — the go-ahead
];

const fill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function Beat1Hook() {
  // Above every Motion component in this tree. Without it AnimateNumber
  // advances on wall clock, not video time — see motionClock.ts.
  useMotionClock();

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flipFrame = FLIP_AT_SECONDS * fps;

  const userPoints = PLAYS.reduce(
    (score, [at, value]) => (frame >= at ? value : score),
    OPENING_SCORE,
  );
  const ahead = userPoints > OPPONENT_SCORE;

  // One spring on the crossing. Scale only — nothing that moves the
  // chip's baseline or reflows its text mid-shot.
  const pop = spring({
    frame: frame - flipFrame,
    fps,
    config: { damping: 14, stiffness: 180, mass: 0.6 },
    durationInFrames: Math.round(fps * 0.6),
  });

  return (
    <div style={{ ...fill, background: "#05070a", overflow: "hidden" }}>
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
        scrollr-dark palette, applied at :root. A promo in another
        palette would need those variables re-scoped WITHOUT the shell's
        layout rules coming along.
      */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 72,
        }}
      >
        <HeroScore points={userPoints} ahead={ahead} pop={pop} />

        <div
          style={{
            position: "relative",
            width: "max-content",
            transform: `scale(${CHIP_SCALE})`,
          }}
        >
          <FantasyStatChip
            league={sundayMoney(userPoints)}
            prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
            comfort
          />
          {/*
            The crossing, felt rather than announced — the storyboard's
            "one soft tick", made visible, tying the graphic to the
            product underneath it.

            Inside the scaled wrapper on purpose. Sized against the
            FRAME it fired within the chip's own bounds once the chip
            got big; inset off the chip, it wraps whatever size the chip
            is and scales with it.
          */}
          {ahead && <FlashRing progress={pop} />}
        </div>
      </div>
    </div>
  );
}

function HeroScore({
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
        // The go-ahead lands with a small lift, so the roll reads as an
        // event rather than a value edit.
        transform: `scale(${1 + (ahead ? pop * 0.04 : 0)})`,
      }}
    >
      <AnimateNumber
        format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
        locales="en-US"
        /*
          Fast on purpose. The chip below shows the same score and
          updates instantly, so a long roll leaves the two visibly
          disagreeing — at 0.5s the hero still read 150.5 while the chip
          said 151.8. At 0.28s the disagreement is ~8 frames of
          mid-roll digits and reads as the number landing.
        */
        transition={{
          type: "spring",
          visualDuration: 0.28,
          bounce: 0.2,
          opacity: { duration: 0.15, ease: "linear" },
        }}
        style={{
          fontSize: 260,
          lineHeight: 1,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          // Tone flips with the lead, using the same tokens the chip
          // uses, so the graphic and the product agree on what red and
          // green mean.
          color: ahead ? "var(--color-up)" : "var(--color-down)",
        }}
      >
        {points}
      </AnimateNumber>
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
