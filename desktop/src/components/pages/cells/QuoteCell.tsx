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
 * How the cell divides between the price (left) and the day (right).
 * SCROLLR-296 round 3 (Brandon: "name top left, value under in large
 * letters, with sparkline and day range on the right 3/5th of the cell or
 * something"). Both were drawn at 1280 and 1920; `half` was picked: at
 * 2/5 the left zone cannot hold a coin's 9-character price at 20px until
 * the column is 312px (three quotes at 1280), and at 1/2 the price is
 * still the biggest, first-read thing in the cell.
 */
export type QuoteSplit = "half" | "twoFifths";
export const QUOTE_SPLIT: QuoteSplit = "half";

/**
 * Narrowest column a quote cell takes, for pagePlan's `columnsFor`, per
 * split. Half: padding 28 + gap 14 + two zones of 109, the left one holding
 * a coin's 9ch price at 20px (108) and the right one the range ends (at most
 * seven characters each at 12px, `rangeText`) = 260. Two fifths: the left
 * zone is 2/5 of 270 = 108 only from 312. The page engine passes it to every
 * finance page; nothing else holds a quote width.
 */
export const QUOTE_MIN_COLS: Record<QuoteSplit, number> = { half: 260, twoFifths: 312 };
export const QUOTE_MIN_COL = QUOTE_MIN_COLS[QUOTE_SPLIT];

/** "▲ 0.89%" / "▼ 12.40%" / "0.00%" (flat has no direction); empty when the change is unknown (never invented). */
export function changeText(pct: number | string | undefined): string {
  const n = Number(pct);
  if (pct == null || pct === "" || !Number.isFinite(n)) return "";
  const abs = Math.abs(n).toFixed(2);
  if (Number(abs) === 0) return `${abs}%`;
  return `${n > 0 ? "▲" : "▼"} ${abs}%`;
}

/**
 * A range end: the price as the bar prints it, whole units from 1,000 up
 * ("79,002", "1,201"), so an end is at most seven characters and both fit
 * the right zone at 12px. Rounded, never invented.
 */
export function rangeText(v: number): string {
  return v >= 1000 ? Math.round(v).toLocaleString("en-US") : formatPriceBare(v);
}

interface QuoteCellProps {
  trade: Trade;
  /** A popular symbol topping up a short watchlist (SCROLLR-292), not one of the user's own. */
  fill?: boolean;
  /** The split between price and day; the dev gallery draws both. */
  split?: QuoteSplit;
  onClick?: () => void;
}

/**
 * One stock or coin in a page column (SCROLLR-296, three rounds of
 * Brandon's notes on SCROLLR-268).
 *
 * Left, the price first: the symbol on top (14px), the PRICE under it, the
 * largest thing in the cell (20px bold), then the change in its direction's
 * colour (12px; flat is neutral, no arrow). Right, the day: its line across
 * the zone, a track under it with the price's place on it, and the day's low
 * and high under that, quiet, at the zone's two edges. A popular fill
 * carries a "+" before its symbol, as the label's "+4 POPULAR" does.
 *
 * Nothing moves on a tick: the price holds `priceCh` and the change
 * CHANGE_CH, each left-aligned in its box; the range ends sit alone at the
 * two edges of their row, so a new low or high grows the number inward and
 * moves nothing else. The line is the chips' own price history
 * (`pushPrice`), so pages and chips draw the same thing.
 */
const QuoteCell = memo(function QuoteCell({ trade: t, fill = false, split = QUOTE_SPLIT, onClick }: QuoteCellProps) {
  const pct = Number(t.percentage_change);
  const text = changeText(t.percentage_change);
  const dir = text.startsWith("▲") ? "up" : text.startsWith("▼") ? "down" : "flat";
  const price = Number(t.price);
  const series = pushPrice(t.symbol, t.price, t.sparkline);
  const pos = rangePosition(price, t.day_low, t.day_high);
  const tone = pct < 0 ? "var(--color-down)" : "var(--color-up)";
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={t.symbol}
      className={clsx(
        "grid h-full w-full min-w-0 items-center gap-x-3.5 px-3.5 text-left font-mono",
        split === "half" ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
      )}
    >
      <span className="flex min-w-0 flex-col gap-[4px] leading-none">
        <span className="min-w-0 truncate text-[14px] font-bold text-fg-2">
          {fill && <span aria-label="popular" className="text-fg-3">+</span>}
          {t.symbol.replace("/USD", "")}
        </span>
        <span data-part="price" className="text-[20px] font-bold text-fg tabular-nums" style={{ minWidth: `${priceCh(t.symbol)}ch` }}>
          {Number.isFinite(price) ? formatPriceBare(price) : ""}
        </span>
        <span
          data-part="change"
          className={clsx("text-[12px] font-semibold tabular-nums", dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-fg-3")}
          style={{ minWidth: `${CHANGE_CH}ch` }}
        >
          {text}
        </span>
      </span>
      <span className="grid min-w-0 grid-rows-[24px_3px_12px] gap-y-[5px]">
        {/* The day's line, across the zone, quieter than the numbers. */}
        <span data-part="spark" className="flex min-w-0 opacity-70">
          <Sparkline points={series} height={24} className={pct < 0 ? "text-down" : "text-up"} />
        </span>
        {/* Where the price sits in the day; with no range the track stays empty rather than guess. */}
        <span data-part="range-rail" className="relative min-w-0 rounded-[2px] bg-fg-3/25">
          <span
            className={clsx("absolute inset-y-0 left-0 rounded-[2px]", pos === null && "invisible")}
            style={{ width: `${pos ?? 0}%`, backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${tone} 22%, transparent), ${tone})` }}
          />
          <span
            className={clsx("absolute -bottom-[3px] -top-[3px] w-[2px] -translate-x-1/2 rounded-[1px] bg-fg-2", pos === null && "invisible")}
            style={{ left: `${pos ?? 0}%` }}
          />
        </span>
        <span data-part="range" className="flex min-w-0 items-center justify-between gap-2 text-[12px] leading-none text-fg-3 tabular-nums">
          <span data-part="range-low">{pos !== null ? rangeText(t.day_low!) : ""}</span>
          <span data-part="range-high">{pos !== null ? rangeText(t.day_high!) : ""}</span>
        </span>
      </span>
    </button>
  );
});

export default QuoteCell;
