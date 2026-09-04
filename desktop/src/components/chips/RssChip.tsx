import { memo, useRef } from "react";
import { clsx } from "clsx";
import type { RssItem } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipShellClasses } from "./chipColors";
import { timeAgo } from "../../utils/format";
import { plainText, sourceTab } from "../../utils/rssText";
import { liftForTint } from "../../utils/chipAccent";
import { useFitsOneLine } from "../../hooks/useFitsOneLine";

interface RssChipProps {
  item: RssItem;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /** The news widget's catalog brand colour; widget colour mode only. */
  accent?: string;
  /**
   * How many items this feed put out in the last day. Shown on the
   * detailed row when the item has no summary and its title left room --
   * the one honest thing to say there, and under the ticker's per-feed
   * cap the number that explains why five are showing and not thirty.
   */
  feedCountToday?: number;
  /**
   * The longest headline this chip will ever be asked to show, when it is
   * a rotating slot. Rendered as a second hidden sizer so the headline
   * column holds its width across swaps. Fixed chips leave it unset.
   */
  reserveTitle?: string;
  onClick?: () => void;
}

/** Older than this and the chip dims — the news has stopped being news. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * The age cell, fixed in both modes.
 *
 * Written as a literal class, not interpolated: Tailwind reads source text,
 * so `grid-cols-[..._${AGE_PX}px]` compiles to nothing and the column falls
 * back to auto -- which is why the cell sized itself to its own text and
 * looked like an afterthought next to the game chip's clock.
 */
const GRID_COLS = "grid-cols-[max-content_minmax(0,max-content)_46px]";

/**
 * The headline chip.
 *
 * Three cells: the source as a tab, the headline, the age -- the sports
 * chip's league / teams / clock, one for one. Content-sized under the same
 * cap, with the headline as the cell that gives way.
 *
 * Compact is the first line of the headline. Detailed is one centred
 * two-line block: line one the headline; line two whatever the headline
 * still needs -- the rest of itself if it wrapped, and then the summary
 * in whatever room is left, or the summary alone if it fit. The summary
 * never widens the chip: the block has zero intrinsic width and fills the
 * track a hidden single-line copy of the title sets. Whether the title
 * fit is measured, not counted (useFitsOneLine).
 *
 * The headline is the one sans-serif thing on the rail, deliberately.
 * Every other chip is data and set in mono; this one is prose.
 */
const RssChip = memo(
  function RssChip({
    item,
    comfort,
    colorMode = "widget",
    accent,
    feedCountToday,
    reserveTitle,
    onClick,
  }: RssChipProps) {
    const c = getChipColors(colorMode, "rss");
    const branded = colorMode === "widget" && !!accent;
    const accentStyle = branded ? ({ "--accent": liftForTint(accent) } as React.CSSProperties) : undefined;
    const rule = branded ? "border-[color-mix(in_srgb,var(--accent)_22%,transparent)]" : "border-info/20";

    const title = plainText(item.title);
    const summary = plainText(item.description);
    const published = item.published_at ? new Date(item.published_at).getTime() : null;
    const stale = published != null && Date.now() - published > STALE_AFTER_MS;

    const sizerRef = useRef<HTMLSpanElement>(null);
    const cellRef = useRef<HTMLSpanElement>(null);
    const fits = useFitsOneLine(sizerRef, cellRef);

    const tabText = sourceTab(item.source_name);
    const second =
      summary || (fits && feedCountToday ? `${item.source_name} · ${feedCountToday} today` : "");

    // The clock's scale, so the two read as the same cell: "29m" at 15px,
    // "1h56" at 13px, "Sep 3" at 12px. Width is fixed either way.
    const ageText = timeAgo(item.published_at);
    const ageSize =
      ageText.length <= 3 ? "text-[15px]" : ageText.length <= 4 ? "text-[13px]" : "text-[12px]";

    return (
      <button
        onClick={onClick}
        style={accentStyle}
        title={title}
        className={clsx(
          chipShellClasses(
            branded
              ? {
                  ...c,
                  bg: "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]",
                  border: "border-[color-mix(in_srgb,var(--accent)_25%,transparent)]",
                  hoverBorder: "hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
                }
              : c,
            "whitespace-nowrap",
          ),
          "grid max-w-[640px]",
          GRID_COLS,
          comfort ? "grid-rows-[30px_20px]" : "grid-rows-[28px]",
          stale && "border-edge/55",
        )}
      >
        {/* Source tab: the one place the widget's colour is painted rather than whispered. */}
        <span
          className={clsx(
            "col-start-1 row-span-full flex items-center border-r px-[9px]",
            rule,
            branded && "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]",
          )}
        >
          <span
            className={clsx(
              "font-mono text-[10px] font-bold tracking-[0.08em]",
              branded ? "text-[var(--accent)]" : "text-info",
              stale && "opacity-55",
            )}
          >
            {tabText}
          </span>
        </span>

        {comfort ? (
          <>
            {/* Sets the column: the title's own single-line width, invisible. */}
            <span
              ref={sizerRef}
              aria-hidden
              className="invisible col-start-2 row-start-1 h-0 overflow-hidden whitespace-nowrap px-2.5 font-sans text-[13px] font-semibold"
            >
              {title}
            </span>
            {/* A rotating slot also sizes to the longest headline it will
                ever hold, so a swap cannot widen or narrow the chip. */}
            {reserveTitle && reserveTitle !== title && (
              <span
                aria-hidden
                className="invisible col-start-2 row-start-1 h-0 overflow-hidden whitespace-nowrap px-2.5 font-sans text-[13px] font-semibold"
              >
                {reserveTitle}
              </span>
            )}
            <span ref={cellRef} className="col-start-2 row-span-full flex min-w-0 items-center px-2.5">
              <span
                data-testid="headline-block"
                // text-left is load-bearing: a <button> centres its text by
                // UA default. A single truncated line fills the width and
                // hides it, but a wrapped block centres whichever of its two
                // lines is shorter, which reads as a random indent.
                className="w-0 min-w-full overflow-hidden whitespace-normal text-left font-sans leading-[17px] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
              >
                <span className={clsx("text-[13px] font-semibold", stale ? "text-fg/55" : "text-fg")}>{title}</span>
                {second && (
                  <>
                    {/* Fit on one line: the summary takes line two. Wrapped:
                        it continues in whatever room line two has left. */}
                    {fits ? <br data-testid="summary-break" /> : " "}
                    <span className="text-[11px] font-medium text-fg-3">{second}</span>
                  </>
                )}
              </span>
            </span>
          </>
        ) : (
          <>
            {reserveTitle && reserveTitle !== title && (
              <span
                aria-hidden
                className="invisible col-start-2 row-start-1 h-0 overflow-hidden whitespace-nowrap px-2.5 font-sans text-[13px] font-semibold"
              >
                {reserveTitle}
              </span>
            )}
            <span className="col-start-2 row-start-1 flex min-w-0 items-center px-2.5">
              <span className={clsx("min-w-0 truncate text-left font-sans text-[13px] font-semibold", stale ? "text-fg/55" : "text-fg")}>
                {title}
              </span>
            </span>
          </>
        )}

        <span
          data-testid="age-cell"
          className={clsx(
            "col-start-3 row-span-full flex items-center justify-center border-l font-mono font-semibold leading-none tracking-[0.04em] text-fg-2",
            ageSize,
            rule,
          )}
        >
          {ageText}
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.comfort === next.comfort &&
    prev.colorMode === next.colorMode &&
    prev.accent === next.accent &&
    prev.feedCountToday === next.feedCountToday &&
    prev.reserveTitle === next.reserveTitle &&
    prev.onClick === next.onClick &&
    prev.item.guid === next.item.guid &&
    prev.item.feed_url === next.item.feed_url &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.item.source_name === next.item.source_name &&
    prev.item.published_at === next.item.published_at,
);

export default RssChip;
