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
    // v1.1.4: lead with the event's QUESTION, not the leg. The leg stays
    // visible when it names an outcome ("France", "Atlanta") because the
    // probability belongs to the leg — but a bare "Yes" adds nothing next
    // to "More tech layoffs in 2026? 92%".
    const label = p.event_title || p.title || p.ticker;
    const leg =
      p.event_title && p.title && p.title.toLowerCase() !== "yes"
        ? p.title
        : "";
    const countdown = showCloseTime
      ? formatCloseCountdown(p.close_time, Date.now())
      : "";

    return (
      <button
        onClick={onClick}
        className={chipBaseClasses(comfort, c, "whitespace-nowrap")}
        title={leg ? `${label} — ${leg}` : label}
      >
        {/* Row 1: question, outcome leg, probability pill, delta.
            The pill mirrors the feed's ProbabilityPill classes (chips keep
            their own chipColors system, so the classes are inlined). */}
        <div className={clsx("flex items-center gap-2", comfort && "text-ui-body")}>
          <span className={clsx("font-semibold max-w-[18rem] truncate", c.text)}>
            {label}
          </span>
          {leg && (
            <span className={clsx("max-w-[8rem] truncate", c.textDim)}>
              {leg}
            </span>
          )}
          <span
            className={clsx(
              "inline-flex items-center rounded-full border px-1.5 font-mono font-bold tabular-nums text-ui-chip",
              showDelta && delta > 0 && "border-up/40 text-up",
              showDelta && delta < 0 && "border-down/40 text-down",
              (!showDelta || delta === 0) && clsx("border-edge", c.textDim),
            )}
          >
            {pct}
          </span>
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
            {showVolume && (p.volume_24h ?? p.volume) != null && (
              <>
                {showCategory && p.category && <span className="text-fg-3">&middot;</span>}
                <span>Vol {formatCompactNumber(p.volume_24h ?? p.volume ?? 0)}</span>
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
    prev.prediction.title === next.prediction.title &&
    prev.prediction.event_title === next.prediction.event_title,
);

export default PredictionChip;
