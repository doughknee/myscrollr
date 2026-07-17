/**
 * Finance FeedTab — desktop-native.
 *
 * Renders a grid of trade cards with real-time price updates
 * via the desktop CDC/SSE pipeline. Supports compact and comfort
 * display modes with price flash animations on change.
 *
 * ONE Kalshi-style control bar (widget-bar primitives): Feed/Symbols
 * segmented view switch · direction pills · sort + category menus ·
 * symbol search · freshness · gear popover. The Symbols view mounts the
 * full SymbolManager in-feed — the Configure page's job, in-widget.
 * Counts live in menu rows (no summary band); filters collapse into one
 * Filter button at narrow widths.
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from "react";
import { clsx } from "clsx";
import { AnimatePresence } from "motion/react";
import { TrendingUp, LineChart, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, financeCatalogOptions } from "../../api/queries";
import { formatPrice, formatChange, relativeTime } from "../../utils/format";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar, BarDivider, BarPill } from "../../components/widget-bar/Bar";
import {
  useDismiss,
  MenuPanel,
  MenuHeading,
  MenuRow,
  FilterTrigger,
} from "../../components/widget-bar/Menu";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { SearchBox, useSlashFocus } from "../../components/widget-bar/SearchBox";
import { MultiSelectMenu } from "../../components/widget-bar/MultiSelectMenu";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import { GearMenu } from "../../components/widget-bar/GearMenu";
import DisplayItemsGrid from "../../components/settings/DisplayItemsGrid";
import SymbolManager from "./SymbolManager";
import { useChannelConfig } from "../../hooks/useChannelConfig";
import { useShell } from "../../shell-context";
import { useNow } from "../../hooks/useNow";
import { applyFinancePipeline, type FinanceSortKey, type FinanceDirectionFilter } from "./view";
import type { Trade, FeedTabProps, ChannelManifest } from "../../types";
import type { ChannelType } from "../../api/client";
import { assetClassForWidget } from "../../marketplace";
import { shouldShowOnFeed } from "../../preferences";
import type { FinanceDisplayPrefs } from "../../preferences";

// ── Channel manifest ─────────────────────────────────────────────

export const financeChannel: ChannelManifest = {
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
      "Open Configure to add symbols and start tracking.",
      "Prices update automatically when connected.",
      "Click any symbol to view its chart on Google Finance.",
    ],
  },
  FeedTab: FinanceFeedTab,
};

// ── Types ────────────────────────────────────────────────────────

type DirectionFilter = FinanceDirectionFilter;
type SortKey = FinanceSortKey;

const DIRECTION_OPTIONS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "gainers", label: "Gainers" },
  { value: "losers", label: "Losers" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "alpha", label: "A–Z" },
  { value: "price", label: "Price" },
  { value: "change", label: "% Change" },
  { value: "updated", label: "Last Updated" },
];

type FinanceView = "feed" | "symbols";

/** Feed / Symbols — options for the Segmented view switch. The Symbols
 *  view is the Configure page's symbol picker, mounted in-feed. */
const VIEW_OPTIONS: SegmentedOption<FinanceView>[] = [
  { value: "feed", label: "Feed", icon: LineChart },
  { value: "symbols", label: "Symbols", icon: ListChecks },
];

interface FinanceChannelConfig {
  symbols?: string[];
}

const DENSITY_OPTIONS: SegmentedOption<"comfort" | "compact">[] = [
  { value: "comfort", label: "Comfort" },
  { value: "compact", label: "Compact" },
];

const PAGE_SIZE = 20;
const LOAD_MORE_INCREMENT = 20;

// ── FeedTab ──────────────────────────────────────────────────────

function FinanceFeedTab({ mode: callerMode, feedContext, onConfigure, widgetId }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.finance;

  // The caller (Home or Source page) hints at a default mode, but
  // the user's per-channel feedDensity pref wins when set. This
  // means the same channel can render compact on Home (caller hint
  // wins for the small preview) and comfort on the Source page
  // when the user prefers it, controlled from one Display setting.
  const mode = dp.feedDensity ?? callerMode;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(financeCatalogOptions());

  // One subscription for the whole list — passed down to each row so
  // every `TradeItem` re-renders together on the 1s tick. Without this
  // the per-row "Xs ago" labels never advance between price updates.
  const now = useNow();

  const allTrades = useMemo(
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
  const assetClass = widgetId ? assetClassForWidget(widgetId) : undefined;
  const trades = useMemo(() => {
    if (!assetClass) return allTrades;
    return allTrades.filter((t) => {
      const isCrypto = categoryMap.get(t.symbol) === "Crypto";
      return assetClass === "crypto" ? isCrypto : !isCrypto;
    });
  }, [allTrades, assetClass, categoryMap]);

  // Derive categories with counts from current trades
  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const trade of trades) {
      const cat = categoryMap.get(trade.symbol);
      if (cat) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [trades, categoryMap]);

  // ── Filter / sort / view state ───────────────────────────────
  const isComfort = mode === "comfort";
  const [view, setView] = useState<FinanceView>("feed");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>(() => dp.defaultSort ?? "alpha");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const clearCategories = useCallback(() => setSelectedCategories(new Set()), []);

  // ── Symbol search (plain substring — no fuzzy matcher here) ──
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  useSlashFocus(searchInputRef, isComfort && view === "feed");

  const clearAllFilters = useCallback(() => {
    setDirectionFilter("all");
    setSelectedCategories(new Set());
    setQuery("");
  }, []);

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [directionFilter, selectedCategories, sortKey, query]);

  // ── Data pipeline ────────────────────────────────────────────
  // Shared with the ticker via `applyFinancePipeline` so `defaultSort`
  // from the Display tab takes effect in both places.
  const piped = useMemo(
    () =>
      applyFinancePipeline(trades, {
        directionFilter,
        selectedCategories,
        categoryMap,
        sortKey,
      }),
    [trades, directionFilter, selectedCategories, categoryMap, sortKey],
  );

  const searchQ = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      searchQ
        ? piped.filter((t) => t.symbol.toLowerCase().includes(searchQ))
        : piped,
    [piped, searchQ],
  );

  // ── Pagination (incremental "load more") ─────────────────────
  // Vertical-monitor friendly: instead of paging, we render a
  // progressively larger slice and append more on click. This keeps
  // scroll position stable as users continue down the list.
  const visible = Math.min(visibleCount, filtered.length);
  const pageItems = filtered.slice(0, visible);
  const remaining = Math.max(0, filtered.length - visible);

  // Most-recent update across filtered trades — drives the FreshnessPill.
  const latestUpdated = useMemo(() => {
    let latest = 0;
    for (const t of filtered) {
      if (!t.last_updated) continue;
      const ts = new Date(t.last_updated).getTime();
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  }, [filtered]);

  // ── Direction counts (menu rows — the summary band is gone) ──
  // Counted over the widget-scoped universe, not the filtered list, so
  // the Gainers/Losers rows stay stable while a direction is selected.
  const directionCounts = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const t of trades) {
      if (t.direction === "up") up++;
      else if (t.direction === "down") down++;
    }
    return { all: trades.length, gainers: up, losers: down };
  }, [trades]);

  const channelType = (widgetId ?? "finance") as ChannelType;
  const showEmpty = trades.length === 0;
  const showSymbols = isComfort && view === "symbols";

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll — an inner scrollport that never scrolls swallows `sticky`
    // (the bar never actually pinned here before this fix).
    <div ref={containerRef} className="relative flex min-h-full flex-col">
      {isComfort && (
        <WidgetBar>
          <Segmented
            ariaLabel="Finance view"
            value={view}
            onChange={setView}
            options={VIEW_OPTIONS}
          />

          {view === "feed" && !showEmpty ? (
            <>
              <BarDivider />

              {/* Wide: open direction pills. Collapse BEFORE clipping. */}
              <div className="scrollbar-none hidden min-w-0 items-center gap-1 overflow-x-auto @5xl:flex">
                {DIRECTION_OPTIONS.map((opt) => (
                  <BarPill
                    key={opt.value}
                    active={directionFilter === opt.value}
                    onClick={() => setDirectionFilter(opt.value)}
                  >
                    {opt.label}
                  </BarPill>
                ))}
              </div>

              {/* Narrow: direction + sort + categories in one Filter menu. */}
              <div className="@5xl:hidden">
                <FinanceFilterMenu
                  directionFilter={directionFilter}
                  onPickDirection={setDirectionFilter}
                  directionCounts={directionCounts}
                  sortKey={sortKey}
                  onPickSort={setSortKey}
                  categories={categoryList}
                  selectedCategories={selectedCategories}
                  onToggleCategory={toggleCategory}
                  onClearCategories={clearCategories}
                />
              </div>

              <div className="ml-auto flex min-w-0 shrink items-center gap-2">
                <span className="hidden @5xl:block">
                  <SelectMenu
                    value={sortKey}
                    options={SORT_OPTIONS}
                    onChange={setSortKey}
                    ariaLabel="Sort symbols"
                    prefix="Sort"
                  />
                </span>
                {categoryList.length > 0 && (
                  <span className="hidden @5xl:block">
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
                  </span>
                )}
                <SearchBox
                  inputRef={searchInputRef}
                  query={query}
                  onQueryChange={setQuery}
                  resultCount={searchQ ? filtered.length : null}
                  ariaLabel="Search symbols"
                  noun="symbols"
                />
                {latestUpdated && (
                  <span className="hidden @xl:block">
                    <FreshnessPill lastUpdated={latestUpdated} label="price" />
                  </span>
                )}
                <FinanceGear />
              </div>
            </>
          ) : (
            <div className="ml-auto">
              <FinanceGear />
            </div>
          )}
        </WidgetBar>
      )}

      {/* Compact density has no bar — float the gear so the widget keeps
          a settings surface (and a way back to comfort) in every mode. */}
      {!isComfort && (
        <div className="absolute right-2 top-2 z-10 rounded-lg bg-surface shadow-soft-sm">
          <FinanceGear />
        </div>
      )}

      {showSymbols ? (
        <FinanceSymbolsPanel channelType={channelType} assetClass={assetClass} />
      ) : showEmpty ? (
        <div className="flex flex-1 flex-col justify-center">
          <EmptyChannelState
            refreshing={Boolean(feedContext.__refreshing)}
            icon={TrendingUp}
            noun="stocks or crypto"
            hasConfig={!!feedContext.__hasConfig}
            dashboardLoaded={!!feedContext.__dashboardLoaded}
            loadingNoun="prices"
            actionHint="choose what to track"
            actionLabel={isComfort ? "Choose symbols to track" : undefined}
            onConfigure={isComfort ? () => setView("symbols") : onConfigure}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <p className="text-[12px] text-fg-3">
            {searchQ
              ? `No symbols match “${query.trim()}”`
              : "No symbols match your filters"}
          </p>
          <button
            onClick={clearAllFilters}
            className="px-3 py-1.5 rounded-md text-ui-meta font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
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
            {pageItems.map((trade) => (
              <TradeItem
                key={trade.symbol}
                trade={trade}
                mode={mode}
                display={dp}
                category={categoryMap.get(trade.symbol)}
                now={now}
              />
            ))}
          </div>
          {remaining > 0 && (
            <div className="flex items-center justify-center gap-3 px-3 py-3 bg-surface border-t border-edge/30">
              <button
                onClick={() =>
                  setVisibleCount((c) =>
                    Math.min(filtered.length, c + LOAD_MORE_INCREMENT),
                  )
                }
                className="px-4 py-1.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors cursor-pointer"
              >
                Load more
              </button>
              <span className="text-xs text-fg-3 tabular-nums font-mono">
                {visible} of {filtered.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Filter menu (narrow-width collapse) ─────────────────────────

function FinanceFilterMenu({
  directionFilter,
  onPickDirection,
  directionCounts,
  sortKey,
  onPickSort,
  categories,
  selectedCategories,
  onToggleCategory,
  onClearCategories,
}: {
  directionFilter: DirectionFilter;
  onPickDirection: (d: DirectionFilter) => void;
  directionCounts: { all: number; gainers: number; losers: number };
  sortKey: SortKey;
  onPickSort: (s: SortKey) => void;
  categories: { name: string; count: number }[];
  selectedCategories: Set<string>;
  onToggleCategory: (c: string) => void;
  onClearCategories: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const activeCount =
    (directionFilter !== "all" ? 1 : 0) + selectedCategories.size;

  return (
    // NOT position:relative — the dropdown anchors to the sticky bar so
    // it spans the channel width instead of clipping at narrow widths.
    <div ref={rootRef} className="shrink-0 rounded-lg">
      <FilterTrigger
        open={open}
        badgeCount={activeCount}
        onClick={() => setOpen((o) => !o)}
      />
      <AnimatePresence>
        {open && (
          <MenuPanel className="inset-x-2">
            <MenuHeading>Direction</MenuHeading>
            {DIRECTION_OPTIONS.map((opt) => (
              <MenuRow
                key={opt.value}
                selected={directionFilter === opt.value}
                onClick={() => onPickDirection(opt.value)}
                role="menuitemradio"
                count={directionCounts[opt.value]}
              >
                {opt.label}
              </MenuRow>
            ))}
            <MenuHeading>Sort</MenuHeading>
            {SORT_OPTIONS.map((opt) => (
              <MenuRow
                key={opt.value}
                selected={sortKey === opt.value}
                onClick={() => onPickSort(opt.value)}
                role="menuitemradio"
              >
                {opt.label}
              </MenuRow>
            ))}
            {categories.length > 0 && (
              <>
                <MenuHeading>Category</MenuHeading>
                <MenuRow
                  selected={selectedCategories.size === 0}
                  onClick={onClearCategories}
                  role="menuitemradio"
                >
                  All categories
                </MenuRow>
                {categories.map((c) => (
                  <MenuRow
                    key={c.name}
                    selected={selectedCategories.has(c.name)}
                    onClick={() => onToggleCategory(c.name)}
                    role="menuitemcheckbox"
                    count={c.count}
                  >
                    {c.name}
                  </MenuRow>
                ))}
              </>
            )}
          </MenuPanel>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Gear popover (display prefs — previously orphaned) ──────────
//
// showChange / showPrevClose / showLastUpdated, default sort, and feed
// density had NO edit surface since the per-channel Display pages were
// removed (2026-06-30) — the ticker and feed read them, nothing wrote
// them. The gear reclaims them.

function FinanceGear() {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.channelDisplay.finance;

  const patchDisplay = useCallback(
    (patch: Partial<FinanceDisplayPrefs>) => {
      onPrefsChange({
        ...prefs,
        channelDisplay: {
          ...prefs.channelDisplay,
          finance: { ...prefs.channelDisplay.finance, ...patch },
        },
      });
    },
    [prefs, onPrefsChange],
  );

  return (
    <GearMenu ariaLabel="Finance settings" panelClassName="right-0 w-80">
      <MenuHeading>Display</MenuHeading>
      <div className="px-1 pb-1">
        <DisplayItemsGrid
          sections={[
            {
              rows: [
                {
                  key: "showChange",
                  label: "% change",
                  description: "Signed percentage move",
                  value: dp.showChange,
                },
                {
                  key: "showPrevClose",
                  label: "Previous close",
                  description: "Prior session's closing price",
                  value: dp.showPrevClose,
                },
                {
                  key: "showLastUpdated",
                  label: "Last updated",
                  description: "Time since the latest price tick",
                  value: dp.showLastUpdated,
                },
              ],
            },
          ]}
          onChange={(changes) =>
            patchDisplay(changes as Partial<FinanceDisplayPrefs>)
          }
        />
      </div>
      <MenuHeading>Feed density</MenuHeading>
      <div className="px-1 pb-1">
        <Segmented
          ariaLabel="Feed density"
          value={dp.feedDensity ?? "comfort"}
          onChange={(d) => patchDisplay({ feedDensity: d })}
          options={DENSITY_OPTIONS}
        />
      </div>
      <MenuHeading>Default sort</MenuHeading>
      {SORT_OPTIONS.map((opt) => (
        <MenuRow
          key={opt.value}
          role="menuitemradio"
          selected={(dp.defaultSort ?? "alpha") === opt.value}
          onClick={() => patchDisplay({ defaultSort: opt.value })}
        >
          {opt.label}
        </MenuRow>
      ))}
    </GearMenu>
  );
}

// ── Symbols view (the Configure page's picker, mounted in-feed) ─

function FinanceSymbolsPanel({
  channelType,
  assetClass,
}: {
  channelType: ChannelType;
  assetClass: ReturnType<typeof assetClassForWidget>;
}) {
  const { error, setError, saving, updateItems } =
    useChannelConfig<string[]>(channelType, "symbols");

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const {
    data: fullCatalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(financeCatalogOptions());

  const channelRow = (dashboard?.channels ?? []).find(
    (ch) => ch.channel_type === channelType,
  );
  const config = (channelRow?.config ?? {}) as FinanceChannelConfig;
  const symbols = useMemo(
    () => (Array.isArray(config.symbols) ? config.symbols : []),
    [config.symbols],
  );
  const symbolSet = useMemo(() => new Set(symbols), [symbols]);

  // Scope the picker to this widget's asset class — the "Crypto" category
  // for the crypto widget, everything else for stocks.
  const catalog = useMemo(() => {
    if (!assetClass) return fullCatalog;
    return fullCatalog.filter((item) =>
      assetClass === "crypto"
        ? item.category === "Crypto"
        : item.category !== "Crypto",
    );
  }, [fullCatalog, assetClass]);

  const trades = useMemo(
    () => (dashboard?.data?.finance as Trade[] | undefined) ?? [],
    [dashboard?.data?.finance],
  );

  const addSymbol = useCallback(
    (sym: string) => {
      if (symbolSet.has(sym)) return;
      updateItems([...symbols, sym]);
    },
    [symbols, symbolSet, updateItems],
  );

  const removeSymbol = useCallback(
    (sym: string) => {
      updateItems(symbols.filter((s) => s !== sym));
    },
    [symbols, updateItems],
  );

  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      {error && (
        <div className="shrink-0 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-[11px] text-error flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-error/60 hover:text-error cursor-pointer"
          >
            ×
          </button>
        </div>
      )}
      <SymbolManager
        symbols={symbols}
        catalog={catalog}
        trades={trades}
        onAdd={addSymbol}
        onRemove={removeSymbol}
        loading={catalogLoading}
        error={catalogError}
        saving={saving}
      />
    </div>
  );
}

// ── TradeItem ────────────────────────────────────────────────────

interface TradeItemProps {
  trade: Trade;
  mode: "comfort" | "compact";
  display: FinanceDisplayPrefs;
  category?: string;
  /** Shared "now" from `useNow()` in the parent list — drives the `Xs ago` label. */
  now: number;
}

const TradeItem = memo(function TradeItem({ trade, mode, display, category, now }: TradeItemProps) {
  const isUp = trade.direction === "up";
  const isDown = trade.direction === "down";

  // Track previous price for flash animation. Single effect owns the ref —
  // the previous split-effect version could overwrite the ref before the
  // flash branch ran on rapid back-to-back CDC events, swallowing flashes.
  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const currentPrice =
      typeof trade.price === "string" ? parseFloat(trade.price) : trade.price;
    const prevPrice = prevPriceRef.current;
    prevPriceRef.current = currentPrice;

    if (
      prevPrice === null ||
      isNaN(currentPrice) ||
      currentPrice === prevPrice
    ) {
      return;
    }

    setFlash(currentPrice > prevPrice ? "up" : "down");
    const timer = setTimeout(() => setFlash(null), 800);
    return () => clearTimeout(timer);
  }, [trade.price]);

  const dirColor = isUp ? "text-up" : isDown ? "text-down" : "text-fg-3";

  if (mode === "compact") {
    return (
      <a
        href={trade.link}
        target="_blank"
        rel="noopener noreferrer"
        className={clsx(
          "flex items-center gap-2 px-3 py-1.5 bg-surface text-xs font-mono transition-colors duration-700 hover:bg-surface-hover",
          flash === "up" && "bg-up/8",
          flash === "down" && "bg-down/8",
        )}
      >
        <span className="font-bold text-fg min-w-[52px] tracking-wide">
          {trade.symbol}
        </span>
        <span className="text-fg-2 tabular-nums">
          {formatPrice(trade.price)}
        </span>
        {shouldShowOnFeed(display.showChange) && (
          <span className={clsx("tabular-nums", dirColor)}>
            {formatChange(trade.percentage_change)}
          </span>
        )}
      </a>
    );
  }

  // Comfort mode
  return (
    <a
      href={trade.link}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        "flex items-center justify-between px-3 py-2 bg-surface transition-colors duration-700 hover:bg-surface-hover border-l-2",
        flash === "up" && "bg-up/6",
        flash === "down" && "bg-down/6",
        isUp && "border-l-up/40",
        isDown && "border-l-down/40",
        !isUp && !isDown && "border-l-transparent",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-mono font-bold text-sm text-fg tracking-wide">
          {trade.symbol}
        </span>
        {category && (
          <span className="bg-[#22c55e]/10 text-fg-3 text-ui-chip font-medium rounded px-1.5 py-px w-fit">
            {category}
          </span>
        )}
        {shouldShowOnFeed(display.showPrevClose) && trade.previous_close != null && Number(trade.previous_close) > 0 && (
          <span className="text-ui-chip font-mono text-fg-3 tabular-nums">
            Prev close {formatPrice(trade.previous_close)}
          </span>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm font-mono font-medium text-fg tabular-nums">
          {formatPrice(trade.price)}
        </span>
        <div className="flex items-center gap-2">
          {shouldShowOnFeed(display.showChange) && (
            <span
              className={clsx(
                "text-ui-meta font-mono font-medium tabular-nums",
                dirColor,
              )}
            >
              {formatChange(trade.percentage_change)}
            </span>
          )}
          {shouldShowOnFeed(display.showLastUpdated) && trade.last_updated && (
            <span
              className="text-ui-chip font-mono text-fg-3 tabular-nums"
              title="Last price update"
            >
              {relativeTime(trade.last_updated, now, { includeSeconds: true })}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.display === next.display &&
  prev.category === next.category &&
  // `now` must trigger a re-render while the "Xs ago" label is visible
  // so it advances on every tick. When the label is hidden the tick
  // is irrelevant — skip it to avoid churning the whole list.
  (!shouldShowOnFeed(next.display.showLastUpdated) || next.mode !== "comfort" || prev.now === next.now) &&
  prev.trade.symbol === next.trade.symbol &&
  prev.trade.price === next.trade.price &&
  prev.trade.percentage_change === next.trade.percentage_change &&
  prev.trade.direction === next.trade.direction &&
  prev.trade.previous_close === next.trade.previous_close &&
  prev.trade.last_updated === next.trade.last_updated
);
