import { memo } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { formatPriceBare, formatChange } from "../../utils/format";
import { Sparkline } from "./Sparkline";
import { pushPrice } from "./priceHistory";
import { DayRangeRail } from "./DayRangeRail";

export type TickerDirectionMarker = "arrow" | "sign" | "none";

interface TradeChipProps {
  trade: Trade;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /** How to render the up/down marker. Defaults to "arrow" (▲▼). */
  directionMarker?: TickerDirectionMarker;
  onClick?: () => void;
}

const TradeChip = memo(
  function TradeChip({
    trade,
    comfort,
    colorMode = "widget",
    directionMarker = "arrow",
    onClick,
  }: TradeChipProps) {
    const c = getChipColors(colorMode, "finance");
    // Direction comes from the signed percentage rather than the stored
    // `direction` string: it is the number actually rendered beside the
    // line, so the two can never disagree. Flat counts as up.
    const pct = Number(trade.percentage_change) || 0;
    const isUp = pct >= 0;
    const changeStr = formatChange(trade.percentage_change);

    // Record this tick and draw what we've seen. Called during render on
    // purpose: the buffer is keyed by symbol+price and collapses repeats,
    // so re-renders with unchanged data are no-ops rather than duplicate
    // points. An effect would miss the first paint and leave the chip
    // flat for a poll cycle.
    const series = pushPrice(trade.symbol, trade.price, trade.sparkline);

    // Pick the marker glyph per user preference. Empty string = no
    // marker rendered (the % itself still carries the sign).
    const marker =
      directionMarker === "arrow"
        ? isUp
          ? "\u25B2"
          : "\u25BC"
        : directionMarker === "sign"
          ? isUp
            ? "+"
            : "\u2212"
          : "";

    // formatChange already signs the number ("+0.89%"), so the "sign"
    // marker rendered a second one: "++0.89%" up, "−-0.55%" down. The
    // marker and the sign are two spellings of one fact, so when the
    // marker IS the sign, the number drops its own.
    //
    // Only that mode. "arrow" deliberately keeps both -- an arrow reads as
    // direction and the sign as arithmetic, and that pairing is what ships
    // today -- and "none" needs the sign because nothing else carries it.
    const changeText =
      directionMarker === "sign" ? changeStr.replace(/^[+−-]/, "") : changeStr;

    return (
      <button
        onClick={onClick}
        className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
      >
        {/* Row 1: symbol, price, change */}
        <div
          className={clsx(
            "flex w-full items-center gap-2",
            comfort && "text-ui-body",
          )}
        >
          {/* Symbol is never coloured. Colour carries exactly one meaning
              on this chip — direction — and a green symbol makes every chip
              read as "up" in peripheral vision. */}
          <span className={clsx("font-semibold", c.text)}>{trade.symbol}</span>
          <Sparkline
            points={series}
            height={comfort ? 16 : 14}
            className={isUp ? "text-up" : "text-down"}
          />
          {/* No currency glyph: every number on the row is a price, and at
              this size the "$" is noise costing width the rail now uses. */}
          <span className={c.text}>{formatPriceBare(trade.price)}</span>
          {changeStr && (
            <span
              className={clsx(
                "font-medium text-ui-meta",
                isUp ? "text-up" : "text-down",
              )}
            >
              {marker}
              {changeText}
            </span>
          )}
        </div>
        {/* Row 2: day-range rail (comfort only). Replaces the previous-close
            fragment, which stopped halfway across the chip and left the
            lower-right quadrant empty. */}
        {comfort && (
          <DayRangeRail
            price={Number(trade.price) || 0}
            low={trade.day_low}
            high={trade.day_high}
            isUp={isUp}
          />
        )}
      </button>
    );
  },
  (prev, next) =>
    prev.comfort === next.comfort &&
    prev.colorMode === next.colorMode &&
    prev.directionMarker === next.directionMarker &&
    prev.onClick === next.onClick &&
    prev.trade.symbol === next.trade.symbol &&
    prev.trade.price === next.trade.price &&
    prev.trade.percentage_change === next.trade.percentage_change &&
    prev.trade.direction === next.trade.direction &&
    prev.trade.previous_close === next.trade.previous_close &&
    prev.trade.price_change === next.trade.price_change &&
    prev.trade.day_low === next.trade.day_low &&
    prev.trade.day_high === next.trade.day_high,
);

export default TradeChip;
