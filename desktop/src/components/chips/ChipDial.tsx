/**
 * ChipDial — a small SVG ring showing a 0–1 fraction.
 *
 * Used by the predictions chip for implied probability. The dial
 * replaces a percentage pill because a ring is readable at a glance on
 * a moving rail: "nearly full" and "barely started" register without
 * reading a number, and the number is still right beside it for anyone
 * who wants it.
 *
 * Deliberately not animated. It sits on a rail that is already
 * scrolling, and the value changes on every poll — a transition would
 * mean the arc is almost never showing the current number.
 */
import { clsx } from "clsx";

interface ChipDialProps {
  /** 0–1. Clamped, so callers can pass raw ratios. */
  value: number;
  /** Outer diameter in px. 18 compact, 26 comfort per the spec. */
  size?: number;
  strokeWidth?: number;
  /** Tailwind text-* class; the arc inherits it via `currentColor`. */
  className?: string;
  label?: string;
}

export function ChipDial({
  value,
  size = 18,
  strokeWidth = 2.5,
  className,
  label,
}: ChipDialProps) {
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  // Inset by half the stroke so the ring's outer edge lands on the box
  // rather than clipping — SVG strokes straddle the path.
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={clsx("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
        // Track is always drawn, so an empty dial reads as "measured at
        // zero" rather than "no data".
        className="stroke-fg-3/15"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={`${circumference * pct} ${circumference}`}
        // Start the arc at 12 o'clock instead of 3 — a gauge that fills
        // from the top is the convention everywhere else.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
