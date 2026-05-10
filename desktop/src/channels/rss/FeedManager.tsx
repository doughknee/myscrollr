/**
 * Unified RSS feed manager — replaces MyFeeds + FeedCatalog with one
 * list. Every catalog feed appears as a row; click to add/remove.
 * Custom feeds (user-supplied URLs) appear at the top of the tracked
 * group, marked with a "custom" badge and removable like any other.
 *
 * Same chrome shape as Sports LeagueManager / Finance SymbolManager:
 * header + count badge + UpgradePrompt + Quick-add for custom feeds
 * + search/category/tracked/sort controls all pinned at the top;
 * the feed list scrolls inside a fixed pane.
 */
import { useMemo, useState, useCallback } from "react";
import {
  Plus,
  Check,
  Search as SearchIcon,
  X,
  Star,
  Rss,
} from "lucide-react";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";
import Tooltip from "../../components/Tooltip";
import UpgradePrompt from "../../components/UpgradePrompt";
import EmptySection from "../../components/layout/EmptySection";
import CategoryFilter from "./CategoryFilter";
import type { TrackedFeed } from "../../api/client";
import type { SubscriptionTier } from "../../auth";

// ── Types ────────────────────────────────────────────────────────

interface SubscribedFeed {
  name: string;
  url: string;
  is_custom?: boolean;
}

interface FeedManagerProps {
  feeds: SubscribedFeed[];
  catalog: TrackedFeed[];
  catalogAll: TrackedFeed[];
  onAddCatalog: (url: string) => void;
  onAddCustom: (name: string, url: string) => void;
  onRemove: (url: string) => void;
  loading: boolean;
  error: boolean;
  maxFeeds: number;
  maxCustomFeeds: number;
  customCount: number;
  subscriptionTier: SubscriptionTier;
  saving: boolean;
}

type SortKey = "default" | "name" | "category" | "activity";

// Treat both catalog and custom feeds uniformly inside the list.
interface UnifiedFeed {
  url: string;
  name: string;
  category: string;
  isCustom: boolean;
  isTracked: boolean;
  catalog?: TrackedFeed;
}

// ── Component ────────────────────────────────────────────────────

export default function FeedManager({
  feeds,
  catalog,
  catalogAll,
  onAddCatalog,
  onAddCustom,
  onRemove,
  loading,
  error,
  maxFeeds,
  maxCustomFeeds,
  customCount,
  subscriptionTier,
  saving,
}: FeedManagerProps) {
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("default");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const trackedSet = useMemo(() => new Set(feeds.map((f) => f.url)), [feeds]);
  const trackedMap = useMemo(
    () => new Map(feeds.map((f) => [f.url, f])),
    [feeds],
  );
  const catalogMap = useMemo(
    () => new Map(catalogAll.map((f) => [f.url, f])),
    [catalogAll],
  );

  const atFeedLimit = feeds.length >= maxFeeds;
  const atCustomLimit = customCount >= maxCustomFeeds;

  // Build the unified list: every catalog feed + any custom feeds
  // not already in the catalog.
  const unified = useMemo<UnifiedFeed[]>(() => {
    const seen = new Set<string>();
    const out: UnifiedFeed[] = [];
    for (const c of catalog) {
      seen.add(c.url);
      out.push({
        url: c.url,
        name: c.name,
        category: c.category,
        isCustom: false,
        isTracked: trackedSet.has(c.url),
        catalog: c,
      });
    }
    // Custom feeds the user added but that aren't in the public catalog.
    for (const f of feeds) {
      if (seen.has(f.url)) continue;
      const catEntry = catalogMap.get(f.url);
      out.push({
        url: f.url,
        name: f.name,
        category: catEntry?.category ?? "Custom",
        isCustom: f.is_custom ?? !catEntry,
        isTracked: true,
        catalog: catEntry,
      });
    }
    return out;
  }, [catalog, feeds, trackedSet, catalogMap]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of unified) {
      if (f.category) map.set(f.category, (map.get(f.category) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
  }, [unified]);

  const filtered = useMemo(() => {
    let list = unified;
    if (trackedOnly) list = list.filter((f) => f.isTracked);
    if (selectedCategories.size > 0) {
      list = list.filter((f) => selectedCategories.has(f.category));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "category":
        sorted.sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.name.localeCompare(b.name),
        );
        break;
      case "activity":
        sorted.sort((a, b) => {
          const aTime = a.catalog?.last_success_at ?? "";
          const bTime = b.catalog?.last_success_at ?? "";
          return bTime.localeCompare(aTime);
        });
        break;
      case "default":
      default: {
        // Tracked first (custom feeds first within tracked), then untracked alpha.
        const order = new Map(feeds.map((f, i) => [f.url, i]));
        sorted.sort((a, b) => {
          if (a.isTracked && !b.isTracked) return -1;
          if (!a.isTracked && b.isTracked) return 1;
          if (a.isTracked && b.isTracked) {
            // Custom feeds before catalog tracked feeds
            if (a.isCustom && !b.isCustom) return -1;
            if (!a.isCustom && b.isCustom) return 1;
            return (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0);
          }
          return a.name.localeCompare(b.name);
        });
        break;
      }
    }
    return sorted;
  }, [
    unified,
    trackedOnly,
    selectedCategories,
    search,
    sort,
    feeds,
  ]);

  const toggleFeed = useCallback(
    (feed: UnifiedFeed) => {
      if (saving) return;
      if (feed.isTracked) {
        onRemove(feed.url);
      } else if (!atFeedLimit) {
        onAddCatalog(feed.url);
      }
    },
    [saving, atFeedLimit, onAddCatalog, onRemove],
  );

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const handleAddCustom = useCallback(() => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    if (!/^https?:\/\/.+/.test(url)) {
      setUrlError("Enter a full URL starting with http:// or https://");
      return;
    }
    setUrlError(null);
    onAddCustom(name, url);
    setNewName("");
    setNewUrl("");
    setShowCustomForm(false);
  }, [newName, newUrl, onAddCustom]);

  if (error) {
    return (
      <EmptySection
        icon={X}
        title="Couldn't load the feed catalog"
        description="Check your connection and try again."
      />
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 pb-5 min-h-0">
      <div className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-fg">Feeds</h3>
          <span
            className={clsx(
              "px-1.5 py-px rounded-full text-ui-chip font-medium tabular-nums",
              atFeedLimit ? "bg-warn/15 text-warn" : "bg-accent/15 text-accent",
            )}
          >
            {feeds.length}
            {maxFeeds !== Infinity && ` / ${maxFeeds}`}
          </span>
        </div>
        {!atFeedLimit && maxCustomFeeds > 0 && (
          <button
            onClick={() => setShowCustomForm((v) => !v)}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta font-medium",
              "transition-all duration-150 active:scale-95",
              showCustomForm
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-edge/40 text-fg-3 hover:text-accent hover:border-accent/40",
            )}
          >
            <Plus size={11} />
            Custom feed
          </button>
        )}
      </div>

      {atFeedLimit && (
        <div className="shrink-0">
          <UpgradePrompt
            current={feeds.length}
            max={maxFeeds}
            noun="feeds"
            tier={subscriptionTier}
          />
        </div>
      )}

      <AnimatePresence initial={false}>
        {showCustomForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
            className="shrink-0 overflow-hidden"
          >
            <div className="p-3 rounded-lg border border-edge/40 bg-surface-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-ui-section uppercase tracking-wider font-bold text-fg-3">
                  Add your own feed
                </span>
                {maxCustomFeeds !== Infinity && (
                  <span className="text-ui-chip text-fg-3 tabular-nums">
                    {customCount}/{maxCustomFeeds} custom
                  </span>
                )}
              </div>
              {atCustomLimit ? (
                <UpgradePrompt
                  current={customCount}
                  max={maxCustomFeeds}
                  noun="custom feeds"
                  tier={subscriptionTier}
                />
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Feed name"
                      className="flex-1 px-2.5 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta font-mono text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/60 transition-colors"
                    />
                    <input
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustom();
                      }}
                      placeholder="https://..."
                      className="flex-[2] px-2.5 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta font-mono text-fg-2 placeholder:text-fg-4 focus:outline-none focus:border-accent/60 transition-colors"
                    />
                    <button
                      onClick={handleAddCustom}
                      disabled={saving || !newName.trim() || !newUrl.trim()}
                      className="px-2.5 py-1.5 rounded-md bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 transition-all duration-150 active:scale-95 flex items-center gap-1 disabled:opacity-30 cursor-pointer"
                    >
                      <Plus size={11} />
                      <span className="text-ui-meta font-medium">Add</span>
                    </button>
                  </div>
                  {urlError && (
                    <p className="text-ui-meta text-error/80">{urlError}</p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
            placeholder="Search feeds..."
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
            trackedOnly
              ? "Showing your feeds only — click to show all"
              : "Show only your feeds"
          }
        >
          <button
            onClick={() => setTrackedOnly((v) => !v)}
            aria-pressed={trackedOnly}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta cursor-pointer whitespace-nowrap",
              "transition-all duration-200 active:scale-95",
              trackedOnly
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
            )}
          >
            <Star
              size={11}
              className={clsx(
                "transition-transform duration-200",
                trackedOnly && "fill-current rotate-[20deg]",
              )}
            />
            <span>Tracked</span>
          </button>
        </Tooltip>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1.5 rounded-md bg-base-200 border border-edge/40 text-ui-meta text-fg-2 focus:outline-none focus:border-accent/60 transition-colors cursor-pointer appearance-none"
          aria-label="Sort feeds"
        >
          <option value="default">Tracked first</option>
          <option value="name">Name</option>
          <option value="category">Category</option>
          <option value="activity">Last activity</option>
        </select>
      </div>

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

      {loading ? (
        <div className="shrink-0 text-center py-8">
          <p className="text-ui-meta text-fg-3 animate-pulse">Loading catalog...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="shrink-0">
          <EmptySection
            icon={SearchIcon}
            title={trackedOnly ? "No tracked feeds match" : "No matches"}
            description={
              trackedOnly
                ? "Try clearing the tracked-only filter or your search."
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
          {filtered.map((feed) => {
            const tracked = trackedMap.get(feed.url);
            return (
              <FeedRow
                key={feed.url}
                feed={feed}
                trackedSubscription={tracked}
                atLimit={atFeedLimit}
                saving={saving}
                onToggle={() => toggleFeed(feed)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

interface FeedRowProps {
  feed: UnifiedFeed;
  trackedSubscription: SubscribedFeed | undefined;
  atLimit: boolean;
  saving: boolean;
  onToggle: () => void;
}

function FeedRow({ feed, atLimit, saving, onToggle }: FeedRowProps) {
  const tracked = feed.isTracked;
  const blocked = !tracked && atLimit;
  const health = feedHealth(feed);

  return (
    <button
      type="button"
      role="listitem"
      onClick={onToggle}
      disabled={saving || blocked}
      aria-label={
        tracked
          ? `Remove ${feed.name}`
          : blocked
            ? `${feed.name} — at feed limit`
            : `Add ${feed.name}`
      }
      className={clsx(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all duration-150 group active:scale-[0.995]",
        tracked
          ? "bg-accent/[0.04] hover:bg-accent/[0.08]"
          : blocked
            ? "opacity-40 cursor-not-allowed"
            : "hover:bg-base-200/50 cursor-pointer",
        saving && "cursor-wait",
      )}
    >
      <span
        className={clsx(
          "shrink-0 w-5 h-5 flex items-center justify-center rounded-md transition-colors",
          tracked
            ? "bg-accent/20 text-accent"
            : "bg-surface-hover text-fg-4 group-hover:text-fg-2",
        )}
      >
        <motion.span
          key={tracked ? "check" : "plus"}
          initial={{ scale: 0.4, opacity: 0, rotate: tracked ? -45 : 45 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="flex items-center justify-center"
        >
          {tracked ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
        </motion.span>
      </span>

      <div className="shrink-0 w-5 h-5 flex items-center justify-center text-fg-4">
        <Rss size={12} />
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-ui-body font-medium text-fg-2 truncate block">
          {feed.name}
        </span>
        {feed.catalog?.last_success_at && tracked && (
          <span className="text-ui-meta text-fg-3 truncate block">
            {relativeTime(feed.catalog.last_success_at)}
          </span>
        )}
      </div>

      {feed.isCustom ? (
        <span className="shrink-0 px-1.5 py-px rounded text-ui-chip font-medium bg-amber-500/10 text-amber-500 border border-amber-500/30">
          custom
        </span>
      ) : (
        <span className="shrink-0 px-1.5 py-px rounded text-ui-chip text-fg-3 bg-surface-hover whitespace-nowrap">
          {feed.category}
        </span>
      )}

      {tracked && (
        <Tooltip content={healthTooltip(feed)} side="left">
          <span
            className={clsx(
              "shrink-0 w-1.5 h-1.5 rounded-full",
              health === "healthy" && "bg-green-500",
              health === "stale" && "bg-amber-500",
              health === "failing" && "bg-red-500",
            )}
          />
        </Tooltip>
      )}
    </button>
  );
}

// ── Health helpers ───────────────────────────────────────────────

function feedHealth(feed: UnifiedFeed): "healthy" | "stale" | "failing" {
  const c = feed.catalog;
  if (!c) return "stale";
  if (c.consecutive_failures > 0) return "failing";
  if (!c.last_success_at) return "stale";
  const hoursSince =
    (Date.now() - new Date(c.last_success_at).getTime()) / 3_600_000;
  if (hoursSince > 72) return "stale";
  return "healthy";
}

function healthTooltip(feed: UnifiedFeed): string {
  const c = feed.catalog;
  if (!c) return "Feed status unknown";
  if (c.consecutive_failures > 0) {
    return c.last_error
      ? `Feed failing: ${c.last_error}`
      : `Feed unreachable (${c.consecutive_failures} failures)`;
  }
  if (!c.last_success_at) return "No articles received yet";
  const hours = Math.round(
    (Date.now() - new Date(c.last_success_at).getTime()) / 3_600_000,
  );
  if (hours < 1) return "Last article: less than 1 hour ago";
  if (hours < 24) return `Last article: ${hours}h ago`;
  return `Last article: ${Math.round(hours / 24)}d ago`;
}

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
