# RSS Feed Tab & Display Tab Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the RSS feed tab into a balanced, filterable article feed with per-source limits, category badges, and expanded display settings.

**Architecture:** All filtering, sorting, and per-source limiting is applied client-side via a `useMemo` pipeline on existing `dashboard.data.rss` data. Category data is resolved by querying the RSS catalog (`TrackedFeed.category`) and building a `feedUrl → category` lookup map. No backend changes needed.

**Tech Stack:** React 19, TanStack Query, Tailwind CSS v4, clsx

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `desktop/src/preferences.ts` | Modify | Add `articlesPerSource` to `RssDisplayPrefs` |
| `desktop/src/channels/rss/FeedTab.tsx` | Major rewrite | Controls bar, per-source limiting, category badges, "show more" rows |
| `desktop/src/routes/channel.$type.$tab.tsx` | Modify | Add articlesPerSource segmented control to `RssDisplay` |

---

### Task 1: Add `articlesPerSource` preference

**Files:**
- Modify: `desktop/src/preferences.ts:171-175` (RssDisplayPrefs interface)
- Modify: `desktop/src/preferences.ts:292` (DEFAULT_CHANNEL_DISPLAY rss defaults)

- [ ] **Step 1: Add `articlesPerSource` to the `RssDisplayPrefs` interface**

In `desktop/src/preferences.ts`, find the `RssDisplayPrefs` interface (line 171-175) and add the new field:

```typescript
export interface RssDisplayPrefs {
  showDescription: boolean;
  showSource: boolean;
  showTimestamps: boolean;
  articlesPerSource: number; // 1, 3, 5, 10, or 0 (all)
}
```

- [ ] **Step 2: Update the default value**

In the same file, find the `DEFAULT_CHANNEL_DISPLAY` constant (line 290-294). Update the `rss` entry:

```typescript
  rss: { showDescription: true, showSource: true, showTimestamps: true, articlesPerSource: 3 },
```

- [ ] **Step 3: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build (Vite bundle + tsc --noEmit). Existing consumers of `RssDisplayPrefs` still compile because the new field has a default via `loadPrefs()` deep-merge.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/preferences.ts
git commit -m "feat(desktop): add articlesPerSource to RSS display prefs (default 3)"
```

---

### Task 2: Add articlesPerSource setting to Display tab

**Files:**
- Modify: `desktop/src/routes/channel.$type.$tab.tsx:223-257` (RssDisplay component)

- [ ] **Step 1: Add the segmented control import**

The file already imports `Section`, `ToggleRow`, `ResetButton` from `../../components/settings/SettingsControls` (line 18). Add `SegmentedRow` to that import:

```typescript
import { Section, ToggleRow, ResetButton, SegmentedRow } from "../components/settings/SettingsControls";
```

- [ ] **Step 2: Add the articlesPerSource control to `RssDisplay`**

Find the `RssDisplay` function (line 223). Replace the entire function with:

```typescript
function RssDisplay() {
  const { prefs, onPrefsChange } = useShell();
  const dp = prefs.channelDisplay.rss;

  function toggle(key: keyof Pick<RssDisplayPrefs, "showDescription" | "showSource" | "showTimestamps">) {
    onPrefsChange({
      ...prefs,
      channelDisplay: {
        ...prefs.channelDisplay,
        rss: { ...dp, [key]: !dp[key] },
      },
    });
  }

  function setArticlesPerSource(value: string) {
    onPrefsChange({
      ...prefs,
      channelDisplay: {
        ...prefs.channelDisplay,
        rss: { ...dp, articlesPerSource: Number(value) },
      },
    });
  }

  function handleReset() {
    onPrefsChange({
      ...prefs,
      channelDisplay: {
        ...prefs.channelDisplay,
        rss: { showDescription: true, showSource: true, showTimestamps: true, articlesPerSource: 3 },
      },
    });
  }

  const ARTICLES_PER_SOURCE_OPTIONS = [
    { value: "1", label: "1" },
    { value: "3", label: "3" },
    { value: "5", label: "5" },
    { value: "10", label: "10" },
    { value: "0", label: "All" },
  ];

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <Section title="Feed & Ticker">
        <ToggleRow label="Show description" checked={dp.showDescription} onChange={() => toggle("showDescription")} />
        <ToggleRow label="Show source name" checked={dp.showSource} onChange={() => toggle("showSource")} />
        <ToggleRow label="Show timestamps" checked={dp.showTimestamps} onChange={() => toggle("showTimestamps")} />
      </Section>
      <Section title="Feed Balance">
        <SegmentedRow
          label="Articles per source"
          description="Limit how many articles appear from each feed"
          value={String(dp.articlesPerSource)}
          options={ARTICLES_PER_SOURCE_OPTIONS}
          onChange={setArticlesPerSource}
        />
      </Section>
      <ResetButton label="Reset display settings" onClick={handleReset} />
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. The `SegmentedRow` import, `Section` usage, and new handler all compile.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/routes/channel.\$type.\$tab.tsx
git commit -m "feat(desktop): add articles-per-source setting to RSS display tab"
```

---

### Task 3: Rewrite RSS FeedTab with controls, filtering, and per-source limiting

**Files:**
- Rewrite: `desktop/src/channels/rss/FeedTab.tsx` (170 lines → ~350-400 lines)

This is the main task. The FeedTab gains: a controls bar (source filter, category filter, sort), a per-source article limit pipeline, category badges on article cards, and "show more" rows.

- [ ] **Step 1: Write the complete new FeedTab**

Replace the entire contents of `desktop/src/channels/rss/FeedTab.tsx` with:

```tsx
/**
 * RSS FeedTab — desktop-native.
 *
 * Balanced article feed with per-source limiting, source/category
 * filtering, sort controls, and category badges. Real-time updates
 * via the desktop CDC/SSE pipeline.
 */
import { memo, useMemo, useState, useCallback } from "react";
import { Rss, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, rssCatalogOptions } from "../../api/queries";
import { timeAgo, truncate } from "../../utils/format";
import EmptyChannelState from "../../components/EmptyChannelState";
import CategoryFilter from "./CategoryFilter";
import { useShell } from "../../shell-context";
import type {
  RssItem as RssItemType,
  FeedTabProps,
  FeedMode,
  ChannelManifest,
} from "../../types";
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

// ── Sort types ───────────────────────────────────────────────────

type SortMode = "newest" | "oldest" | "by-source";

// ── FeedTab ──────────────────────────────────────────────────────

function RssFeedTab({ mode, feedContext, onConfigure }: FeedTabProps) {
  const { prefs } = useShell();
  const dp = prefs.channelDisplay.rss;

  // ── Filter / sort state ──────────────────────────────────────
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  // ── Data sources ─────────────────────────────────────────────
  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog = [] } = useQuery(rssCatalogOptions());

  const rssItems = useMemo(
    () => (dashboard?.data?.rss as RssItemType[] | undefined) ?? [],
    [dashboard?.data?.rss],
  );

  // Build feedUrl → category lookup from catalog
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const feed of catalog) {
      map.set(feed.url, feed.category);
    }
    return map;
  }, [catalog]);

  // ── Unique sources and categories from current articles ──────
  const { sources, categories } = useMemo(() => {
    const sourceSet = new Set<string>();
    const catCounts = new Map<string, number>();
    for (const item of rssItems) {
      sourceSet.add(item.source_name);
      const cat = categoryMap.get(item.feed_url);
      if (cat) {
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
      }
    }
    const sortedSources = Array.from(sourceSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    const sortedCategories = Array.from(catCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));
    return { sources: sortedSources, categories: sortedCategories };
  }, [rssItems, categoryMap]);

  // ── Filter + sort + limit pipeline ───────────────────────────
  const { visibleItems, overflowCounts } = useMemo(() => {
    let items = [...rssItems];

    // Source filter
    if (selectedSources.size > 0) {
      items = items.filter((item) => selectedSources.has(item.source_name));
    }

    // Category filter
    if (selectedCategories.size > 0) {
      items = items.filter((item) => {
        const cat = categoryMap.get(item.feed_url);
        return cat != null && selectedCategories.has(cat);
      });
    }

    // Sort
    if (sortMode === "oldest") {
      items.sort((a, b) => {
        const aTime = a.published_at ?? a.created_at;
        const bTime = b.published_at ?? b.created_at;
        return aTime.localeCompare(bTime);
      });
    } else if (sortMode === "by-source") {
      items.sort((a, b) => {
        const cmp = a.source_name.localeCompare(b.source_name, undefined, { sensitivity: "base" });
        if (cmp !== 0) return cmp;
        // Within source: newest first
        const aTime = a.published_at ?? a.created_at;
        const bTime = b.published_at ?? b.created_at;
        return bTime.localeCompare(aTime);
      });
    }
    // "newest" is the default order from the dashboard/CDC pipeline — no re-sort needed

    // Per-source limit
    const limit = dp.articlesPerSource;
    const overflow = new Map<string, number>();

    if (limit > 0) {
      const counts = new Map<string, number>();
      const filtered: RssItemType[] = [];

      for (const item of items) {
        const src = item.source_name;
        const count = counts.get(src) ?? 0;
        const isExpanded = expandedSources.has(src);

        if (isExpanded || count < limit) {
          filtered.push(item);
        }
        counts.set(src, count + 1);
      }

      // Compute overflow counts
      for (const [src, total] of counts) {
        if (!expandedSources.has(src) && total > limit) {
          overflow.set(src, total - limit);
        }
      }

      return { visibleItems: filtered, overflowCounts: overflow };
    }

    return { visibleItems: items, overflowCounts: new Map<string, number>() };
  }, [rssItems, selectedSources, selectedCategories, sortMode, dp.articlesPerSource, expandedSources, categoryMap]);

  // ── Handlers ─────────────────────────────────────────────────
  const toggleSource = useCallback((source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setSelectedSources(new Set());
    setSelectedCategories(new Set());
  }, []);

  const hasActiveFilters = selectedSources.size > 0 || selectedCategories.size > 0;

  // ── Empty state ──────────────────────────────────────────────
  if (rssItems.length === 0) {
    return (
      <EmptyChannelState
        icon={Rss}
        noun="feeds"
        hasConfig={!!feedContext.__hasConfig}
        dashboardLoaded={!!feedContext.__dashboardLoaded}
        loadingNoun="articles"
        actionHint="add websites"
        onConfigure={onConfigure}
      />
    );
  }

  // ── Build render list (articles + "show more" rows) ──────────
  const renderList: Array<
    | { type: "article"; item: RssItemType }
    | { type: "show-more"; source: string; count: number }
  > = [];

  // Track which sources have had their "show more" row inserted
  const insertedShowMore = new Set<string>();
  let lastSource: string | null = null;

  for (const item of visibleItems) {
    // If we switched sources and the previous source has overflow, insert "show more"
    if (lastSource !== null && lastSource !== item.source_name && !insertedShowMore.has(lastSource)) {
      const overflow = overflowCounts.get(lastSource);
      if (overflow) {
        renderList.push({ type: "show-more", source: lastSource, count: overflow });
        insertedShowMore.add(lastSource);
      }
    }
    renderList.push({ type: "article", item });
    lastSource = item.source_name;
  }
  // Handle overflow for the very last source
  if (lastSource && !insertedShowMore.has(lastSource)) {
    const overflow = overflowCounts.get(lastSource);
    if (overflow) {
      renderList.push({ type: "show-more", source: lastSource, count: overflow });
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div>
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-surface border-b border-edge/20">
        {/* Source filter */}
        <SourceFilter
          sources={sources}
          selected={selectedSources}
          onToggle={toggleSource}
          onClearAll={() => setSelectedSources(new Set())}
        />

        {/* Category filter (reuse from config panel) */}
        <CategoryFilter
          categories={categories}
          selected={selectedCategories}
          onToggle={toggleCategory}
          onClearAll={() => setSelectedCategories(new Set())}
        />

        {/* Sort */}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="px-2 py-1.5 rounded-md border border-edge/30 bg-transparent text-[11px] text-fg-3 focus:outline-none focus:border-accent/30 transition-colors cursor-pointer"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="by-source">By source</option>
        </select>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-surface border-b border-edge/10">
          {Array.from(selectedSources).map((src) => (
            <button
              key={`src-${src}`}
              onClick={() => toggleSource(src)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] text-accent hover:bg-accent/15 transition-colors cursor-pointer"
            >
              {src}
              <span className="opacity-60">×</span>
            </button>
          ))}
          {Array.from(selectedCategories).map((cat) => (
            <button
              key={`cat-${cat}`}
              onClick={() => toggleCategory(cat)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] text-accent hover:bg-accent/15 transition-colors cursor-pointer"
            >
              {cat}
              <span className="opacity-60">×</span>
            </button>
          ))}
          <button
            onClick={clearAllFilters}
            className="px-2 py-0.5 text-[10px] text-fg-4 hover:text-fg-3 transition-colors cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Articles */}
      {visibleItems.length === 0 && hasActiveFilters ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-xs text-fg-4 mb-2">No articles match your filters</p>
          <button
            onClick={clearAllFilters}
            className="text-xs text-accent hover:text-accent/80 transition-colors cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div
          className={clsx(
            "grid gap-px bg-edge",
            mode === "compact" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
          )}
        >
          {renderList.map((entry) => {
            if (entry.type === "show-more") {
              return (
                <ShowMoreRow
                  key={`more-${entry.source}`}
                  source={entry.source}
                  count={entry.count}
                  onExpand={() => toggleExpanded(entry.source)}
                />
              );
            }
            return (
              <RssArticle
                key={`${entry.item.feed_url}:${entry.item.guid}`}
                item={entry.item}
                mode={mode}
                display={dp}
                category={categoryMap.get(entry.item.feed_url)}
              />
            );
          })}

          {/* Collapse buttons for expanded sources */}
          {expandedSources.size > 0 &&
            Array.from(expandedSources).map((src) => {
              // Only show collapse if this source actually had overflow
              const total = rssItems.filter((i) => i.source_name === src).length;
              if (total <= dp.articlesPerSource) return null;
              return (
                <CollapseRow
                  key={`collapse-${src}`}
                  source={src}
                  onCollapse={() => toggleExpanded(src)}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── SourceFilter ────────────────────────────────────────────────
// Similar to CategoryFilter but for source names

interface SourceFilterProps {
  sources: string[];
  selected: Set<string>;
  onToggle: (source: string) => void;
  onClearAll: () => void;
}

function SourceFilter({ sources, selected, onToggle, onClearAll }: SourceFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeCount = selected.size;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] transition-colors cursor-pointer whitespace-nowrap",
          activeCount > 0
            ? "border-accent/30 text-accent"
            : "border-edge/30 text-fg-4 hover:text-fg-3 hover:border-edge/50",
        )}
      >
        <Rss size={12} />
        <span>Sources</span>
        {activeCount > 0 && (
          <span className="bg-accent/20 text-accent rounded-full px-1.5 text-[10px] font-medium">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 max-h-64 overflow-y-auto bg-surface-2 border border-edge/30 rounded-lg shadow-lg z-50 py-1">
          {sources.map((src) => {
            const isActive = selected.has(src);
            return (
              <button
                key={src}
                onClick={() => onToggle(src)}
                className={clsx(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12px] transition-colors cursor-pointer",
                  isActive ? "text-fg-2" : "text-fg-4 hover:text-fg-3",
                )}
              >
                <span
                  className={clsx(
                    "w-3.5 h-3.5 rounded border flex items-center justify-center text-[10px] shrink-0",
                    isActive
                      ? "bg-accent/20 border-accent/40 text-accent"
                      : "border-edge/40",
                  )}
                >
                  {isActive && "✓"}
                </span>
                <span className="flex-1 truncate">{src}</span>
              </button>
            );
          })}
          {activeCount > 0 && (
            <>
              <div className="h-px bg-edge/20 my-1" />
              <button
                onClick={() => {
                  onClearAll();
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] text-fg-4 hover:text-fg-3 transition-colors cursor-pointer"
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

// ── ShowMoreRow ──────────────────────────────────────────────────

interface ShowMoreRowProps {
  source: string;
  count: number;
  onExpand: () => void;
}

function ShowMoreRow({ source, count, onExpand }: ShowMoreRowProps) {
  return (
    <button
      onClick={onExpand}
      className="col-span-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-hover transition-colors text-[11px] cursor-pointer"
    >
      <ChevronDown size={12} className="text-fg-4" />
      <span className="text-fg-4">
        <span className="text-fg-3 font-medium">{count} more</span> from{" "}
        <span className="font-mono text-accent/60 uppercase tracking-wider text-[9px] font-bold">
          {source}
        </span>
      </span>
    </button>
  );
}

// ── CollapseRow ─────────────────────────────────────────────────

interface CollapseRowProps {
  source: string;
  onCollapse: () => void;
}

function CollapseRow({ source, onCollapse }: CollapseRowProps) {
  return (
    <button
      onClick={onCollapse}
      className="col-span-full flex items-center gap-2 px-3 py-2 bg-surface hover:bg-surface-hover transition-colors text-[11px] cursor-pointer"
    >
      <ChevronUp size={12} className="text-fg-4" />
      <span className="text-fg-4">
        Collapse{" "}
        <span className="font-mono text-accent/60 uppercase tracking-wider text-[9px] font-bold">
          {source}
        </span>
      </span>
    </button>
  );
}

// ── RssArticle ──────────────────────────────────────────────────

interface RssArticleProps {
  item: RssItemType;
  mode: FeedMode;
  display: RssDisplayPrefs;
  category?: string;
}

const RssArticle = memo(function RssArticle({
  item,
  mode,
  display,
  category,
}: RssArticleProps) {
  const ago = display.showTimestamps ? timeAgo(item.published_at) : null;

  const categoryBadge = display.showSource && category ? (
    <span className="px-1.5 py-px rounded text-[8px] text-fg-4/50 bg-accent/5 shrink-0 whitespace-nowrap">
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
        {display.showSource && (
          <span className="font-mono text-[9px] text-accent/70 shrink-0 min-w-[56px] max-w-[80px] truncate uppercase tracking-wider font-bold">
            {item.source_name}
          </span>
        )}
        {categoryBadge}
        <span className="text-fg truncate flex-1">{item.title}</span>
        {ago && (
          <span className="text-fg-4 shrink-0 text-[9px] font-mono tabular-nums">
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
      className="block px-3 py-2.5 bg-surface hover:bg-surface-hover transition-colors cursor-pointer border-l-2 border-l-accent/10 hover:border-l-accent/30"
    >
      <span className="text-sm font-medium text-fg leading-snug line-clamp-2">
        {item.title}
      </span>
      {display.showDescription && item.description && (
        <p className="mt-1 text-xs text-fg-2 leading-relaxed line-clamp-2">
          {truncate(item.description, 160)}
        </p>
      )}
      {(display.showSource || ago) && (
        <div className="flex items-center gap-2 mt-1.5">
          {display.showSource && (
            <span className="text-[9px] font-mono font-bold text-accent/60 uppercase tracking-wider">
              {item.source_name}
            </span>
          )}
          {categoryBadge}
          {ago && (
            <span className="text-[9px] font-mono text-fg-4 tabular-nums">
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
  prev.item.guid === next.item.guid &&
  prev.item.feed_url === next.item.feed_url &&
  prev.item.title === next.item.title &&
  prev.item.description === next.item.description &&
  prev.item.link === next.item.link &&
  prev.item.source_name === next.item.source_name &&
  prev.item.published_at === next.item.published_at
);
```

**IMPORTANT:** The `SourceFilter` component uses `useRef` and `useEffect` — make sure the top-level import line includes them:

```typescript
import { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
```

- [ ] **Step 2: Verify build**

Run: `npm run build` in `desktop/`
Expected: Clean build. All imports resolve, types match, no unused variables.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/channels/rss/FeedTab.tsx
git commit -m "feat(desktop): rewrite RSS feed tab with filters, per-source limits, and category badges"
```

---

### Task 4: Manual testing and polish

**Files:**
- Potentially modify: `desktop/src/channels/rss/FeedTab.tsx` (based on testing findings)

- [ ] **Step 1: Test with `npm run tauri:dev`**

Run: `npm run tauri:dev` in `desktop/`

Test checklist:
1. Navigate to `/channel/rss/feed` — verify controls bar appears with Sources, Categories, and sort dropdown
2. Verify articles are limited to 3 per source by default
3. Click "Show more" on a truncated source — verify it expands
4. Click "Collapse" — verify it re-limits
5. Toggle source filter — verify articles filter correctly
6. Toggle category filter — verify articles filter correctly
7. Change sort to "Oldest first" — verify order reverses
8. Change sort to "By source" — verify grouping
9. Apply both source and category filters — verify chips appear and can be dismissed
10. Click "Clear all" on filter chips — verify all filters reset
11. Navigate to `/channel/rss/display` — verify "Articles per source" segmented control appears
12. Change the value to "1" — verify feed shows only 1 article per source
13. Change to "All" — verify no limiting
14. Switch between compact and comfort modes — verify category badges appear in both

- [ ] **Step 2: Fix any issues found during testing**

Address any visual issues, spacing problems, or interaction bugs found during manual testing.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(desktop): polish RSS feed tab based on manual testing"
```
