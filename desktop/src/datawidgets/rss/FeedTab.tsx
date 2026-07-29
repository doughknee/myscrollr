/**
 * RSS FeedTab — desktop-native.
 *
 * Renders a filterable, sortable list of RSS articles with per-source
 * limiting, category badges, and real-time updates via the desktop
 * CDC/SSE pipeline.
 *
 * ONE Kalshi-style control bar (widget-bar primitives): Articles/Feeds
 * segmented switch (rss_custom only — curated widgets have an intrinsic
 * feed) · sort SelectMenu · source/category MultiSelectMenus with counts
 * · freshness · article-window SelectMenu (written as the per-widget
 * config.display override). The Feeds view mounts the
 * full FeedManager in-feed. Per-source "Show all" lives at the list
 * FOOTER as content, not chrome.
 */
import { memo, useMemo, useState, useCallback } from "react";
import { Rss, Newspaper, CalendarRange } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { dashboardQueryOptions, rssCatalogOptions } from "../../api/queries";
import { relativeTime, truncate } from "../../utils/format";
import EmptyWidgetState from "../../components/EmptyWidgetState";
import WidgetStateTransition from "../../components/WidgetStateTransition";
import { FEED_CARD, FEED_CARD_INTERACTIVE } from "../../components/feedCard";
import FreshnessPill from "../../components/FreshnessPill";
import { WidgetBar, BarDivider } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { MultiSelectMenu } from "../../components/widget-bar/MultiSelectMenu";
import { SelectMenu } from "../../components/widget-bar/SelectMenu";
import FeedManager from "./FeedManager";
import { useDataWidgetConfig } from "../../hooks/useDataWidgetConfig";
import { useShell } from "../../shell-context";
import { useNow } from "../../hooks/useNow";
import { useSetToggle, latestTimestamp } from "../feedHooks";
import {
  applyRssPipeline,
  type RssSortOrder,
  distinctSourceCount,
  getRssDisplayPrefs,
} from "./view";
import type {
  RssItem as RssItemType,
  FeedTabProps,
  FeedMode,
  DataWidgetManifest,
} from "../../types";
import type { WidgetId, RssWidgetConfig } from "../../api/client";
import type { RssDisplayPrefs } from "../../preferences";
import { RssHomeRows, rssHomeGroups } from "./home";

// ── DataWidgetRow manifest ─────────────────────────────────────────────

export const rssDataWidget: DataWidgetManifest = {
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
      "Manage feeds from the Feeds view (Custom RSS).",
      "Articles are sorted by publish date, newest first.",
      "Click any article to open it in your browser.",
    ],
  },
  FeedTab: RssFeedTab,
  HomeRows: RssHomeRows,
  homeGroups: rssHomeGroups,
};

// ── Sort type ────────────────────────────────────────────────────

type SortOrder = RssSortOrder;

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

type RssView = "articles" | "feeds";

/** Articles / Feeds — options for the Segmented view switch. The Feeds
 *  view (rss_custom only) is the Configure page's manager, in-feed. */
const VIEW_OPTIONS: SegmentedOption<RssView>[] = [
  { value: "articles", label: "Articles", icon: Newspaper },
  { value: "feeds", label: "Feeds", icon: Rss },
];

// ── FeedTab ──────────────────────────────────────────────────────

function RssFeedTab({ mode, feedContext, widgetId }: FeedTabProps) {
  const { prefs } = useShell();

  const dashboardLoaded = feedContext.__dashboardLoaded as boolean | undefined;

  const { data: dashboard } = useQuery(dashboardQueryOptions());
  const { data: catalog } = useQuery(rssCatalogOptions());

  // Shared 1s tick so every `RssArticle` advances its "Xm ago" label in
  // sync without each row spawning its own timer.
  const now = useNow();

  // This widget's widget row — source of its feed scope + display overrides.
  const widget = useMemo(
    () => dashboard?.widgets?.find((c) => c.widget_type === widgetId),
    [dashboard?.widgets, widgetId],
  );

  // Per-widget display overrides merged over the global rss display —
  // the same selector the ticker uses.
  const dp = useMemo(
    () => getRssDisplayPrefs(prefs.widgetDisplay.rss, dashboard, widgetId),
    [prefs.widgetDisplay.rss, dashboard, widgetId],
  );

  // Scope to this widget's own feeds (news_bbc → only the BBC feed;
  // rss_custom → only the user's added feeds). undefined = a legacy coarse
  // widget, which shows everything.
  const widgetFeedUrls = useMemo(() => {
    if (!widgetId || widgetId === "rss" || widgetId === "news") return undefined;
    const feeds = (
      widget?.config as { feeds?: Array<{ url?: string }> } | undefined
    )?.feeds;
    const urls = (Array.isArray(feeds) ? feeds : [])
      .map((f) => f.url)
      .filter((u): u is string => !!u);
    return new Set(urls);
  }, [widget?.config, widgetId]);

  const rssItems = useMemo(() => {
    const all = (dashboard?.data?.rss as RssItemType[] | undefined) ?? [];
    if (!widgetFeedUrls) return all;
    return all.filter((i) => widgetFeedUrls.has(i.feed_url));
  }, [dashboard?.data?.rss, widgetFeedUrls]);

  // Build category map: feed_url → category
  //
  // Defensive dedup: if the catalog returns the same URL twice (curated +
  // "Custom" leftover from the pre-fix duplication bug), prefer the
  // non-"Custom" category. The backend now filters these via
  // queryUserCatalog's NOT EXISTS clause and the cleanup migration drops
  // historical dupes, but this guard means a stale row anywhere upstream
  // can never re-label a curated feed in the UI.
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (catalog) {
      for (const feed of catalog) {
        if (!feed.category) continue;
        const existing = map.get(feed.url);
        // Don't overwrite a non-"Custom" category with "Custom".
        if (existing && existing !== "Custom" && feed.category === "Custom") {
          continue;
        }
        map.set(feed.url, feed.category);
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

  // ── View / filter / sort state ───────────────────────────────
  const isComfort = mode === "comfort";
  // Only rss_custom manages feeds; curated news widgets have an
  // intrinsic feed (and legacy coarse rows were consumed by migrations
  // 000015/000016 — they can't exist).
  const isCustom = widgetId === "rss_custom";
  const [view, setView] = useState<RssView>("articles");
  const [selectedSources, toggleSource, clearSources] = useSetToggle();
  const [selectedCategories, toggleCategory, clearCategories] = useSetToggle();
  // Sticky sort (2026-07-17 unification): initialized from the persisted
  // per-widget override (dp merges it); filters deliberately reset.
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    () => dp.feedSort ?? "newest",
  );
  const [showAll, setShowAll] = useState(false);

  // Per-source article counts — menu rows carry the numbers now.
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of rssItems) {
      counts[item.source_name] = (counts[item.source_name] ?? 0) + 1;
    }
    return counts;
  }, [rssItems]);

  const displayOverride = useMemo(
    () =>
      (widget?.config as { display?: Partial<RssDisplayPrefs> } | undefined)
        ?.display ?? {},
    [widget?.config],
  );
  const widgetType = (widget?.widget_type ?? widgetId ?? "rss");

  // Persists the sticky sort into this widget's config.display override
  // (same slot the time window uses; separate keyed hook from the bar's
  // so writes can't clobber each other's reads).
  const { updateItems: persistDisplay } = useDataWidgetConfig<
    Partial<RssDisplayPrefs>
  >(widgetType, "display");

  const pickSort = useCallback(
    (next: SortOrder) => {
      setSortOrder(next);
      setShowAll(false);
      persistDisplay({ ...displayOverride, feedSort: next });
    },
    [displayOverride, persistDisplay],
  );

  const pickWindow = useCallback(
    (days: number) => {
      persistDisplay({ ...displayOverride, maxArticleAgeDays: days });
    },
    [displayOverride, persistDisplay],
  );

  const pickMaxArticles = useCallback(
    (maxArticles: number) => {
      persistDisplay({ ...displayOverride, maxArticles });
    },
    [displayOverride, persistDisplay],
  );

  const clearAllFilters = useCallback(() => {
    clearSources();
    clearCategories();
  }, [clearSources, clearCategories]);

  const hasFilters = selectedSources.size > 0 || selectedCategories.size > 0;

  const latestUpdated = useMemo(
    () => latestTimestamp(rssItems, (i) => i.published_at ?? i.created_at),
    [rssItems],
  );

  // ── Data pipeline ────────────────────────────────────────────
  // Delegates to the shared `applyRssPipeline` selector so the feed page
  // and the ticker apply the same filter/sort/limit logic.
  const { visibleItems, totalHidden } = useMemo(
    () =>
      applyRssPipeline(rssItems, {
        selectedSources,
        selectedCategories,
        categoryMap,
        sortOrder,
        articlesPerSource: dp.articlesPerSource,
        maxArticles: dp.maxArticles,
        maxArticleAgeDays: dp.maxArticleAgeDays,
        showAll,
      }),
    [rssItems, selectedSources, selectedCategories, sortOrder, dp.articlesPerSource, dp.maxArticles, dp.maxArticleAgeDays, categoryMap, showAll],
  );

  // Single-outlet widgets have exactly one source; the per-source
  // limit UI only exists for multi-feed widgets (Custom RSS, legacy
  // News) — see v1.1.1 smart removal.
  const multiSource = useMemo(
    () => distinctSourceCount(rssItems) > 1,
    [rssItems],
  );

  const showEmpty = rssItems.length === 0;
  const showFeedsView = isComfort && isCustom && view === "feeds";

  return (
    // NO inner scroll container: the Source page (PageLayout) owns the
    // scroll — sticky pins against it.
    <div className="flex min-h-full flex-col">
      {isComfort && (
        <WidgetBar>
          {isCustom && (
            <Segmented
              ariaLabel="News view"
              value={view}
              onChange={setView}
              options={VIEW_OPTIONS}
            />
          )}

          {view === "articles" && !showEmpty ? (
            <>
              {isCustom && <BarDivider />}

              {/* Left cluster: the filters (Kalshi weighting — filters
                  anchor the left, utilities keep the right). Collapse
                  BEFORE clipping. */}
              <div className="flex shrink-0 items-center gap-2">
                <SelectMenu
                  value={sortOrder}
                  options={SORT_OPTIONS}
                  onChange={pickSort}
                  ariaLabel="Sort articles"
                  prefix="Sort"
                  align="left"
                />
                {allSources.length > 1 && (
                  <MultiSelectMenu
                    options={allSources}
                    counts={sourceCounts}
                    selected={Array.from(selectedSources)}
                    onToggle={toggleSource}
                    onClear={clearSources}
                    noun="sources"
                    ariaLabel="Filter by source"
                    align="left"
                  />
                )}
                {categoryList.length > 1 && (
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
                    align="left"
                  />
                )}
              </div>
              {/* Narrow: one Filter menu. */}
              <div className="ml-auto flex min-w-0 shrink items-center gap-2">
                {latestUpdated && (
                  <span className="hidden @xl:block">
                    <FreshnessPill lastUpdated={latestUpdated} label="article" />
                  </span>
                )}
                <RssLimitInput
                  maxArticles={dp.maxArticles}
                  onPick={pickMaxArticles}
                />
                <RssWindowSelect days={dp.maxArticleAgeDays} onPick={pickWindow} />
              </div>
            </>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <RssLimitInput
                maxArticles={dp.maxArticles}
                onPick={pickMaxArticles}
              />
              <RssWindowSelect days={dp.maxArticleAgeDays} onPick={pickWindow} />
            </div>
          )}
        </WidgetBar>
      )}

      <WidgetStateTransition
        stateKey={showFeedsView ? "feeds" : "articles"}
      >
        {showFeedsView ? (
          <RssFeedsPanel
            widgetType={widgetType}
            widgetConfig={widget?.config as RssWidgetConfig | undefined}
          />
        ) : showEmpty ? (
          <div className="flex flex-1 flex-col justify-center">
            <EmptyWidgetState
              refreshing={Boolean(feedContext.__refreshing)}
              icon={Rss}
              noun="feeds"
              hasConfig={!!feedContext.__hasConfig}
              dashboardLoaded={!!dashboardLoaded}
              loadingNoun="articles"
              actionHint="add websites"
              actionLabel={isComfort && isCustom ? "Add feeds" : undefined}
              onConfigure={
                isComfort && isCustom ? () => setView("feeds") : undefined
              }
            />
          </div>
        ) : (
          <>
          {/* No-results state */}
          {visibleItems.length === 0 && hasFilters && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <Rss size={28} className="text-fg-3" />
              <p className="text-sm text-fg-4">No articles match your filters</p>
              <button
                onClick={clearAllFilters}
                className="text-xs text-accent hover:text-accent/80  cursor-pointer"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Article list */}
          {visibleItems.length > 0 && (
            <div
              className={clsx(
                mode === "compact"
                  ? "grid grid-cols-1 gap-px bg-edge"
                  : "grid grid-cols-1 gap-2 p-3 sm:grid-cols-2",
              )}
            >
              {visibleItems.map((item) => (
                <RssArticle
                  key={`${item.feed_url}:${item.guid}`}
                  item={item}
                  mode={mode}
                  category={categoryMap.get(item.feed_url)}
                  now={now}
                />
              ))}
            </div>
          )}

          {/* Per-source limit — list FOOTER content, not chrome (the old
              info bands above the list are gone). Multi-source only:
              single-outlet widgets have no per-source concept. */}
          {multiSource && totalHidden > 0 && !showAll && (
            <div className="flex items-center justify-center gap-3 px-3 py-3">
              <button
                onClick={() => setShowAll(true)}
                className="px-4 py-1.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20  cursor-pointer"
              >
                Show all
              </button>
              <span className="text-xs text-fg-3 tabular-nums font-mono">
                {totalHidden} hidden · {dp.articlesPerSource} per source
              </span>
            </div>
          )}
          {multiSource && showAll && totalHidden === 0 && dp.articlesPerSource > 0 && (
            <div className="flex items-center justify-center px-3 py-3">
              <button
                onClick={() => setShowAll(false)}
                className="px-4 py-1.5 rounded-md text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20  cursor-pointer"
              >
                Limit to {dp.articlesPerSource} per source
              </button>
            </div>
          )}
          </>
        )}
      </WidgetStateTransition>
    </div>
  );
}

// ── Article window (per-widget display override, in the bar) ────
//
// Same write the old gear's ArticleAgeControl made: the widget's
// `config.display` override, merged over the global rss display
// everywhere it's read. 0 = no age filter.

function RssLimitInput({
  maxArticles,
  onPick,
}: {
  maxArticles: number;
  onPick: (maxArticles: number) => void;
}) {
  return (
    <label className="flex h-7 items-center gap-1 rounded-lg border border-edge/30 bg-base-150/60 px-2 text-ui-meta text-fg-3">
      <span>Show</span>
      <input
        key={maxArticles}
        type="number"
        min={1}
        step={1}
        defaultValue={maxArticles || ""}
        placeholder="All"
        aria-label="Maximum articles; leave blank for all"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const value = e.currentTarget.valueAsNumber;
          const next =
            Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
          e.currentTarget.value = next ? String(next) : "";
          onPick(next);
        }}
        className="w-10 bg-transparent text-center font-mono text-fg outline-none placeholder:text-fg-4"
      />
    </label>
  );
}

const AGE_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "Today" },
  { value: "3", label: "3 days" },
  { value: "7", label: "Week" },
  { value: "0", label: "All" },
];

function RssWindowSelect({
  days,
  onPick,
}: {
  days: number;
  onPick: (days: number) => void;
}) {
  // A stored custom window (old gear's stepper) gets its own row so the
  // trigger never shows a value the menu doesn't contain.
  const options = AGE_OPTIONS.some((o) => o.value === String(days))
    ? AGE_OPTIONS
    : [...AGE_OPTIONS, { value: String(days), label: `${days} days` }];
  return (
    <SelectMenu
      ariaLabel="Article time window"
      icon={CalendarRange}
      value={String(days)}
      options={options}
      onChange={(v) => onPick(Number(v))}
    />
  );
}

// ── Feeds view (the Configure page's manager, mounted in-feed) ──

function RssFeedsPanel({
  widgetType,
  widgetConfig,
}: {
  widgetType: WidgetId;
  widgetConfig: RssWidgetConfig | undefined;
}) {
  const { error, setError, saving, updateItems } = useDataWidgetConfig<
    Array<{ name: string; url: string; is_custom?: boolean }>
  >(widgetType, "feeds");

  const feeds = useMemo(
    () => (Array.isArray(widgetConfig?.feeds) ? widgetConfig.feeds : []),
    [widgetConfig?.feeds],
  );
  const feedUrlSet = useMemo(() => new Set(feeds.map((f) => f.url)), [feeds]);

  // Two catalogs: "clean" (curated, healthy feeds for browsing) and
  // "all" (includes failing feeds + the user's customs, used for
  // health badges on rows the user has already subscribed to).
  const {
    data: catalog = [],
    isLoading: catalogLoading,
    isError: catalogError,
  } = useQuery(rssCatalogOptions());
  const { data: catalogAll = [] } = useQuery(
    rssCatalogOptions({ includeFailing: true }),
  );

  const addCatalogFeed = useCallback(
    (url: string) => {
      const allFeeds = [...catalog, ...catalogAll];
      const feed = allFeeds.find((f) => f.url === url);
      if (!feed || feedUrlSet.has(url)) return;
      updateItems([...feeds, { name: feed.name, url: feed.url }]);
    },
    [catalog, catalogAll, feeds, feedUrlSet, updateItems],
  );

  const removeFeed = useCallback(
    (url: string) => {
      updateItems(feeds.filter((f) => f.url !== url));
    },
    [feeds, updateItems],
  );

  const addCustomFeed = useCallback(
    (name: string, url: string) => {
      if (feedUrlSet.has(url)) {
        toast.error("This feed is already added");
        return;
      }
      updateItems([...feeds, { name, url, is_custom: true }]);
    },
    [feeds, feedUrlSet, updateItems],
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
      <FeedManager
        feeds={feeds}
        catalog={catalog}
        catalogAll={catalogAll}
        onAddCatalog={addCatalogFeed}
        onAddCustom={addCustomFeed}
        onRemove={removeFeed}
        loading={catalogLoading}
        error={catalogError}
        saving={saving}
      />
    </div>
  );
}

// ── RssArticle ──────────────────────────────────────────────────

interface RssArticleProps {
  item: RssItemType;
  mode: FeedMode;
  category?: string;
  /** Shared "now" from `useNow()` so the "Xm ago" label advances between renders. */
  now: number;
}

const RssArticle = memo(function RssArticle({ item, mode, category, now }: RssArticleProps) {
  const ago = relativeTime(item.published_at, now);

  const categoryBadge = category ? (
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
        className="flex items-center gap-2 px-3 py-1.5 bg-surface text-xs hover:bg-surface-hover  cursor-pointer"
      >
        <span className="font-mono text-ui-section text-accent shrink-0 min-w-[56px] max-w-[80px] truncate uppercase tracking-wider font-bold">
          {item.source_name}
        </span>
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
      className={clsx(FEED_CARD, FEED_CARD_INTERACTIVE, "block")}
    >
      <span className="text-sm font-medium text-fg leading-snug line-clamp-2">
        {item.title}
      </span>
      {item.description && (
        <p className="mt-1 text-xs text-fg-2 leading-relaxed line-clamp-2">
          {truncate(item.description, 160)}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-ui-section font-mono font-bold text-accent uppercase tracking-wider">
          {item.source_name}
        </span>
        {categoryBadge}
        {ago && (
          <span className="text-ui-chip font-mono text-fg-3 tabular-nums">
            {ago}
          </span>
        )}
      </div>
    </a>
  );
}, (prev, next) =>
  prev.mode === next.mode &&
  prev.category === next.category &&
  prev.now === next.now &&
  prev.item.guid === next.item.guid &&
  prev.item.feed_url === next.item.feed_url &&
  prev.item.title === next.item.title &&
  prev.item.description === next.item.description &&
  prev.item.link === next.item.link &&
  prev.item.source_name === next.item.source_name &&
  prev.item.published_at === next.item.published_at
);
