import { memo } from "react";
import { clsx } from "clsx";
import type { RssItem } from "../../../types";
import { plainText } from "../../../utils/rssText";

/** Narrowest column a headline takes (two lines of a real headline), for pagePlan's `columnsFor`. */
export const NEWS_MIN_COL = 400;

/** A pinned headline on the edge: one line, so the edge stays narrow (SCROLLR-284). */
export const NEWS_PIN_W = 260;

/** A column at least this wide sets the headline larger instead of leaving it short. */
export const BIG_HEADLINE_PX = 560;

/** "29m", "4h", "3d": how long ago it was published (undated: when we saw it). */
export function age(item: RssItem, now: number = Date.now()): string {
  const t = new Date(item.published_at ?? item.created_at).getTime();
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

interface NewsCellProps {
  item: RssItem;
  /** The column's width in px; decides the headline size. */
  width: number;
  /** Clock for the age; tests and the dev gallery pin it. */
  now?: number;
  /** One line of headline with the feed's name beneath: a pin on the edge. */
  line?: boolean;
  onClick?: () => void;
}

/**
 * One headline in a page column (canvas: SCROLLR-268 "Families", BBC/NPR).
 *
 * The age sits in a fixed 26px column on the left, so "9m" turning "1h"
 * never moves the headline. The headline takes up to two lines, then the
 * summary (or, with none, the feed's name) on one line beneath.
 */
const NewsCell = memo(function NewsCell({ item, width, now, line, onClick }: NewsCellProps) {
  const summary = plainText(item.description);
  const big = width >= BIG_HEADLINE_PX;
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={String(item.id)}
      className="grid h-full w-full min-w-0 grid-cols-[26px_minmax(0,1fr)] items-center gap-x-2.5 px-3.5 py-[6px] text-left"
    >
      <span data-part="age" className="self-start pt-[3px] text-right font-mono text-[11px] font-semibold leading-none text-fg-3 tabular-nums">
        {age(item, now)}
      </span>
      <span className="flex min-w-0 flex-col justify-center gap-[3px]">
        <span
          data-part="headline"
          className={clsx(
            "text-left font-sans font-semibold text-fg",
            line ? "truncate" : "line-clamp-2",
            big ? "text-[15px] leading-[18px]" : "text-[13px] leading-[16px]",
          )}
        >
          {plainText(item.title)}
        </span>
        <span data-part="summary" className="truncate text-left font-sans text-[11px] leading-[13px] text-fg-3">
          {(!line && summary) || item.source_name}
        </span>
      </span>
    </button>
  );
});

export default NewsCell;
