/**
 * MarketDetail — a focused modal for a single prediction market.
 *
 * Shows the full question, implied probability + delta, bid/ask spread, a live
 * price-history sparkline (built from streamed ticks — see sparkline.ts),
 * volume / open interest / close countdown, and resolution state. Lets the user
 * star the market (watchlist) and set local price alerts ("tell me if this
 * crosses 50%"), and deep-links out to Kalshi to act. Display-only — no order
 * entry.
 */
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { useQuery, queryOptions } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import {
  X,
  Star,
  ExternalLink,
  Bell,
  BellPlus,
  Trash2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import {
  formatCompactNumber,
  formatCloseCountdown,
  relativeTime,
} from "../../utils/format";
import { authFetch } from "../../api/client";
import type {
  PredictionCandle,
  PredictionCandlesticksResponse,
} from "../../api/queries";
import {
  formatProbability,
  formatSpread,
  priceDelta,
  isResolved,
} from "./view";
import { getHistory, sparklinePoints, trend } from "./sparkline";
import { describeAlert, type AlertComparator, type PredictionAlert } from "./watchlist";
import { outcomeLabel } from "./search";
import ProbabilityPill from "./ProbabilityPill";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import type { Prediction } from "../../types";

interface MarketDetailProps {
  market: Prediction;
  /** Every live leg of this market's event, price-sorted (B2). The modal
   *  lists them all when there's more than one; tapping switches markets. */
  siblings?: Prediction[];
  onSelectMarket?: (market: Prediction) => void;
  now: number;
  watched: boolean;
  onToggleWatch: () => void;
  alerts: PredictionAlert[];
  onAddAlert: (input: {
    ticker: string;
    label: string;
    comparator: AlertComparator;
    threshold: number;
  }) => void;
  onRemoveAlert: (id: string) => void;
  onClose: () => void;
}

const SPARK_W = 280;
const SPARK_H = 56;

/**
 * DataWidgetRow-owned candlesticks query. The route is `Auth: true`, so this MUST
 * go through `authFetch` — the old shared query helper (since deleted) used
 * the unauthenticated `request()` and has 401'd on every call since the
 * #220 auth fix closed the fail-open gateway hole (see ui-review/NOTES.md,
 * A1). Same query key + staleTime as before (mirrors the server's 5-min
 * Redis TTL).
 */
function candlesticksOptions(ticker: string) {
  return queryOptions({
    queryKey: ["predictions-candlesticks", ticker],
    queryFn: () =>
      authFetch<PredictionCandlesticksResponse>(
        `/predictions/candlesticks/${encodeURIComponent(ticker)}`,
      ),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    enabled: ticker.length > 0,
  });
}

export default function MarketDetail({
  market,
  siblings = [],
  onSelectMarket,
  now,
  watched,
  onToggleWatch,
  alerts,
  onAddAlert,
  onRemoveAlert,
  onClose,
}: MarketDetailProps) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const delta = priceDelta(market);
  const resolved = isResolved(market);
  const history = getHistory(market.ticker);
  const dir = trend(history);

  const points = useMemo(
    () => sparklinePoints(history, { width: SPARK_W, height: SPARK_H, pad: 4, min: 0, max: 100 }),
    [history],
  );

  // Real price history (v1.1.4): ~7 days of hourly candles via the
  // Kalshi proxy. The live tick-accumulator sparkline stays as the
  // fallback when the fetch fails or a market has no trade history.
  const {
    data: candleData,
    isLoading: candlesLoading,
    isError: candlesError,
  } = useQuery(candlesticksOptions(market.ticker));
  const candlePts = useMemo(() => {
    const rows: PredictionCandle[] = candleData?.candlesticks ?? [];
    const pts: { t: number; v: number }[] = [];
    for (const c of rows) {
      const raw = c.price?.close_dollars ?? c.price?.mean_dollars;
      if (!raw) continue;
      const v = parseFloat(raw) * 100;
      if (!Number.isFinite(v)) continue;
      pts.push({ t: c.end_period_ts, v });
    }
    return pts;
  }, [candleData]);

  const myAlerts = alerts.filter((a) => a.ticker === market.ticker);
  const countdown = formatCloseCountdown(market.close_time, now);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={market.title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge/60 bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-2 border-b border-edge/30 px-4 py-3">
          <div className="min-w-0 flex-1">
            {market.category && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-predictions">
                {market.category}
              </span>
            )}
            {/* v1.1.4: the EVENT question headlines; this leg is the
                subtitle ("More tech layoffs in 2026?" / Outcome: Yes). */}
            <h2 className="text-[15px] font-semibold leading-snug text-fg">
              {market.event_title || market.title}
            </h2>
            {market.event_title ? (
              <p className="mt-0.5 text-[12px] text-fg-3">
                Outcome: {market.title || market.subtitle || "Yes"}
              </p>
            ) : (
              market.subtitle && (
                <p className="mt-0.5 text-[12px] text-fg-3">{market.subtitle}</p>
              )
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-3  hover:bg-surface-hover hover:text-fg cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Probability + sparkline */}
          <div className="flex items-center justify-between gap-4 px-4 pt-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold tabular-nums text-fg">
                {formatProbability(market.yes_price)}
              </span>
              {delta !== 0 && (
                <span
                  className={clsx(
                    "flex items-center gap-0.5 font-mono text-[13px] font-semibold tabular-nums",
                    delta > 0 ? "text-up" : "text-down",
                  )}
                >
                  {delta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {Math.abs(delta)}
                </span>
              )}
            </div>
          </div>

          {/* Price history: real 7-day candles (v1.1.4), falling back to
              the live tick-accumulator sparkline while loading fails or a
              market has no trade history yet. */}
          <div className="px-4 pt-2">
            {candlePts.length >= 2 ? (
              <HistoryChart points={candlePts} />
            ) : candlesLoading ? (
              <div className="h-[88px]  rounded-lg bg-base-100/40" />
            ) : history.length >= 2 ? (
              <svg
                viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                width="100%"
                height={SPARK_H}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Recent price trend: ${dir}`}
                className="overflow-visible"
              >
                <polyline
                  points={points}
                  fill="none"
                  stroke={dir === "up" ? "var(--color-up)" : dir === "down" ? "var(--color-down)" : "var(--color-fg-3)"}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            ) : candlesError ? (
              // Fetch failed (offline, signed out, upstream hiccup) — say
              // so instead of implying the market has no history.
              <div className="flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-edge/50 bg-base-100/40">
                <span className="text-[11px] font-medium text-fg-3">
                  Price history unavailable right now
                </span>
                <span className="text-[10px] text-fg-4">
                  Live price still updates below
                </span>
              </div>
            ) : (
              // Fetch succeeded but the market has <2 traded hours — a
              // genuinely fresh market. History accumulates from here.
              <div className="flex h-[56px] flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-edge/50 bg-base-100/40">
                <span className="text-[11px] font-medium text-fg-3">
                  No trade history yet
                </span>
                <span className="text-[10px] text-fg-4">
                  Tracking live — the chart builds as this market trades
                </span>
              </div>
            )}
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-4 text-[12px]">
            <Stat label="Spread (bid–ask)" value={formatSpread(market.yes_bid, market.yes_ask) || "—"} />
            <Stat
              label="Volume"
              value={market.volume != null ? formatCompactNumber(market.volume) : "—"}
            />
            <Stat
              label="Open interest"
              value={market.open_interest != null ? formatCompactNumber(market.open_interest) : "—"}
            />
            <Stat
              label={resolved ? "Resolved" : "Closes"}
              value={
                resolved
                  ? (market.result ? market.result.toUpperCase() : "Settled")
                  : countdown
                    ? countdown === "Closed"
                      ? "Closed"
                      : `in ${countdown}`
                    : "—"
              }
              tone={resolved && market.result ? (market.result.toLowerCase() === "yes" ? "up" : "down") : "flat"}
            />
          </div>

          {/* All outcomes (B2): every live leg of the event, highest price
              first, current one pinned visually. Tapping switches the modal
              to that leg — how ">2 outcome" events reveal their full list. */}
          {siblings.length >= 2 && onSelectMarket && (
            <div className="border-t border-edge/30 px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                All outcomes
                <span className="ml-1.5 font-mono text-[10px] font-normal text-fg-4">
                  {siblings.length}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {siblings.map((s) => {
                  const current = s.id === market.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-current={current || undefined}
                        onClick={() => {
                          if (!current) onSelectMarket(s);
                        }}
                        className={clsx(
                          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ",
                          current
                            ? "cursor-default border-accent/40 bg-accent/8"
                            : "cursor-pointer border-edge/30 bg-base-100/40 hover:border-edge/60 hover:bg-surface-hover",
                        )}
                      >
                        <span
                          className={clsx(
                            "min-w-0 flex-1 truncate",
                            current ? "font-medium text-fg" : "text-fg-2",
                          )}
                        >
                          {outcomeLabel(s)}
                        </span>
                        <ProbabilityPill pct={s.yes_price} delta={priceDelta(s)} size="sm" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Alerts */}
          <div className="border-t border-edge/30 px-4 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <Bell size={12} />
              Price alerts
            </div>
            {myAlerts.length > 0 && (
              <ul className="mb-2 flex flex-col gap-1">
                {myAlerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-lg bg-base-100/50 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="flex-1 text-fg-2">{describeAlert(a)}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveAlert(a.id)}
                      aria-label="Remove alert"
                      className="text-fg-4  hover:text-error cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AlertForm
              onAdd={(comparator, threshold) =>
                onAddAlert({
                  ticker: market.ticker,
                  label: market.title,
                  comparator,
                  threshold,
                })
              }
            />
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 border-t border-edge/30 px-4 py-3">
          <button
            type="button"
            onClick={onToggleWatch}
            aria-pressed={watched}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium  cursor-pointer",
              watched
                ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
                : "border-edge/50 text-fg-3 hover:text-fg-2",
            )}
          >
            <Star size={13} className={watched ? "fill-current" : ""} />
            {watched ? "Watching" : "Watch"}
          </button>
          {market.link && (
            <button
              type="button"
              onClick={() => open(market.link!).catch(() => {})}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-predictions px-3 py-1.5 text-[12px] font-semibold text-white  hover:-translate-y-px cursor-pointer"
            >
              <ExternalLink size={13} />
              View on Kalshi
            </button>
          )}
        </div>

        {/* Last-updated footnote */}
        {market.updated_at && (
          <div className="border-t border-edge/20 px-4 py-1.5 text-center font-mono text-[10px] text-fg-4">
            Updated {relativeTime(market.updated_at, now, { suffix: true })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

const CHART_W = 280;
const CHART_H = 88;
const CHART_PAD = 4;

/**
 * The real price-history chart (v1.1.4): an auto-scaled area line over
 * ~7 days of hourly closes, colored by the window's overall direction,
 * with the range labeled so a flat-looking line can't mislead.
 */
function HistoryChart({ points }: { points: { t: number; v: number }[] }) {
  const { linePts, areaPts, min, max, up } = useMemo(() => {
    const vs = points.map((p) => p.v);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    // Flat markets get breathing room so the line doesn't hug an edge.
    if (hi - lo < 4) {
      const mid = (hi + lo) / 2;
      lo = mid - 2;
      hi = mid + 2;
    }
    lo = Math.max(0, lo - 1);
    hi = Math.min(100, hi + 1);
    const span = hi - lo || 1;
    const innerW = CHART_W - CHART_PAD * 2;
    const innerH = CHART_H - CHART_PAD * 2;
    const step = innerW / (points.length - 1);
    const xy = points.map(
      (p, i) =>
        `${(CHART_PAD + i * step).toFixed(1)},${(
          CHART_PAD + (1 - (p.v - lo) / span) * innerH
        ).toFixed(1)}`,
    );
    const baseline = CHART_H - CHART_PAD;
    return {
      linePts: xy.join(" "),
      areaPts: `${CHART_PAD},${baseline} ${xy.join(" ")} ${CHART_W - CHART_PAD},${baseline}`,
      min: lo,
      max: hi,
      up: points[points.length - 1].v >= points[0].v,
    };
  }, [points]);

  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`7-day price history, ${up ? "up" : "down"} overall`}
      >
        <polygon points={areaPts} fill={stroke} opacity="0.08" />
        <polyline
          points={linePts}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute right-0 top-0 font-mono text-[9px] tabular-nums text-fg-4">
        {Math.round(max)}%
      </span>
      <span className="absolute bottom-4 right-0 font-mono text-[9px] tabular-nums text-fg-4">
        {Math.round(min)}%
      </span>
      <span className="mt-0.5 block text-right font-mono text-[9px] uppercase tracking-wide text-fg-4">
        7d · hourly
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wide text-fg-4">{label}</span>
      <span
        className={clsx(
          "font-mono text-[13px] font-semibold tabular-nums",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "flat" && "text-fg",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function AlertForm({ onAdd }: { onAdd: (comparator: AlertComparator, threshold: number) => void }) {
  const [comparator, setComparator] = useState<AlertComparator>("above");
  const [threshold, setThreshold] = useState("50");

  const submit = () => {
    const n = Math.round(Number(threshold));
    if (!Number.isFinite(n) || n < 0 || n > 100) return;
    onAdd(comparator, n);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-fg-3">Alert me when</span>
      <SelectMenu
        value={comparator}
        options={[
          { value: "above", label: "above" },
          { value: "below", label: "below" },
        ]}
        onChange={setComparator}
        ariaLabel="Alert direction"
        align="left"
      />
      <div className="flex items-center rounded-md border border-edge/50 bg-base-100 px-1.5 focus-within:border-accent/60">
        <input
          type="number"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          aria-label="Alert threshold percent"
          className="w-10 bg-transparent py-1 text-right font-mono text-[12px] text-fg outline-none"
        />
        <span className="text-[12px] text-fg-3">%</span>
      </div>
      <button
        type="button"
        onClick={submit}
        className="ml-auto inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[12px] font-medium text-accent  hover:bg-accent/25 cursor-pointer"
      >
        <BellPlus size={13} />
        Add
      </button>
    </div>
  );
}
