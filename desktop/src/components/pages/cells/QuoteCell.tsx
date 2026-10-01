import { memo } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../../types";
import { formatPriceBare } from "../../../utils/format";
import { Sparkline } from "../../chips/Sparkline";
import { pushPrice } from "../../chips/priceHistory";
import { rangePosition } from "../../chips/DayRangeRail";

/** Characters a price holds: "12,345.67" is nine. */
export const PRICE_CH = 9;
/** Characters a change holds: "▲ 12.34%" is eight (the canvas's 7 fits only one digit). */
export const CHANGE_CH = 8;

/**
 * Narrowest column a quote cell takes, for pagePlan's `columnsFor`. Padding
 * 28 + a 9ch price at 15px (81) + gap 8 + an 8ch change at 11.5px (55) =
 * 172, so "79,850.21" fits whole. pagePlan's default of 158 cuts a
 * five-digit price.
 */
export const QUOTE_MIN_COL = 172;

/** "▲ 0.89%" / "▼ 12.40%"; empty when the change is unknown (never invented). */
export function changeText(pct: number | string | undefined): string {
  const n = Number(pct);
  if (pct == null || pct === "" || !Number.isFinite(n)) return "";
  return `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;
}

interface QuoteCellProps {
  trade: Trade;
  onClick?: () => void;
}

/**
 * One stock or coin in a page column (canvas: SCROLLR-268 "Families",
 * stocks and crypto).
 *
 * Symbol over price on the left; the change over the day's line on the
 * right; the day's range along the bottom. The change keeps CHANGE_CH and
 * the price PRICE_CH, so a live tick never moves the column. The line is
 * the chips' own price history (`pushPrice`, seeded from the server's
 * intraday series), so pages and chips draw the same thing.
 */
const QuoteCell = memo(function QuoteCell({ trade: t, onClick }: QuoteCellProps) {
  const pct = Number(t.percentage_change);
  const up = !(pct < 0);
  const price = Number(t.price);
  const series = pushPrice(t.symbol, t.price, t.sparkline);
  const pos = rangePosition(price, t.day_low, t.day_high);
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={t.symbol}
      className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[15px_18px_12px] items-center gap-x-2 px-3.5 py-[7px] text-left font-mono"
    >
      <span className="truncate text-[11px] font-bold leading-none tracking-[0.06em] text-fg-2">{t.symbol.replace("/USD", "")}</span>
      <span
        data-part="change"
        className={clsx("text-right text-[11.5px] font-semibold leading-none tabular-nums", up ? "text-up" : "text-down")}
        style={{ minWidth: `${CHANGE_CH}ch` }}
      >
        {changeText(t.percentage_change)}
      </span>
      <span
        data-part="price"
        className="truncate text-[15px] font-bold leading-none text-fg tabular-nums"
        style={{ minWidth: `${PRICE_CH}ch` }}
      >
        {Number.isFinite(price) ? formatPriceBare(price) : ""}
      </span>
      <span className="flex w-[52px] justify-self-end">
        <Sparkline points={series} height={16} className={up ? "text-up" : "text-down"} />
      </span>
      {/* The day's range: low, where the price sits, high. The track is
          always there; with no range it stays empty rather than guess. */}
      <span data-part="range" className="col-span-2 flex items-center gap-1.5 text-[9.5px] leading-none text-fg-4 tabular-nums">
        <span>{pos !== null ? formatPriceBare(t.day_low!) : ""}</span>
        <span className="relative h-px flex-1 bg-fg-4/40">
          <span
            className={clsx("absolute -top-[2px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-fg-2", pos === null && "invisible")}
            style={{ left: `${pos ?? 0}%` }}
          />
        </span>
        <span>{pos !== null ? formatPriceBare(t.day_high!) : ""}</span>
      </span>
    </button>
  );
});

export default QuoteCell;
