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
 * SCROLLR-296 round 2 (Brandon: "the actual price of the stock should be the
 * biggest, most important thing"; "I really liked the side-by-side setup"):
 * one row of padding 28 + a five-letter symbol at 14px (42) + gap 8 + an 8ch
 * stock price at 20px (96) + gap 8 + an 8ch change at 12px (57.6) = 239.6, a
 * coin (four letters, a 9ch price) 243.2; 260 leaves the row some air. The
 * page engine passes it to every finance page; nothing else holds a quote
 * width.
 */
export const QUOTE_MIN_COL = 260;

/**
 * Whether the day's range row is drawn. Round 2 dropped it (Brandon: "too
 * much going on"): the price leads, the day's line under it is the one detail.
 */
export const QUOTE_RANGE_ROW = false;

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
  /** Draw the day's range row (the dev gallery shows both variants). */
  range?: boolean;
  onClick?: () => void;
}

/**
 * One stock or coin in a page column (SCROLLR-296, Brandon's notes on
 * SCROLLR-268, two rounds).
 *
 * Side by side, as the continuous TradeChip: the symbol, then the PRICE,
 * the largest thing in the cell, then the change in its direction's colour
 * (flat is neutral, no arrow). Under them, quieter, the day's line across
 * the whole cell. Three sizes, none under 12px. A popular fill carries a
 * "+" before its symbol, as the label's "+4 POPULAR" does.
 *
 * The change keeps CHANGE_CH and the price `priceCh` (and so do both range
 * ends when the range row is drawn), so a live tick never moves anything.
 * The line is the chips' own price history (`pushPrice`, seeded from the
 * server's intraday series), so pages and chips draw the same thing.
 */
const QuoteCell = memo(function QuoteCell({ trade: t, fill = false, range = QUOTE_RANGE_ROW, onClick }: QuoteCellProps) {
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
      className={clsx(
        "grid h-full w-full min-w-0 content-center px-3.5 text-left font-mono",
        range ? "grid-rows-[22px_13px_12px] gap-y-[4px]" : "grid-rows-[22px_20px] gap-y-[6px]",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2 leading-none">
        <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-fg-2">
          {fill && <span aria-label="popular" className="text-fg-3">+</span>}
          {t.symbol.replace("/USD", "")}
        </span>
        <span data-part="price" className="shrink-0 text-right text-[20px] font-bold text-fg tabular-nums" style={{ minWidth: ch }}>
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
      {/* The day's line, across the whole cell, quieter than the numbers. */}
      <span data-part="spark" className="flex min-w-0 opacity-70">
        <Sparkline points={series} height={range ? 13 : 20} className={pct < 0 ? "text-down" : "text-up"} />
      </span>
      {/* The day's range: low, the track filled up to the price, high. Both
          ends hold the price's reservation from first render, so a new low or
          high changes the number, never where the track starts or stops. */}
      {range && (
        <span data-part="range" className="flex items-center gap-2 text-[12px] leading-none text-fg-3 tabular-nums">
          <span data-part="range-low" className="shrink-0 text-left" style={{ minWidth: ch }}>
            {pos !== null ? formatPriceBare(t.day_low!) : ""}
          </span>
          <span data-part="range-rail" className="relative h-[2px] min-w-0 flex-1 rounded-[2px] bg-fg-3/25">
            <span
              className={clsx("absolute inset-y-0 left-0 rounded-[2px]", pos === null && "invisible")}
              style={{ width: `${pos ?? 0}%`, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${tone} 22%, transparent), ${tone})` }}
            />
            <span
              className={clsx("absolute -bottom-[3px] -top-[3px] w-[2px] -translate-x-1/2 rounded-[1px] bg-fg-2", pos === null && "invisible")}
              style={{ left: `${pos ?? 0}%` }}
            />
          </span>
          <span data-part="range-high" className="shrink-0 text-right" style={{ minWidth: ch }}>
            {pos !== null ? formatPriceBare(t.day_high!) : ""}
          </span>
        </span>
      )}
    </button>
  );
});

export default QuoteCell;
