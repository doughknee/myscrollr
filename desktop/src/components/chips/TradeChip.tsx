import { memo } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import {
  formatPrice,
  formatChange,
  formatPriceChange,
} from "../../utils/format";
import { Sparkline } from "./Sparkline";
import { pushPrice } from "./priceHistory";

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
    const isUp = trade.direction === "up";
    const changeStr = formatChange(trade.percentage_change);

    // Record this tick and draw what we've seen. Called during render on
    // purpose: the buffer is keyed by symbol+price and collapses repeats,
    // so re-renders with unchanged data are no-ops rather than duplicate
    // points. An effect would miss the first paint and leave the chip
    // flat for a poll cycle.
    const series = pushPrice(trade.symbol, trade.price);
    const flat = Math.abs(Number(trade.percentage_change) || 0) < 1;

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

    return (
      <button
        onClick={onClick}
        className={chipBaseClasses(comfort, c, "font-mono whitespace-nowrap")}
      >
        {/* Row 1: symbol, price, change */}
        <div
          className={clsx("flex items-center gap-2", comfort && "text-ui-body")}
        >
          <span className={clsx("font-semibold", c.text)}>{trade.symbol}</span>
          <Sparkline
            points={series}
            width={comfort ? 56 : 44}
            height={comfort ? 16 : 14}
            // Sub-1% moves go neutral. At this size an up-tinted line
            // and a down-tinted one look like meaningfully different
            // days when the market barely moved. Spark only — the delta
            // text keeps its real direction.
            className={flat ? "text-fg-3/35" : isUp ? "text-up" : "text-down"}
          />
          <span className={c.textDim}>{formatPrice(trade.price)}</span>
          {changeStr && (
            <span
              className={clsx(
                "font-medium text-ui-meta",
                isUp ? "text-up" : "text-down",
              )}
            >
              {marker}
              {changeStr}
            </span>
          )}
        </div>
        {/* Row 2: previous close + price change (comfort only) */}
        {comfort && (
          <div
            className={clsx(
              "flex items-center gap-1.5 text-ui-chip",
              c.textFaint,
            )}
          >
            {trade.previous_close != null && (
              <span>Prev {formatPrice(trade.previous_close)}</span>
            )}
            {trade.price_change != null && (
              <>
                <span className="text-fg-3">&middot;</span>
                <span className={isUp ? "text-up/70" : "text-down/70"}>
                  {formatPriceChange(trade.price_change)}
                </span>
              </>
            )}
          </div>
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
    prev.trade.price_change === next.trade.price_change,
);

export default TradeChip;
