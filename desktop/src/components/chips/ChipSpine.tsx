/**
 * ChipSpine — the 2px bar along the bottom edge of a ticker chip.
 *
 * One glance, no reading: how the thing the chip describes is actually
 * going. For a league chip that's win probability; for a player chip
 * it's progress against their projection. The number is already on the
 * chip — the spine is there so a rail of chips can be scanned without
 * parsing any of them.
 *
 * Lives inside a chip with `relative overflow-hidden` (see
 * chipBaseClasses), so it clips to the chip's rounded corners.
 *
 * Motion: the live pulse is opt-in via a `data-motion` attribute rather
 * than a bare `animate-*` class, because the app shell stills every
 * animation with `animation: none !important`. The ticker window has no
 * such rule, so the same markup pulses there and sits still in the app —
 * which is the intent, not a compromise. Reduced motion disables it in
 * both.
 */
import { clsx } from "clsx";

export type SpineState = "pre" | "live" | "final";

interface ChipSpineProps {
  /** 0–1. Clamped, so callers can hand over raw ratios. */
  fill: number;
  state: SpineState;
  /**
   * Tone of the fill. Defaults to the chip's own accent; `up`/`down`
   * are for settled results where win/loss is the whole story.
   */
  tone?: "accent" | "up" | "down";
}

export function ChipSpine({ fill, state, tone = "accent" }: ChipSpineProps) {
  const pct = Math.round(clamp01(fill) * 100);

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
    >
      {/* Track — always present, so a chip with a 0% fill still reads as
          "measured at zero" rather than "no data". */}
      <span className="absolute inset-0 bg-fg-3/15" />
      <span
        data-motion={state === "live" ? "spine-glow" : undefined}
        className={clsx(
          "absolute inset-y-0 left-0",
          tone === "up" && "bg-up",
          tone === "down" && "bg-down",
          tone === "accent" && "bg-current",
          // Pre-game is a projection, not a result. Rendering it at full
          // strength would claim more certainty than exists.
          state === "pre" && "opacity-35",
        )}
        style={{ width: `${state === "final" ? 100 : pct}%` }}
      />
    </span>
  );
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
