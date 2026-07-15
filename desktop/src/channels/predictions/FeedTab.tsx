/**
 * Predictions FeedTab — v1.1.5 "Kalshi Cleans Up".
 *
 * ONE personalization primitive (the ★ watchlist) and ONE control row
 * (four lenses: Trending / Movers / Closing soon / Watchlist). Trending
 * browses Kalshi-style: category sections ordered by 24h volume, each a
 * grid of event cards (question headline, outcome rows with probability
 * pills, volume footer). Other lenses and category focus render a flat
 * sorted grid with incremental paging.
 *
 * Server-side config (categories/favorites) is retired — the payload is
 * the full curated set (~240 markets) and ALL filtering is client-side.
 * Stars live in local prefs only (watchlist.ts) and take over the ticker.
 *
 * Comfort mode = the browse experience; compact mode = single dense
 * ticker rows (Home preview density).
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";
import {
  TrendingUp,
  LineChart,
  Wallet,
  Star,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Flame,
  Clock,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, predictionsCatalogOptions } from "../../api/queries";
import {
  formatCompactNumber,
  formatCloseCountdown,
} from "../../utils/format";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import MyPositionsPanel from "./MyPositionsPanel";
import MarketDetail from "./MarketDetail";
import ProbabilityPill from "./ProbabilityPill";
import { isKalshiAvailable } from "./kalshi";
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
import {
  selectLens,
  selectResolvedToday,
  groupByEvent,
  groupEventsByCategory,
  marketLabel,
  priceDelta,
  type PredictionEvent,
  type PredictionsLens,
  type CategorySection,
} from "./view";
import type { Prediction, FeedTabProps, ChannelManifest } from "../../types";
import { shouldShowOnFeed } from "../../preferences";
import type { PredictionsDisplayPrefs } from "../../preferences";

// ── Channel manifest ─────────────────────────────────────────────

export const predictionsChannel: ChannelManifest = {
  id: "predictions",
  name: "Predictions",
  tabLabel: "Predict",
  description: "Live prediction-market odds from Kalshi",
  hex: "#1fc9a0",
  icon: TrendingUp,
  info: {
    about:
      "Track live prediction markets across politics, sports, economics, " +
      "and more. Each market shows its implied probability — the chance " +
      "the market gives a 'Yes' outcome — and moves in real time as " +
      "traders shift the odds.",
    usage: [
      "Browse Trending by category, or flip lenses: Movers, Closing soon.",
      "Star any market — stars build your watchlist and take over the ticker.",
      "Click any outcome for its price history, alerts, and the Kalshi link.",
    ],
  },
  FeedTab: PredictionsFeedTab,
};

// ── Constants ────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const LOAD_MORE_INCREMENT = 20;

/** Channel accent — kept in sync with `predictionsChannel.hex` and the
 *  marketplace catalog color (v1.1.5 unified the old indigo/teal split). */
const PREDICTIONS_HEX = "#1fc9a0";

/** Events shown per category section before "View all" takes over. */
const SECTION_PREVIEW_COUNT = 6;

type FeedView = "markets" | "positions";

// ── Display helpers ──────────────────────────────────────────────

/** Signed delta with arrow glyph ("▲ 4" / "▼ 3" / "—"). */
function formatDelta(delta: number): string {
  if (delta > 0) return `▲ ${delta}`;
  if (delta < 0) return `▼ ${Math.abs(delta)}`;
  return "—";
}

const LENSES: { value: PredictionsLens; label: string; icon?: typeof Flame }[] = [
  { value: "trending", label: "Trending", icon: Flame },
  { value: "movers", label: "Movers", icon: TrendingUp },
  { value: "closing", label: "Closing soon", icon: Clock },
  { value: "watchlist", label: "Watchlist", icon: Star },
];

// ── FeedTab ──────────────────────────────────────────────────────

function PredictionsFeedTab({ mode: callerMode, feedContext, onConfigure }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.predictions;

  // The caller (Home or Source page) hints at a default mode, but the
  // user's per-channel feedDensity pref wins when set — so the same
  // channel can render compact on Home (caller hint wins for the small
  // preview) and comfort on the Source page, controlled from Configure.
  const mode = dp.feedDensity ?? callerMode;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(predictionsCatalogOptions());

  // One subscription for the whole list — passed down to each row so
  // every card re-renders together on the 1s tick. Without this the
  // per-row close-time countdowns never advance between updates.
  const now = useNow();

  const markets = useMemo(
    () => (dashboard?.data?.predictions as Prediction[] | undefined) ?? [],
    [dashboard?.data?.predictions],
  );

  // ── Watchlist + local alerts (account-free, local persistence) ─
  // v1.1.5: stars are PURELY local — the old config.favorites server
  // mirror is retired (the payload is no longer narrowed server-side,
  // so there is nothing for a mirror to protect against).
  const [watchlist, setWatchlist] = useState<string[]>(() => getWatchlist());
  const [alerts, setAlerts] = useState<PredictionAlert[]>(() => getAlerts());
  const watchedSet = useMemo(() => new Set(watchlist), [watchlist]);

  // Records prices for sparklines + fires edge-triggered price alerts (toast).
  usePredictionAlerts(markets, alerts);

  const toggleWatch = useCallback((ticker: string) => {
    setWatchlist((prev) => {
      const next = withToggled(prev, ticker);
      saveWatchlist(next);
      return next;
    });
  }, []);

  const addAlertCb = useCallback(
    (input: { ticker: string; label: string; comparator: AlertComparator; threshold: number }) => {
      setAlerts(persistAddAlert(input));
    },
    [],
  );

  const removeAlertCb = useCallback((id: string) => {
    setAlerts(persistRemoveAlert(id));
  }, []);

  // ── Lens + category focus + market-detail modal ───────────────
  const [lens, setLens] = useState<PredictionsLens>("trending");
  const [categoryFocus, setCategoryFocus] = useState<string | null>(null);
  const [detailMarket, setDetailMarket] = useState<Prediction | null>(null);
  const openDetail = useCallback((m: Prediction) => setDetailMarket(m), []);
  const closeDetail = useCallback(() => setDetailMarket(null), []);

  const pickLens = useCallback((next: PredictionsLens) => {
    setLens(next);
    setCategoryFocus(null);
  }, []);

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

  const categoryOf = useCallback(
    (m: Prediction): string => m.category ?? categoryMap.get(m.id) ?? "Other",
    [categoryMap],
  );

  // ── Data pipeline (pure selectors from view.ts) ───────────────
  const lensItems = useMemo(
    () => selectLens(markets, lens, watchedSet),
    [markets, lens, watchedSet],
  );

  const focusedItems = useMemo(
    () =>
      categoryFocus
        ? lensItems.filter((m) => categoryOf(m) === categoryFocus)
        : lensItems,
    [lensItems, categoryFocus, categoryOf],
  );

  const events = useMemo(() => groupByEvent(focusedItems), [focusedItems]);
  const isComfort = mode === "comfort";

  // Browse mode: Trending with no category focus = Kalshi-style sections.
  const sections: CategorySection[] | null = useMemo(
    () =>
      isComfort && lens === "trending" && !categoryFocus
        ? groupEventsByCategory(events)
        : null,
    [isComfort, lens, categoryFocus, events],
  );

  // ── Pagination (flat modes only — sections self-cap) ─────────
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [lens, categoryFocus, watchlist]);

  const renderTotal = isComfort ? events.length : focusedItems.length;
  const visible = Math.min(visibleCount, renderTotal);
  const pageItems = focusedItems.slice(0, visible);
  const pageEvents = events.slice(0, visible);
  const remaining = Math.max(0, renderTotal - visible);

  // Most-recent update across visible markets — drives the FreshnessPill.
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
            actionHint="markets load automatically"
            onConfigure={onConfigure}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-y-auto">
      {showSwitcher && <ViewSwitcher view={view} onChange={setView} />}

      {/* The ONE control row: four lenses + freshness. */}
      {isComfort && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge/30 bg-surface px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {LENSES.map((l) => {
              const Icon = l.icon;
              const active = lens === l.value && !categoryFocus;
              return (
                <LensPill key={l.value} active={active} onClick={() => pickLens(l.value)}>
                  {Icon && (
                    <Icon
                      size={12}
                      className={l.value === "watchlist" && active ? "fill-current" : ""}
                    />
                  )}
                  {l.label}
                  {l.value === "watchlist" && watchlist.length > 0
                    ? ` ${watchlist.length}`
                    : ""}
                </LensPill>
              );
            })}
            {categoryFocus && (
              <LensPill active onClick={() => setCategoryFocus(null)}>
                {categoryFocus}
                <span aria-hidden className="text-accent/70">×</span>
              </LensPill>
            )}
          </div>
          {latestUpdated && (
            <div className="ml-auto shrink-0">
              <FreshnessPill lastUpdated={latestUpdated} label="odds" />
            </div>
          )}
        </div>
      )}

      {/* Resolved Today recap (collapsible) */}
      {isComfort && lens !== "watchlist" && resolvedToday.length > 0 && (
        <ResolvedTodayStrip items={resolvedToday} onOpen={openDetail} />
      )}

      {/* Market browse / grids */}
      {renderTotal === 0 ? (
        lens === "watchlist" ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
            <Star size={22} className="text-fg-4" />
            <p className="text-[12px] text-fg-3">No watched markets yet</p>
            <p className="text-[11px] text-fg-4">
              Tap the ☆ on any market to add it to your watchlist.
            </p>
            <button
              onClick={() => pickLens("trending")}
              className="mt-1 px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Browse markets
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-[12px] text-fg-3">Nothing here right now</p>
            <button
              onClick={() => pickLens("trending")}
              className="px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Back to Trending
            </button>
          </div>
        )
      ) : sections ? (
        // ── Browse mode: category sections, hottest first ─────────
        <div className="flex flex-col">
          {sections.map((section) => (
            <div key={section.category} className="flex flex-col">
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                <h3 className="text-ui-section font-semibold uppercase tracking-wide text-fg-3">
                  {section.category}
                </h3>
                <span className="font-mono text-ui-chip tabular-nums text-fg-4">
                  {section.events.length}
                </span>
                {section.events.length > SECTION_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setCategoryFocus(section.category)}
                    className="ml-auto inline-flex items-center gap-0.5 text-ui-meta font-medium text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  >
                    View all
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
              <div className="grid gap-px bg-edge grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {section.events.slice(0, SECTION_PREVIEW_COUNT).map((ev) => (
                  <EventCard
                    key={ev.eventTicker}
                    event={ev}
                    display={dp}
                    now={now}
                    watchedSet={watchedSet}
                    onToggleWatch={toggleWatch}
                    onOpenDetail={openDetail}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="h-3" />
        </div>
      ) : (
        // ── Flat mode: other lenses / category focus / compact ────
        <>
          <div
            className={clsx(
              "grid gap-px bg-edge",
              isComfort
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid-cols-1",
            )}
          >
            {isComfort
              ? pageEvents.map((ev) => (
                  <EventCard
                    key={ev.eventTicker}
                    event={ev}
                    display={dp}
                    category={categoryFocus ? undefined : categoryOf(ev.outcomes[0])}
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
                    display={dp}
                    now={now}
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

// ── MarketItem (compact density only) ────────────────────────────
//
// The comfort card path is owned by EventCard; compact mode (Home
// preview density) renders one dense row per market. The v1.1.4
// comfort branch of this component was dead code and is deleted.

interface MarketItemProps {
  market: Prediction;
  display: PredictionsDisplayPrefs;
  /** Shared "now" from `useNow()` in the parent list — drives the countdown. */
  now: number;
}

const MarketItem = memo(function MarketItem({
  market,
  display,
  now,
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
  const countdown = formatCloseCountdown(market.close_time, now);

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
      <ProbabilityPill pct={market.yes_price} delta={delta} size="sm" />
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
          {formatCompactNumber(market.volume_24h ?? market.volume)}
        </span>
      )}
      {shouldShowOnFeed(display.showCloseTime) && countdown && (
        <span className="text-fg-3 tabular-nums shrink-0">{countdown}</span>
      )}
    </a>
  );
}, (prev, next) =>
  prev.display === next.display &&
  // `now` must trigger a re-render while the close-time countdown is
  // visible so it advances on every tick. When the countdown is hidden
  // the tick is irrelevant — skip it to avoid churning the whole list.
  (!shouldShowOnFeed(next.display.showCloseTime) || !next.market.close_time || prev.now === next.now) &&
  prev.market.id === next.market.id &&
  prev.market.yes_price === next.market.yes_price &&
  prev.market.prev_yes_price === next.market.prev_yes_price &&
  prev.market.volume === next.market.volume &&
  prev.market.volume_24h === next.market.volume_24h &&
  prev.market.title === next.market.title &&
  prev.market.event_title === next.market.event_title &&
  prev.market.close_time === next.market.close_time &&
  prev.market.updated_at === next.market.updated_at
);

// ── EventCard (v1.1.5 restyle) ───────────────────────────────────
//
// Kalshi-style card: the EVENT question headlines with ONE watch star
// (top-right, stars the lead leg), up to two outcome rows with
// probability pills, and a 24h-volume footer. Leg-level starring stays
// available inside MarketDetail. In browse mode the section header
// already names the category, so the per-card badge only renders in
// flat lenses (pass `category`).

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
  const watched = lead ? watchedSet.has(lead.ticker) : false;
  const countdown = formatCloseCountdown(
    event.closeTime ?? lead?.close_time,
    now,
  );

  return (
    <div className="relative flex flex-col gap-2 bg-surface px-3 py-2.5">
      {/* Watch star — one per card, stars the lead leg. */}
      {lead && (
        <button
          type="button"
          aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={watched}
          onClick={(e) => {
            e.stopPropagation();
            onToggleWatch(lead.ticker);
          }}
          className={clsx(
            "absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md transition-colors cursor-pointer",
            watched ? "text-amber-400" : "text-fg-4 hover:text-fg-2",
          )}
        >
          <Star size={14} className={watched ? "fill-current" : ""} />
        </button>
      )}

      {/* Header: category badge (flat lenses only) · close countdown */}
      <div className="flex items-center justify-between gap-2 pr-7 text-ui-chip">
        {shouldShowOnFeed(display.showCategory) && category ? (
          <span
            className="rounded px-1.5 py-px font-medium"
            style={{
              backgroundColor: `${PREDICTIONS_HEX}1f`,
              color: PREDICTIONS_HEX,
            }}
          >
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
            onOpenDetail={onOpenDetail}
          />
        ))}
        {event.outcomes.length === 1 && (
          <OutcomeRow
            market={event.outcomes[0]}
            display={display}
            onOpenDetail={onOpenDetail}
            syntheticNo
          />
        )}
      </div>

      {/* Footer: summed 24h volume across legs */}
      {shouldShowOnFeed(display.showVolume) && (event.volume24h > 0 || event.volume > 0) && (
        <div className="text-ui-chip font-mono tabular-nums text-fg-3">
          Vol {formatCompactNumber(event.volume24h || event.volume)}
          <span className="text-fg-4"> · 24h</span>
        </div>
      )}
    </div>
  );
});

/** One outcome leg inside an EventCard — label, delta, probability pill.
 *  `syntheticNo` renders the implicit No side of a binary market
 *  (100 - yes, inverted delta) — it's the same market, so the star and
 *  detail click belong to the Yes row / card. */
function OutcomeRow({
  market,
  display,
  onOpenDetail,
  syntheticNo = false,
}: {
  market: Prediction;
  display: PredictionsDisplayPrefs;
  onOpenDetail: (market: Prediction) => void;
  syntheticNo?: boolean;
}) {
  const rawDelta = priceDelta(market);
  const delta = syntheticNo ? -rawDelta : rawDelta;
  const isUp = delta > 0;
  const isDown = delta < 0;

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
    <button
      type="button"
      onClick={() => onOpenDetail(market)}
      className={clsx(
        "flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-edge/30 bg-base-100/40 px-2 py-1.5 text-left transition-colors hover:border-edge/60",
        isUp && "border-l-2 border-l-up/40",
        isDown && "border-l-2 border-l-down/40",
      )}
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
      <ProbabilityPill pct={shownPct} delta={delta} size="sm" />
    </button>
  );
}
