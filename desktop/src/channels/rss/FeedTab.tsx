/**
 * RSS FeedTab — desktop-native.
 *
 * Renders a filterable, sortable list of RSS articles with per-source
 * limiting, category badges, and real-time updates via the desktop
 * CDC/SSE pipeline.
 */
import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Rss, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, rssCatalogOptions } from "../../api/queries";
import { relativeTime, truncate } from "../../utils/format";
import EmptyChannelState from "../../components/EmptyChannelState";
import FreshnessPill from "../../components/FreshnessPill";
import CategoryFilter from "./CategoryFilter";
import { useShell } from "../../shell-context";
import { useNow } from "../../hooks/useNow";
import { applyRssPipeline, type RssSortOrder } from "./view";
import type {
  RssItem as RssItemType,
  FeedTabProps,
  FeedMode,
  ChannelManifest,
} from "../../types";
import { shouldShowOnFeed } from "../../preferences";
import type { RssDisplayPrefs } from "../../preferences";

// ── Channel manifest ─────────────────────────────────────────────

export const rssChannel: ChannelManifest = {
  id: "rss",
  name: "News",
  tabLabel: "News",
  description: "Articles from your favorite feeds",
  hex: "#a855f7",
  icon: Rss,
  info: {
    about:
      "Collect articles from your favorite websites into one place. " +
      "New articles appear automatically as they are published.",
    usage: [
      "Add news sources from the Settings tab.",
      "Articles are sorted by publish date, newest first.",
      "Click any article to open it in your browser.",
    ],
  },
  FeedTab: RssFeedTab,
};

// ── Sort type ────────────────────────────────────────────────────

type SortOrder = RssSortOrder;

// ── SourceFilter ─────────────────────────────────────────────────

interface SourceFilterProps {
  sources: string[];
  selected: Set<string>;
  onToggle: (source: string) => void;
  onClearAll: () => void;
}

function SourceFilter({ sources, selected, onToggle, onClearAll }: SourceFilterProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = selected.size;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-ui-meta transition-colors cursor-pointer whitespace-nowrap",
          activeCount > 0
            ? "border-accent/50 text-accent"
            : "border-edge/40 text-fg-3 hover:text-fg-2 hover:border-edge/60",
        )}
      >
        <Rss size={12} />
        <span>Sources</span>
        {activeCount > 0 && (
          <span className="bg-accent/20 text-accent rounded-full px-1.5 text-ui-chip font-medium">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 w-52 bg-surface-2 border border-edge/50 rounded-lg shadow-lg z-[5] py-1 max-h-64 overflow-y-auto">
          {sources.map((source) => {
            const isActive = selected.has(source);
            return (
              <button
                key={source}
                onClick={() => onToggle(source)}
                className={clsx(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-left text-ui-meta transition-colors cursor-pointer",
                  isActive
                    ? "text-fg-2"
                    : "text-fg-4 hover:text-fg-3",
                )}
              >
                <span
                  className={clsx(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center text-ui-chip shrink-0",
                    isActive
                      ? "bg-accent/25 border-accent/50 text-accent"
                      : "border-edge/50",
                  )}
                >
                  {isActive && "\u2713"}
                </span>
                <span className="flex-1 truncate">{source}</span>
              </button>
            );
          })}
          {activeCount > 0 && (
            <>
              <div className="h-px bg-edge/40 my-1" />
              <button
                onClick={() => {
                  onClearAll();
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-ui-meta text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
              >
                Clear all filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── FeedTab ──────────────────────────────────────────────────────

function RssFeedTab({ mode, feedContext, onConfigure }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.rss;

  const dashboardLoaded = feedContext.__dashboardLoaded as boolean | undefined;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(rssCatalogOptions());

  // Shared 1s tick so every `RssArticle` advances its "Xm ago" label in
  // sync without each row spawning its own timer.
  const now = useNow();

  const rssItems = useMemo(
    () => (dashboard?.data?.rss as RssItemType[] | undefined) ?? [],
    [dashboard?.data?.rss],
  );

  // Build category map: feed_url → category
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (catalog) {
      for (const feed of catalog) {
        if (feed.category) {
          map.set(feed.url, feed.category);
        }
      }
    }
    return map;
  }, [catalog]);

  // Derive all unique source names (sorted alphabetically)
  const allSources = useMemo(() => {
    const set = new Set<string>();
    for (const item of rssItems) {
      set.add(item.source_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rssItems]);

  // Derive categories with counts from current items
  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of rssItems) {
      const cat = categoryMap.get(item.feed_url);
      if (cat) {
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rssItems, categoryMap]);

  // ── Filter / sort state ──────────────────────────────────────
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const toggleSource = useCallback((source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const clearSources = useCallback(() => setSelectedSources(new Set()), []);

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const clearCategories = useCallback(() => setSelectedCategories(new Set()), []);

  const clearAllFilters = useCallback(() => {
    setSelectedSources(new Set());
    setSelectedCategories(new Set());
  }, []);

  const toggleExpanded = useCallback((source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const hasFilters = selectedSources.size > 0 || selectedCategories.size > 0;

  // Most-recent item timestamp (published_at ?? created_at) — drives the FreshnessPill.
  const latestUpdated = useMemo(() => {
    let latest = 0;
    for (const item of rssItems) {
      const raw = item.published_at ?? item.created_at;
      if (!raw) continue;
      const ts = new Date(raw).getTime();
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : null;
  }, [rssItems]);

  // ── Data pipeline ────────────────────────────────────────────
  // Delegates to the shared `applyRssPipeline` selector so the feed page
  // and the ticker apply the same filter/sort/limit logic.
  const { visibleItems, overflowCounts, totalHidden } = useMemo(
    () =>
      applyRssPipeline(rssItems, {
        selectedSources,
        selectedCategories,
        categoryMap,
        sortOrder,
        articlesPerSource: dp.articlesPerSource,
        showAll,
        expandedSources,
      }),
    [rssItems, selectedSources, selectedCategories, sortOrder, dp.articlesPerSource, categoryMap, expandedSources, showAll],
  );

  // ── Build render list ──────────────────────────────────────────
  type RenderEntry =
    | { kind: "article"; item: RssItemType; category?: string }
    | { kind: "source-header"; source: string; overflow: number; expanded: boolean };

  const isBySource = sortOrder === "by-source";

  const renderList = useMemo(() => {
    const entries: RenderEntry[] = [];

    if (isBySource) {
      // Group by source — header contains the expand/collapse action
      let currentSource: string | null = null;

      for (const item of visibleItems) {
        if (item.source_name !== currentSource) {
          currentSource = item.source_name;
          const overflow = overflowCounts.get(currentSource) ?? 0;
          const expanded = expandedSources.has(currentSource);
          entries.push({
            kind: "source-header",
            source: currentSource,
            overflow,
            expanded,
          });
        }

        entries.push({
          kind: "article",
          item,
          category: categoryMap.get(item.feed_url),
        });
      }
    } else {
      // Chronological sorts: plain article list
      for (const item of visibleItems) {
        entries.push({
          kind: "article",
          item,
          category: categoryMap.get(item.feed_url),
        });
      }
    }

    return entries;
  }, [visibleItems, overflowCounts, expandedSources, categoryMap, isBySource]);

  // ── Empty state (no data at all) ─────────────────────────────
  if (rssItems.length === 0) {
    return (
      <EmptyChannelState
        icon={Rss}
        noun="feeds"
        channelName="RSS"
        hasConfig={!!feedContext.__hasConfig}
        dashboardLoaded={!!dashboardLoaded}
        loadingNoun="articles"
        actionHint="add websites"
        onConfigure={onConfigure}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="sticky top-0 z-20 bg-surface border-b border-edge/40 px-3 py-2 flex items-center gap-2 flex-wrap">
        <SourceFilter
          sources={allSources}
          selected={selectedSources}
          onToggle={toggleSource}
          onClearAll={clearSources}
        />
        <CategoryFilter
          categories={categoryList}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClearAll={clearCategories}
        />
        {latestUpdated && <FreshnessPill lastUpdated={latestUpdated} label="article" />}
        <div className="ml-auto">
          <select
            value={sortOrder}
            onChange={(e) => {
              setSortOrder(e.target.value as SortOrder);
              setShowAll(false);
              setExpandedSources(new Set());
            }}
            className="bg-surface-2 border border-edge/40 rounded-md px-2 py-1.5 text-ui-meta text-fg-2 cursor-pointer outline-none focus:border-accent/60"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="by-source">By Source</option>
          </select>
        </div>
      </div>

      {/* Filter chips */}
      {hasFilters && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border-b border-edge/30 flex-wrap">
          {Array.from(selectedSources).map((s) => (
            <button
              key={`src:${s}`}
              onClick={() => toggleSource(s)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/15 text-accent text-ui-chip hover:bg-accent/25 transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[120px]">{s}</span>
              <span className="text-accent/60">&times;</span>
            </button>
          ))}
          {Array.from(selectedCategories).map((c) => (
            <button
              key={`cat:${c}`}
              onClick={() => toggleCategory(c)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 text-ui-chip hover:bg-purple-500/25 transition-colors cursor-pointer"
            >
              <span className="truncate max-w-[120px]">{c}</span>
              <span className="text-purple-400/60">&times;</span>
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="px-2 py-0.5 text-ui-chip text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Per-source limit info bar (chronological sorts only) */}
      {!isBySource && totalHidden > 0 && !showAll && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-edge/30 text-ui-meta text-fg-3">
          <span>
            Showing {dp.articlesPerSource} per source &middot;{" "}
            <span className="tabular-nums">{totalHidden}</span> articles hidden
          </span>
          <button
            onClick={() => setShowAll(true)}
            className="text-accent hover:text-accent/80 transition-colors cursor-pointer font-medium"
          >
            Show all
          </button>
        </div>
      )}
      {!isBySource && showAll && totalHidden === 0 && dp.articlesPerSource > 0 && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-edge/30 text-ui-meta text-fg-3">
          <span>Showing all articles</span>
          <button
            onClick={() => setShowAll(false)}
            className="text-accent hover:text-accent/80 transition-colors cursor-pointer font-medium"
          >
            Limit to {dp.articlesPerSource} per source
          </button>
        </div>
      )}

      {/* No-results state */}
      {visibleItems.length === 0 && hasFilters && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Rss size={28} className="text-fg-3" />
          <p className="text-sm text-fg-4">No articles match your filters</p>
          <button
            onClick={clearAllFilters}
            className="text-xs text-accent hover:text-accent/80 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Article list */}
      {visibleItems.length > 0 && (
        <div
          className={clsx(
            "grid gap-px bg-edge flex-1",
            mode === "compact"
              ? "grid-cols-1"
              : "grid-cols-1 sm:grid-cols-2",
          )}
        >
          {renderList.map((entry) => {
            if (entry.kind === "source-header") {
              return (
                <SourceHeader
                  key={`hdr:${entry.source}`}
                  source={entry.source}
                  category={categoryMap.get(
                    rssItems.find((i) => i.source_name === entry.source)?.feed_url ?? "",
                  )}
                  overflow={entry.overflow}
                  expanded={entry.expanded}
                  onToggle={() => toggleExpanded(entry.source)}
                />
              );
            }
            return (
              <RssArticle
                key={`${entry.item.feed_url}:${entry.item.guid}`}
                item={entry.item}
                mode={mode}
                display={dp}
                category={entry.category}
                now={now}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SourceHeader (by-source sort) ────────────────────────────────

interface SourceHeaderProps {
  source: string;
  category?: string;
  overflow: number;
  expanded: boolean;
  onToggle: () => void;
}

function SourceHeader({ source, category, overflow, expanded, onToggle }: SourceHeaderProps) {
  const hasAction = overflow > 0 || expanded;

  return (
    <div className="col-span-full flex items-center gap-2 px-3 py-2 bg-surface-2 border-b border-edge/30">
      <span className="font-mono text-ui-section font-bold text-fg-2 uppercase tracking-wider">
        {source}
      </span>
      {category && (
        <span className="px-1.5 py-px rounded text-ui-chip text-fg-3 bg-accent/10">
          {category}
        </span>
      )}
      {hasAction && (
        <button
          onClick={onToggle}
          className="ml-auto flex items-center gap-1 text-ui-chip text-accent hover:text-accent/80 transition-colors cursor-pointer"
        >
          {overflow > 0 ? (
            <>
              <span>{overflow} more</span>
              <ChevronDown size={11} />
            </>
          ) : (
            <>
              <span>Collapse</span>
              <ChevronUp size={11} />
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ── RssArticle ──────────────────────────────────────────────────

interface RssArticleProps {
  item: RssItemType;
  mode: FeedMode;
  display: RssDisplayPrefs;
  category?: string;
  /** Shared "now" from `useNow()` so the "Xm ago" label advances between renders. */
  now: number;
}

const RssArticle = memo(function RssArticle({ item, mode, display, category, now }: RssArticleProps) {
  const showSource = shouldShowOnFeed(display.showSource);
  const showTimestamps = shouldShowOnFeed(display.showTimestamps);
  const showDescription = shouldShowOnFeed(display.showDescription);
  const ago = showTimestamps ? relativeTime(item.published_at, now) : null;

  const categoryBadge = showSource && category ? (
    <span className="px-1.5 py-px rounded text-ui-chip text-fg-3 bg-accent/10 shrink-0 whitespace-nowrap">
      {category}
    </span>
  ) : null;

  if (mode === "compact") {
    return (
      <a
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-1.5 bg-surface text-xs hover:bg-surface-hover transition-colors cursor-pointer"
      >
        {showSource && (
          <span className="font-mono text-ui-section text-accent shrink-0 min-w-[56px] max-w-[80px] truncate uppercase tracking-wider font-bold">
            {item.source_name}
          </span>
        )}
        {categoryBadge}
        <span className="text-fg truncate flex-1">{item.title}</span>
        {ago && (
          <span className="text-fg-3 shrink-0 text-ui-chip font-mono tabular-nums">
            {ago}
          </span>
        )}
      </a>
    );
  }

  // Comfort mode
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-3 py-2.5 bg-surface hover:bg-surface-hover transition-colors cursor-pointer border-l-2 border-l-accent/25 hover:border-l-accent/50"
    >
      <span className="text-sm font-medium text-fg leading-snug line-clamp-2">
        {item.title}
      </span>
      {showDescription && item.description && (
        <p className="mt-1 text-xs text-fg-2 leading-relaxed line-clamp-2">
          {truncate(item.description, 160)}
        </p>
      )}
      {(showSource || ago) && (
        <div className="flex items-center gap-2 mt-1.5">
          {showSource && (
            <span className="text-ui-section font-mono font-bold text-accent uppercase tracking-wider">
              {item.source_name}
            </span>
          )}
          {categoryBadge}
          {ago && (
            <span className="text-ui-chip font-mono text-fg-3 tabular-nums">
              {ago}
            </span>
          )}
        </div>
      )}
    </a>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.display === next.display &&
  prev.category === next.category &&
  // Only re-render on the `now` tick when this row actually renders
  // a timestamp — otherwise the tick would churn the whole list for
  // no visible change.
  (!shouldShowOnFeed(next.display.showTimestamps) || prev.now === next.now) &&
  prev.item.guid === next.item.guid &&
  prev.item.feed_url === next.item.feed_url &&
  prev.item.title === next.item.title &&
  prev.item.description === next.item.description &&
  prev.item.link === next.item.link &&
  prev.item.source_name === next.item.source_name &&
  prev.item.published_at === next.item.published_at
);
