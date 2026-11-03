import { memo } from "react";
import { clsx } from "clsx";
import type { RssItem } from "../../../types";
import { plainText } from "../../../utils/rssText";

/** Narrowest column a headline takes (two lines of a real headline), for pagePlan's `columnsFor`. */
export const NEWS_MIN_COL = 400;

/** A pinned headline on the edge: one line, so the edge stays narrow (SCROLLR-284). */
export const NEWS_PIN_W = 260;

/** Characters the age holds: "59m", "23h", "6d" (the ingester keeps a week). */
export const AGE_CH = 3;

/** "29m", "4h", "3d": how long ago it was published (undated: when we saw it). */
export function age(item: RssItem, now: number = Date.now()): string {
  const t = new Date(item.published_at ?? item.created_at).getTime();
  const m = Math.max(0, Math.round((now - t) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

interface NewsCellProps {
  item: RssItem;
  /** The column's width in px (the page passes it; the layout is the same at every width a headline gets). */
  width: number;
  /** Clock for the age; tests and the dev gallery pin it. */
  now?: number;
  /** One line of headline with the feed's name beneath: a pin on the edge. */
  line?: boolean;
  expanded?: boolean;
  onClick?: () => void;
}

/**
 * One headline in a page column (SCROLLR-296, Brandon's notes on SCROLLR-268).
 *
 * A fixed grid, top-anchored: the headline's first line starts at the same
 * y whether it takes one line or two, and the meta line (the age, then the
 * summary or, with none, the feed's name) sits on the same baseline under
 * both. The age leads that line in a fixed AGE_CH box, so "9m" turning "1h"
 * never moves the summary, and the headline gets the column's whole width.
 *
 * Two sizes: the headline at 15px at every width (real news columns are
 * 426-584px, so the old 560px switch to 15px almost never fired), the meta
 * line at 12px.
 */
const NewsCell = memo(function NewsCell({ item, now, line, expanded = false, onClick }: NewsCellProps) {
  const summary = plainText(item.description);
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={String(item.id)}
      data-display-cell={expanded ? "news" : undefined}
      className={clsx(
        "grid h-full w-full min-w-0 px-4 text-left",
        expanded ? "grid-rows-[66px_minmax(0,1fr)] gap-y-3 py-4" : "content-center gap-y-[3px]",
        !expanded && (line ? "grid-rows-[19px_15px]" : "grid-rows-[38px_15px]"),
      )}
    >
      <span
        data-part="headline"
        className={clsx(
          "min-w-0 self-start text-left font-sans font-semibold text-fg",
          expanded ? "line-clamp-3 text-[18px] leading-[22px]" : "text-[15px] leading-[19px]",
          !expanded && (line ? "truncate" : "line-clamp-2"),
        )}
      >
        {plainText(item.title)}
      </span>
      <span className="flex min-h-0 min-w-0 items-baseline gap-2 overflow-hidden text-[12px] leading-[15px]">
        <span
          data-part="age"
          className="shrink-0 font-mono font-semibold text-fg-3 tabular-nums"
          style={{ width: `${AGE_CH}ch` }}
        >
          {age(item, now)}
        </span>
        <span data-part="summary" className={clsx("min-w-0 text-left font-sans text-fg-3", expanded ? "line-clamp-3" : "truncate")}>
          {(!line && summary) || item.source_name}
        </span>
      </span>
    </button>
  );
});

export default NewsCell;
