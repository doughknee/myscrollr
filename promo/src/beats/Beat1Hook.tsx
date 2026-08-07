/**
 * Beat 01 — the hook. 3 seconds, locked camera.
 *
 * One rail chip, filling the frame. You are 1.8 points down with a
 * player still on the field, and the number crosses while you watch.
 * No supers, no explanation: every fantasy player has lived this exact
 * number, and the storyboard is right that the feeling has to land
 * before the product does.
 *
 * The chip is the REAL FantasyStatChip with real league data, scaled
 * up — not a recreation. That's the reason this project exists: when
 * the chip design changes, this re-renders instead of going stale, and
 * the beat can never show something the product doesn't do.
 *
 * Layout is deliberately explicit inline style rather than AbsoluteFill
 * defaults or Tailwind utilities. Two reasons, both learned the hard
 * way here: the composition renders at a fixed 2560x1440 where
 * responsive utilities buy nothing, and mixing the app's Tailwind layer
 * with Remotion's own layout produced a silently blank frame that took
 * three renders to diagnose. Styling the CHIP is Tailwind's job;
 * placing it in frame is not.
 */
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import FantasyStatChip from "../../../desktop/src/components/chips/FantasyStatChip";
import { DEFAULT_WIDGET_DISPLAY } from "../../../desktop/src/preferences";
import {
  CLOSING_SCORE,
  DRIFT_SCORE,
  OPENING_SCORE,
  sundayMoney,
} from "../data/sundayMoney";

/** The second the lead changes hands. Everything keys off this. */
const FLIP_AT_SECONDS = 2;

/**
 * Chip is built for a 40px rail; this makes it a hero. 4.4 went
 * full-bleed with ~40px of air either side, which reads as cropped
 * rather than large — 3.6 leaves the frame around it.
 */
const HERO_SCALE = 3.6;

const fill: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function Beat1Hook() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flipFrame = FLIP_AT_SECONDS * fps;

  // Points arrive in PLAYS, not in a smooth ramp — the app's number
  // jumps when a poll lands, so the beat does too. Drift first, then
  // the catch that takes the lead.
  //
  // A linear ramp was the first instinct and it desyncs the shot: with
  // 1.8 of the 1.9-point climb happening before the lead changes, the
  // crossing lands ~14 frames after the spring fires, so the flash and
  // the number are visibly separate events. Stepping puts the number,
  // the colour flip and the flash on one frame.
  const ahead = frame >= flipFrame;
  const userPoints = ahead
    ? CLOSING_SCORE
    : interpolate(frame, [0, flipFrame], [OPENING_SCORE, DRIFT_SCORE]);

  // One spring on the crossing. Scale only — nothing that moves the
  // chip's baseline or reflows its text mid-shot.
  const pop = spring({
    frame: frame - flipFrame,
    fps,
    config: { damping: 14, stiffness: 180, mass: 0.6 },
    durationInFrames: Math.round(fps * 0.6),
  });
  const scale = HERO_SCALE * (1 + (ahead ? pop * 0.035 : 0));

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
          position: "relative",
          width: "max-content",
          transform: `scale(${scale})`,
        }}
      >
        <FantasyStatChip
          league={sundayMoney(userPoints)}
          prefs={DEFAULT_WIDGET_DISPLAY.fantasy}
          comfort
        />
        {/*
          The crossing, felt rather than announced — the storyboard's
          "one soft tick", made visible.

          Inside the scaled wrapper on purpose. Sized against the FRAME
          it fired within the chip's own bounds once the chip got big;
          inset off the chip, it wraps whatever size the chip is and
          scales with it.
        */}
        {ahead && <FlashRing progress={pop} />}
      </div>
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
