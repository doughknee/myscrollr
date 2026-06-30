import { memo } from "react";
import { clsx } from "clsx";
import type { Prediction } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { formatCompactNumber, formatCloseCountdown } from "../../utils/format";

interface PredictionChipProps {
  prediction: Prediction;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  /** Show the ▲/▼ implied-probability delta (default: shown). */
  showDelta?: boolean;
  /** Show the category badge in comfort mode (default: shown). */
  showCategory?: boolean;
  /** Show abbreviated volume in comfort mode (default: shown). */
  showVolume?: boolean;
  /** Show the close-time countdown in comfort mode (default: shown). */
  showCloseTime?: boolean;
  onClick?: () => void;
}

/**
 * Ticker chip for a Kalshi prediction market. Leads with the implied
 * probability (yes_price is stored as integer cents 0–100 == implied %),
 * a ▲/▼ delta vs the previous price (the "heartbeat" of the market), and —
 * in comfort mode — a category badge, abbreviated volume, and a live close
 * countdown. Mirrors the TradeChip structure so it composes with the rest of
 * the ticker.
 */
const PredictionChip = memo(
  function PredictionChip({
    prediction: p,
    comfort,
    colorMode = "channel",
    showDelta = true,
    showCategory = true,
    showVolume = true,
    showCloseTime = true,
    onClick,
  }: PredictionChipProps) {
    const c = getChipColors(colorMode, "predictions");

    const yes = p.yes_price ?? 0;
    const prev = p.prev_yes_price ?? yes;
    const delta = yes - prev;
    const isUp = delta >= 0;
    const pct = `${Math.round(yes)}%`;
    const label = p.title || p.ticker;
    const countdown = showCloseTime
      ? formatCloseCountdown(p.close_time, Date.now())
      : "";

    return (
      <button
        onClick={onClick}
        className={chipBaseClasses(comfort, c, "whitespace-nowrap")}
        title={p.subtitle ? `${label} — ${p.subtitle}` : label}
      >
        {/* Row 1: question, implied probability, delta */}
        <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
          <span className={clsx("font-semibold max-w-[18rem] truncate", c.text)}>
            {label}
          </span>
          <span className={clsx("font-mono tabular-nums", c.textDim)}>{pct}</span>
          {showDelta && delta !== 0 && (
            <span
              className={clsx(
                "font-mono font-medium text-ui-meta",
                isUp ? "text-up" : "text-down",
              )}
            >
              {isUp ? "▲" : "▼"}
              {Math.abs(delta)}
            </span>
          )}
        </div>

        {/* Row 2 (comfort only): category · volume · close countdown */}
        {comfort && (
          <div className={clsx("flex items-center gap-1.5 text-ui-chip", c.textFaint)}>
            {showCategory && p.category && (
              <span className="uppercase tracking-wide">{p.category}</span>
            )}
            {showVolume && p.volume != null && (
              <>
                {showCategory && p.category && <span className="text-fg-3">&middot;</span>}
                <span>Vol {formatCompactNumber(p.volume)}</span>
              </>
            )}
            {showCloseTime && countdown && (
              <>
                <span className="text-fg-3">&middot;</span>
                <span>{countdown}</span>
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
    prev.showDelta === next.showDelta &&
    prev.showCategory === next.showCategory &&
    prev.showVolume === next.showVolume &&
    prev.showCloseTime === next.showCloseTime &&
    prev.onClick === next.onClick &&
    prev.prediction.id === next.prediction.id &&
    prev.prediction.yes_price === next.prediction.yes_price &&
    prev.prediction.prev_yes_price === next.prediction.prev_yes_price &&
    prev.prediction.volume === next.prediction.volume &&
    prev.prediction.title === next.prediction.title,
);

export default PredictionChip;
