/**
 * Finance FeedTab — desktop-native.
 *
 * Renders a grid of trade cards with real-time price updates
 * via the desktop CDC/SSE pipeline. Supports compact and comfort
 * display modes.
 *
 * ONE Kalshi-style control bar (widget-bar primitives): All/Watchlist
 * · sort/category menus · symbol search · freshness.
 * Search is the symbol manager: catalog matches surface inline with
 * Add/Remove actions (the separate Symbols view is gone). Controls remain
 * visible in the shared horizontally scrollable bar at narrow widths.
 */
import { memo, useMemo, useRef, useState, useCallback } from "react";
import { clsx } from "clsx";
import { TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import {
  dashboardQueryOptions,
  financeCatalogOptions,
  financeMarketOptions,
} from "../../api/queries";
import { formatPrice, formatChange, relativeTime } from "../../utils/format";
import EmptyWidgetState from "../../components/EmptyWidgetState";
import { FEED_CARD, FEED_CARD_INTERACTIVE } from "../../components/feedCard";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SearchBox, useSlashFocus } from "../../components/widget-bar/SearchBox";
import { MultiSelectMenu } from "../../components/widget-bar/MultiSelectMenu";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import { useDataWidgetConfig } from "../../hooks/useDataWidgetConfig";
import { useShell } from "../../shell-context";
import { useNow } from "../../hooks/useNow";
import { useCatalog } from "../../hooks/useCatalog";
import { controlTransition } from "../../lib/motion";
import {
  useAutoPagination,
  useSetToggle,
  latestTimestamp,
} from "../feedHooks";
import {
  applyFinancePipeline,
  searchFinanceCatalog,
  selectStockView,
  STOCK_SECTORS,
  type FinanceSortKey,
  type FinanceView,
} from "./view";
import type { Trade, FeedTabProps, DataWidgetManifest } from "../../types";
import type { WidgetId } from "../../api/client";
import { assetClassForWidget } from "../../marketplace";
import { FinanceHomeRows, financeHomeGroups } from "./home";

// ── DataWidgetRow manifest ─────────────────────────────────────────────

export const financeDataWidget: DataWidgetManifest = {
  id: "finance",
  name: "Finance",
  tabLabel: "Finance",
  description: "Real-time stock and crypto prices",
  hex: "#22c55e",
  icon: TrendingUp,
  info: {
    about:
      "Track stocks, ETFs, and cryptocurrencies with live price updates. " +
      "Prices update automatically so your feed always shows the latest.",
    usage: [
      "Open Watchlist, then search the full catalog to add or remove symbols.",
      "Prices update automatically when connected.",
      "Click any symbol to view its chart on Google Finance.",
    ],
  },
  FeedTab: FinanceFeedTab,
  HomeRows: FinanceHomeRows,
  homeGroups: financeHomeGroups,
};

// ── Types ────────────────────────────────────────────────────────

type SortKey = FinanceSortKey;

const VIEW_OPTIONS: SegmentedOption<FinanceView>[] = [
  { value: "all", label: "All" },
  { value: "watchlist", label: "Watchlist" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "alpha", label: "A–Z" },
  { value: "price", label: "Price" },
  { value: "change", label: "% Change" },
  { value: "updated", label: "Last Updated" },
];

interface FinanceWidgetConfig {
  symbols?: string[];
}

// ── FeedTab ──────────────────────────────────────────────────────

function FinanceFeedTab({ mode: callerMode, feedContext, widgetId }: FeedTabProps) {
  // assetClassForWidget is read in the render body, so subscribing is all
  // this needs — the re-render re-reads the current catalog.
  useCatalog();
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.widgetDisplay.finance;

  // Density is caller-driven only (the per-widget feedDensity pref was
  // deleted in the 2026-07-17 settings unification — feeds render
  // comfort; the ticker owns the one density concept).
  const mode = callerMode;
  const isComfort = mode === "comfort";
  const assetClass = widgetId ? assetClassForWidget(widgetId) : undefined;
  const isStocks = assetClass === "stock";
  const useMarketUniverse = assetClass != null && isComfort;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(financeCatalogOptions());
  const { data: marketTrades } = useQuery({
    ...financeMarketOptions(),
    enabled: useMarketUniverse,
  });

  // One subscription for the whole list — passed down to each row so
  // every `TradeItem` re-renders together on the 1s tick. Without this
  // the per-row "Xs ago" labels never advance between price updates.
  const now = useNow();

  const configuredTrades = useMemo(
    () => (dashboard?.data?.finance as Trade[] | undefined) ?? [],
    [dashboard?.data?.finance],
  );

  // Symbol → category lookup from the (full) catalog.
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (catalog) {
      for (const sym of catalog) {
        if (sym.category) {
          map.set(sym.symbol, sym.category);
        }
      }
    }
    return map;
  }, [catalog]);

  // A per-asset-class widget (finance_stocks / finance_crypto) scopes the feed
  // to its class: crypto = the "Crypto" category, stocks = everything else.
  const trades = useMemo(() => {
    const universe = useMarketUniverse
      ? (marketTrades ?? configuredTrades)
      : configuredTrades;
    if (!assetClass) return universe;
    return universe.filter((t) => {
      const isCrypto =
        categoryMap.get(t.symbol) === "Crypto" || t.symbol.includes("/");
      return assetClass === "crypto" ? isCrypto : !isCrypto;
    });
  }, [assetClass, categoryMap, configuredTrades, marketTrades, useMarketUniverse]);

  // Derive meaningful stock-sector counts from the broad market universe.
  const categoryList = useMemo(() => {
    const sectors = new Set<string>(STOCK_SECTORS);
    const counts = new Map<string, number>();
    for (const trade of trades) {
      const cat = categoryMap.get(trade.symbol);
      if (cat && sectors.has(cat)) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [trades, categoryMap]);

  // ── Filter / sort state ──────────────────────────────────────
  const [view, setView] = useState<FinanceView>("all");
  const [sortKey, setSortKey] = useState<SortKey>(() => dp.defaultSort ?? "alpha");

  // Sticky sort (2026-07-17 unification): the bar's sort choice persists
  // as dp.defaultSort — the gear's separate "Default sort" rows are gone,
  // and the ticker keeps following the same pref.
  const pickSort = useCallback(
    (next: SortKey) => {
      setSortKey(next);
      onPrefsChange({
        ...prefs,
        widgetDisplay: {
          ...prefs.widgetDisplay,
          finance: { ...prefs.widgetDisplay.finance, defaultSort: next },
        },
      });
    },
    [prefs, onPrefsChange],
  );
  const [selectedCategories, toggleCategory, clearCategories] = useSetToggle();

  // ── Symbol search (plain substring — no fuzzy matcher here) ──
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchInputRef, isComfort);

  const widgetType = widgetId ?? "finance";
  const {
    error: symbolsError,
    setError: setSymbolsError,
    saving: symbolsSaving,
    updateItems: updateSymbols,
  } = useDataWidgetConfig<string[]>(widgetType, "symbols");
  const widgetRow = (dashboard?.widgets ?? []).find(
    (widget) => widget.widget_type === widgetType,
  );
  const widgetConfig = (widgetRow?.config ?? {}) as FinanceWidgetConfig;
  const trackedSymbols = useMemo(
    () => (Array.isArray(widgetConfig.symbols) ? widgetConfig.symbols : []),
    [widgetConfig.symbols],
  );
  const trackedSet = useMemo(() => new Set(trackedSymbols), [trackedSymbols]);

  const clearAllFilters = useCallback(() => {
    setView("all");
    clearCategories();
    setQuery("");
  }, [clearCategories]);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Data pipeline ────────────────────────────────────────────
  // Stocks scope All to known sectors; Crypto uses the full coin universe.
  // Both share the same All/Watchlist view and persisted sort preference.
  const piped = useMemo(
    () => isStocks && isComfort
      ? selectStockView(trades, {
          view,
          watchlist: trackedSet,
          selectedSectors: selectedCategories,
          categoryMap,
          sortKey,
        })
      : applyFinancePipeline(trades, {
          view,
          selectedCategories,
          categoryMap,
          sortKey,
          watchlist: trackedSet,
        }),
    [
      categoryMap,
      selectedCategories,
      sortKey,
      trackedSet,
      trades,
      view,
      isComfort,
      isStocks,
    ],
  );

  const searchQ = query.trim().toLowerCase();

  const catalogMatches = useMemo(
    () => searchFinanceCatalog(catalog ?? [], searchQ, assetClass),
    [searchQ, catalog, assetClass],
  );
  const shownTrades = useMemo(
    () =>
      searchQ
        ? catalogMatches.flatMap((item) => {
            const trade = trades.find(
              (candidate) => candidate.symbol === item.symbol,
            );
            return trade ? [trade] : [];
          })
        : piped,
    [catalogMatches, piped, searchQ, trades],
  );

  const { visible, footer } = useAutoPagination(
    shownTrades.length,
    [view, selectedCategories, sortKey, searchQ],
    "px-3 py-3 bg-surface border-t border-edge/30",
  );
  const pageItems = shownTrades.slice(0, visible);

  const latestUpdated = useMemo(
    () => latestTimestamp(shownTrades, (t) => t.last_updated),
    [shownTrades],
  );

  const showEmpty = trades.length === 0;

  const addSymbol = useCallback(
    (sym: string) => {
      if (trackedSet.has(sym)) return;
      updateSymbols([...trackedSymbols, sym]);
    },
    [trackedSymbols, trackedSet, updateSymbols],
  );

  const removeSymbol = useCallback(
    (sym: string) => {
      if (!trackedSet.has(sym)) return;
      updateSymbols(trackedSymbols.filter((s) => s !== sym));
    },
    [trackedSymbols, trackedSet, updateSymbols],
  );

  const isWatchlist = view === "watchlist";

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll — an inner scrollport that never scrolls swallows `sticky`
    // (the bar never actually pinned here before this fix).
    <div ref={containerRef} className="relative flex min-h-full flex-col">
      {isComfort && (
        <WidgetBar>
          <Segmented
            value={view}
            options={VIEW_OPTIONS}
            ariaLabel={isStocks ? "Stock view" : "Crypto view"}
            onChange={setView}
          />

          <div className="ml-auto flex min-w-0 shrink items-center gap-2">
            <SelectMenu
              value={sortKey}
              options={SORT_OPTIONS}
              onChange={pickSort}
              ariaLabel="Sort symbols"
              prefix="Sort"
            />
            {isStocks && categoryList.length > 1 && (
              <MultiSelectMenu
                options={categoryList.map((c) => c.name)}
                counts={Object.fromEntries(
                  categoryList.map((c) => [c.name, c.count]),
                )}
                selected={Array.from(selectedCategories)}
                onToggle={toggleCategory}
                onClear={clearCategories}
                noun="categories"
                ariaLabel="Filter by category"
              />
            )}
            <SearchBox
              inputRef={searchInputRef}
              query={query}
              onQueryChange={setQuery}
              resultCount={searchQ ? shownTrades.length : null}
              ariaLabel={`Search ${isStocks ? "stocks" : "crypto"} to manage watchlist`}
              noun="symbols"
              placeholder={`Search ${isStocks ? "stocks" : "crypto"}`}
            />
            {latestUpdated && (
              <span className="hidden @xl:block">
                <FreshnessPill lastUpdated={latestUpdated} label="price" />
              </span>
            )}
          </div>
        </WidgetBar>
      )}

      {/* Config-write error strip (ex-Symbols view). */}
      {symbolsError && (
        <div className="mx-3 mt-2 flex items-center justify-between rounded-lg border border-error/20 bg-error/10 px-3 py-2 text-[11px] text-error">
          <span>{symbolsError}</span>
          <button
            onClick={() => setSymbolsError(null)}
            aria-label="Dismiss error"
            className="cursor-pointer text-error/60 hover:text-error"
          >
            ×
          </button>
        </div>
      )}

      {!searchQ && showEmpty ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyWidgetState
            refreshing={Boolean(feedContext.__refreshing)}
            icon={TrendingUp}
            noun="stocks or crypto"
            hasConfig={!!feedContext.__hasConfig}
            dashboardLoaded={!!feedContext.__dashboardLoaded}
            loadingNoun="prices"
            actionHint="search to add symbols"
            actionLabel={isComfort ? "Search to add symbols" : undefined}
            onConfigure={
              isComfort ? () => searchInputRef.current?.focus() : undefined
            }
          />
        </div>
      ) : shownTrades.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-[12px] text-fg-3">
            {searchQ
              ? `No ${isStocks ? "stocks" : "crypto"} found for “${query.trim()}”`
              : isWatchlist
                ? "Your watchlist is empty — search to add symbols"
                : "No symbols match your filters"}
          </p>
          {!searchQ && (
            <button
              onClick={clearAllFilters}
              className="px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20  cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div
            className={clsx(
              mode === "compact"
                ? "grid grid-cols-1 gap-px bg-edge"
                : "grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
            )}
          >
            {pageItems.map((trade) => (
              <TradeItem
                key={trade.symbol}
                trade={trade}
                mode={mode}
                category={categoryMap.get(trade.symbol)}
                now={now}
                onAdd={
                  isComfort && !trackedSet.has(trade.symbol)
                    ? addSymbol
                    : undefined
                }
                onRemove={
                  isComfort &&
                  trackedSet.has(trade.symbol) &&
                  (isWatchlist || Boolean(searchQ))
                    ? removeSymbol
                    : undefined
                }
                actionVisible={
                  Boolean(searchQ) &&
                  (!isWatchlist || !trackedSet.has(trade.symbol))
                }
                saving={symbolsSaving}
              />
            ))}
          </div>
          {footer}
        </>
      )}
    </div>
  );
}

// ── TradeItem ────────────────────────────────────────────────────

const CARD_ACTION_MOTION = {
  hidden: { opacity: 0, transform: "scale(0.9)" },
  visible: { opacity: 1, transform: "scale(1)" },
};

interface TradeItemProps {
  trade: Trade;
  mode: "comfort" | "compact";
  category?: string;
  onAdd?: (symbol: string) => void;
  onRemove?: (symbol: string) => void;
  actionVisible?: boolean;
  saving?: boolean;
  /** Shared "now" from `useNow()` in the parent list — drives the `Xs ago` label. */
  now: number;
}

const TradeItem = memo(function TradeItem({
  trade,
  mode,
  category,
  now,
  onAdd,
  onRemove,
  actionVisible = false,
  saving,
}: TradeItemProps) {
  const isUp = trade.direction === "up";
  const isDown = trade.direction === "down";
  const [actionHovered, setActionHovered] = useState(false);

  const dirColor = isUp ? "text-up" : isDown ? "text-down" : "text-fg-3";

  if (mode === "compact") {
    return (
      <a
        href={trade.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-1.5 bg-surface text-xs font-mono hover:bg-surface-hover"
      >
        <span className="font-bold text-fg min-w-[52px] tracking-wide">
          {trade.symbol}
        </span>
        <span className="text-fg-2 tabular-nums">
          {formatPrice(trade.price)}
        </span>
        <span className={clsx("tabular-nums", dirColor)}>
          {formatChange(trade.percentage_change)}
        </span>
      </a>
    );
  }

  // Comfort mode
  return (
    <motion.div
      onHoverStart={() => setActionHovered(true)}
      onHoverEnd={() => setActionHovered(false)}
      className={clsx(
        FEED_CARD,
        FEED_CARD_INTERACTIVE,
        "relative flex items-center justify-between overflow-hidden border-l-2",
        isUp && "border-l-up/40",
        isDown && "border-l-down/40",
        !isUp && !isDown && "border-l-transparent",
      )}
    >
      <a
        href={trade.link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${trade.symbol} on Google Finance`}
        className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="pointer-events-none font-mono font-bold text-sm text-fg tracking-wide">
          {trade.symbol}
        </span>
        {category && (
          <span className="pointer-events-none bg-[#22c55e]/10 text-fg-3 text-ui-chip font-medium rounded px-1.5 py-px w-fit">
            {category}
          </span>
        )}
        {trade.previous_close != null && Number(trade.previous_close) > 0 && (
          <span className="pointer-events-none text-ui-chip font-mono text-fg-3 tabular-nums">
            Prev close {formatPrice(trade.previous_close)}
          </span>
        )}
      </div>

      <div className="pointer-events-none flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-sm font-mono font-medium text-fg tabular-nums">
          {formatPrice(trade.price)}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              "text-ui-meta font-mono font-medium tabular-nums",
              dirColor,
            )}
          >
            {formatChange(trade.percentage_change)}
          </span>
          {trade.last_updated && (
            <span
              className="text-ui-chip font-mono text-fg-3 tabular-nums"
              title="Last price update"
            >
              {relativeTime(trade.last_updated, now, { includeSeconds: true })}
            </span>
          )}
        </div>
      </div>
      {(onAdd || onRemove) && (
        <motion.button
          type="button"
          initial={false}
          animate={
            actionVisible || actionHovered
              ? CARD_ACTION_MOTION.visible
              : CARD_ACTION_MOTION.hidden
          }
          onFocus={() => setActionHovered(true)}
          onBlur={() => setActionHovered(false)}
          whileTap={{ transform: "scale(0.95)" }}
          transition={controlTransition}
          onClick={() => (onRemove ?? onAdd)?.(trade.symbol)}
          disabled={saving}
          aria-label={`${onRemove ? "Remove" : "Add"} ${trade.symbol} ${onRemove ? "from" : "to"} watchlist`}
          title={`${onRemove ? "Remove from" : "Add to"} watchlist`}
          className={clsx(
            "absolute right-2 top-2 z-10 flex h-7 min-w-14 items-center justify-center rounded-md border bg-surface-3 px-2.5 text-ui-chip font-semibold shadow-md disabled:opacity-40",
            onRemove
              ? "border-down/30 text-down hover:bg-surface-hover"
              : "border-accent/30 text-accent hover:bg-surface-hover",
          )}
        >
          {onRemove ? "Remove ×" : "Add +"}
        </motion.button>
      )}
    </motion.div>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.category === next.category &&
  prev.onAdd === next.onAdd &&
  prev.onRemove === next.onRemove &&
  prev.actionVisible === next.actionVisible &&
  prev.saving === next.saving &&
  // `now` must trigger a re-render while the "Xs ago" label is visible
  // so it advances on every tick. Compact mode has no label — skip the
  // tick there to avoid churning the whole list.
  (next.mode !== "comfort" || prev.now === next.now) &&
  prev.trade.symbol === next.trade.symbol &&
  prev.trade.price === next.trade.price &&
  prev.trade.percentage_change === next.trade.percentage_change &&
  prev.trade.direction === next.trade.direction &&
  prev.trade.previous_close === next.trade.previous_close &&
  prev.trade.last_updated === next.trade.last_updated
);
