/**
 * CategoryPicker — unified favorites + catalog picker for the
 * Predictions channel. Mirrors the Finance SymbolManager.
 *
 * Every catalog market is a row. Favorited rows are pinned (and show a
 * filled star); the rest show a quiet "Add" affordance. Clicking
 * anywhere on a row toggles the favorite state. One search field + one
 * category filter + one "Favorites only" toggle + one sort select drive
 * the same list — no parallel filtering systems.
 *
 * UX rationale: curating which markets you pin is one task ("which of
 * these do I care about?"), not two. Folding it into a single list with
 * a clear favorited/unfavorited treatment removes the Add-Mode /
 * Manage-Mode context switch.
 */
import { useMemo, useState, useCallback } from "react";
import { Plus, Check, Search as SearchIcon, X, Star } from "lucide-react";
import clsx from "clsx";
import { motion } from "motion/react";
import Tooltip from "../../components/Tooltip";
import UpgradePrompt from "../../components/UpgradePrompt";
import EmptySection from "../../components/layout/EmptySection";
import CategoryFilter from "../rss/CategoryFilter";
import type { PredictionCatalogEntry } from "../../api/queries";
import type { Prediction } from "../../types";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface CategoryPickerProps {
  /** Current favorited markets (Kalshi tickers). */
  favorites: string[];
  /** Full catalog (loaded from /predictions/catalog). */
  catalog: PredictionCatalogEntry[];
  /** Live prediction data for context (implied probability). */
  markets: Prediction[];
  /** Pin a market. */
  onAdd: (ticker: string) => void;
  /** Unpin a market. */
  onRemove: (ticker: string) => void;
  /** Catalog query state. */
  loading: boolean;
  error: boolean;
  /** Tier-limit info. */
  max: number;
  subscriptionTier: SubscriptionTier;
  /** Whether a save mutation is in-flight (disables row toggles). */
  saving: boolean;
}

type SortKey = "default" | "name" | "category" | "probability";

// Categories highlighted as quick-add starters for empty favorites.
const QUICK_ADD_CATEGORIES = [
  "Politics",
  "Sports",
  "Economics",
  "Crypto",
  "World",
];

// ── Component ────────────────────────────────────────────────────

export default function CategoryPicker({
  favorites,
  catalog,
  markets,
  onAdd,
  onRemove,
  loading,
  error,
  max,
  subscriptionTier,
  saving,
}: CategoryPickerProps) {
  // ── Local UI state ─────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("default");

  // ── Derived data ───────────────────────────────────────────────

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const probabilityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of markets) {
      if (typeof m.yes_price === "number") {
        map.set(m.ticker, m.yes_price);
      }
    }
    return map;
  }, [markets]);
  const atLimit = favorites.length >= max;

  // Categories with counts — drives the dropdown filter.
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of catalog) {
      map.set(c.category, (map.get(c.category) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [catalog]);

  // Quick-add chips: the first untracked catalog market in each popular
  // category. Only surfaced when the favorites list is near-empty.
  const quickAddChips = useMemo(() => {
    if (favorites.length >= 3) return [];
    const chips: PredictionCatalogEntry[] = [];
    for (const cat of QUICK_ADD_CATEGORIES) {
      const entry = catalog.find(
        (c) => c.category === cat && !favoriteSet.has(c.ticker),
      );
      if (entry) chips.push(entry);
    }
    return chips;
  }, [catalog, favoriteSet, favorites.length]);

  // Filter + sort the unified list.
  const filtered = useMemo(() => {
    let list = catalog;

    if (favoritesOnly) {
      list = list.filter((c) => favoriteSet.has(c.ticker));
    }
    if (selectedCategories.size > 0) {
      list = list.filter((c) => selectedCategories.has(c.category));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.ticker.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q),
      );
    }

    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "category":
        sorted.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.title.localeCompare(b.title),
        );
        break;
      case "probability":
        sorted.sort(
          (a, b) =>
            (probabilityMap.get(b.ticker) ?? -1) -
            (probabilityMap.get(a.ticker) ?? -1),
        );
        break;
      case "default":
      default: {
        // Favorites first (in user's pinned order), then the rest alpha.
        const order = new Map(favorites.map((t, i) => [t, i]));
        sorted.sort((a, b) => {
          const aF = favoriteSet.has(a.ticker);
          const bF = favoriteSet.has(b.ticker);
          if (aF && !bF) return -1;
          if (!aF && bF) return 1;
          if (aF && bF) {
            return (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0);
          }
          return a.title.localeCompare(b.title);
        });
        break;
      }
    }
    return sorted;
  }, [
    catalog,
    favoritesOnly,
    selectedCategories,
    search,
    sort,
    favoriteSet,
    favorites,
    probabilityMap,
  ]);

  // ── Handlers ───────────────────────────────────────────────────

  const toggleMarket = useCallback(
    (ticker: string) => {
      if (saving) return;
      if (favoriteSet.has(ticker)) {
        onRemove(ticker);
      } else if (!atLimit) {
        onAdd(ticker);
      }
    },
    [favoriteSet, atLimit, saving, onAdd, onRemove],
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
        title="Couldn't load the market catalog"
        description="Check your connection and try again."
      />
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 pb-5 min-h-0">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-fg">Markets</h3>
          <span
            className={clsx(
              "px-1.5 py-px rounded-full text-ui-chip font-medium tabular-nums",
              atLimit ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent",
            )}
          >
            {favorites.length}
            {max !== Infinity && ` / ${max}`}
          </span>
        </div>
        <p className="text-ui-meta text-fg-3 truncate">
          Click a row to pin or unpin
        </p>
      </div>

      {atLimit && (
        <div className="shrink-0">
          <UpgradePrompt
            current={favorites.length}
            max={max}
            noun="markets"
            tier={subscriptionTier}
          />
        </div>
      )}

      {/* ── Quick-add chips (only on near-empty favorites) ────── */}
      {quickAddChips.length > 0 && (
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-3 py-2.5 rounded-lg border border-edge/30 bg-base-200/30">
          <span className="text-ui-section font-mono uppercase tracking-wider text-fg-3 mr-1">
            Quick add
          </span>
          {quickAddChips.map((entry) => (
            <button
              key={entry.ticker}
              onClick={() => onAdd(entry.ticker)}
              disabled={atLimit || saving}
              className={clsx(
                "flex items-center gap-1 px-2 py-0.5 rounded-md border text-ui-chip font-mono",
                "transition-all duration-150 active:scale-90",
                "border-edge/40 text-fg-2 hover:border-accent/50 hover:bg-accent/5 hover:text-accent cursor-pointer",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-edge/40 disabled:hover:bg-transparent disabled:hover:text-fg-2",
              )}
            >
              <Plus size={10} />
              <span className="truncate max-w-[140px]">{entry.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Controls: search, category filter, favorites toggle, sort ── */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <SearchIcon
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets, tickers, categories..."
            className="w-full pl-7 pr-7 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/60 transition-colors"
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
            favoritesOnly
              ? "Showing your pinned markets only — click to show all"
              : "Show only your pinned markets"
          }
        >
          <button
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta cursor-pointer whitespace-nowrap",
              "transition-all duration-200 active:scale-95",
              favoritesOnly
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
            )}
          >
            <Star
              size={11}
              className={clsx(
                "transition-transform duration-200",
                favoritesOnly && "fill-current rotate-[20deg]",
              )}
            />
            <span>Pinned</span>
          </button>
        </Tooltip>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none"
          aria-label="Sort markets"
        >
          <option value="default">Pinned first</option>
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="probability">Probability</option>
        </select>
      </div>

      {/* ── Active filter chips ───────────────────────────────── */}
      {selectedCategories.size > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {Array.from(selectedCategories).map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-ui-chip text-accent hover:bg-accent/25 transition-colors cursor-pointer"
            >
              {cat}
              <X size={10} className="opacity-60" />
            </button>
          ))}
          <button
            onClick={() => setSelectedCategories(new Set())}
            className="px-2 py-0.5 text-ui-chip text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Unified list (only this region scrolls) ───────────── */}
      {loading ? (
        <div className="shrink-0 text-center py-8">
          <p className="text-ui-meta text-fg-3 animate-pulse">
            Loading catalog...
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="shrink-0">
          <EmptySection
            icon={SearchIcon}
            title={favoritesOnly ? "No pinned markets match" : "No matches"}
            description={
              favoritesOnly
                ? "Try clearing the pinned-only filter or your search."
                : "Try a different search or category."
            }
            compact
          />
        </div>
      ) : (
        <div
          role="list"
          className="flex-1 min-h-0 overflow-y-auto scrollbar-thin border border-edge/30 rounded-lg divide-y divide-edge/20"
        >
          {filtered.map((entry) => (
            <MarketRow
              key={entry.ticker}
              entry={entry}
              favorited={favoriteSet.has(entry.ticker)}
              probability={probabilityMap.get(entry.ticker)}
              atLimit={atLimit}
              saving={saving}
              onToggle={() => toggleMarket(entry.ticker)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

interface MarketRowProps {
  entry: PredictionCatalogEntry;
  favorited: boolean;
  probability: number | undefined;
  atLimit: boolean;
  saving: boolean;
  onToggle: () => void;
}

function MarketRow({
  entry,
  favorited,
  probability,
  atLimit,
  saving,
  onToggle,
}: MarketRowProps) {
  // Unfavorited rows at the limit are visually muted and click is a
  // no-op (the toggle handler bails). Favorited rows are always clickable.
  const blocked = !favorited && atLimit;

  return (
    <button
      type="button"
      role="listitem"
      onClick={onToggle}
      disabled={saving || blocked}
      aria-label={
        favorited
          ? `Unpin ${entry.title}`
          : blocked
            ? `${entry.title} — at pinned limit`
            : `Pin ${entry.title}`
      }
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 group",
        "active:scale-[0.995]",
        favorited
          ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
          : blocked
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-base-200/50 cursor-pointer",
        saving && "cursor-wait",
      )}
    >
      {/* Favorited/unfavorited indicator. */}
      <span
        className={clsx(
          "shrink-0 w-5 h-5 flex items-center justify-center rounded-md transition-colors",
          favorited
            ? "bg-accent/20 text-accent"
            : "bg-surface-hover text-fg-4 group-hover:text-fg-2",
        )}
      >
        <motion.span
          key={favorited ? "check" : "plus"}
          initial={{ scale: 0.4, opacity: 0, rotate: favorited ? -45 : 45 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="flex items-center justify-center"
        >
          {favorited ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
        </motion.span>
      </span>

      {/* Title + ticker */}
      <div className="flex-1 min-w-0">
        <span className="text-ui-body text-fg-2 truncate block">
          {entry.title}
        </span>
        <span className="text-ui-meta font-mono text-fg-3 truncate block">
          {entry.ticker}
        </span>
      </div>

      {/* Category badge */}
      <span className="shrink-0 px-1.5 py-px rounded text-ui-chip text-fg-3 bg-surface-hover whitespace-nowrap">
        {entry.category}
      </span>

      {/* Implied probability (live, when available) */}
      <span className="shrink-0 w-12 text-right text-ui-meta font-mono tabular-nums text-fg-3">
        {probability != null ? `${Math.round(probability)}%` : "—"}
      </span>
    </button>
  );
}
