/**
 * FreshnessPill — compact "updated Xs ago" indicator with tone color.
 *
 * Provides a single trust signal per channel: users can glance at the
 * feed's control bar and see how recent the most-recent item is, and
 * whether the pipeline appears healthy. The tone shifts as data ages:
 *
 *   < fresh     → green dot (CDC/SSE flowing, or a recent poll)
 *   < stale     → neutral grey (normal steady-state between updates)
 *   < verystale → amber warning
 *   ≥ verystale → red pulsing + "Data may be stale" tooltip
 *
 * Ticks once per second via the shared `useNow()` subscription, so the
 * label advances predictably without spawning per-instance timers.
 */
import { memo } from "react";
import { clsx } from "clsx";
import { useNow } from "../hooks/useNow";
import { relativeTime } from "../utils/format";

interface FreshnessPillProps {
  /** ISO timestamp of last update. */
  lastUpdated: string | null | undefined;
  /** Override the default thresholds (all in ms). */
  thresholds?: { fresh: number; stale: number; verystale: number };
  /** Custom label for the tooltip (defaults to "updated"). */
  label?: string;
  className?: string;
}

const DEFAULT_THRESHOLDS = { fresh: 30_000, stale: 90_000, verystale: 300_000 };

/**
 * Shows "updated Xs ago" with a color transition that escalates as the
 * value ages past the configured thresholds.
 *
 * Memoized so parents can re-render freely without churning the pill.
 */
export default memo(function FreshnessPill({
  lastUpdated,
  thresholds = DEFAULT_THRESHOLDS,
  label = "updated",
  className,
}: FreshnessPillProps) {
  const now = useNow();
  if (!lastUpdated) return null;

  const ts = new Date(lastUpdated).getTime();
  if (!Number.isFinite(ts)) return null;

  const age = now - ts;
  let tone: "fresh" | "neutral" | "stale" | "very-stale" = "fresh";
  if (age >= thresholds.verystale) tone = "very-stale";
  else if (age >= thresholds.stale) tone = "stale";
  else if (age >= thresholds.fresh) tone = "neutral";

  const toneClass = {
    "fresh": "text-up/80 bg-up/10",
    "neutral": "text-fg-4 bg-surface-2",
    "stale": "text-warning bg-warning/10",
    "very-stale": "text-down bg-down/10",
  }[tone];

  const rel = relativeTime(lastUpdated, now, { includeSeconds: true });

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-ui-chip tabular-nums",
        toneClass,
        className,
      )}
      title={tone === "very-stale" ? "Data may be stale" : `Last ${label} ${rel}`}
    >
      <span
        className={clsx(
          "h-1 w-1 rounded-full",
          tone === "fresh" && "bg-up",
          tone === "neutral" && "bg-fg-4",
          tone === "stale" && "bg-warning",
          tone === "very-stale" && "bg-down animate-pulse",
        )}
      />
      {rel}
    </span>
  );
});
