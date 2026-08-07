import { memo } from "react";
import { clsx } from "clsx";
import type { Prediction } from "../../types";
import type { ChipColorMode } from "../../preferences";
import { getChipColors, chipBaseClasses } from "./chipColors";
import { ChipDial } from "./ChipDial";
import { formatCompactNumber, formatCloseCountdown } from "../../utils/format";

interface PredictionChipProps {
  prediction: Prediction;
  comfort?: boolean;
  colorMode?: ChipColorMode;
  onClick?: () => void;
}

/** Under 24h to close. Below that the chip switches to warning tone. */
function isClosingSoon(
  closeStr: string | null | undefined,
  now: number,
): boolean {
  if (!closeStr) return false;
  const t = new Date(closeStr).getTime();
  if (Number.isNaN(t)) return false;
  const diff = t - now;
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
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
    colorMode = "widget",
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
    const countdown = formatCloseCountdown(p.close_time, Date.now());
    // Under a day left is the state worth flagging: the market is about
    // to resolve and the probability stops being a forecast. Border
    // swaps to warning and the countdown gets promoted onto row 1.
    const closingSoon = isClosingSoon(p.close_time, Date.now());

    return (
      <button
        onClick={onClick}
        className={clsx(
          chipBaseClasses(comfort, c, "whitespace-nowrap"),
          closingSoon && "border-warning/40",
        )}
        title={leg ? `${label} — ${leg}` : label}
      >
        {/* Row 1: question, outcome leg, probability pill, delta.
            The pill mirrors the feed's ProbabilityPill classes (chips keep
            their own chipColors system, so the classes are inlined). */}
        <div
          className={clsx("flex items-center gap-2", comfort && "text-ui-body")}
        >
          <span
            className={clsx("font-semibold max-w-[18rem] truncate", c.text)}
          >
            {label}
          </span>
          {leg && (
            <span className={clsx("max-w-[8rem] truncate", c.textDim)}>
              {leg}
            </span>
          )}
          {/* Dial replaces the old percentage pill. A ring reads at a
              glance on a moving rail; the number stays beside it for
              anyone who wants the exact figure. */}
          <ChipDial
            value={yes / 100}
            size={comfort ? 26 : 18}
            strokeWidth={comfort ? 3 : 2.5}
            className={clsx(
              delta > 0 && "text-up",
              delta < 0 && "text-down",
              delta === 0 && "text-predictions",
            )}
            label={`${pct} implied probability`}
          />
          <span
            className={clsx(
              "font-mono font-bold tabular-nums text-ui-chip",
              delta > 0 && "text-up",
              delta < 0 && "text-down",
              delta === 0 && c.textDim,
            )}
          >
            {pct}
          </span>
          {delta !== 0 && (
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
          {closingSoon && !comfort && countdown && (
            <span className="font-mono font-bold uppercase tracking-wider text-ui-chip text-warning">
              {countdown} left
            </span>
          )}
        </div>

        {/* Row 2 (comfort only): category · volume · close countdown */}
        {comfort && (
          <div
            className={clsx(
              "flex items-center gap-1.5 text-ui-chip",
              c.textFaint,
            )}
          >
            {p.category && (
              <span className="uppercase tracking-wide">{p.category}</span>
            )}
            {(p.volume_24h ?? p.volume) != null && (
              <>
                {p.category && <span className="text-fg-3">&middot;</span>}
                <span>
                  Vol {formatCompactNumber(p.volume_24h ?? p.volume ?? 0)}
                </span>
              </>
            )}
            {countdown && (
              <>
                <span className="text-fg-3">&middot;</span>
                <span
                  className={clsx(closingSoon && "font-semibold text-warning")}
                >
                  {closingSoon ? `closes ${countdown}` : countdown}
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
    prev.onClick === next.onClick &&
    prev.prediction.id === next.prediction.id &&
    prev.prediction.yes_price === next.prediction.yes_price &&
    prev.prediction.prev_yes_price === next.prediction.prev_yes_price &&
    prev.prediction.volume === next.prediction.volume &&
    prev.prediction.title === next.prediction.title &&
    prev.prediction.event_title === next.prediction.event_title,
);

export default PredictionChip;
