import { memo, useState } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../../types";
import { formatPriceBare } from "../../../utils/format";
import { Sparkline } from "../../chips/Sparkline";
import { pushPrice } from "../../chips/priceHistory";
import { rangePosition } from "../../chips/DayRangeRail";

/** Characters a change holds: "▲ 12.34%" is eight. */
export const CHANGE_CH = 8;

/**
 * Characters the price holds, decided once when the cell mounts (a page
 * mounts its cells at swipe-in, so this is the freeze): the price's own
 * length plus one, so a digit-boundary crossing while the page is up
 * (99.99 to 100.01, or back) never moves anything, and the line sits at
 * most one character further off than the price alone (SCROLLR-296 round 6).
 * Where the format itself jumps by two near the price (999.99 to 1,000.00
 * adds a comma; 1.00 to 0.9900 adds two decimals) it holds that too.
 */
export function priceReserve(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const len = (v: number) => formatPriceBare(v).length;
  return Math.max(len(price) + 1, len(price * 1.02), len(price * 0.98));
}

/**
 * Narrowest column a quote cell takes, for pagePlan's `columnsFor`.
 * SCROLLR-296 rounds 3 and 4: padding 28 + the price zone, as wide as a
 * coin's 9ch price at 20px (108) + a 12px gap + the day zone, which needs
 * the two range ends (at most seven characters each at 12px, `rangeText`,
 * 101) and a gap = 257. The page engine passes it to every finance page;
 * nothing else holds a quote width.
 */
export const QUOTE_MIN_COL = 260;

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
  onClick?: () => void;
}

/**
 * One stock or coin in a page column (SCROLLR-296, five rounds of
 * Brandon's notes on SCROLLR-268).
 *
 * Left, the price first: the symbol on top (14px), the PRICE under it, the
 * largest thing in the cell (20px bold), then the change in its direction's
 * colour (12px; flat is neutral, no arrow). Right, the day: its line across
 * the zone, a track under it with the price's place on it, and the day's low
 * and high under that, quiet, at the zone's two edges. A popular fill
 * carries a "+" before its symbol, as the label's "+4 POPULAR" does, hung in
 * the gutter so every symbol starts at the same x.
 *
 * Symbol, price and change share one left edge (round 5, Brandon: "align
 * left"), and the price zone is as wide as the price itself, so the line
 * starts 12px after the price's last digit (round 4: "too much padding
 * between the number and the line"; round 3 had 54-63px).
 *
 * Nothing moves on a tick: the price holds `priceReserve`, fixed when the
 * page swipes in, so a digit-boundary crossing either way stays inside it;
 * the change holds CHANGE_CH; the range ends sit alone at the two edges of
 * their row, so a new low or high grows the number inward and moves nothing
 * else. The line is the chips' own price history
 * (`pushPrice`), so pages and chips draw the same thing.
 */
const QuoteCell = memo(function QuoteCell({ trade: t, fill = false, onClick }: QuoteCellProps) {
  const pct = Number(t.percentage_change);
  const text = changeText(t.percentage_change);
  const dir = text.startsWith("▲") ? "up" : text.startsWith("▼") ? "down" : "flat";
  const price = Number(t.price);
  // Once, at mount: a page's cells mount when it swipes in.
  const [reserve] = useState(() => priceReserve(price));
  const series = pushPrice(t.symbol, t.price, t.sparkline);
  const pos = rangePosition(price, t.day_low, t.day_high);
  const tone = pct < 0 ? "var(--color-down)" : "var(--color-up)";
  return (
    <button
      type="button"
      onClick={onClick}
      data-chip=""
      data-item={t.symbol}
      className="grid h-full w-full min-w-0 grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3 px-3.5 text-left font-mono"
    >
      <span className="flex min-w-0 flex-col items-start gap-[4px] leading-none">
        <span data-part="symbol" className="relative flex min-w-0 max-w-full text-[14px] font-bold text-fg-2">
          {/* Hung in the gutter (outside the truncating box, so it is not clipped): a fill's symbol starts where everyone's does. */}
          {fill && <span aria-label="popular" className="absolute right-full mr-px text-fg-3">+</span>}
          <span className="min-w-0 truncate">{t.symbol.replace("/USD", "")}</span>
        </span>
        <span data-part="price" className="text-[20px] font-bold text-fg tabular-nums" style={{ minWidth: `${reserve}ch` }}>
          {Number.isFinite(price) ? formatPriceBare(price) : ""}
        </span>
        <span
          data-part="change"
          className={clsx("text-[12px] font-semibold tabular-nums", dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-fg-3")}
          style={{ minWidth: `${CHANGE_CH}ch` }}
        >
          {/* The arrow is not in IBM Plex Mono: the fallback font draws it at a
              different width per OS, so it gets a box of exactly one character
              (CI's Linux Chromium measured the ▼ wider than the ▲). */}
          {dir === "flat" ? text : (
            <>
              <span className="inline-block w-[1ch] overflow-hidden text-center">{text[0]}</span>
              {text.slice(1)}
            </>
          )}
        </span>
      </span>
      {/* 31 + 4 + 3 + 4 + 12 = 54, the price zone's height: the low and high share the change's baseline. */}
      <span className="grid min-w-0 grid-rows-[31px_3px_12px] gap-y-[4px]">
        {/* The day's line, across the zone, quieter than the numbers. */}
        <span data-part="spark" className="flex min-w-0 opacity-70">
          <Sparkline points={series} height={30} className={pct < 0 ? "text-down" : "text-up"} />
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
        <span data-part="range" className="-mt-px flex min-w-0 items-start justify-between gap-2 text-[12px] leading-none text-fg-3 tabular-nums">
          <span data-part="range-low">{pos !== null ? rangeText(t.day_low!) : ""}</span>
          <span data-part="range-high">{pos !== null ? rangeText(t.day_high!) : ""}</span>
        </span>
      </span>
    </button>
  );
});

export default QuoteCell;
