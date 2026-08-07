/**
 * Sparkline — a tiny polyline of recent prices.
 *
 * Normalised to its own min/max rather than an absolute scale: the
 * question a sparkline answers on a ticker is "which way has this been
 * going", not "how much is it worth" — the price is already printed
 * beside it. A flat series draws a flat line through the middle rather
 * than dividing by a zero range.
 *
 * Renders nothing below two points. One point is a dot, and a dot next
 * to a price implies a trend that doesn't exist yet.
 */
import { clsx } from "clsx";

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({
  points,
  width = 34,
  height = 12,
  className,
}: SparklineProps) {
  if (points.length < 2) {
    // Reserve the space anyway. Letting the chip shrink until history
    // arrives would reflow the whole rail a few seconds after launch.
    return <span style={{ width, height }} className="inline-block shrink-0" />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  // Inset by half the stroke so the extremes aren't clipped.
  const pad = 1;
  const usable = height - pad * 2;

  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y =
        range === 0 ? height / 2 : pad + (1 - (p - min) / range) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
