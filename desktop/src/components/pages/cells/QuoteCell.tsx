import { memo } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../../types";
import { formatPriceBare } from "../../../utils/format";
import { Sparkline } from "../../chips/Sparkline";
import { pushPrice } from "../../chips/priceHistory";
import { rangePosition } from "../../chips/DayRangeRail";

/** Characters a coin's price holds: "79,850.21" is nine. */
export const PRICE_CH = 9;
/** Characters a stock's price holds: "9,999.99" is eight (NVR, BKNG, AZO all sit under it). */
export const STOCK_PRICE_CH = 8;
/** Characters a change holds: "▲ 12.34%" is eight. */
export const CHANGE_CH = 8;

/** The price reservation for this symbol: a coin's nine characters, a stock's eight. */
export function priceCh(symbol: string): number {
  return symbol.includes("/") ? PRICE_CH : STOCK_PRICE_CH;
}

/**
 * Narrowest column a quote cell takes, for pagePlan's `columnsFor`.
 * SCROLLR-296 puts the continuous chip's top line in one row: padding 24 +
 * a five-letter symbol at 13px (39) + gap 6 + an 8ch stock price at 15px
 * (72) + gap 6 + an 8ch change at 12px (57.6) = 204.6, and a coin (four
 * letters, a 9ch price) 205.8, so "GOOGL" sits whole beside a price and its
 * change. 212 keeps eight quotes at 1920 with the Clock on the edge: wider
 * costs the crypto page a second page and the busiest lap its 60 s
 * (pages.spec). The page engine passes it to every finance page; nothing
 * else holds a quote width.
 */
export const QUOTE_MIN_COL = 212;

/** "▲ 0.89%" / "▼ 12.40%" / "0.00%" (flat has no direction); empty when the change is unknown (never invented). */
export function changeText(pct: number | string | undefined): string {
  const n = Number(pct);
  if (pct == null || pct === "" || !Number.isFinite(n)) return "";
  const abs = Math.abs(n).toFixed(2);
  if (Number(abs) === 0) return `${abs}%`;
  return `${n > 0 ? "▲" : "▼"} ${abs}%`;
}

interface QuoteCellProps {
  trade: Trade;
  /** A popular symbol topping up a short watchlist (SCROLLR-292), not one of the user's own. */
  fill?: boolean;
  onClick?: () => void;
}

/**
 * One stock or coin in a page column, to the standard of the continuous
 * TradeChip (SCROLLR-296, Brandon's notes on SCROLLR-268).
 *
 * The chip's top line in one row: the symbol, then the price and the change
 * in its direction's colour (flat is neutral, no arrow). Under it the day's
 * line across the whole cell, so it grows with the column, and the day's
 * range tight under that: low, a track filled up to where the price sits,
 * high. Three sizes, none under 12px. A popular fill carries a "+" before
 * its symbol, as the label's "+4 POPULAR" does.
 *
 * The change keeps CHANGE_CH, and the price and both range ends `priceCh`,
 * so a live tick never moves anything. The line is the chips' own price
 * history (`pushPrice`, seeded from the server's intraday series), so pages
 * and chips draw the same thing.
 */
const QuoteCell = memo(function QuoteCell({ trade: t, fill = false, onClick }: QuoteCellProps) {
  const pct = Number(t.percentage_change);
  const text = changeText(t.percentage_change);
  const dir = text.startsWith("▲") ? "up" : text.startsWith("▼") ? "down" : "flat";
  const price = Number(t.price);
  const series = pushPrice(t.symbol, t.price, t.sparkline);
  const pos = rangePosition(price, t.day_low, t.day_high);
  const tone = pct < 0 ? "var(--color-down)" : "var(--color-up)";
  const ch = `${priceCh(t.symbol)}ch`;
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={t.symbol}
      className="grid h-full w-full min-w-0 grid-rows-[17px_16px_12px] content-center gap-y-[4px] px-3 text-left font-mono"
    >
      <span className="flex min-w-0 items-baseline gap-1.5 leading-none">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-fg-2">
          {fill && <span aria-label="popular" className="text-fg-3">+</span>}
          {t.symbol.replace("/USD", "")}
        </span>
        <span data-part="price" className="shrink-0 text-right text-[15px] font-bold text-fg tabular-nums" style={{ minWidth: ch }}>
          {Number.isFinite(price) ? formatPriceBare(price) : ""}
        </span>
        <span
          data-part="change"
          className={clsx("shrink-0 text-right text-[12px] font-semibold tabular-nums", dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-fg-3")}
          style={{ minWidth: `${CHANGE_CH}ch` }}
        >
          {text}
        </span>
      </span>
      {/* The day's line, across the whole cell. */}
      <span data-part="spark" className="flex min-w-0">
        <Sparkline points={series} height={16} className={pct < 0 ? "text-down" : "text-up"} />
      </span>
      {/* The day's range: low, the track filled up to the price, high. The
          track is always there; with no range it stays empty rather than
          guess. Both ends hold the price's reservation from first render, so
          a new low or high changes the number, never where the track starts
          or stops. */}
      <span data-part="range" className="flex items-center gap-2 text-[12px] leading-none text-fg-3 tabular-nums">
        <span data-part="range-low" className="shrink-0 text-left" style={{ minWidth: ch }}>
          {pos !== null ? formatPriceBare(t.day_low!) : ""}
        </span>
        <span data-part="range-rail" className="relative h-[3px] min-w-0 flex-1 rounded-[2px] bg-fg-3/25">
          <span
            className={clsx("absolute inset-y-0 left-0 rounded-[2px]", pos === null && "invisible")}
            style={{ width: `${pos ?? 0}%`, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${tone} 22%, transparent), ${tone})` }}
          />
          <span
            className={clsx("absolute -bottom-[3px] -top-[3px] w-[2px] -translate-x-1/2 rounded-[1px] bg-fg", pos === null && "invisible")}
            style={{ left: `${pos ?? 0}%` }}
          />
        </span>
        <span data-part="range-high" className="shrink-0 text-right" style={{ minWidth: ch }}>
          {pos !== null ? formatPriceBare(t.day_high!) : ""}
        </span>
      </span>
    </button>
  );
});

export default QuoteCell;
