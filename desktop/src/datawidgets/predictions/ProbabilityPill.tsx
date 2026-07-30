/**
 * ProbabilityPill — the predictions widget's signature element (v1.1.5).
 *
 * A rounded mono pill showing implied probability ("62%"), tinted by the
 * market's direction. Uses Scrollr tokens so it holds up across light/dark
 * and every theme palette.
 */
import { clsx } from "clsx";
import { formatProbability } from "./view";

export interface ProbabilityPillProps {
  /** Implied probability in cents (0–100). */
  pct: number | null | undefined;
  /** Signed delta driving the tint; 0/undefined renders neutral. */
  delta?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Fixed min-widths (sized for "100%") so pills share a column edge across
// rows and cards — variable-width pills made the delta column wobble.
const SIZE_CLASSES: Record<NonNullable<ProbabilityPillProps["size"]>, string> = {
  sm: "min-w-12 px-1.5 py-px text-ui-chip",
  md: "min-w-14 px-2 py-0.5 text-ui-body",
  lg: "min-w-16 px-2.5 py-1 text-base",
};

export default function ProbabilityPill({
  pct,
  delta = 0,
  size = "md",
  className,
}: ProbabilityPillProps) {
  const isUp = delta > 0;
  const isDown = delta < 0;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold tabular-nums  ",
        SIZE_CLASSES[size],
        isUp && "bg-up/10 text-up",
        isDown && "bg-down/10 text-down",
        !isUp && !isDown && "bg-surface-2 text-fg",
        className,
      )}
    >
      {formatProbability(pct)}
    </span>
  );
}
