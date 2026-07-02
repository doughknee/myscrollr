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
import type { RssDisplayPrefs } from "../../preferences";

export type RssSortOrder = "newest" | "oldest" | "by-source";

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
  // by-source
  return [...items].sort((a, b) => {
    const cmp = a.source_name.localeCompare(b.source_name, undefined, { sensitivity: "base" });
    if (cmp !== 0) return cmp;
    const aTime = a.published_at ?? a.created_at;
    const bTime = b.published_at ?? b.created_at;
    return bTime.localeCompare(aTime);
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
): RssItem[] {
  const ordered = sortRssItems(items, "newest");
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
  /** Feed-page interactive toggle that disables the per-source limit. */
  showAll?: boolean;
  /** Feed-page: sources the user has expanded in by-source view. */
  expandedSources?: Set<string>;
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
    showAll,
    expandedSources,
  } = opts;

  let filtered = items;

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
  const isBySource = sortOrder === "by-source";

  // Per-source limiting only means anything when several sources are
  // competing — single-outlet widgets show their whole feed (v1.1.1).
  const multiSource = distinctSourceCount(items) > 1;

  if (multiSource && articlesPerSource > 0 && !showAll) {
    const sourceCounts = new Map<string, number>();
    const limited: RssItem[] = [];

    for (const item of sorted) {
      const count = sourceCounts.get(item.source_name) ?? 0;
      const isExpanded = !!(isBySource && expandedSources?.has(item.source_name));

      if (isExpanded || count < articlesPerSource) {
        limited.push(item);
      }
      sourceCounts.set(item.source_name, count + 1);
    }

    let hidden = 0;
    for (const [source, total] of sourceCounts) {
      const expanded = !!(isBySource && expandedSources?.has(source));
      if (total > articlesPerSource && !expanded) {
        overflow.set(source, total - articlesPerSource);
        hidden += total - articlesPerSource;
      }
    }

    return { visibleItems: limited, overflowCounts: overflow, totalHidden: hidden };
  }

  return { visibleItems: sorted, overflowCounts: overflow, totalHidden: 0 };
}
