/**
 * Sparkline — a tiny polyline of recent prices.
 *
 * Stretches to whatever width the flex row gives it (`viewBox="0 0 100 30"`
 * with `preserveAspectRatio="none"`), which is what lets the chip be a fixed
 * size while symbols and prices vary in length. `vector-effect` keeps the
 * stroke an even weight despite the non-uniform scale.
 *
 * Renders nothing below two points. One point is a dot, and a dot next to a
 * price implies a trend that doesn't exist yet.
 */
import { clsx } from "clsx";

interface SparklineProps {
  points: number[];
  height?: number;
  className?: string;
}

// The viewBox is a fixed coordinate space; the browser scales it to the
// element's real width. All the maths below is in these units.
const VB_W = 100;
const VB_H = 30;

/**
 * How much of the box a series' movement earns, 0..1.
 *
 * Normalising purely to a series' own min/max makes every chip fill its box,
 * so a symbol that ranged 0.79% and one that ranged 5.12% draw the same size
 * squiggle — the shape survives but the MAGNITUDE is thrown away, and a
 * sparkline has no axis to recover it from. Scaling the drawn height by the
 * real range restores it and makes chips comparable to each other.
 *
 * Exported for tests: this is the part with the arithmetic in it.
 */
export function amplitudeFor(points: number[]): number {
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (!(min > 0)) return 1;
  const rangePct = ((max - min) / min) * 100;
  // 4% earns the full box. Floored so a very quiet symbol still reads as a
  // line with movement in it rather than a dead rule, which looks like
  // missing data.
  return Math.max(0.18, Math.min(1, rangePct / 4));
}

export function Sparkline({ points, height = 16, className }: SparklineProps) {
  if (points.length < 2) {
    // Reserve the row height but no width: the chip is a fixed size and the
    // sparkline is its flexible element, so an empty one should give its
    // space to the rest of the row rather than hold a visible gap.
    return <span style={{ height }} className="flex-1" aria-hidden />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;

  const pad = 1.5;
  const usable = VB_H - pad * 2;
  const drawable = usable * amplitudeFor(points);
  const top = pad + (usable - drawable) / 2;

  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * VB_W;
      const y =
        range === 0 ? VB_H / 2 : top + (1 - (p - min) / range) * drawable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={clsx("min-w-0 flex-1", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
