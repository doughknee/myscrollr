/**
 * FreshnessPill — compact "updated Xs ago" indicator with tone color.
 *
 * Provides a single trust signal per widget: users can glance at the
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
  /** Custom label for the tooltip (defaults to "updated"). */
  label?: string;
  className?: string;
}

const THRESHOLDS = { fresh: 30_000, stale: 90_000, verystale: 300_000 };

/**
 * Shows "updated Xs ago" with a color  that escalates as the
 * value ages past the configured thresholds.
 *
 * Memoized so parents can re-render freely without churning the pill.
 */
export default memo(function FreshnessPill({
  lastUpdated,
  label = "updated",
  className,
}: FreshnessPillProps) {
  const now = useNow();
  if (!lastUpdated) return null;

  const ts = new Date(lastUpdated).getTime();
  if (!Number.isFinite(ts)) return null;

  const age = now - ts;
  let tone: "fresh" | "neutral" | "stale" | "very-stale" = "fresh";
  if (age >= THRESHOLDS.verystale) tone = "very-stale";
  else if (age >= THRESHOLDS.stale) tone = "stale";
  else if (age >= THRESHOLDS.fresh) tone = "neutral";

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
        // h-7 = the bar's one control height (28px: trigger border +
        // py-1 + ui-meta line-height). BarPill carries a transparent
        // border for the same reason — every control sits on one rule.
        // align-top: the bars mount this inside `hidden @xl:block`
        // spans; as inline content the pill sat on the wrapper's text
        // BASELINE, growing the wrapper by the descender gap (~3px)
        // and riding ~1.5px low against its neighbors. vertical-align
        // is inert in flex parents, so this is safe everywhere.
        "inline-flex h-7 align-top items-center gap-1 rounded-full px-2.5 font-mono text-ui-chip tabular-nums",
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
          tone === "very-stale" && "bg-down ",
        )}
      />
      {rel}
    </span>
  );
});
