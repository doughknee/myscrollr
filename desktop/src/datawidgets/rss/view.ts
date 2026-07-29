/**
 * RSS view selectors — shared filter/sort/limit pipeline.
 *
 * Both `FeedTab` (main window) and `ScrollrTicker` consume `selectRssForTicker`
 * (or the richer `applyRssPipeline` for interactive filters) to produce a
 * curated item list. This is the SINGLE SOURCE OF TRUTH for how RSS items
 * should be filtered, sorted, and limited per the user's Display prefs.
 *
 * Keeping this in one place prevents the ticker from drifting out of sync
 * with the feed page, which is what caused display prefs (per-source limit,
 * sort order) to work on the feed but not the ticker prior to this module.
 */
import type { RssItem } from "../../types";
import { migrateRssDisplay, type RssDisplayPrefs } from "../../preferences";

export type RssSortOrder = "newest" | "oldest";

// ── Pure: sort ───────────────────────────────────────────────────

function sortRssItems(items: RssItem[], order: RssSortOrder): RssItem[] {
  if (order === "newest") {
    // Default order from CDC pipeline is already newest-first.
    return items;
  }
  if (order === "oldest") {
    return [...items].sort((a, b) => {
      const aTime = a.published_at ?? a.created_at;
      const bTime = b.published_at ?? b.created_at;
      return aTime.localeCompare(bTime);
    });
  }
  return items;
}

// ── Pure: article-age window (v1.1.3 Time Controls) ─────────────

const DAY_MS = 86_400_000;

/**
 * Drop articles older than `maxAgeDays` (published_at, falling back to
 * created_at). 0 = no filter. Unparseable timestamps stay visible rather
 * than silently vanishing. `now` is injectable for tests.
 *
 * The cutoff is anchored to LOCAL CALENDAR DAYS, matching the sports
 * window: maxAgeDays 1 = "published today", 3 = today + the two prior
 * days — not a rolling 24h/72h period that would hide this morning's
 * article at 11pm.
 */
export function filterByArticleAge(
  items: RssItem[],
  maxAgeDays: number,
  now: number = Date.now(),
): RssItem[] {
  if (maxAgeDays <= 0) return items;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const cutoff = dayStart.getTime() - (maxAgeDays - 1) * DAY_MS;
  return items.filter((i) => {
    const t = new Date(i.published_at ?? i.created_at).getTime();
    return !Number.isFinite(t) || t >= cutoff;
  });
}

// ── Pure: per-source limit ───────────────────────────────────────

/**
 * Cap the number of items shown per source. `limit === 0` means "no limit".
 * Keeps the first N items encountered per source, in the order given
 * (so pair this with a sort step that establishes the desired ordering).
 */
export function limitPerSource(items: RssItem[], limit: number): RssItem[] {
  if (limit <= 0) return items;
  const counts = new Map<string, number>();
  const result: RssItem[] = [];
  for (const item of items) {
    const count = counts.get(item.source_name) ?? 0;
    if (count < limit) {
      result.push(item);
      counts.set(item.source_name, count + 1);
    }
  }
  return result;
}

// ── Pure: selector for the ticker ────────────────────────────────

/**
 * Baseline pipeline used by the ticker: applies per-source limit (from Display
 * prefs) and ensures the default "newest-first" ordering.
 *
 * The ticker doesn't expose interactive filters (source/category selection,
 * sort toggle). If those are added later, surface them as arguments here.
 */
export function selectRssForTicker(
  items: RssItem[],
  prefs: RssDisplayPrefs,
  now: number = Date.now(),
): RssItem[] {
  // Age window first (v1.1.3) so the per-source balancer only allocates
  // slots among articles that are actually eligible to show.
  const fresh = filterByArticleAge(items, prefs.maxArticleAgeDays ?? 0, now);
  const ordered = sortRssItems(fresh, "newest");
  // Single-outlet widgets (news_bbc, news_npr, ...) have exactly one
  // source — a per-source cap there just hides articles for no reason
  // (v1.1.1 "smart removal"). The balancer only makes sense when
  // multiple feeds compete for space (Custom RSS, legacy News).
  if (distinctSourceCount(ordered) <= 1) return ordered;
  return limitPerSource(ordered, prefs.articlesPerSource);
}

/** Number of distinct sources present in a payload. Widgets are already
 *  scoped per widget upstream, so this is "how many feeds does THIS
 *  widget aggregate" — 1 for outlet widgets, N for Custom RSS. */
export function distinctSourceCount(items: RssItem[]): number {
  const sources = new Set<string>();
  for (const item of items) sources.add(item.source_name);
  return sources.size;
}

// ── Helper: per-widget display prefs (global + config.display) ──

import type { DashboardResponse } from "../../types";

/**
 * Resolve a widget's effective RSS display prefs: the global
 * `prefs.widgetDisplay.rss` with the widget row's `config.display`
 * override merged on top — the same merge FeedTab does. Added in
 * v1.1.3 so the TICKER honors per-widget overrides (time window,
 * per-source limit) instead of only the global prefs; mirror of
 * `getSportsDisplayConfig`.
 */
export function getRssDisplayPrefs(
  globalPrefs: RssDisplayPrefs,
  dashboard: DashboardResponse | null | undefined,
  widgetType?: string,
): RssDisplayPrefs {
  const widgets = dashboard?.widgets ?? [];
  // widget_type is a widget id at runtime (news_bbc, rss_custom, …);
  // compare as string so the legacy coarse rows ("rss" pre-000014,
  // "news" post-rename) both resolve as the fallback.
  const widget =
    (widgetType
      ? widgets.find((c) => (c.widget_type as string) === widgetType)
      : undefined) ??
    widgets.find((c) => {
      const t = c.widget_type as string;
      return t === "rss" || t === "news";
    });
  const override = (
    widget?.config as { display?: Partial<RssDisplayPrefs> } | undefined
  )?.display;
  if (!override) return globalPrefs;
  return migrateRssDisplay({ ...globalPrefs, ...override });
}

// ── Pipeline result (for FeedTab) ────────────────────────────────

export interface RssPipelineOptions {
  /** User's per-source selected filter (feed-page only). Empty set = no filter. */
  selectedSources?: Set<string>;
  /** User's per-category filter (feed-page only). Empty set = no filter. */
  selectedCategories?: Set<string>;
  /** Required to resolve categories. */
  categoryMap: Map<string, string>;
  /** Current sort order. */
  sortOrder: RssSortOrder;
  /** Per-source limit (from Display prefs). 0 = no limit. */
  articlesPerSource: number;
  /** Total feed limit after filtering and sorting. 0 = no limit. */
  maxArticles?: number;
  /** Article-age window in days (v1.1.3). 0 = no filter. */
  maxArticleAgeDays?: number;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
  /** Feed-page interactive toggle that disables the per-source limit. */
  showAll?: boolean;
}

export interface RssPipelineResult {
  visibleItems: RssItem[];
  /** Map of source_name → hidden count (only populated when limit > 0). */
  overflowCounts: Map<string, number>;
  /** Total items hidden by the per-source limit. */
  totalHidden: number;
}

/**
 * Full interactive pipeline used by the feed page. Applies source + category
 * filters, sort, and per-source limit with per-source expansion support.
 */
export function applyRssPipeline(
  items: RssItem[],
  opts: RssPipelineOptions,
): RssPipelineResult {
  const {
    selectedSources,
    selectedCategories,
    categoryMap,
    sortOrder,
    articlesPerSource,
    maxArticles = 0,
    maxArticleAgeDays = 0,
    now = Date.now(),
    showAll,
  } = opts;

  // Age window first (v1.1.3) — everything downstream (filters, limit,
  // overflow counts) should only ever see eligible articles.
  let filtered = filterByArticleAge(items, maxArticleAgeDays, now);

  if (selectedSources && selectedSources.size > 0) {
    filtered = filtered.filter((i) => selectedSources.has(i.source_name));
  }

  if (selectedCategories && selectedCategories.size > 0) {
    filtered = filtered.filter((i) => {
      const cat = categoryMap.get(i.feed_url);
      return cat != null && selectedCategories.has(cat);
    });
  }

  const sorted = sortRssItems(filtered, sortOrder);

  const overflow = new Map<string, number>();
  // Per-source limiting only means anything when several sources are
  // competing — single-outlet widgets show their whole feed (v1.1.1).
  const multiSource = distinctSourceCount(items) > 1;

  if (multiSource && articlesPerSource > 0 && !showAll) {
    const sourceCounts = new Map<string, number>();
    const limited: RssItem[] = [];

    for (const item of sorted) {
      const count = sourceCounts.get(item.source_name) ?? 0;
      if (count < articlesPerSource) {
        limited.push(item);
      }
      sourceCounts.set(item.source_name, count + 1);
    }

    let hidden = 0;
    for (const [source, total] of sourceCounts) {
      if (total > articlesPerSource) {
        overflow.set(source, total - articlesPerSource);
        hidden += total - articlesPerSource;
      }
    }

    return {
      visibleItems: maxArticles > 0 ? limited.slice(0, maxArticles) : limited,
      overflowCounts: overflow,
      totalHidden: hidden,
    };
  }

  return {
    visibleItems: maxArticles > 0 ? sorted.slice(0, maxArticles) : sorted,
    overflowCounts: overflow,
    totalHidden: 0,
  };
}
