/**
 * Predictions display preferences — the "/channel/predictions/display" page.
 *
 * Layout mirrors the Finance DisplayPanel:
 *   1. Live preview   — Feed card + Ticker chip side by side, both update
 *                       in real time as toggles change.
 *   2. Display items  — one row per metric with two surface chips
 *                       (Feed / Ticker). Click a chip to toggle that
 *                       surface only. Section header has bulk All / None.
 *   3. Layout & order — feed density + default sort.
 *   4. Footer reset   — restore defaults.
 *
 * Persisted shape: `off | feed | ticker | both` enum converted at the
 * UI boundary via enumToBools / boolsToEnum.
 */
import { useMemo } from "react";
import { Eye, Tv, Check, Clock, BarChart3 } from "lucide-react";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { useShell } from "../../shell-context";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "../../api/queries";
import {
  boolsToEnum,
  enumToBools,
  type Venue,
  type PredictionsDisplayPrefs,
} from "../../preferences";
import {
  Section,
  SegmentedRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
import { formatCompactNumber, formatCloseCountdown } from "../../utils/format";
import { priceDelta } from "./view";
import type { Prediction } from "../../types";
import { useNow } from "../../hooks/useNow";

// ── Constants ────────────────────────────────────────────────────

const DEFAULTS: PredictionsDisplayPrefs = {
  showDelta: "both",
  showCategory: "both",
  showVolume: "both",
  showCloseTime: "both",
  defaultSort: "volume",
  feedDensity: "comfort",
};

const SORT_OPTIONS = [
  { value: "movers", label: "Movers" },
  { value: "volume", label: "Volume" },
  { value: "closing", label: "Closing" },
  { value: "alpha", label: "A–Z" },
];

const DENSITY_OPTIONS = [
  { value: "comfort", label: "Comfort" },
  { value: "compact", label: "Compact" },
];

// Metric definitions drive the unified Display items section. Each row
// binds one prefs field to its label, description, and surface chips.
type MetricKey = "showDelta" | "showCategory" | "showVolume" | "showCloseTime";

interface MetricDef {
  key: MetricKey;
  label: string;
  description: string;
}

const METRICS: MetricDef[] = [
  {
    key: "showDelta",
    label: "Odds delta",
    description: "▲/▼ change in implied probability since the last tick",
  },
  {
    key: "showCategory",
    label: "Category badge",
    description: "Politics / Sports / Economics / … bucket",
  },
  {
    key: "showVolume",
    label: "Volume",
    description: "Abbreviated contract volume (e.g. 12.4K)",
  },
  {
    key: "showCloseTime",
    label: "Close countdown",
    description: "Time remaining until the market closes",
  },
];

// Sample market used for the preview when no real market is tracked.
function buildSampleMarket(): Prediction {
  return {
    id: "kalshi:SAMPLE",
    source: "kalshi",
    ticker: "SAMPLE",
    title: "Will the sample event resolve Yes?",
    category: "Politics",
    yes_price: 62,
    prev_yes_price: 58,
    volume: 12_400,
    close_time: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 12_000).toISOString(),
    link: "",
  };
}

// ── Component ────────────────────────────────────────────────────

export default function PredictionsDisplayPanel() {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.channelDisplay.predictions;

  // Pull the user's first real tracked market so the preview shows
  // something they recognise. Falls back to the sample.
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const previewMarket: Prediction = useMemo(() => {
    const markets = (dashboard?.data?.predictions as Prediction[] | undefined) ?? [];
    if (markets.length > 0) return markets[0];
    return buildSampleMarket();
  }, [dashboard?.data?.predictions]);

  // ── Patch helpers ──────────────────────────────────────────────

  function patch(next: Partial<PredictionsDisplayPrefs>) {
    onPrefsChange({
      ...prefs,
      channelDisplay: {
        ...prefs.channelDisplay,
        predictions: { ...dp, ...next },
      },
    });
  }

  function setVenue(key: MetricKey, surface: "feed" | "ticker", on: boolean) {
    const bools = enumToBools(dp[key]);
    const next: Venue = boolsToEnum(
      surface === "feed" ? on : bools.feed,
      surface === "ticker" ? on : bools.ticker,
    );
    patch({ [key]: next } as Partial<PredictionsDisplayPrefs>);
  }

  function bulkSurface(surface: "feed" | "ticker", on: boolean) {
    const next: Partial<PredictionsDisplayPrefs> = {};
    for (const m of METRICS) {
      const bools = enumToBools(dp[m.key]);
      next[m.key] = boolsToEnum(
        surface === "feed" ? on : bools.feed,
        surface === "ticker" ? on : bools.ticker,
      );
    }
    patch(next);
  }

  function handleReset() {
    patch(DEFAULTS);
  }

  // ── Booleans the preview reads from ───────────────────────────

  const feedShowDelta = enumToBools(dp.showDelta).feed;
  const feedShowCategory = enumToBools(dp.showCategory).feed;
  const feedShowVolume = enumToBools(dp.showVolume).feed;
  const feedShowCloseTime = enumToBools(dp.showCloseTime).feed;
  const tickerShowDelta = enumToBools(dp.showDelta).ticker;
  const tickerShowCategory = enumToBools(dp.showCategory).ticker;
  const tickerShowVolume = enumToBools(dp.showVolume).ticker;
  const tickerShowCloseTime = enumToBools(dp.showCloseTime).ticker;

  const allFeedOn = METRICS.every((m) => enumToBools(dp[m.key]).feed);
  const allTickerOn = METRICS.every((m) => enumToBools(dp[m.key]).ticker);

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-8">
      {/* ── Live preview ─────────────────────────────────────────── */}
      <Section title="Live preview">
        <div className="px-3 pb-1 space-y-3">
          <p className="text-[11px] text-fg-4 leading-snug">
            Toggle items below to see the Feed and Ticker update in real time.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <PreviewSurface label="Feed" icon={Eye}>
              <FeedPreview
                market={previewMarket}
                density={dp.feedDensity}
                showDelta={feedShowDelta}
                showCategory={feedShowCategory}
                showVolume={feedShowVolume}
                showCloseTime={feedShowCloseTime}
              />
            </PreviewSurface>
            <PreviewSurface label="Ticker" icon={Tv}>
              <TickerPreview
                market={previewMarket}
                showDelta={tickerShowDelta}
                showCategory={tickerShowCategory}
                showVolume={tickerShowVolume}
                showCloseTime={tickerShowCloseTime}
              />
            </PreviewSurface>
          </div>
        </div>
      </Section>

      {/* ── Display items (column grid) ──────────────────────────── */}
      <div className="mb-6 pb-5 border-b border-edge/30 last:border-b-0 last:mb-0 last:pb-0">
        <div className="mx-3 rounded-lg border border-edge/40 overflow-hidden">
          <div role="grid" aria-label="Where each metric appears" className="select-none">
            {/* Header bar — section title + bulk-toggle column heads. */}
            <div
              role="row"
              className="grid items-center gap-x-2 px-3 py-1.5 bg-base-250/30 border-b border-edge/40 grid-cols-[1fr_56px_56px]"
            >
              <h3
                role="columnheader"
                className="text-[11px] font-mono font-semibold uppercase tracking-wider text-fg-4"
              >
                Display items
              </h3>
              <ColumnHeaderToggle
                icon={Eye}
                label="Feed"
                active={allFeedOn}
                onClick={() => bulkSurface("feed", !allFeedOn)}
              />
              <ColumnHeaderToggle
                icon={Tv}
                label="Ticker"
                active={allTickerOn}
                onClick={() => bulkSurface("ticker", !allTickerOn)}
              />
            </div>

            {/* Metric rows. */}
            {METRICS.map((metric, idx) => {
              const bools = enumToBools(dp[metric.key]);
              const isLast = idx === METRICS.length - 1;
              return (
                <div
                  key={metric.key}
                  role="row"
                  className={clsx(
                    "grid items-center gap-x-2 px-3 py-2.5 hover:bg-base-250/20 transition-colors",
                    !isLast && "border-b border-edge/30",
                    "grid-cols-[1fr_56px_56px]",
                  )}
                >
                  <div role="rowheader" className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[12px] text-fg-2 leading-tight">
                      {metric.label}
                    </span>
                    <span className="text-[11px] text-fg-4 leading-tight">
                      {metric.description}
                    </span>
                  </div>
                  <CellToggle
                    active={bools.feed}
                    onClick={() => setVenue(metric.key, "feed", !bools.feed)}
                    ariaLabel={`${bools.feed ? "Hide" : "Show"} ${metric.label} on Feed`}
                  />
                  <CellToggle
                    active={bools.ticker}
                    onClick={() => setVenue(metric.key, "ticker", !bools.ticker)}
                    ariaLabel={`${bools.ticker ? "Hide" : "Show"} ${metric.label} on Ticker`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Layout & order ───────────────────────────────────────── */}
      <Section title="Layout & order">
        <SegmentedRow
          label="Feed density"
          description="Comfort shows a card grid; Compact stacks dense ticker rows"
          value={dp.feedDensity}
          options={DENSITY_OPTIONS}
          onChange={(v) =>
            patch({ feedDensity: v as PredictionsDisplayPrefs["feedDensity"] })
          }
        />
        <SegmentedRow
          label="Default sort"
          description="How markets are ordered on the Feed and the Ticker"
          value={dp.defaultSort}
          options={SORT_OPTIONS}
          onChange={(v) =>
            patch({ defaultSort: v as PredictionsDisplayPrefs["defaultSort"] })
          }
        />
      </Section>

      {/* ── Footer reset ─────────────────────────────────────────── */}
      <div className="flex items-center justify-end pt-2">
        <ResetButton label="Reset display settings" onClick={handleReset} />
      </div>
    </div>
  );
}

// ── Column header (also a bulk toggle) ──────────────────────────

interface ColumnHeaderToggleProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}

function ColumnHeaderToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: ColumnHeaderToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${active ? "Hide all from" : "Show all on"} ${label}`}
      onClick={onClick}
      className={clsx(
        "flex flex-col items-center justify-center gap-0.5 py-1 rounded-md",
        "transition-all duration-150 active:scale-[0.93]",
        active
          ? "text-accent hover:bg-accent/5"
          : "text-fg-4 hover:text-fg-2 hover:bg-base-250/40",
      )}
    >
      <Icon size={12} />
      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider leading-none">
        {label}
      </span>
    </button>
  );
}

// ── Cell toggle (per-row indicator in the Feed / Ticker columns) ──

interface CellToggleProps {
  active: boolean;
  ariaLabel: string;
  onClick: () => void;
}

function CellToggle({ active, ariaLabel, onClick }: CellToggleProps) {
  return (
    <div role="gridcell" className="flex items-center justify-center">
      <button
        type="button"
        role="checkbox"
        aria-checked={active}
        aria-label={ariaLabel}
        onClick={onClick}
        className={clsx(
          "w-[22px] h-[22px] rounded-md flex items-center justify-center",
          "transition-all duration-150 active:scale-90",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          active
            ? "bg-accent text-surface hover:bg-accent/90"
            : "bg-base-300 hover:bg-base-350 border border-edge/40 text-transparent",
        )}
      >
        <motion.span
          key={active ? "on" : "off"}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="flex items-center justify-center"
        >
          <Check size={12} strokeWidth={3} />
        </motion.span>
      </button>
    </div>
  );
}

// ── Preview surface card ────────────────────────────────────────

interface PreviewSurfaceProps {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}

function PreviewSurface({ label, icon: Icon, children }: PreviewSurfaceProps) {
  return (
    <div className="rounded-lg border border-edge/40 bg-base-200/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-edge/40 bg-surface-2/30">
        <Icon size={11} className="text-fg-4" />
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-4">
          {label}
        </span>
      </div>
      <div className="p-2.5 min-h-[72px] flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

// ── Feed preview — mini comfort/compact row ─────────────────────

interface FeedPreviewProps {
  market: Prediction;
  density: PredictionsDisplayPrefs["feedDensity"];
  showDelta: boolean;
  showCategory: boolean;
  showVolume: boolean;
  showCloseTime: boolean;
}

function FeedPreview({
  market,
  density,
  showDelta,
  showCategory,
  showVolume,
  showCloseTime,
}: FeedPreviewProps) {
  const now = useNow();
  const delta = priceDelta(market);
  const isUp = delta > 0;
  const isDown = delta < 0;
  const dirColor = isUp ? "text-up" : isDown ? "text-down" : "text-fg-3";
  const deltaLabel = isUp ? `▲ ${delta}` : isDown ? `▼ ${Math.abs(delta)}` : "—";
  const probability = `${Math.round(market.yes_price)}%`;
  const countdown = formatCloseCountdown(market.close_time, now);
  const isCompact = density === "compact";

  if (isCompact) {
    return (
      <motion.div
        key={`compact-${showDelta}-${showCategory}-${showVolume}-${showCloseTime}`}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-surface rounded-md font-mono"
      >
        <span className="font-semibold text-[12px] text-fg tabular-nums min-w-[34px]">
          {probability}
        </span>
        {showDelta && (
          <span className={clsx("text-[11px] tabular-nums", dirColor)}>
            {deltaLabel}
          </span>
        )}
        <span className="text-[11px] text-fg-2 truncate flex-1 font-sans">
          {market.title}
        </span>
        {showCloseTime && countdown && (
          <span className="text-[9px] text-fg-4 tabular-nums">{countdown}</span>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={`comfort-${showDelta}-${showCategory}-${showVolume}-${showCloseTime}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className={clsx(
        "w-full flex flex-col gap-1.5 px-3 py-2 bg-surface rounded-md border-l-2",
        isUp && "border-l-up/40",
        isDown && "border-l-down/40",
        !isUp && !isDown && "border-l-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[16px] font-mono font-bold text-fg tabular-nums leading-none">
            {probability}
          </span>
          {showDelta && (
            <span className={clsx("text-[10px] font-mono font-semibold tabular-nums", dirColor)}>
              {deltaLabel}
            </span>
          )}
        </div>
        {showCategory && market.category && (
          <span className="bg-[#6366f1]/12 text-[#6366f1] text-[9px] font-medium rounded px-1 py-px">
            {market.category}
          </span>
        )}
      </div>
      <span className="text-[10px] text-fg-3 leading-snug line-clamp-1">
        {market.title}
      </span>
      {(showVolume || showCloseTime) && (
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-fg-4 tabular-nums">
          {showVolume && market.volume != null && (
            <span>Vol {formatCompactNumber(market.volume)}</span>
          )}
          {showVolume && showCloseTime && countdown && (
            <span aria-hidden className="text-fg-4/50">·</span>
          )}
          {showCloseTime && countdown && <span>{countdown}</span>}
        </div>
      )}
    </motion.div>
  );
}

// ── Ticker preview — mini chip ──────────────────────────────────

interface TickerPreviewProps {
  market: Prediction;
  showDelta: boolean;
  showCategory: boolean;
  showVolume: boolean;
  showCloseTime: boolean;
}

function TickerPreview({
  market,
  showDelta,
  showCategory,
  showVolume,
  showCloseTime,
}: TickerPreviewProps) {
  const now = useNow();
  const delta = priceDelta(market);
  const isUp = delta > 0;
  const isDown = delta < 0;
  const dirColor = isUp ? "text-up" : isDown ? "text-down" : "text-fg-3";
  const deltaLabel = isUp ? `▲${delta}` : isDown ? `▼${Math.abs(delta)}` : "—";
  const probability = `${Math.round(market.yes_price)}%`;
  const countdown = formatCloseCountdown(market.close_time, now);

  return (
    <motion.div
      key={`${showDelta}-${showCategory}-${showVolume}-${showCloseTime}`}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
      className="inline-flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-md bg-surface-2 border border-edge/30 font-mono whitespace-nowrap"
    >
      <div className="flex items-center gap-1.5 text-[12px]">
        {showCategory && market.category && (
          <span className="text-[9px] text-fg-4 uppercase tracking-wide">
            {market.category}
          </span>
        )}
        <span className="font-semibold text-fg tabular-nums">{probability}</span>
        {showDelta && (
          <span className={clsx("text-[10px] font-medium tabular-nums", dirColor)}>
            {deltaLabel}
          </span>
        )}
      </div>
      {(showVolume || showCloseTime) && (
        <div className="flex items-center gap-1.5 text-[9px] text-fg-4 tabular-nums">
          {showVolume && market.volume != null && (
            <span className="flex items-center gap-0.5">
              <BarChart3 size={8} />
              {formatCompactNumber(market.volume)}
            </span>
          )}
          {showVolume && showCloseTime && countdown && (
            <span aria-hidden className="text-fg-4/50">·</span>
          )}
          {showCloseTime && countdown && (
            <span className="flex items-center gap-0.5">
              <Clock size={8} />
              {countdown}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}
