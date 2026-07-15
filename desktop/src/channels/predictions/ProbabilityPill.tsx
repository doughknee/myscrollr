/**
 * ProbabilityPill — the predictions channel's signature element (v1.1.5).
 *
 * A rounded mono pill showing implied probability ("62%"), tinted by the
 * market's direction and flashing briefly when the value changes — the
 * kalshi.com percentage-pill look, built on Scrollr tokens so it holds up
 * across light/dark and every theme palette.
 *
 * Owns the flash lifecycle: one effect tracks the previous value in a ref
 * so rapid back-to-back CDC events can't swallow a flash. Card rows that
 * previously flashed their whole background now delegate to this pill.
 */
import { useEffect, useRef, useState } from "react";
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

const SIZE_CLASSES: Record<NonNullable<ProbabilityPillProps["size"]>, string> = {
  sm: "px-1.5 py-px text-ui-chip",
  md: "px-2 py-0.5 text-ui-body",
  lg: "px-2.5 py-1 text-base",
};

export default function ProbabilityPill({
  pct,
  delta = 0,
  size = "md",
  className,
}: ProbabilityPillProps) {
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const current = typeof pct === "number" ? pct : NaN;
    const prev = prevRef.current;
    prevRef.current = Number.isNaN(current) ? prev : current;
    if (prev === null || Number.isNaN(current) || current === prev) return;
    setFlash(current > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [pct]);

  const isUp = delta > 0;
  const isDown = delta < 0;

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold tabular-nums transition-colors duration-700",
        SIZE_CLASSES[size],
        isUp && "bg-up/10 text-up",
        isDown && "bg-down/10 text-down",
        !isUp && !isDown && "bg-surface-2 text-fg",
        flash === "up" && "bg-up/25",
        flash === "down" && "bg-down/25",
        className,
      )}
    >
      {formatProbability(pct)}
    </span>
  );
}
