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
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp,
  LineChart,
  Wallet,
  Star,
  CheckCircle2,
  ChevronRight,
  Flame,
  Clock,
  Search,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataWidgetsApi } from "../../api/client";
import { dashboardQueryOptions, predictionsCatalogOptions } from "../../api/queries";
import {
  formatCompactNumber,
  formatCloseCountdown,
  relativeTime,
} from "../../utils/format";
import EmptyWidgetState from "../../components/EmptyWidgetState";
import { FEED_CARD, FEED_CARD_INTERACTIVE } from "../../components/feedCard";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar, BarDivider, BarPill } from "../../components/widget-bar/Bar";
import {
  FilterMenuShell,
  MenuHeading,
  MenuRow,
} from "../../components/widget-bar/Menu";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SearchBox, useSlashFocus } from "../../components/widget-bar/SearchBox";
import { MultiSelectMenu } from "../../components/widget-bar/MultiSelectMenu";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
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
  useLoadMore,
  usePriceFlash,
  useSetToggle,
  latestTimestamp,
} from "../feedHooks";
import {
  selectLens,
  selectResolvedToday,
  groupByEvent,
  groupEventsByCategory,
  priceDelta,
  cardOutcomes,
  outcomesByPrice,
  timeIndicator,
  isResolved,
  type PredictionEvent,
  type PredictionsLens,
  type CategorySection,
  type TimeIndicator,
} from "./view";
import {
  searchEvents,
  outcomeLabel,
  type EventSearchHit,
  type MatchRange,
} from "./search";
import type { Prediction, FeedTabProps, DataWidgetManifest } from "../../types";
import type { PredictionsDisplayPrefs } from "../../preferences";
import { PredictionsHomeRows } from "./home";

// ── DataWidgetRow manifest ─────────────────────────────────────────────

export const predictionsDataWidget: DataWidgetManifest = {
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
      "Browse Trending by category, or flip lenses: Movers, Closing soon, Resolved.",
      "Star any market — stars build your watchlist and take over the ticker.",
      "Click any outcome for its price history, alerts, and the Kalshi link.",
    ],
  },
  FeedTab: PredictionsFeedTab,
  HomeRows: PredictionsHomeRows,
};

// ── Constants ────────────────────────────────────────────────────

/** DataWidgetRow accent — kept in sync with `predictionsDataWidget.hex` and the
 *  marketplace catalog color (v1.1.5 unified the old indigo/teal split). */
const PREDICTIONS_HEX = "#1fc9a0";

/** Events shown per category section before "View all" takes over. */
const SECTION_PREVIEW_COUNT = 6;

type FeedView = "markets" | "positions";

/** Markets / My Positions — options for the Segmented view switch. */
const VIEW_OPTIONS: SegmentedOption<FeedView>[] = [
  { value: "markets", label: "Markets", icon: LineChart },
  { value: "positions", label: "Positions", icon: Wallet },
];

/** Ticker fallback when nothing is starred — bar SelectMenu options
 *  (mirrors PredictionsDisplayPrefs.defaultSort minus "alpha"). */
const TICKER_FALLBACKS: {
  value: NonNullable<PredictionsDisplayPrefs["defaultSort"]>;
  label: string;
}[] = [
  { value: "trending", label: "Trending" },
  { value: "movers", label: "Movers" },
  { value: "closing", label: "Closing soon" },
];

/** Pre-v1.1.5 server-side config keys (see the migration effect). */
interface LegacyPredictionsConfig {
  categories?: string[];
  favorites?: string[];
}

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
  { value: "resolved", label: "Resolved", icon: CheckCircle2 },
  { value: "watchlist", label: "Watchlist", icon: Star },
];

// ── FeedTab ──────────────────────────────────────────────────────

function PredictionsFeedTab({ mode: callerMode, feedContext }: FeedTabProps) {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.widgetDisplay.predictions;

  // Density is caller-driven only (the per-widget feedDensity pref was
  // deleted in the 2026-07-17 settings unification — feeds render
  // comfort; the ticker owns the one density concept).
  const mode = callerMode;

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

  // ── One-time legacy config migration (v1.1.5) ─────────────────
  // Pre-v1.1.5 configs carried `categories` (server-side universe filter)
  // and `favorites` (hidden watchlist mirror). Import favorites into the
  // local stars, then clear BOTH keys in one write so the server stops
  // narrowing this user's payload. Lives on the FEED mount (moved off the
  // Configure page) so it reaches users who never open Configure — a
  // lingering server `categories` filter would silently hide markets.
  const queryClient = useQueryClient();
  const widgetRow = useMemo(
    () =>
      (dashboard?.widgets ?? []).find(
        (ch) => ch.widget_type === "predictions",
      ),
    [dashboard?.widgets],
  );
  const migratedRef = useRef(false);
  useEffect(() => {
    // Wait for the dashboard row — running before it loads would burn the
    // once-per-mount guard on a no-op.
    if (migratedRef.current || !widgetRow) return;
    migratedRef.current = true;

    const config = (widgetRow.config ?? {}) as LegacyPredictionsConfig;
    const favorites = Array.isArray(config.favorites) ? config.favorites : [];
    const categories = Array.isArray(config.categories) ? config.categories : [];
    if (favorites.length === 0 && categories.length === 0) return;

    // 1) Absorb legacy pins/mirror into the local watchlist.
    if (favorites.length > 0) {
      const current = getWatchlist();
      const merged = Array.from(new Set([...current, ...favorites]));
      const imported = merged.length - current.length;
      if (imported > 0) {
        saveWatchlist(merged);
        setWatchlist(merged);
        toast.success(
          `Moved ${imported} pinned market${imported === 1 ? "" : "s"} to your watchlist`,
          { description: "Stars are the one list now — managed right here." },
        );
      }
    }

    // 2) Clear both legacy keys in a single write (two racing updates
    //    would each send a stale merged config and resurrect the other
    //    key). The API keeps honoring these fields for old clients; this
    //    client simply stops using them.
    void dataWidgetsApi
      .update(widgetRow.widget_type, {
        config: { ...(widgetRow.config ?? {}), categories: [], favorites: [] },
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .catch(() => {
        // Non-fatal: the server filter just lingers until the next visit
        // retries. The feed itself is fully functional either way.
        migratedRef.current = false;
      });
  }, [widgetRow, queryClient]);

  // ── Lens + category filter + market-detail modal ──────────────
  const [lens, setLens] = useState<PredictionsLens>("trending");
  // Multi-select category filter (empty = all). "View all" on a section
  // focuses exactly that category; the menu toggles combine freely.
  const [selectedCats, toggleCat, clearCats] = useSetToggle();
  const [detailMarket, setDetailMarket] = useState<Prediction | null>(null);
  const openDetail = useCallback((m: Prediction) => setDetailMarket(m), []);
  const closeDetail = useCallback(() => setDetailMarket(null), []);

  const focusCategory = useCallback(
    (c: string) => {
      clearCats();
      toggleCat(c);
    },
    [clearCats, toggleCat],
  );

  const pickLens = useCallback(
    (next: PredictionsLens) => {
      setLens(next);
      clearCats();
    },
    [clearCats],
  );

  // Resolved-today recap (trailing 24h), refreshed as `now` ticks.
  const resolvedToday = useMemo(
    () => selectResolvedToday(markets, now),
    [markets, now],
  );

  // Starred tickers with no live row — they left the curated set, so the
  // lens grid can't show them. A quiet list under the Watchlist lens keeps
  // them legible (and removable) instead of silently shrinking the stars.
  const staleStars = useMemo(
    () => watchlist.filter((t) => !markets.some((m) => m.ticker === t)),
    [watchlist, markets],
  );
  const staleTitleFor = useCallback(
    (ticker: string): string => {
      const entry = catalog?.find((c) => c.ticker === ticker);
      return entry?.title || ticker;
    },
    [catalog],
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
  // `now` only anchors the resolved lens's 24h window — freeze it for the
  // other lenses so their memo doesn't churn on every 1s tick.
  const lensNow = lens === "resolved" ? now : 0;
  const lensItems = useMemo(
    () => selectLens(markets, lens, watchedSet, lensNow),
    [markets, lens, watchedSet, lensNow],
  );

  const focusedItems = useMemo(
    () =>
      selectedCats.size > 0
        ? lensItems.filter((m) => selectedCats.has(categoryOf(m)))
        : lensItems,
    [lensItems, selectedCats, categoryOf],
  );

  const events = useMemo(() => groupByEvent(focusedItems), [focusedItems]);
  const isComfort = mode === "comfort";

  // ── Market search (client-side only — see search.ts) ─────────
  // The dashboard payload IS the full universe, so matching is pure and
  // synchronous per keystroke: no debounce, no network, no loading state.
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Roving selection for ↑/↓ + Enter, indexing into render order.
  const [selIdx, setSelIdx] = useState(-1);

  const eventCategoryOf = useCallback(
    (ev: PredictionEvent): string | undefined =>
      ev.outcomes[0] ? categoryOf(ev.outcomes[0]) : ev.category,
    [categoryOf],
  );

  // null = search inactive (empty query, or compact density has no bar).
  const hits = useMemo(
    () => (isComfort ? searchEvents(query, events, eventCategoryOf) : null),
    [isComfort, query, events, eventCategoryOf],
  );
  const searching = hits !== null;

  const shownEvents = useMemo(
    () => (hits ? events.filter((ev) => hits.has(ev.eventTicker)) : events),
    [events, hits],
  );

  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    setSelIdx(-1);
  }, []);

  // Browse mode: Trending with no category filter = Kalshi-style sections.
  const sections: CategorySection[] | null = useMemo(
    () =>
      isComfort && lens === "trending" && selectedCats.size === 0
        ? groupEventsByCategory(shownEvents)
        : null,
    [isComfort, lens, selectedCats, shownEvents],
  );

  // ── Pagination (flat modes only — sections self-cap) ─────────
  const containerRef = useRef<HTMLDivElement>(null);

  const renderTotal = isComfort ? shownEvents.length : focusedItems.length;
  const { visible, footer } = useLoadMore(
    renderTotal,
    [lens, selectedCats, watchlist, query],
    "px-3 pb-3",
  );
  const pageItems = focusedItems.slice(0, visible);
  const pageEvents = shownEvents.slice(0, visible);

  const latestUpdated = useMemo(
    () => latestTimestamp(lensItems, (m) => m.updated_at),
    [lensItems],
  );

  // Live version of the open market (so the modal reflects price ticks).
  const liveDetail = useMemo(
    () =>
      detailMarket
        ? markets.find((m) => m.id === detailMarket.id) ?? detailMarket
        : null,
    [detailMarket, markets],
  );

  // Every leg of the open market's event, price-sorted — the detail view's
  // "All outcomes" list (B2). Dropped-but-unresolved siblings are excluded
  // (their frozen prices are the stale-data bug v1.1.5 killed).
  const detailSiblings = useMemo(() => {
    if (!liveDetail?.event_ticker) return [];
    return outcomesByPrice(
      markets.filter(
        (m) =>
          m.event_ticker === liveDetail.event_ticker &&
          (m.in_sweep !== false || isResolved(m)),
      ),
    );
  }, [liveDetail, markets]);

  // ── Filter bar state (B4/B5) ──────────────────────────────────
  // ALL categories in the payload (live + resolved), NOT the current
  // lens's subset — the selector's options must not reshuffle when the
  // user flips between Trending/Closing/Resolved. A category empty under
  // the current lens just shows the empty state. Alphabetical.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of markets) {
      if (m.in_sweep !== false || isResolved(m)) set.add(categoryOf(m));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [markets, categoryOf]);

  // ── View switcher (Markets / My Positions) ───────────────────
  // Only on the full-size Source page (comfort). The compact Home preview
  // stays a pure markets list. "My Positions" is desktop-only (keychain).
  const [view, setView] = useState<FeedView>("markets");
  const showSwitcher = mode === "comfort" && isKalshiAvailable();

  // ── Search keyboard support ───────────────────────────────────
  // Render-order list of matched events for ↑/↓ + Enter. Sections show
  // every match while searching, so section order IS the nav order.
  const navEvents = useMemo(() => {
    if (!searching) return [];
    return sections ? sections.flatMap((s) => s.events) : pageEvents;
  }, [searching, sections, pageEvents]);

  const navIndex = useMemo(
    () => new Map(navEvents.map((ev, i) => [ev.eventTicker, i])),
    [navEvents],
  );

  // "/" focuses search from anywhere in the widget (unless typing, or
  // the market-detail modal is open).
  useSlashFocus(searchInputRef, isComfort && view === "markets");

  // Keep the keyboard-selected card in view.
  useEffect(() => {
    if (selIdx < 0) return;
    containerRef.current
      ?.querySelector(`[data-nav-idx="${selIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selIdx]);

  // Roving ↑/↓ + Enter while searching; two-stage Escape lives inside
  // SearchBox.
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!searching || navEvents.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelIdx((i) => Math.min(i + 1, navEvents.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const ev = navEvents[selIdx >= 0 && selIdx < navEvents.length ? selIdx : 0];
        // Same landing as a card click: the top-priced leg.
        const target = ev ? outcomesByPrice(ev.outcomes)[0] : undefined;
        if (target) openDetail(target);
      }
    },
    [searching, navEvents, selIdx, openDetail],
  );

  if (showSwitcher && view === "positions") {
    return (
      <div className="flex min-h-full flex-col">
        {/* Sticky so the way back to Markets survives scrolling. */}
        <div className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b border-edge/30 bg-surface px-3 py-1.5">
          <Segmented
            ariaLabel="Predictions view"
            value={view}
            onChange={setView}
            options={VIEW_OPTIONS}
          />
        </div>
        <div className="flex flex-1 flex-col">
          <MyPositionsPanel markets={markets} hex={PREDICTIONS_HEX} />
        </div>
      </div>
    );
  }

  // ── Empty state (no data at all) ─────────────────────────────
  if (markets.length === 0) {
    return (
      <div className="flex min-h-full flex-col">
        {showSwitcher && (
          <div className="flex shrink-0 items-center gap-2 border-b border-edge/30 bg-surface px-3 py-1.5">
            <Segmented
              ariaLabel="Predictions view"
              value={view}
              onChange={setView}
              options={VIEW_OPTIONS}
            />
          </div>
        )}
        <div className="flex flex-1 flex-col justify-center">
          <EmptyWidgetState
            refreshing={Boolean(feedContext.__refreshing)}
            icon={TrendingUp}
            noun="markets"
            hasConfig={!!feedContext.__hasConfig}
            dashboardLoaded={!!feedContext.__dashboardLoaded}
            loadingNoun="odds"
            actionHint="manage your watchlist"
          />
        </div>
      </div>
    );
  }

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll. `overflow-y-auto` here created a never-scrolling scrollport
    // that swallowed the bar's `sticky` in the real app — the bar only
    // pins against the ancestor that actually scrolls. (RSS uses the same
    // page-scroll structure.)
    <div ref={containerRef} className="relative flex min-h-full flex-col">
      {/* ONE control bar: view switcher (segmented, Tauri-only) · lens
          pills + category select · search · freshness. WidgetBar owns the
          sticky @container shell and the pinned-elevation sentinel. At
          narrow widget widths the lens pills + category select collapse
          into a single Filter button so nothing clips (B4/B5). */}
      {isComfort && (
        <WidgetBar>
          {showSwitcher && (
            <>
              <Segmented
                ariaLabel="Predictions view"
                value={view}
                onChange={setView}
                options={VIEW_OPTIONS}
              />
              <BarDivider />
            </>
          )}

          {/* Wide: open lens pills. Counts live in the filter menu and
              section headers — pills stay quiet (de-crowd pass). The
              @5xl threshold collapses BEFORE the row runs out of room —
              pills must never render cut off. */}
          <div className="scrollbar-none hidden min-w-0 items-center gap-1 overflow-x-auto @5xl:flex">
            {LENSES.map((l) => {
              const Icon = l.icon;
              const active = lens === l.value && selectedCats.size === 0;
              return (
                <BarPill key={l.value} active={active} onClick={() => pickLens(l.value)}>
                  {Icon && (
                    <Icon
                      size={12}
                      className={l.value === "watchlist" && active ? "fill-current" : ""}
                    />
                  )}
                  {l.label}
                </BarPill>
              );
            })}
          </div>

          {/* Narrow: everything above collapses into one Filter button. */}
          <div className="@5xl:hidden">
            <FilterMenu
              lens={lens}
              onPickLens={pickLens}
              watchlistCount={watchlist.length}
              resolvedCount={resolvedToday.length}
              categories={categories}
              selectedCats={selectedCats}
              onToggleCategory={toggleCat}
              onClearCategories={clearCats}
            />
          </div>

          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            {/* Category rides with the other narrowing controls (search)
                so the lens row keeps its breathing room. */}
            <span className="hidden @5xl:block">
              <MultiSelectMenu
                options={categories}
                selected={Array.from(selectedCats)}
                onToggle={toggleCat}
                onClear={clearCats}
                noun="categories"
                ariaLabel="Filter by category"
              />
            </span>
            <SearchBox
              inputRef={searchInputRef}
              query={query}
              onQueryChange={changeQuery}
              onKeyDown={onSearchKeyDown}
              resultCount={searching ? shownEvents.length : null}
              ariaLabel="Search markets"
              noun="markets"
            />
            {latestUpdated && (
              <span className="hidden @xl:block">
                <FreshnessPill lastUpdated={latestUpdated} label="odds" />
              </span>
            )}
            <SelectMenu
              ariaLabel="Ticker fallback when nothing is starred"
              prefix="Ticker"
              value={dp.defaultSort ?? "trending"}
              options={TICKER_FALLBACKS}
              onChange={(v) =>
                onPrefsChange({
                  ...prefs,
                  widgetDisplay: {
                    ...prefs.widgetDisplay,
                    predictions: { ...dp, defaultSort: v },
                  },
                })
              }
            />
          </div>
        </WidgetBar>
      )}


      {/* Market browse / grids */}
      {renderTotal === 0 ? (
        searching ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
            <Search size={22} className="text-fg-4" />
            <p className="text-[12px] text-fg-3">
              No markets match{" "}
              <span className="font-medium text-fg-2">“{query.trim()}”</span>
            </p>
            <p className="text-[11px] text-fg-4">
              Check the spelling, or try a shorter word.
            </p>
            <button
              onClick={() => {
                changeQuery("");
                searchInputRef.current?.focus();
              }}
              className="mt-1 px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
            >
              Clear search
            </button>
          </div>
        ) : lens === "watchlist" ? (
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
            <p className="text-[12px] text-fg-3">
              {lens === "resolved"
                ? "Nothing settled in the last 24 hours"
                : "Nothing here right now"}
            </p>
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
            // rounded-md is invisible here — it only feeds the header
            // button's inherited focus-ring radius (global focus rule).
            <div key={section.category} className="flex flex-col rounded-md">
              {/* Whole header row is the "View all" target (B1) — same
                  hover treatment as the cards. mx/px split keeps the label
                  x-aligned with card content (12px) while the hover surface
                  stays inset. */}
              <button
                type="button"
                onClick={() => focusCategory(section.category)}
                aria-label={`View all ${section.category} markets`}
                className="group mx-1.5 mb-1 mt-1.5 flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-hover/70"
              >
                <span
                  data-section-title
                  role="heading"
                  aria-level={3}
                  className="text-ui-section font-semibold uppercase tracking-wide text-fg-3 transition-colors group-hover:text-fg-2"
                >
                  {section.category}
                </span>
                <span className="font-mono text-ui-chip tabular-nums text-fg-4">
                  {section.events.length}
                </span>
                {!searching && (
                  <span className="ml-auto inline-flex items-center gap-0.5 text-ui-meta font-medium text-accent opacity-80 transition-opacity group-hover:opacity-100">
                    View all
                    <ChevronRight size={13} />
                  </span>
                )}
              </button>
              <div className="grid grid-cols-1 gap-2 px-3 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {/* While searching every match shows (no preview cap) and
                    leavers animate out. */}
                <AnimatePresence initial={false} mode="popLayout">
                  {section.events
                    .slice(0, searching ? undefined : SECTION_PREVIEW_COUNT)
                    .map((ev) => (
                      <CardCell
                        key={ev.eventTicker}
                        navIdx={navIndex.get(ev.eventTicker)}
                        selected={selIdx >= 0 && navIndex.get(ev.eventTicker) === selIdx}
                      >
                        <EventCard
                          event={ev}
                          category={categoryOf(ev.outcomes[0])}
                          now={now}
                          watchedSet={watchedSet}
                          onToggleWatch={toggleWatch}
                          onOpenDetail={openDetail}
                          hit={hits?.get(ev.eventTicker)}
                        />
                      </CardCell>
                    ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
          <div className="h-2" />
        </div>
      ) : (
        // ── Flat mode: other lenses / category focus / compact ────
        <>
          <div
            className={clsx(
              isComfort
                ? "grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                : "grid grid-cols-1 gap-px bg-edge",
            )}
          >
            {!isComfort ? (
              pageItems.map((market) => (
                <MarketItem
                  key={market.id}
                  market={market}
                  now={now}
                />
              ))
            ) : (
              <AnimatePresence initial={false} mode="popLayout">
                {pageEvents.map((ev) => (
                  <CardCell
                    key={ev.eventTicker}
                    navIdx={navIndex.get(ev.eventTicker)}
                    selected={selIdx >= 0 && navIndex.get(ev.eventTicker) === selIdx}
                  >
                    {lens === "resolved" ? (
                      <ResolvedCard
                        event={ev}
                        category={categoryOf(ev.outcomes[0])}
                        now={now}
                        watchedSet={watchedSet}
                        onToggleWatch={toggleWatch}
                        onOpenDetail={openDetail}
                        hit={hits?.get(ev.eventTicker)}
                      />
                    ) : (
                      <EventCard
                        event={ev}
                        category={categoryOf(ev.outcomes[0])}
                        now={now}
                        watchedSet={watchedSet}
                        onToggleWatch={toggleWatch}
                        onOpenDetail={openDetail}
                        hit={hits?.get(ev.eventTicker)}
                      />
                    )}
                  </CardCell>
                ))}
              </AnimatePresence>
            )}
          </div>
          {footer}
        </>
      )}

      {/* Stale stars — starred markets that left the curated set. The
          lens grid can't render them (no live row), so a quiet list keeps
          them visible and removable. */}
      {isComfort && lens === "watchlist" && staleStars.length > 0 && (
        <div className="flex flex-col gap-1 px-3 pb-3 pt-1">
          <span className="text-ui-chip font-medium uppercase tracking-wide text-fg-4">
            No longer tracked
          </span>
          {staleStars.map((ticker) => (
            <div
              key={ticker}
              className="flex items-center gap-2 rounded-lg border border-edge/30 bg-base-100/40 px-2.5 py-1.5"
            >
              <Star size={12} className="shrink-0 fill-current text-fg-4" />
              <span
                className="min-w-0 flex-1 truncate text-ui-meta text-fg-4"
                title={staleTitleFor(ticker)}
              >
                {staleTitleFor(ticker)}
              </span>
              <button
                type="button"
                onClick={() => toggleWatch(ticker)}
                aria-label={`Remove ${ticker} from watchlist`}
                className="shrink-0 rounded-md px-2 py-0.5 text-ui-chip font-medium text-fg-4 transition-colors hover:bg-error/10 hover:text-error cursor-pointer"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Market-detail modal */}
      {liveDetail && (
        <MarketDetail
          market={liveDetail}
          siblings={detailSiblings}
          onSelectMarket={openDetail}
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

// ── Filter bar controls (B4/B5) ──────────────────────────────────

/** Narrow-width collapse of the lens pills + category menu: one Filter
 *  button (with an active-filter count badge) opening a compact menu. The
 *  wide bar hides this via container queries and vice versa. */
function FilterMenu({
  lens,
  onPickLens,
  watchlistCount,
  resolvedCount,
  categories,
  selectedCats,
  onToggleCategory,
  onClearCategories,
}: {
  lens: PredictionsLens;
  onPickLens: (l: PredictionsLens) => void;
  watchlistCount: number;
  resolvedCount: number;
  categories: string[];
  selectedCats: Set<string>;
  onToggleCategory: (c: string) => void;
  onClearCategories: () => void;
}) {
  const activeCount = (lens !== "trending" ? 1 : 0) + selectedCats.size;

  return (
    <FilterMenuShell badgeCount={activeCount}>
      <MenuHeading>View</MenuHeading>
      {LENSES.map((l) => (
        <MenuRow
          key={l.value}
          selected={lens === l.value}
          onClick={() => onPickLens(l.value)}
          role="menuitemradio"
        >
          {l.label}
          {l.value === "watchlist" && watchlistCount > 0
            ? ` ${watchlistCount}`
            : l.value === "resolved" && resolvedCount > 0
              ? ` ${resolvedCount}`
              : ""}
        </MenuRow>
      ))}
      <MenuHeading>Category</MenuHeading>
      <MenuRow
        selected={selectedCats.size === 0}
        onClick={onClearCategories}
        role="menuitemradio"
      >
        All categories
      </MenuRow>
      {categories.map((c) => (
        <MenuRow
          key={c}
          selected={selectedCats.has(c)}
          onClick={() => onToggleCategory(c)}
          role="menuitemcheckbox"
        >
          {c}
        </MenuRow>
      ))}
    </FilterMenuShell>
  );
}

/** Grid cell for a card: exit animation (search filter), keyboard-selection
 *  ring, and the data-nav-idx hook scrollIntoView targets. */
function CardCell({
  navIdx,
  selected,
  children,
}: {
  navIdx?: number;
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.12 }}
      data-nav-idx={navIdx}
      className={clsx(
        "h-full min-w-0 rounded-lg",
        selected && "ring-2 ring-accent",
      )}
    >
      {children}
    </motion.div>
  );
}

/** Text with matched substrings wrapped in a subtle accent mark. */
function Highlight({
  text,
  ranges,
}: {
  text: string;
  ranges?: MatchRange[];
}) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start >= text.length) break;
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(
      <mark
        key={start}
        className="rounded-[2px] bg-accent/25 text-inherit"
      >
        {text.slice(start, Math.min(end, text.length))}
      </mark>,
    );
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

// ── ResolvedCard (the Resolved lens) ─────────────────────────────
//
// Same card anatomy as EventCard — header (category · settled-time + ★),
// dominant clamped title, outcome rows, quiet footer — but purpose-fit
// content for settled markets: each leg carries its RESULT badge instead
// of a live probability pill, and the footer shows total volume (24h
// volume decays to noise once trading stops).

interface ResolvedCardProps {
  event: PredictionEvent;
  category?: string;
  now: number;
  watchedSet: Set<string>;
  onToggleWatch: (ticker: string) => void;
  onOpenDetail: (market: Prediction) => void;
  /** Search-match highlight ranges, present only while searching. */
  hit?: EventSearchHit;
}

function resolvedStamp(p: Prediction | undefined): string | undefined {
  return p?.settled_at ?? p?.updated_at ?? p?.close_time ?? undefined;
}

const ResolvedCard = memo(function ResolvedCard({
  event,
  category,
  now,
  watchedSet,
  onToggleWatch,
  onOpenDetail,
  hit,
}: ResolvedCardProps) {
  const lead = event.outcomes[0];
  const watched = lead ? watchedSet.has(lead.ticker) : false;
  const stamp = resolvedStamp(lead);
  const settledLabel = stamp ? `Settled ${relativeTime(stamp, now)}` : "Settled";
  const showHeaderCategory = Boolean(category);

  const metaGroup = (
    <span className="flex shrink-0 items-center gap-1">
      <span className="font-mono text-ui-chip tabular-nums text-fg-3">
        {settledLabel}
      </span>
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
            "flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer hover:bg-surface-hover",
            watched ? "text-amber-400" : "text-fg-4 hover:text-fg-2",
          )}
        >
          <Star size={13} className={watched ? "fill-current" : ""} />
        </button>
      )}
    </span>
  );

  const openCard = () => {
    if (lead) onOpenDetail(lead);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${event.title}`}
      onClick={openCard}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openCard();
        }
      }}
      className={clsx(FEED_CARD, FEED_CARD_INTERACTIVE, "flex h-full flex-col gap-1.5")}
    >
      {showHeaderCategory && (
        <div className="flex h-5 items-center justify-between gap-2">
          <span className="truncate text-ui-chip font-medium uppercase tracking-wide text-fg-4">
            <Highlight text={category!} ranges={hit?.categoryRanges} />
          </span>
          {metaGroup}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <span className="text-ui-title line-clamp-2 sm:min-h-10">
          <Highlight text={event.title} ranges={hit?.titleRanges} />
        </span>
        {!showHeaderCategory && metaGroup}
      </div>

      {/* Legs with their results — no synthetic No here; settlement is
          already the answer, one row per resolved leg. */}
      <div className="flex flex-col gap-1">
        {event.outcomes.map((m) => {
          const result = (m.result ?? "").toLowerCase();
          const won = result === "yes";
          const lost = result === "no";
          const legLabel = outcomeLabel(m);
          return (
            <button
              key={m.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail(m);
              }}
              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-edge/30 bg-base-100/40 px-2 py-1.5 text-left transition-colors hover:border-edge/60 hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1 truncate text-ui-meta text-fg-2">
                <Highlight text={legLabel} ranges={hit?.outcomeRanges[m.id]} />
              </span>
              <span
                className={clsx(
                  "inline-flex min-w-12 items-center justify-center rounded-full px-1.5 py-px font-mono text-ui-chip font-bold uppercase",
                  won && "bg-up/10 text-up",
                  lost && "bg-down/10 text-down",
                  !won && !lost && "bg-surface-2 text-fg-3",
                )}
              >
                {won ? "Yes" : lost ? "No" : "Settled"}
              </span>
            </button>
          );
        })}
      </div>

      {event.volume > 0 && (
        <div className="mt-auto pt-0.5 font-mono text-ui-chip tabular-nums text-fg-3">
          Vol {formatCompactNumber(event.volume)}
          <span className="text-fg-4"> · total</span>
        </div>
      )}
    </div>
  );
});

// ── MarketItem (compact density only) ────────────────────────────
//
// The comfort card path is owned by EventCard; compact mode (Home
// preview density) renders one dense row per market. The v1.1.4
// comfort branch of this component was dead code and is deleted.

interface MarketItemProps {
  market: Prediction;
  /** Shared "now" from `useNow()` in the parent list — drives the countdown. */
  now: number;
}

const MarketItem = memo(function MarketItem({
  market,
  now,
}: MarketItemProps) {
  const delta = priceDelta(market);
  const isUp = delta > 0;
  const isDown = delta < 0;

  const flash = usePriceFlash(market.yes_price);

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
      {/* Fixed slot; empty (not "—") when unmoved, matching card rows. */}
      <span className={clsx("tabular-nums min-w-[40px]", dirColor)}>
        {delta !== 0 ? formatDelta(delta) : ""}
      </span>
      <span className="text-fg-2 truncate flex-1 font-sans">
        {market.event_title || market.title}
      </span>
      {market.volume != null && (
        <span className="text-fg-3 tabular-nums shrink-0">
          {formatCompactNumber(market.volume_24h ?? market.volume)}
        </span>
      )}
      {/* Terse countdown in a reserved slot (no tick reflow). */}
      {countdown && (
        <span className="inline-block min-w-[4ch] shrink-0 text-right tabular-nums text-fg-3">
          {countdown}
        </span>
      )}
    </a>
  );
}, (prev, next) =>
  // `now` must trigger a re-render while the close-time countdown is
  // visible so it advances on every tick. When there is no close time
  // the tick is irrelevant — skip it to avoid churning the whole list.
  (!next.market.close_time || prev.now === next.now) &&
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

// ── EventCard (v1.1.5 polish pass) ──────────────────────────────
//
// Card anatomy (top to bottom) — every row has a left anchor, metadata
// never floats alone (Kalshi hierarchy, Scrollr skin):
//   1. Header: muted uppercase category LEFT · countdown + ★ RIGHT.
//      With the category hidden by prefs, the countdown/★ group moves
//      into the title row so no row is right-aligned metadata only.
//   2. Title: the ONE focal point (text-ui-title), clamped to two
//      lines with the two-line height reserved so card heights stay
//      uniform across a row regardless of title length.
//   3. Exactly two outcome rows (synthetic No fills single-leg events).
//   4. Footer: 24h volume, left-aligned, quiet mono.
// The star always stars the LEAD leg; leg-level starring lives in
// MarketDetail.

interface EventCardProps {
  event: PredictionEvent;
  category?: string;
  now: number;
  watchedSet: Set<string>;
  onToggleWatch: (ticker: string) => void;
  onOpenDetail: (market: Prediction) => void;
  /** Search-match highlight ranges, present only while searching. */
  hit?: EventSearchHit;
}

const EventCard = memo(function EventCard({
  event,
  category,
  now,
  watchedSet,
  onToggleWatch,
  onOpenDetail,
  hit,
}: EventCardProps) {
  const lead = event.outcomes[0];
  const watched = lead ? watchedSet.has(lead.ticker) : false;
  // Time indicator (B3) — evaluated against the event's close time.
  const ind: TimeIndicator = lead
    ? timeIndicator(
        { ...lead, close_time: event.closeTime ?? lead.close_time },
        now,
      )
    : { kind: "none" };
  const showHeaderCategory = Boolean(category);
  const showTime = ind.kind !== "none";

  // Top outcomes by price + the hidden count (B2). Detail shows them all.
  const { visible, extra } = cardOutcomes(event.outcomes);
  // Card click lands on the top-priced leg — the first row the user reads
  // (the ★ still anchors to the rank-1 lead; rank ≠ price on some events).
  const openCard = () => {
    const target = visible[0] ?? lead;
    if (target) onOpenDetail(target);
  };

  const metaGroup = (
    <span className="flex shrink-0 items-center gap-1">
      {showTime && <TimeBadge ind={ind} />}
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
            "flex h-5 w-5 items-center justify-center rounded transition-colors cursor-pointer hover:bg-surface-hover",
            watched ? "text-amber-400" : "text-fg-4 hover:text-fg-2",
          )}
        >
          <Star size={13} className={watched ? "fill-current" : ""} />
        </button>
      )}
    </span>
  );

  return (
    // Whole card opens the market detail (B1); the outcome rows, star and
    // "+N more" are their own targets via stopPropagation. role=button (not
    // <button>) because interactive children live inside.
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${event.title}`}
      onClick={openCard}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // inner controls handle their own keys
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openCard();
        }
      }}
      className={clsx(FEED_CARD, FEED_CARD_INTERACTIVE, "flex h-full flex-col gap-1.5")}
    >
      {/* Header row — category anchors the left so the countdown/star
          never sit alone. */}
      {showHeaderCategory && (
        <div className="flex h-5 items-center justify-between gap-2">
          <span className="truncate text-ui-chip font-medium uppercase tracking-wide text-fg-4">
            <Highlight text={category!} ranges={hit?.categoryRanges} />
          </span>
          {metaGroup}
        </div>
      )}

      {/* Title row — the focal point. The two-line slot (20px line height
          × 2) is reserved only at multi-column widths, where it keeps
          neighbors row-aligned; single-column cards hug their title. */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-ui-title line-clamp-2 sm:min-h-10">
          <Highlight text={event.title} ranges={hit?.titleRanges} />
        </span>
        {!showHeaderCategory && metaGroup}
      </div>

      {/* Outcome legs, highest price first, capped at two (B2). ANY
          single-leg event gets a synthetic No row — a lone market's No
          side is always its complement (100 - yes) — mirroring Kalshi's
          own Yes/No pair instead of leaving one row stranded. */}
      <div className="flex flex-col gap-1">
        {visible.map((m) => (
          <OutcomeRow
            key={m.id}
            market={m}
            onOpenDetail={onOpenDetail}
            ranges={hit?.outcomeRanges[m.id]}
          />
        ))}
        {event.outcomes.length === 1 && (
          <OutcomeRow
            market={event.outcomes[0]}
            onOpenDetail={onOpenDetail}
            syntheticNo
          />
        )}
        {extra > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openCard();
            }}
            className="self-start rounded-md px-2 py-0.5 text-ui-chip font-medium text-accent transition-colors hover:bg-accent/10 cursor-pointer"
          >
            +{extra} more
          </button>
        )}
      </div>

      {/* Footer: 24h volume, quiet and left-anchored. mt-auto pins it to
          the card bottom so footers align across a row. */}
      {(event.volume24h > 0 || event.volume > 0) && (
        <div className="mt-auto pt-0.5 font-mono text-ui-chip tabular-nums text-fg-3">
          Vol {formatCompactNumber(event.volume24h || event.volume)}
          <span className="text-fg-4"> · 24h</span>
        </div>
      )}
    </div>
  );
});

/** The card's time indicator (B3): a reserved-width countdown
 *  ("Closes 5d") or a muted "Closed". Reserved widths (ch, mono) mean the
 *  1s tick can shorten the text without ever reflowing the card. */
function TimeBadge({ ind }: { ind: TimeIndicator }) {
  if (ind.kind === "none") return null;
  if (ind.kind === "closed") {
    return (
      <span className="font-mono text-ui-chip tabular-nums text-fg-4">Closed</span>
    );
  }
  return (
    <span className="inline-block min-w-[11ch] whitespace-nowrap text-right font-mono text-ui-chip tabular-nums text-fg-3">
      {ind.label}
    </span>
  );
}

/** One outcome leg inside an EventCard — label, delta, probability pill.
 *
 *  The right rail is two FIXED columns (delta slot + fixed-width pill) so
 *  numbers share a column edge on every row of every card — a row without
 *  movement reserves the delta slot empty rather than collapsing it.
 *  Movement is expressed ONLY there (no tinted row borders: a conditional
 *  border shifted the label 2px and made siblings misalign).
 *
 *  `syntheticNo` renders the implicit No side of a binary market
 *  (100 - yes, inverted delta) — it's the same market, so the star and
 *  detail click belong to the Yes row / card. */
function OutcomeRow({
  market,
  onOpenDetail,
  syntheticNo = false,
  ranges,
}: {
  market: Prediction;
  onOpenDetail: (market: Prediction) => void;
  syntheticNo?: boolean;
  /** Search-match ranges within the (non-synthetic) leg label. */
  ranges?: MatchRange[];
}) {
  const rawDelta = priceDelta(market);
  const delta = syntheticNo ? -rawDelta : rawDelta;
  const isUp = delta > 0;
  const isDown = delta < 0;

  // Binary events read best as "Yes" rows; multi-outcome events name
  // their leg ("France", "Atlanta"). The synthetic row is always "No".
  // outcomeLabel is shared with the search matcher so highlight offsets
  // always line up with what's rendered.
  const legLabel = syntheticNo ? "No" : outcomeLabel(market);

  // The No side of a binary market is the complement of yes_price.
  const shownPct = syntheticNo
    ? Math.max(0, Math.min(100, 100 - (market.yes_price ?? 0)))
    : market.yes_price;

  return (
    <button
      type="button"
      onClick={(e) => {
        // The whole card is a click target now (B1) — keep the row its own.
        e.stopPropagation();
        onOpenDetail(market);
      }}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-edge/30 bg-base-100/40 px-2 py-1.5 text-left transition-colors hover:border-edge/60 hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1 truncate text-ui-meta text-fg-2">
        <Highlight text={legLabel} ranges={syntheticNo ? undefined : ranges} />
      </span>
      <span
        className={clsx(
          "w-9 shrink-0 text-right font-mono text-ui-chip font-semibold tabular-nums",
          isUp && "text-up",
          isDown && "text-down",
        )}
      >
        {delta !== 0 ? formatDelta(delta) : ""}
      </span>
      <ProbabilityPill pct={shownPct} delta={delta} size="sm" />
    </button>
  );
}
