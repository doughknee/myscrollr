/**
 * CDC table registry — single source of truth for how CDC records
 * are processed, keyed, validated, and sorted.
 *
 * Both the ticker window (App.tsx) and the main window (__root.tsx)
 * import this registry so CDC merge behaviour is identical everywhere.
 *
 * Adding a new CDC-backed channel = add one entry to CDC_TABLES.
 */
import type { Trade, Game, RssItem } from "./types";
import type { SubscriptionTier } from "./auth";

// ── CDC Table Config ─────────────────────────────────────────────

export interface CDCTableConfig {
  /** CDC table name from Sequin (e.g. "trades"). */
  table: string;
  /** Key into DashboardResponse.data (e.g. "finance"). */
  dataKey: string;
  /** Extract a unique key from a record for upsert / dedup. */
  keyOf: (item: unknown) => string;
  /** Optional sort comparator applied after every mutation. */
  sort?: (a: unknown, b: unknown) => number;
  /** Max items to keep in the cache slice. Defaults to 50. */
  maxItems: number;
  /** Whether CDC may add records that are not already in this user's slice. */
  allowInsert?: boolean;
  /** Return false to skip a malformed CDC record. */
  validate?: (record: Record<string, unknown>) => boolean;
}

export const CDC_TABLES: CDCTableConfig[] = [
  {
    table: "trades",
    dataKey: "finance",
    keyOf: (item) => (item as Trade).symbol,
    sort: (a, b) =>
      (a as Trade).symbol.localeCompare((b as Trade).symbol),
    validate: (r) => typeof r.symbol === "string",
    maxItems: 50,
  },
  {
    table: "games",
    dataKey: "sports",
    keyOf: (item) => String((item as Game).id),
    validate: (r) => r.id != null,
    allowInsert: false,
    maxItems: 50,
  },
  {
    table: "rss_items",
    dataKey: "rss",
    keyOf: (item) => {
      const r = item as RssItem;
      return `${r.feed_url}:${r.guid}`;
    },
    sort: (a, b) => {
      const ta = (a as RssItem).published_at
        ? new Date((a as RssItem).published_at!).getTime()
        : 0;
      const tb = (b as RssItem).published_at
        ? new Date((b as RssItem).published_at!).getTime()
        : 0;
      return tb - ta;
    },
    validate: (r) =>
      typeof r.feed_url === "string" && typeof r.guid === "string",
    maxItems: 50,
  },
];

// ── Shared Constants ─────────────────────────────────────────────

/** Tier-based polling intervals shared by both windows. */
export const POLL_INTERVALS: Record<SubscriptionTier, number> = {
  free: 60_000,
  uplink: 30_000,
  uplink_pro: 10_000,
  uplink_ultimate: 30_000, // SSE is primary; polling is a safety-net
  super_user: 30_000,      // SSE is primary; same as ultimate
};

/**
 * Delay before re-fetching after an SSE config-change event, giving
 * the backend time to propagate the update before we query.
 */
export const SSE_REFETCH_DELAY_MS = 500;
