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
import { rotateSlots } from "../ticker";
import { plainText } from "../../utils/rssText";
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
/**
 * The ticker's own horizon for headlines. Independent of the widget page:
 * the feed's sort, source filters, "Show N" and time window are about
 * reading a list, and none of them reach the rail. The rail has one rule
 * and the user never configures it.
 *
 * Eligible is everything from the last TICKER_RSS_HOURS. A feed with
 * nothing in that window still gets its latest item, provided that item
 * is under TICKER_RSS_FLOOR_HOURS old: the floor keeps a QUIET feed
 * represented, not a dead one. What is eligible then rotates through
 * TICKER_RSS_SLOTS fixed positions (arrangeRssSlots), so a wire that
 * posts thirty articles in an hour is still three chips on the bar and
 * every article still comes round.
 */
export const TICKER_RSS_HOURS = 6;
export const TICKER_RSS_FLOOR_HOURS = 48;
/**
 * Three headlines on the rail at once. Headline chips are the widest on
 * the bar (up to the 640 cap) and a news widget is usually one feed, so
 * three is about the width a league's four game chips take.
 */
export const TICKER_RSS_SLOTS = 3;

/**
 * Everything eligible for the rail, newest first but interleaved by feed,
 * so on a multi-feed widget one loud wire cannot own the front of every
 * slot's rotation.
 */
export function selectRssForTicker(items: RssItem[], now: number = Date.now()): RssItem[] {
  const sorted = sortRssItems(items, "newest");
  const cutoff = now - TICKER_RSS_HOURS * 3_600_000;
  const floorCutoff = now - TICKER_RSS_FLOOR_HOURS * 3_600_000;
  const perFeed = new Map<string, RssItem[]>();
  const newest = new Map<string, RssItem>();
  for (const it of sorted) {
    const t = new Date(it.published_at ?? it.created_at).getTime();
    // An undated item is treated as current rather than dropped: the feed
    // gave us no reason to think it is old.
    if (!newest.has(it.feed_url) && !(Number.isFinite(t) && t < floorCutoff)) newest.set(it.feed_url, it);
    if (Number.isFinite(t) && t < cutoff) continue;
    perFeed.set(it.feed_url, [...(perFeed.get(it.feed_url) ?? []), it]);
  }
  for (const [feed, top] of newest) {
    if (!perFeed.has(feed)) perFeed.set(feed, [top]);
  }
  // Interleave: feeds in order of their newest item, one item from each in turn.
  const lists = [...perFeed.values()];
  const out: RssItem[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

/** One rail position for headlines. */
export interface RssSlot {
  key: string;
  item: RssItem;
  rotateSlot?: string;
  /** The longest headline this slot will show, so its width holds across swaps. */
  reserveTitle?: string;
}

/** Eligible headlines laid out as TICKER_RSS_SLOTS rotating positions. */
export function arrangeRssSlots(
  eligible: RssItem[],
  cycles: Readonly<Record<string, number>>,
  keyPrefix: string,
): RssSlot[] {
  return rotateSlots(eligible, TICKER_RSS_SLOTS, cycles, keyPrefix, (it) => it.id, (cls) =>
    cls.map((it) => plainText(it.title)).reduce((a, b) => (b.length > a.length ? b : a), ""),
  ).map((r) => ({ key: r.key, item: r.item, rotateSlot: r.rotateSlot, reserveTitle: r.reserve }));
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
