import { memo } from "react";
import { clsx } from "clsx";
import type { Trade } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { formatPrice, formatChange, formatPriceChange } from "../../utils/format";

export type TickerDirectionMarker = "arrow" | "sign" | "none";

interface TradeChipProps {
  trade: Trade;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /** Hide percentage change indicator (default: shown) */
  showChange?: boolean;
  /** How to render the up/down marker. Defaults to "arrow" (▲▼). */
  directionMarker?: TickerDirectionMarker;
  onClick?: () => void;
}

const TradeChip = memo(function TradeChip({
  trade,
  comfort,
  colorMode = "channel",
  showChange = true,
  directionMarker = "arrow",
  onClick,
}: TradeChipProps) {
  const c = getChipColors(colorMode, "finance");
  const isUp = trade.direction === "up";
  const changeStr = showChange ? formatChange(trade.percentage_change) : null;

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
      <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
        <span className={clsx("font-semibold", c.text)}>{trade.symbol}</span>
        <span className={c.textDim}>{formatPrice(trade.price)}</span>
        {changeStr && (
          <span
            className={clsx(
              "font-medium text-ui-meta",
              isUp ? "text-up" : "text-down"
            )}
          >
            {marker}
            {changeStr}
          </span>
        )}
      </div>
      {/* Row 2: previous close + price change (comfort only) */}
      {comfort && (
        <div className={clsx("flex items-center gap-1.5 text-ui-chip", c.textFaint)}>
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
}, (prev, next) =>
  prev.comfort === next.comfort &&
  prev.colorMode === next.colorMode &&
  prev.showChange === next.showChange &&
  prev.directionMarker === next.directionMarker &&
  prev.onClick === next.onClick &&
  prev.trade.symbol === next.trade.symbol &&
  prev.trade.price === next.trade.price &&
  prev.trade.percentage_change === next.trade.percentage_change &&
  prev.trade.direction === next.trade.direction &&
  prev.trade.previous_close === next.trade.previous_close &&
  prev.trade.price_change === next.trade.price_change
);

export default TradeChip;
