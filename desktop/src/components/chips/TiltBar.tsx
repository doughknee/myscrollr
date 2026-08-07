/**
 * TiltBar — which way a game is leaning.
 *
 * A horizontal track with the fill anchored to the AWAY side, matching
 * the chip's left-to-right reading order: away team, tilt, home team.
 * A bar past halfway means the left name is winning, without reading
 * either score.
 *
 * The number behind it is score share, not a real win probability — see
 * winProbabilityForGame. That's why nothing here prints a percentage:
 * the bar can honestly show a lean, but a figure would claim precision
 * the source doesn't have.
 */
import { clsx } from "clsx";

interface TiltBarProps {
  /** 0–1, away-team share. */
  value: number;
  comfort?: boolean;
  /** Pre-game: no scores yet, so the bar is a placeholder, not a claim. */
  dimmed?: boolean;
  /** Final: the bar snaps fully to whoever won. */
  settled?: boolean;
  /** Close game in progress — the fill pulses. */
  live?: boolean;
}

export function TiltBar({
  value,
  comfort,
  dimmed,
  settled,
  live,
}: TiltBarProps) {
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
  // Snapping to 0 or 100 at full time makes the result unmistakable at
  // a glance, which a 63/37 bar next to "FINAL" is not.
  const fill = settled ? (pct >= 0.5 ? 1 : 0) : pct;

  return (
    <span
      className={clsx(
        "relative inline-block shrink-0 overflow-hidden rounded-[2px] bg-fg-3/15",
        comfort ? "h-1 w-11" : "h-1 w-[34px]",
        dimmed && "opacity-40",
      )}
      aria-hidden
    >
      <span
        data-motion={live ? "tilt-pulse" : undefined}
        className={clsx(
          "absolute inset-y-0 left-0 rounded-[2px]",
          // Semantic, never the sports accent: this is a state, and
          // states share one colour language across the whole rail.
          settled ? "bg-fg-3" : "bg-live",
        )}
        style={{ width: `${fill * 100}%` }}
      />
    </span>
  );
}
