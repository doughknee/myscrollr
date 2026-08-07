import { memo } from "react";
import { clsx } from "clsx";
import type { RssItem } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { timeAgo, truncate } from "../../utils/format";

interface RssChipProps {
  item: RssItem;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
}

/** Older than this and the chip dims — the news has stopped being news. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * RSS chip — kicker stack.
 *
 * The source moves from a trailing footnote to a leading kicker, which
 * buys the headline the width the source used to occupy: compact
 * truncation goes 40 -> 64 characters even though the chip didn't grow.
 * A headline cut at 40 characters usually lost the verb.
 *
 * The headline is the one sans-serif thing on the rail, deliberately.
 * Every other chip is data and set in mono; this one is prose and reads
 * as prose.
 */
const RssChip = memo(
  function RssChip({
    item,
    comfort,
    colorMode = "widget",
    onClick,
  }: RssChipProps) {
    const c = getChipColors(colorMode, "rss");
    const headline = truncate(item.title, comfort ? 80 : 64);
    const published = item.published_at
      ? new Date(item.published_at).getTime()
      : null;
    const stale = published != null && Date.now() - published > STALE_AFTER_MS;

    return (
      <button
        onClick={onClick}
        className={clsx(
          chipBaseClasses(comfort, c, "whitespace-nowrap"),
          // Stale items stay legible but stop competing with fresh ones.
          stale && "border-edge/55",
        )}
        title={item.title}
      >
        <div
          className={clsx(
            "flex items-baseline gap-2",
            comfort && "text-ui-body",
          )}
        >
          <Kicker item={item} dim={stale} />
          {/* Sans, not mono — see the component note. */}
          <span
            className={clsx(
              "font-sans font-medium",
              comfort ? "text-[13px]" : "text-ui-body",
              stale ? "text-fg/55" : c.text,
            )}
          >
            {headline}
          </span>
        </div>

        {comfort && item.published_at && (
          <div
            className={clsx(
              "flex items-center gap-1.5 font-mono text-ui-chip",
              c.textFaint,
            )}
          >
            <span>{timeAgo(item.published_at, { suffix: true })}</span>
          </div>
        )}
      </button>
    );
  },
  (prev, next) =>
    prev.comfort === next.comfort &&
    prev.colorMode === next.colorMode &&
    prev.onClick === next.onClick &&
    prev.item.guid === next.item.guid &&
    prev.item.feed_url === next.item.feed_url &&
    prev.item.title === next.item.title &&
    prev.item.source_name === next.item.source_name &&
    prev.item.category === next.item.category &&
    prev.item.published_at === next.item.published_at,
);

/**
 * Source, plus the feed's category when we have one:
 *   REUTERS · MARKETS
 *
 * `category` is optional and currently always absent — see RssItem. The
 * kicker is designed to read correctly either way rather than depending
 * on data that isn't there yet.
 */
function Kicker({ item, dim }: { item: RssItem; dim?: boolean }) {
  if (!item.source_name) return null;
  return (
    <span
      className={clsx(
        "shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider",
        dim ? "text-info/55" : "text-info",
      )}
    >
      {item.source_name}
      {item.category && (
        <>
          <span className="mx-1 text-fg-3">&middot;</span>
          {item.category}
        </>
      )}
    </span>
  );
}

export default RssChip;
