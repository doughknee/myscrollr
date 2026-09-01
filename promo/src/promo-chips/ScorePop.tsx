/**
 * ScorePop — the "+13.6 PTS" pill that lands on a music hit.
 *
 * The only comp here with no shipped counterpart: nothing in the app is
 * a standalone score badge, so this is built rather than reused. It
 * still takes its colour, radius and type from the app's own CSS
 * variables through the `#app-shell` wrapper in Stage, so it belongs to
 * the same design system even though it isn't the same component. The
 * alternative — picking a green and a font by eye — is how an overlay
 * ends up subtly not matching the product it's sitting on.
 *
 * Timed to be CUT TO, not read: the overshoot peaks around frame 12 and
 * is settled by 34, so lining the comp's frame 0 up with a beat puts
 * the visual accent a fifth of a second later, which is where an accent
 * wants to sit relative to a transient.
 */
import { interpolate, useCurrentFrame } from "remotion";
import { Stage } from "./Stage";
import { countUp, pop } from "./anim";

/**
 * A type alias, not an interface, and that is load-bearing: Remotion's
 * `Composition` requires props assignable to `Record<string, unknown>`,
 * and TypeScript grants an implicit index signature to type aliases but
 * not to interfaces. As an interface this fails to compile with a
 * `LooseComponentType` mismatch that names neither cause nor fix.
 */
export type ScorePopProps = {
  /** The number on the pill. Sign is applied automatically. */
  value: number;
  /** Trailing label, e.g. "PTS". Omit for a bare number. */
  unit?: string;
  /** `up` is the brand green, `down` the loss red. */
  tone?: "up" | "down";
  /** Show a leading + on positive values. */
  showSign?: boolean;
  /** Count to `value` from here instead of arriving at it. */
  countUpFrom?: number;
  /** How far past its final size it overshoots. 0 disables the bounce. */
  bounce?: number;
  scale?: number;
  /** `[data-theme]` palette to render under. */
  theme?: string;
}

export function ScorePop({
  value,
  unit = "PTS",
  tone = "up",
  showSign = true,
  countUpFrom,
  bounce = 0.34,
  scale = 2,
  theme,
}: ScorePopProps) {
  const frame = useCurrentFrame();
  const shown = countUp(frame, value, countUpFrom);
  const s = pop(frame, { bounce });

  // Fades faster than it scales, so the overshoot is seen at full
  // strength rather than arriving through a haze.
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const color = tone === "up" ? "var(--color-up)" : "var(--color-down)";
  const sign = showSign && shown > 0 ? "+" : "";

  return (
    <Stage scale={scale} theme={theme}>
      <div
        style={{
          transform: `scale(${s})`,
          opacity,
          display: "inline-flex",
          alignItems: "baseline",
          gap: "0.4em",
          padding: "0.34em 0.85em",
          borderRadius: 999,
          // color-mix against the token rather than a second hex, so
          // retinting the brand green retints this too.
          backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
          border: `1.5px solid color-mix(in srgb, ${color} 45%, transparent)`,
          color,
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          fontSize: 30,
          lineHeight: 1,
          letterSpacing: "0.01em",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {sign}
          {shown.toFixed(1)}
        </span>
        {unit && (
          <span style={{ fontSize: "0.55em", letterSpacing: "0.12em" }}>
            {unit}
          </span>
        )}
      </div>
    </Stage>
  );
}
