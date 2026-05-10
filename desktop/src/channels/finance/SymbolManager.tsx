/**
 * SymbolManager — unified watchlist + catalog for the Finance channel.
 *
 * Replaces the previous two-pane layout (MyWatchlist on top, SymbolCatalog
 * below) with a single list where every symbol is a row. Tracked rows
 * show live price + percentage change; untracked rows show a quiet
 * "Add" affordance. Clicking anywhere on a row toggles the tracked
 * state. One search field + one category filter + one "Tracked only"
 * toggle drive the same list — no more parallel filtering systems.
 *
 * UX rationale: managing a watchlist is fundamentally one task ("which
 * of these do I track?"), not two ("look at what I have" + "look at
 * what I could add"). Splitting it into two panes forced users to
 * mentally context-switch between Add Mode and Manage Mode. Folding it
 * into one list with a clear tracked/untracked treatment removes that
 * switch.
 */
import { useMemo, useState, useCallback } from "react";
import {
  Plus,
  Check,
  Search as SearchIcon,
  X,
  Star,
} from "lucide-react";
import clsx from "clsx";
import Tooltip from "../../components/Tooltip";
import UpgradePrompt from "../../components/UpgradePrompt";
import EmptySection from "../../components/layout/EmptySection";
import CategoryFilter from "../rss/CategoryFilter";
import { formatPrice, formatChange } from "../../utils/format";
import type { TrackedSymbol } from "../../api/queries";
import type { Trade } from "../../types";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface SymbolManagerProps {
  /** Current tracked symbols. */
  symbols: string[];
  /** Full catalog (loaded from /finance/symbols). */
  catalog: TrackedSymbol[];
  /** Live trade data for tracked symbols. */
  trades: Trade[];
  /** Add a symbol to the watchlist. */
  onAdd: (symbol: string) => void;
  /** Remove a symbol from the watchlist. */
  onRemove: (symbol: string) => void;
  /** Catalog query state. */
  loading: boolean;
  error: boolean;
  /** Tier-limit info. */
  maxSymbols: number;
  subscriptionTier: SubscriptionTier;
  /** Whether a save mutation is in-flight (disables row toggles). */
  saving: boolean;
}

type SortKey = "default" | "name" | "category" | "change";

// Symbols highlighted as quick-add starters for empty watchlists.
const QUICK_ADD = [
  "AAPL",
  "MSFT",
  "GOOG",
  "AMZN",
  "TSLA",
  "NVDA",
  "BTC/USD",
  "ETH/USD",
];

// ── Component ────────────────────────────────────────────────────

export default function SymbolManager({
  symbols,
  catalog,
  trades,
  onAdd,
  onRemove,
  loading,
  error,
  maxSymbols,
  subscriptionTier,
  saving,
}: SymbolManagerProps) {
  // ── Local UI state ─────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("default");

  // ── Derived data ───────────────────────────────────────────────

  const trackedSet = useMemo(() => new Set(symbols), [symbols]);
  const tradeMap = useMemo(
    () => new Map(trades.map((t) => [t.symbol, t])),
    [trades],
  );
  const atLimit = symbols.length >= maxSymbols;

  // Categories with counts — drives the dropdown filter.
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of catalog) {
      map.set(s.category, (map.get(s.category) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [catalog]);

  // Quick-add chips: only render the popular symbols that exist in
  // the catalog AND aren't already tracked. When the user has
  // fewer-than-three tracked symbols, surface this as a starter row.
  const quickAddChips = useMemo(() => {
    if (symbols.length >= 3) return [];
    const catalogSet = new Set(catalog.map((s) => s.symbol));
    return QUICK_ADD.filter(
      (s) => catalogSet.has(s) && !trackedSet.has(s),
    );
  }, [catalog, trackedSet, symbols.length]);

  // Filter + sort the unified list.
  const filtered = useMemo(() => {
    let list = catalog;

    if (trackedOnly) {
      list = list.filter((s) => trackedSet.has(s.symbol));
    }
    if (selectedCategories.size > 0) {
      list = list.filter((s) => selectedCategories.has(s.category));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.symbol.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      );
    }

    // Default sort: tracked symbols first (in their watchlist order),
    // then untracked alphabetically. Other sort modes ignore the
    // tracked grouping and apply uniformly.
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
        break;
      case "category":
        sorted.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.symbol.localeCompare(b.symbol),
        );
        break;
      case "change":
        sorted.sort((a, b) => {
          const aChg = parseFloat(
            String(tradeMap.get(a.symbol)?.percentage_change ?? "0"),
          );
          const bChg = parseFloat(
            String(tradeMap.get(b.symbol)?.percentage_change ?? "0"),
          );
          return bChg - aChg;
        });
        break;
      case "default":
      default: {
        // Tracked first (in user's watchlist order), then untracked alpha.
        const trackedOrder = new Map(symbols.map((s, i) => [s, i]));
        sorted.sort((a, b) => {
          const aT = trackedSet.has(a.symbol);
          const bT = trackedSet.has(b.symbol);
          if (aT && !bT) return -1;
          if (!aT && bT) return 1;
          if (aT && bT) {
            return (
              (trackedOrder.get(a.symbol) ?? 0) -
              (trackedOrder.get(b.symbol) ?? 0)
            );
          }
          return a.symbol.localeCompare(b.symbol);
        });
        break;
      }
    }
    return sorted;
  }, [
    catalog,
    trackedOnly,
    selectedCategories,
    search,
    sort,
    trackedSet,
    symbols,
    tradeMap,
  ]);

  // ── Handlers ───────────────────────────────────────────────────

  const toggleSymbol = useCallback(
    (symbol: string) => {
      if (saving) return;
      if (trackedSet.has(symbol)) {
        onRemove(symbol);
      } else if (!atLimit) {
        onAdd(symbol);
      }
    },
    [trackedSet, atLimit, saving, onAdd, onRemove],
  );

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────

  if (error) {
    return (
      <EmptySection
        icon={X}
        title="Couldn't load the symbol catalog"
        description="Check your connection and try again."
      />
    );
  }

  const showAtLimitWarning = atLimit;

  return (
    <div className="space-y-3">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-fg">Symbols</h3>
          <span
            className={clsx(
              "px-1.5 py-px rounded-full text-[11px] font-medium tabular-nums",
              atLimit
                ? "bg-warn/15 text-warn"
                : "bg-accent/15 text-accent",
            )}
          >
            {symbols.length}
            {maxSymbols !== Infinity && ` / ${maxSymbols}`}
          </span>
        </div>
        <p className="text-[11px] text-fg-4 truncate">
          Click a row to add or remove
        </p>
      </div>

      {showAtLimitWarning && (
        <UpgradePrompt
          current={symbols.length}
          max={maxSymbols}
          noun="symbols"
          tier={subscriptionTier}
        />
      )}

      {/* ── Quick-add chips (only on near-empty watchlist) ────── */}
      {quickAddChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 rounded-lg border border-edge/30 bg-base-200/30">
          <span className="text-[10px] font-mono uppercase tracking-wider text-fg-4 mr-1">
            Quick add
          </span>
          {quickAddChips.map((sym) => (
            <button
              key={sym}
              onClick={() => onAdd(sym)}
              disabled={atLimit || saving}
              className={clsx(
                "flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-mono transition-colors",
                "border-edge/40 text-fg-2 hover:border-accent/50 hover:bg-accent/5 hover:text-accent cursor-pointer",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-edge/40 disabled:hover:bg-transparent disabled:hover:text-fg-2",
              )}
            >
              <Plus size={10} />
              <span>{sym}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Controls: search, category filter, tracked toggle, sort ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <SearchIcon
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbols, names, categories..."
            className="w-full pl-7 pr-7 py-1.5 rounded-md bg-base-200 border border-edge/40 text-[11px] text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/60 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-fg-4 hover:text-fg-2 hover:bg-surface-hover transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClearAll={() => setSelectedCategories(new Set())}
          alignRight
        />

        <Tooltip
          content={
            trackedOnly
              ? "Showing your watchlist only — click to show all symbols"
              : "Show only your watchlist"
          }
        >
          <button
            onClick={() => setTrackedOnly((v) => !v)}
            aria-pressed={trackedOnly}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] transition-colors cursor-pointer whitespace-nowrap",
              trackedOnly
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
            )}
          >
            <Star
              size={11}
              className={clsx(trackedOnly && "fill-current")}
            />
            <span>Tracked</span>
          </button>
        </Tooltip>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1.5 rounded-md bg-base-200 border border-edge/40 text-[11px] text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none"
          aria-label="Sort symbols"
        >
          <option value="default">Tracked first</option>
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="change">% change</option>
        </select>
      </div>

      {/* ── Active filter chips ───────────────────────────────── */}
      {selectedCategories.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(selectedCategories).map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-[10px] text-accent hover:bg-accent/25 transition-colors cursor-pointer"
            >
              {cat}
              <X size={10} className="opacity-60" />
            </button>
          ))}
          <button
            onClick={() => setSelectedCategories(new Set())}
            className="px-2 py-0.5 text-[10px] text-fg-4 hover:text-fg-2 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Unified list ──────────────────────────────────────── */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-[11px] text-fg-4 animate-pulse">
            Loading catalog...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptySection
          icon={SearchIcon}
          title={trackedOnly ? "No tracked symbols match" : "No matches"}
          description={
            trackedOnly
              ? "Try clearing the tracked-only filter or your search."
              : "Try a different search or category."
          }
          compact
        />
      ) : (
        <div
          role="list"
          className="border border-edge/30 rounded-lg overflow-hidden divide-y divide-edge/20"
        >
          {filtered.map((sym) => (
            <SymbolRow
              key={sym.symbol}
              entry={sym}
              tracked={trackedSet.has(sym.symbol)}
              trade={tradeMap.get(sym.symbol)}
              atLimit={atLimit}
              saving={saving}
              onToggle={() => toggleSymbol(sym.symbol)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

interface SymbolRowProps {
  entry: TrackedSymbol;
  tracked: boolean;
  trade: Trade | undefined;
  atLimit: boolean;
  saving: boolean;
  onToggle: () => void;
}

function SymbolRow({
  entry,
  tracked,
  trade,
  atLimit,
  saving,
  onToggle,
}: SymbolRowProps) {
  // Untracked rows at the limit are visually muted and click is a
  // no-op (the toggle handler bails). Tracked rows are always clickable.
  const blocked = !tracked && atLimit;
  const pctChange =
    trade?.percentage_change != null
      ? parseFloat(String(trade.percentage_change))
      : null;

  return (
    <button
      type="button"
      role="listitem"
      onClick={onToggle}
      disabled={saving || blocked}
      aria-label={
        tracked
          ? `Remove ${entry.symbol} from watchlist`
          : blocked
            ? `${entry.symbol} — at watchlist limit`
            : `Add ${entry.symbol} to watchlist`
      }
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors group",
        tracked
          ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
          : blocked
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-base-200/50 cursor-pointer",
        saving && "cursor-wait",
      )}
    >
      {/* Tracked/untracked indicator */}
      <span
        className={clsx(
          "shrink-0 w-5 h-5 flex items-center justify-center rounded-md transition-colors",
          tracked
            ? "bg-accent/20 text-accent"
            : "bg-surface-hover text-fg-4 group-hover:text-fg-2",
        )}
      >
        {tracked ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
      </span>

      {/* Symbol + name */}
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-mono font-bold text-fg-2 truncate block">
          {entry.symbol}
        </span>
        <span className="text-[10px] text-fg-4 truncate block">
          {entry.name}
        </span>
      </div>

      {/* Category badge */}
      <span className="shrink-0 px-1.5 py-px rounded text-[9px] text-fg-4 bg-surface-hover whitespace-nowrap">
        {entry.category}
      </span>

      {/* Live price (tracked only) */}
      <span className="shrink-0 w-16 text-right text-[11px] font-mono tabular-nums text-fg-3">
        {trade ? formatPrice(trade.price) : "—"}
      </span>

      {/* % change (tracked only) */}
      <span
        className={clsx(
          "shrink-0 w-16 text-right text-[11px] font-mono tabular-nums",
          pctChange != null && pctChange > 0 && "text-up",
          pctChange != null && pctChange < 0 && "text-down",
          (pctChange == null || pctChange === 0) && "text-fg-4",
        )}
      >
        {trade ? formatChange(trade.percentage_change) : "—"}
      </span>
    </button>
  );
}
