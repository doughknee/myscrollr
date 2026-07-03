/**
 * Predictions FeedTab — desktop-native, flagship channel.
 *
 * Renders a grid of Kalshi prediction-market cards with real-time
 * implied-probability updates via the desktop CDC/SSE pipeline. Each
 * market surfaces its implied probability (yes_price as "NN%") with a
 * ▲/▼ delta vs prev_yes_price, a category badge, abbreviated volume,
 * and a live close-time countdown. Probability flashes up/down on change.
 *
 * Comfort mode = responsive card grid; compact mode = single dense
 * ticker row. Controls bar provides direction filter pills (All /
 * Up / Down), sort dropdown, and category filter. Summary bar shows
 * up/down/flat counts. Dismissible filter chips appear when category
 * filters are active.
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";
import { TrendingUp, LineChart, Wallet, Star, CheckCircle2, ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, predictionsCatalogOptions } from "../../api/queries";
import {
  formatCompactNumber,
  formatCloseCountdown,
  relativeTime,
} from "../../utils/format";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import MyPositionsPanel from "./MyPositionsPanel";
import MarketDetail from "./MarketDetail";
import { isKalshiAvailable } from "./kalshi";
import { marketLabel, selectResolvedToday, formatProbability } from "./view";
import { usePredictionAlerts } from "./usePredictionAlerts";
import {
  getWatchlist,
  saveWatchlist,
  withToggled,
  getAlerts,
  addAlert as persistAddAlert,
  removeAlert as persistRemoveAlert,
  type PredictionAlert,
  type AlertComparator,
} from "./watchlist";
import { useShell } from "../../shell-context";
import { useNow } from "../../hooks/useNow";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import {
  applyPredictionsPipeline,
  groupByEvent,
  priceDelta,
  type PredictionEvent,
  type PredictionsSortKey,
} from "./view";
import type { Prediction, FeedTabProps, ChannelManifest } from "../../types";
import type { ChannelType } from "../../api/client";
import { shouldShowOnFeed } from "../../preferences";
import type { PredictionsDisplayPrefs } from "../../preferences";

// ── Channel manifest ─────────────────────────────────────────────

export const predictionsChannel: ChannelManifest = {
  id: "predictions",
  name: "Predictions",
  tabLabel: "Predict",
  description: "Live prediction-market odds from Kalshi",
  hex: "#6366f1",
  icon: TrendingUp,
  info: {
    about:
      "Track live prediction markets across politics, sports, economics, " +
      "and more. Each market shows its implied probability — the chance " +
      "the market gives a 'Yes' outcome — and moves in real time as " +
      "traders shift the odds.",
    usage: [
      "Open Configure to pin markets and choose categories.",
      "Probabilities update automatically when connected.",
      "Click any market to view it on Kalshi.",
    ],
  },
  FeedTab: PredictionsFeedTab,
};

// ── Types ────────────────────────────────────────────────────────

type SortKey = PredictionsSortKey;

const PAGE_SIZE = 20;
const LOAD_MORE_INCREMENT = 20;

/** Channel accent — kept in sync with `predictionsChannel.hex`. */
const PREDICTIONS_HEX = "#6366f1";

type FeedView = "markets" | "positions";

// ── Display helpers ──────────────────────────────────────────────

/** Signed delta with arrow glyph ("▲ 4" / "▼ 3" / "—"). */
function formatDelta(delta: number): string {
  if (delta > 0) return `▲ ${delta}`;
  if (delta < 0) return `▼ ${Math.abs(delta)}`;
  return "—";
}

// ── FeedTab ──────────────────────────────────────────────────────

function PredictionsFeedTab({ mode: callerMode, feedContext, onConfigure, widgetId }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.predictions;

  // Watchlist mirror (v1.1.4 round 3): stars are local, but the server
  // must know them so a starred market survives Configure's category
  // narrowing (queryMarketsForUser unions favorites into the payload).
  // config.favorites is that mirror — written on every toggle, never
  // shown as its own UI.
  const { updateItems: mirrorFavorites } = useChannelConfig<string[]>(
    (widgetId ?? "predictions") as ChannelType,
    "favorites",
  );

  // The caller (Home or Source page) hints at a default mode, but the
  // user's per-channel feedDensity pref wins when set — so the same
  // channel can render compact on Home (caller hint wins for the small
  // preview) and comfort on the Source page, controlled from Display.
  const mode = dp.feedDensity ?? callerMode;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(predictionsCatalogOptions());

  // One subscription for the whole list — passed down to each row so
  // every `MarketItem` re-renders together on the 1s tick. Without this
  // the per-row close-time countdowns never advance between updates.
  const now = useNow();

  const markets = useMemo(
    () => (dashboard?.data?.predictions as Prediction[] | undefined) ?? [],
    [dashboard?.data?.predictions],
  );

  // ── Watchlist + local alerts (account-free, local persistence) ─
  const [watchlist, setWatchlist] = useState<string[]>(() => getWatchlist());
  const [alerts, setAlerts] = useState<PredictionAlert[]>(() => getAlerts());
  const watchedSet = useMemo(() => new Set(watchlist), [watchlist]);

  // Records prices for sparklines + fires edge-triggered price alerts (toast).
  usePredictionAlerts(markets, alerts);

  const toggleWatch = useCallback(
    (ticker: string) => {
      setWatchlist((prev) => {
        const next = withToggled(prev, ticker);
        saveWatchlist(next);
        mirrorFavorites(next);
        return next;
      });
    },
    [mirrorFavorites],
  );

  const addAlertCb = useCallback(
    (input: { ticker: string; label: string; comparator: AlertComparator; threshold: number }) => {
      setAlerts(persistAddAlert(input));
    },
    [],
  );

  const removeAlertCb = useCallback((id: string) => {
    setAlerts(persistRemoveAlert(id));
  }, []);

  // ── Lens + market-detail modal ────────────────────────────────
  const [lens, setLens] = useState<"all" | "watchlist">("all");
  const [detailMarket, setDetailMarket] = useState<Prediction | null>(null);
  const openDetail = useCallback((m: Prediction) => setDetailMarket(m), []);
  const closeDetail = useCallback(() => setDetailMarket(null), []);

  // Resolved-today recap (trailing 24h), refreshed as `now` ticks.
  const resolvedToday = useMemo(
    () => selectResolvedToday(markets, now),
    [markets, now],
  );

  // id → category lookup from the catalog (keyed by Kalshi ticker, which
  // the prediction id wraps as "kalshi:<ticker>"). The catalog is a
  // secondary source; most rows carry their own `category`.
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (catalog) {
      for (const entry of catalog) {
        if (entry.category) {
          map.set(`kalshi:${entry.ticker}`, entry.category);
          map.set(entry.ticker, entry.category);
        }
      }
    }
    return map;
  }, [catalog]);

  // Derive categories with counts from current markets.
  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of markets) {
      const cat = m.category ?? categoryMap.get(m.id);
      if (cat) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [markets, categoryMap]);

  // ── Filter / sort state ──────────────────────────────────────
  // Sort + density now live entirely in the Display tab, and the full set of
  // tracked categories in Configure — so the feed itself stays uncluttered.
  // The feed reads the saved default sort (reactive to Display changes); the
  // single lens row below drives one-category focus.
  const sortKey: SortKey = dp.defaultSort ?? "volume";
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const clearCategories = useCallback(() => setSelectedCategories(new Set()), []);

  const clearAllFilters = useCallback(() => {
    setSelectedCategories(new Set());
    setLens("all");
  }, []);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [selectedCategories, sortKey, lens, watchlist]);

  // ── Data pipeline ────────────────────────────────────────────
  // Shared with the ticker via `applyPredictionsPipeline` so
  // `defaultSort` from the Display tab takes effect in both places.
  const filtered = useMemo(
    () =>
      applyPredictionsPipeline(markets, {
        directionFilter: "all",
        selectedCategories,
        categoryMap,
        sortKey,
      }),
    [markets, selectedCategories, categoryMap, sortKey],
  );

  // Watchlist lens: starred markets, deliberately UNFILTERED by any
  // category selection (client chips here or Configure's server-side
  // narrowing) — a star means "always show me this" (v1.1.4 round 3).
  // Sort still applies so the lens matches the grid's ordering.
  const lensItems = useMemo(
    () =>
      lens === "watchlist"
        ? applyPredictionsPipeline(
            markets.filter((m) => watchedSet.has(m.ticker)),
            {
              directionFilter: "all",
              selectedCategories: new Set<string>(),
              categoryMap,
              sortKey,
            },
          )
        : filtered,
    [filtered, lens, watchedSet, markets, categoryMap, sortKey],
  );

  // Comfort mode renders Kalshi-style EVENT cards (v1.1.4): the sorted
  // market list folds into events ordered by each event's lead leg, so
  // the Display-tab sort still governs the card order. Compact mode
  // stays a flat dense market list.
  const events = useMemo(() => groupByEvent(lensItems), [lensItems]);
  const isComfort = mode === "comfort";

  // ── Pagination (incremental "load more") ─────────────────────
  const renderTotal = isComfort ? events.length : lensItems.length;
  const visible = Math.min(visibleCount, renderTotal);
  const pageItems = lensItems.slice(0, visible);
  const pageEvents = events.slice(0, visible);
  const remaining = Math.max(0, renderTotal - visible);

  // Most-recent update across filtered markets — drives the FreshnessPill.
  const latestUpdated = useMemo(() => {
    let latest = 0;
    for (const m of lensItems) {
      if (!m.updated_at) continue;
      const ts = new Date(m.updated_at).getTime();
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  }, [lensItems]);

  // Live version of the open market (so the modal reflects price ticks).
  const liveDetail = useMemo(
    () =>
      detailMarket
        ? markets.find((m) => m.id === detailMarket.id) ?? detailMarket
        : null,
    [detailMarket, markets],
  );

  // ── View switcher (Markets / My Positions) ───────────────────
  // Only on the full-size Source page (comfort). The compact Home preview
  // stays a pure markets list. "My Positions" is desktop-only (keychain).
  const [view, setView] = useState<FeedView>("markets");
  const showSwitcher = mode === "comfort" && isKalshiAvailable();

  if (showSwitcher && view === "positions") {
    return (
      <div className="flex h-full flex-col min-h-0">
        <ViewSwitcher view={view} onChange={setView} />
        <div className="flex-1 min-h-0">
          <MyPositionsPanel markets={markets} hex={PREDICTIONS_HEX} />
        </div>
      </div>
    );
  }

  // ── Empty state (no data at all) ─────────────────────────────
  if (markets.length === 0) {
    return (
      <div className="flex h-full flex-col min-h-0">
        {showSwitcher && <ViewSwitcher view={view} onChange={setView} />}
        <div className="flex-1 min-h-0">
          <EmptyChannelState
            refreshing={Boolean(feedContext.__refreshing)}
            icon={TrendingUp}
            noun="markets"
            hasConfig={!!feedContext.__hasConfig}
            dashboardLoaded={!!feedContext.__dashboardLoaded}
            loadingNoun="odds"
            actionHint="choose what to track"
            onConfigure={onConfigure}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-y-auto">
      {showSwitcher && <ViewSwitcher view={view} onChange={setView} />}

      {/* Slim lens row — the only inline control. Sort + density live in the
          Display tab; the full set of tracked categories lives in Configure. */}
      {mode === "comfort" && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge/30 bg-surface px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <LensPill
              active={lens === "all" && selectedCategories.size === 0}
              onClick={() => {
                setLens("all");
                clearCategories();
              }}
            >
              All
            </LensPill>
            <LensPill
              active={lens === "watchlist"}
              onClick={() => setLens((l) => (l === "watchlist" ? "all" : "watchlist"))}
            >
              <Star size={12} className={lens === "watchlist" ? "fill-current" : ""} />
              Watchlist{watchlist.length > 0 ? ` ${watchlist.length}` : ""}
            </LensPill>
            {categoryList.slice(0, 6).map((c) => (
              <LensPill
                key={c.name}
                active={lens === "all" && selectedCategories.size === 1 && selectedCategories.has(c.name)}
                onClick={() => {
                  setLens("all");
                  setSelectedCategories(new Set([c.name]));
                }}
              >
                {c.name}
              </LensPill>
            ))}
          </div>
          {latestUpdated && (
            <div className="ml-auto shrink-0">
              <FreshnessPill lastUpdated={latestUpdated} label="odds" />
            </div>
          )}
        </div>
      )}

      {/* Resolved Today recap (collapsible) */}
      {mode === "comfort" && lens !== "watchlist" && resolvedToday.length > 0 && (
        <ResolvedTodayStrip items={resolvedToday} onOpen={openDetail} />
      )}

      {/* Market grid */}
      {lensItems.length === 0 ? (
        lens === "watchlist" ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
            <Star size={22} className="text-fg-4" />
            <p className="text-[12px] text-fg-3">No watched markets yet</p>
            <p className="text-[11px] text-fg-4">
              Tap the ☆ on any market to add it to your watchlist.
            </p>
            <button
              onClick={() => setLens("all")}
              className="mt-1 px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Browse markets
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-[12px] text-fg-3">No markets match your filters</p>
            <button
              onClick={clearAllFilters}
              className="px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        )
      ) : (
        <>
          <div
            className={clsx(
              "grid gap-px bg-edge",
              mode === "compact"
                ? "grid-cols-1"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {isComfort
              ? pageEvents.map((ev) => (
                  <EventCard
                    key={ev.eventTicker}
                    event={ev}
                    display={dp}
                    category={
                      ev.category ??
                      categoryMap.get(ev.outcomes[0]?.id ?? "")
                    }
                    now={now}
                    watchedSet={watchedSet}
                    onToggleWatch={toggleWatch}
                    onOpenDetail={openDetail}
                  />
                ))
              : pageItems.map((market) => (
                  <MarketItem
                    key={market.id}
                    market={market}
                    mode={mode}
                    display={dp}
                    category={market.category ?? categoryMap.get(market.id)}
                    now={now}
                    watched={watchedSet.has(market.ticker)}
                  />
                ))}
          </div>
          {remaining > 0 && (
            <div className="flex items-center justify-center gap-3 px-3 py-3 bg-surface border-t border-edge/30">
              <button
                onClick={() =>
                  setVisibleCount((c) =>
                    Math.min(renderTotal, c + LOAD_MORE_INCREMENT),
                  )
                }
                className="px-4 py-1.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
              >
                Load more
              </button>
              <span className="text-xs text-fg-3 tabular-nums font-mono">
                {visible} of {renderTotal}
              </span>
            </div>
          )}
        </>
      )}

      {/* Market-detail modal */}
      {liveDetail && (
        <MarketDetail
          market={liveDetail}
          now={now}
          watched={watchedSet.has(liveDetail.ticker)}
          onToggleWatch={() => toggleWatch(liveDetail.ticker)}
          alerts={alerts}
          onAddAlert={addAlertCb}
          onRemoveAlert={removeAlertCb}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}

// ── Lens pill ────────────────────────────────────────────────────

function LensPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-ui-meta font-medium transition-colors cursor-pointer",
        active
          ? "bg-accent/15 text-accent"
          : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
      )}
    >
      {children}
    </button>
  );
}

// ── Resolved Today recap ─────────────────────────────────────────

function ResolvedTodayStrip({
  items,
  onOpen,
}: {
  items: Prediction[];
  onOpen: (m: Prediction) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-edge/30 bg-surface px-3 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-ui-chip font-semibold uppercase tracking-wide text-fg-3 transition-colors hover:text-fg-2 cursor-pointer"
      >
        <CheckCircle2 size={12} />
        Resolved today
        <span className="font-mono text-fg-4">{items.length}</span>
        <ChevronDown
          size={13}
          className={clsx("ml-auto transition-transform", open ? "" : "-rotate-90")}
        />
      </button>
      {open && (
      <div className="mt-1 flex gap-1.5 overflow-x-auto pb-0.5">
        {items.slice(0, 20).map((m) => {
          const won = (m.result ?? "").toLowerCase() === "yes";
          const lost = (m.result ?? "").toLowerCase() === "no";
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m)}
              title={m.title}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge/40 bg-base-100/40 px-2 py-1 text-ui-chip transition-colors hover:border-edge cursor-pointer"
            >
              <span className="max-w-[140px] truncate text-fg-2">{marketLabel(m, 32)}</span>
              <span
                className={clsx(
                  "rounded px-1 py-px font-mono text-[9px] font-bold uppercase",
                  won && "bg-up/15 text-up",
                  lost && "bg-down/15 text-down",
                  !won && !lost && "bg-surface-2 text-fg-3",
                )}
              >
                {m.result ? m.result : "settled"}
              </span>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

// ── View switcher ────────────────────────────────────────────────

function ViewSwitcher({
  view,
  onChange,
}: {
  view: FeedView;
  onChange: (v: FeedView) => void;
}) {
  const tabs: { value: FeedView; label: string; icon: typeof LineChart }[] = [
    { value: "markets", label: "Markets", icon: LineChart },
    { value: "positions", label: "My Positions", icon: Wallet },
  ];
  return (
    <div
      role="tablist"
      aria-label="Predictions view"
      className="flex shrink-0 items-center gap-1 border-b border-edge/30 bg-surface px-3 py-1.5"
    >
      {tabs.map((t) => {
        const active = view === t.value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-ui-meta font-medium transition-colors cursor-pointer",
              active
                ? "bg-accent/15 text-accent"
                : "text-fg-3 hover:bg-surface-hover hover:text-fg-2",
            )}
          >
            <Icon size={13} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── MarketItem ───────────────────────────────────────────────────

interface MarketItemProps {
  market: Prediction;
  mode: "comfort" | "compact";
  display: PredictionsDisplayPrefs;
  category?: string;
  /** Shared "now" from `useNow()` in the parent list — drives the countdown. */
  now: number;
  /** Whether this market is on the watchlist (comfort cards show a ★). */
  watched?: boolean;
  /** Toggle the watchlist star (comfort only). */
  onToggleWatch?: (ticker: string) => void;
  /** Open the market-detail modal (comfort only). When set, the card opens the
   *  detail on click instead of deep-linking straight to Kalshi. */
  onOpenDetail?: (market: Prediction) => void;
}

const MarketItem = memo(function MarketItem({
  market,
  mode,
  display,
  category,
  now,
  watched = false,
  onToggleWatch,
  onOpenDetail,
}: MarketItemProps) {
  const delta = priceDelta(market);
  const isUp = delta > 0;
  const isDown = delta < 0;

  // Track previous probability for the flash animation. A single effect
  // owns the ref so rapid back-to-back CDC events can't swallow a flash.
  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const current = typeof market.yes_price === "number" ? market.yes_price : NaN;
    const prev = prevPriceRef.current;
    prevPriceRef.current = current;

    if (prev === null || isNaN(current) || current === prev) {
      return;
    }

    setFlash(current > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [market.yes_price]);

  const dirColor = isUp ? "text-up" : isDown ? "text-down" : "text-fg-3";
  const probability = formatProbability(market.yes_price);
  const countdown = formatCloseCountdown(market.close_time, now);

  if (mode === "compact") {
    return (
      <a
        href={market.link}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx(
          "flex items-center gap-2 px-3 py-1.5 bg-surface text-xs font-mono transition-colors duration-700 hover:bg-surface-hover",
          flash === "up" && "bg-up/8",
          flash === "down" && "bg-down/8",
        )}
      >
        <span className="text-fg font-semibold tabular-nums min-w-[40px]">
          {probability}
        </span>
        {shouldShowOnFeed(display.showDelta) && (
          <span className={clsx("tabular-nums min-w-[40px]", dirColor)}>
            {formatDelta(delta)}
          </span>
        )}
        <span className="text-fg-2 truncate flex-1 font-sans">
          {market.event_title || market.title}
        </span>
        {shouldShowOnFeed(display.showVolume) && market.volume != null && (
          <span className="text-fg-3 tabular-nums shrink-0">
            {formatCompactNumber(market.volume)}
          </span>
        )}
        {shouldShowOnFeed(display.showCloseTime) && countdown && (
          <span className="text-fg-3 tabular-nums shrink-0">{countdown}</span>
        )}
      </a>
    );
  }

  // Comfort mode — responsive card. When `onOpenDetail` is set the card opens
  // the market-detail modal (with sparkline, alerts, and the Kalshi link);
  // otherwise it falls back to deep-linking straight to Kalshi.
  const cardClass = clsx(
    "relative flex flex-col gap-2 px-3 py-2.5 bg-surface text-left transition-colors duration-700 hover:bg-surface-hover border-l-2 w-full",
    flash === "up" && "bg-up/6",
    flash === "down" && "bg-down/6",
    isUp && "border-l-up/40",
    isDown && "border-l-down/40",
    !isUp && !isDown && "border-l-transparent",
  );

  const inner = (
    <>
      {/* Watchlist star — top-right, doesn't trigger the card click */}
      {onToggleWatch && (
        <button
          type="button"
          aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={watched}
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch(market.ticker);
          }}
          className={clsx(
            "absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer",
            watched ? "text-amber-400" : "text-fg-4 hover:text-fg-2",
          )}
        >
          <Star size={14} className={watched ? "fill-current" : ""} />
        </button>
      )}

      {/* Top row: probability + delta, then category badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-mono font-bold text-fg tabular-nums leading-none">
            {probability}
          </span>
          {shouldShowOnFeed(display.showDelta) && (
            <span
              className={clsx(
                "text-ui-meta font-mono font-semibold tabular-nums",
                dirColor,
              )}
            >
              {formatDelta(delta)}
            </span>
          )}
        </div>
        {shouldShowOnFeed(display.showCategory) && category && (
          <span className={clsx("shrink-0 bg-[#6366f1]/12 text-[#6366f1] text-ui-chip font-medium rounded px-1.5 py-px", onToggleWatch && "mr-7")}>
            {category}
          </span>
        )}
      </div>

      {/* Title */}
      <span className="text-ui-body text-fg-2 leading-snug line-clamp-2">
        {market.title}
      </span>

      {/* Footer: volume + close countdown */}
      <div className="flex items-center justify-between gap-2 text-ui-chip font-mono text-fg-3 tabular-nums">
        {shouldShowOnFeed(display.showVolume) && market.volume != null ? (
          <span title="24h volume">Vol {formatCompactNumber(market.volume)}</span>
        ) : (
          <span />
        )}
        {shouldShowOnFeed(display.showCloseTime) && countdown && (
          <span
            className={clsx(countdown === "Closed" && "text-fg-4")}
            title={
              market.close_time
                ? `Closes ${relativeTime(market.close_time, now)}`
                : undefined
            }
          >
            {countdown === "Closed" ? countdown : `Closes ${countdown}`}
          </span>
        )}
      </div>
    </>
  );

  if (onOpenDetail) {
    return (
      <button type="button" onClick={() => onOpenDetail(market)} className={cardClass}>
        {inner}
      </button>
    );
  }

  return (
    <a href={market.link} target="_blank" rel="noopener noreferrer" className={cardClass}>
      {inner}
    </a>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.display === next.display &&
  prev.category === next.category &&
  prev.watched === next.watched &&
  prev.onToggleWatch === next.onToggleWatch &&
  prev.onOpenDetail === next.onOpenDetail &&
  // `now` must trigger a re-render while the close-time countdown is
  // visible so it advances on every tick. When the countdown is hidden
  // the tick is irrelevant — skip it to avoid churning the whole list.
  (!shouldShowOnFeed(next.display.showCloseTime) || !next.market.close_time || prev.now === next.now) &&
  prev.market.id === next.market.id &&
  prev.market.yes_price === next.market.yes_price &&
  prev.market.prev_yes_price === next.market.prev_yes_price &&
  prev.market.volume === next.market.volume &&
  prev.market.title === next.market.title &&
  prev.market.event_title === next.market.event_title &&
  prev.market.close_time === next.market.close_time &&
  prev.market.updated_at === next.market.updated_at
);

// ── EventCard (v1.1.4 Kalshi Grows Up) ──────────────────────────
//
// Kalshi-style card: the EVENT question headlines, with up to two
// outcome legs inside. Each leg carries its own probability, delta,
// price-flash, and watchlist star, and opens the detail modal for
// exactly that leg — mirroring Kalshi's own Browse Markets cards.

interface EventCardProps {
  event: PredictionEvent;
  display: PredictionsDisplayPrefs;
  category?: string;
  now: number;
  watchedSet: Set<string>;
  onToggleWatch: (ticker: string) => void;
  onOpenDetail: (market: Prediction) => void;
}

const EventCard = memo(function EventCard({
  event,
  display,
  category,
  now,
  watchedSet,
  onToggleWatch,
  onOpenDetail,
}: EventCardProps) {
  const lead = event.outcomes[0];
  const countdown = formatCloseCountdown(
    event.closeTime ?? lead?.close_time,
    now,
  );

  return (
    <div className="flex flex-col gap-2 bg-surface px-3 py-2.5">
      {/* Header: category badge · close countdown */}
      <div className="flex items-center justify-between gap-2 text-ui-chip">
        {shouldShowOnFeed(display.showCategory) && category ? (
          <span className="rounded bg-[#6366f1]/12 px-1.5 py-px font-medium text-[#6366f1]">
            {category}
          </span>
        ) : (
          <span />
        )}
        {shouldShowOnFeed(display.showCloseTime) && countdown && (
          <span
            className={clsx(
              "font-mono tabular-nums text-fg-3",
              countdown === "Closed" && "text-fg-4",
            )}
          >
            {countdown === "Closed" ? countdown : `Closes ${countdown}`}
          </span>
        )}
      </div>

      {/* The event question */}
      <span className="text-ui-body font-medium leading-snug text-fg line-clamp-2">
        {event.title}
      </span>

      {/* Outcome legs. ANY single-leg event gets a synthetic No row —
          a lone market's No side is always its complement (100 - yes),
          whether the leg is "Yes", "Reza Pahlavi", or "Before Jan 1,
          2027" — mirroring Kalshi's own Yes/No pair instead of leaving
          one row stranded. */}
      <div className="flex flex-col gap-1">
        {event.outcomes.map((m) => (
          <OutcomeRow
            key={m.id}
            market={m}
            display={display}
            watched={watchedSet.has(m.ticker)}
            onToggleWatch={onToggleWatch}
            onOpenDetail={onOpenDetail}
          />
        ))}
        {event.outcomes.length === 1 && (
          <OutcomeRow
            market={event.outcomes[0]}
            display={display}
            watched={watchedSet.has(event.outcomes[0].ticker)}
            onToggleWatch={onToggleWatch}
            onOpenDetail={onOpenDetail}
            syntheticNo
          />
        )}
      </div>

      {/* Footer: summed volume across legs */}
      {shouldShowOnFeed(display.showVolume) && event.volume > 0 && (
        <div className="text-ui-chip font-mono tabular-nums text-fg-3">
          Vol {formatCompactNumber(event.volume)}
        </div>
      )}
    </div>
  );
});

/** One outcome leg inside an EventCard — its own flash, star, and click.
 *  `syntheticNo` renders the implicit No side of a binary market
 *  (100 - yes, inverted delta, no star — it's the same market, so the
 *  Yes row owns the watchlist state). */
function OutcomeRow({
  market,
  display,
  watched,
  onToggleWatch,
  onOpenDetail,
  syntheticNo = false,
}: {
  market: Prediction;
  display: PredictionsDisplayPrefs;
  watched: boolean;
  onToggleWatch: (ticker: string) => void;
  onOpenDetail: (market: Prediction) => void;
  syntheticNo?: boolean;
}) {
  const rawDelta = priceDelta(market);
  const delta = syntheticNo ? -rawDelta : rawDelta;
  const isUp = delta > 0;
  const isDown = delta < 0;

  // Same flash-on-change pattern as MarketItem: one effect owns the ref
  // so rapid back-to-back CDC events can't swallow a flash.
  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const current =
      typeof market.yes_price === "number" ? market.yes_price : NaN;
    const prev = prevPriceRef.current;
    prevPriceRef.current = current;
    if (prev === null || isNaN(current) || current === prev) return;
    setFlash(current > prev ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [market.yes_price]);

  // Binary events read best as "Yes" rows; multi-outcome events name
  // their leg ("France", "Atlanta"). The synthetic row is always "No".
  const legLabel = syntheticNo
    ? "No"
    : market.title && market.title.toLowerCase() !== "yes"
      ? market.title
      : "Yes";

  // The No side of a binary market is the complement of yes_price.
  const shownPct = syntheticNo
    ? Math.max(0, Math.min(100, 100 - (market.yes_price ?? 0)))
    : market.yes_price;

  return (
    <div
      className={clsx(
        "flex items-center gap-1.5 rounded-md border border-edge/30 bg-base-100/40 px-2 py-1.5 transition-colors duration-700",
        flash === (syntheticNo ? "down" : "up") && "bg-up/8",
        flash === (syntheticNo ? "up" : "down") && "bg-down/8",
        isUp && "border-l-2 border-l-up/40",
        isDown && "border-l-2 border-l-down/40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetail(market)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-ui-meta text-fg-2">
          {legLabel}
        </span>
        {shouldShowOnFeed(display.showDelta) && delta !== 0 && (
          <span
            className={clsx(
              "shrink-0 font-mono text-ui-chip font-semibold tabular-nums",
              isUp ? "text-up" : "text-down",
            )}
          >
            {formatDelta(delta)}
          </span>
        )}
        <span className="shrink-0 font-mono text-ui-body font-bold tabular-nums text-fg">
          {formatProbability(shownPct)}
        </span>
      </button>
      {syntheticNo ? (
        // Spacer keeps the No row's numbers column-aligned with Yes.
        <span className="h-6 w-6 shrink-0" aria-hidden />
      ) : (
        <button
          type="button"
          aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={watched}
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch(market.ticker);
          }}
          className={clsx(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer",
            watched ? "text-amber-400" : "text-fg-4 hover:text-fg-2",
          )}
        >
          <Star size={13} className={watched ? "fill-current" : ""} />
        </button>
      )}
    </div>
  );
}
