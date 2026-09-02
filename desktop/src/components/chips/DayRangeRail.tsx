/**
 * Day-range rail — where the price sits inside today's low-to-high range.
 *
 * Replaces the "Prev $183.69 · -$0.77" fragment that used to occupy row two.
 * Previous close is derivable from price and change and does not answer a
 * question a glancing viewer has; range position does, and without them
 * reading a number.
 *
 * The track always renders, even with no range data. Collapsing it would
 * change the chip's height, and these chips sit in a marquee where a height
 * change reflows the whole rail.
 */
import { formatPriceBare } from "../../utils/format";

interface DayRangeRailProps {
  price: number;
  low?: number;
  high?: number;
  isUp: boolean;
}

/**
 * Where the price sits in the range, as a percentage, or null when there is
 * no usable range.
 *
 * Exported so the arithmetic can be tested without rendering: the clamp and
 * the divide-by-zero guard are the parts that break, and both are invisible
 * in a snapshot.
 */
export function rangePosition(
  price: number,
  low?: number,
  high?: number,
): number | null {
  const lo = Number(low) || 0;
  const hi = Number(high) || 0;
  // A zero or inverted range has no meaningful position. The ingester guards
  // against storing one, but a chip must not divide by zero on data it did
  // not write.
  if (!(lo > 0 && hi > lo)) return null;
  if (!Number.isFinite(price)) return null;
  // Clamped on purpose: the stored range comes from a daily quote widened by
  // live ticks, so a print can briefly land outside it. A marker sitting off
  // the end of the track reads as a rendering bug.
  return Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100));
}

export function DayRangeRail({ price, low, high, isUp }: DayRangeRailProps) {
  const lo = Number(low) || 0;
  const hi = Number(high) || 0;
  const pos = rangePosition(price, low, high);
  const hasRange = pos !== null;
  const position = pos ?? 0;

  const accent = isUp ? "var(--color-up)" : "var(--color-down)";

  return (
    <div className="flex w-full items-center gap-1.5">
      <span className="shrink-0 font-mono text-[8px] tracking-[0.04em] text-fg-4 tabular-nums">
        {hasRange ? formatPriceBare(lo) : ""}
      </span>

      <div className="relative h-1 flex-1 rounded-[2px] bg-fg-4/25">
        {hasRange && (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-[2px]"
              style={{
                width: `${position}%`,
                // Dark-to-bright so the fill reads as a track that has been
                // travelled, not a solid bar competing with the marker.
                backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${accent} 22%, transparent), ${accent})`,
              }}
            />
            <div
              className="absolute w-[2px] rounded-[1px] bg-primary"
              // Overhangs the 4px track by 2px each side so the marker is
              // findable at a glance while the strip is moving.
              style={{ left: `${position}%`, top: -2, bottom: -2 }}
            />
          </>
        )}
      </div>

      <span className="shrink-0 font-mono text-[8px] tracking-[0.04em] text-fg-4 tabular-nums">
        {hasRange ? formatPriceBare(hi) : ""}
      </span>
    </div>
  );
}
