/**
 * The embed's data (SCROLLR-310): turns the anonymous public feed into the
 * signed-in `/dashboard` shape the ticker reads, so the app runs unchanged.
 *
 * What `/public/feed` lacks, and what stands in for it here:
 *   - no `widgets` / `preferences`: rows are built from the catalog
 *     snapshot's default configs for the widgets the page asked for;
 *     `?widgets=` (feedUrl) narrows the feed to those widgets' data
 *     (SCROLLR-315);
 *   - `rss` holds the curated news feeds only (SCROLLR-313); when it is
 *     missing or empty, news rows come from the bundled fixture (the caller
 *     passes them in);
 *   - `sports` is `{ sports, meta }` where the dashboard has `sports` and
 *     `sports_meta`, and holds up to 40 games per league (SCROLLR-313), so
 *     a league whose next game is days out may still be absent (its page
 *     shows the league status line instead).
 */
import snapshot from "../catalog.snapshot.json";

type Row = Record<string, unknown>;
export interface EmbedDashboard {
  data: Record<string, unknown>;
  widgets: Row[];
  preferences: Row;
}

interface CatalogEntry {
  id: string;
  category?: string;
  default_config?: Row;
}
const CATALOG = snapshot.widgets as CatalogEntry[];

/**
 * A fresh account's starter (SCROLLR-283): NPR + Stocks, the Clock on the
 * edge. Stocks leads: its rows are live, NPR's are the fixture's.
 */
export const STARTER = ["finance_stocks", "news_npr"];

/** `nfl` or `sports_nfl` → the catalog id. Unknown names are dropped. */
export function resolveWidget(name: string): string | null {
  const ids = [name, `sports_${name}`, `news_${name}`, `finance_${name}`];
  return ids.find((id) => CATALOG.some((w) => w.id === id)) ?? null;
}

export function isUtility(id: string): boolean {
  return CATALOG.find((w) => w.id === id)?.category === "utility";
}

/** The feed URL for `ids`: only their data (SCROLLR-315); utilities need none, so none means the full feed. */
export function feedUrl(base: string, ids: string[] | null): string {
  const data = ids?.filter((id) => !isUtility(id)) ?? [];
  return data.length ? `${base}?widgets=${data.join(",")}` : base;
}

/** Dashboard widget rows for the data widgets among `ids`, as the server writes them. */
export function widgetRows(ids: string[]): Row[] {
  return ids
    .filter((id) => !isUtility(id))
    .map((id, i) => ({
      id: i + 1,
      widget_type: id,
      enabled: true,
      ticker_enabled: true,
      config: CATALOG.find((w) => w.id === id)?.default_config ?? {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }));
}

interface Game {
  league?: string;
  state?: string;
  start_time?: string;
}

/**
 * The sports widget with games tonight: the first in catalog order (the
 * big leagues lead) with a game live or starting within 12 hours.
 */
export function sportsTonight(games: Game[], now: number): string | null {
  const busy = new Set(
    games
      .filter((g) => g.state === "in" || (g.state === "pre" && Date.parse(g.start_time ?? "") - now < 12 * 3600e3))
      .map((g) => g.league),
  );
  const hit = CATALOG.find((w) => {
    const leagues = (w.default_config?.leagues as string[] | undefined) ?? [];
    return w.category === "sports" && leagues.some((l) => busy.has(l));
  });
  return hit?.id ?? null;
}

export const PREFERENCES: Row = {
  feed_mode: "compact",
  feed_position: "bottom",
  feed_behavior: "overlay",
  feed_enabled: true,
  enabled_sites: [],
  disabled_sites: [],
  subscription_tier: "free",
  default_widgets_applied: true,
  updated_at: "2026-01-01T00:00:00Z",
};

/** The public feed as a dashboard for `ids`, `fallbackRss` when it has no news; null when it carries nothing. */
export function fromPublicFeed(body: unknown, ids: string[], fallbackRss: Row[]): EmbedDashboard | null {
  const data = (body as { data?: { finance?: Row[]; sports?: { sports?: Row[]; meta?: Row }; rss?: Row[] } })?.data;
  const finance = data?.finance ?? [];
  const sports = data?.sports?.sports ?? [];
  if (finance.length === 0 && sports.length === 0 && !data?.rss?.length) return null;
  return {
    data: {
      finance,
      sports,
      sports_meta: data?.sports?.meta ?? { leagues: [] },
      rss: data?.rss?.length ? data.rss : fallbackRss,
    },
    widgets: widgetRows(ids),
    preferences: PREFERENCES,
  };
}

/** Shift every ISO timestamp by `delta` ms (a fixture, seen as captured just now). */
export function rebase<T>(node: T, delta: number): T {
  if (typeof node === "string") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(node)) return node;
    const t = Date.parse(node);
    return (Number.isNaN(t) ? node : new Date(t + delta).toISOString()) as T;
  }
  if (Array.isArray(node)) return node.map((n) => rebase(n, delta)) as T;
  if (node && typeof node === "object") {
    const out: Row = {};
    for (const [k, v] of Object.entries(node)) out[k] = rebase(v, delta);
    return out as T;
  }
  return node;
}
