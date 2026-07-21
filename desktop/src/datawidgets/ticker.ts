/**
 * The ticker's `source → renderer` registry (VISION §4.1, backlog #5).
 *
 * ScrollrTicker used to carry a per-source if/switch ladder: a `fantasy`
 * branch plus `case "finance" | "sports" | "rss" | "predictions"`, each
 * reaching for that source's display prefs, selector, and chip component.
 * Adding a source meant editing an 884-line component.
 *
 * Now each source exports a `TickerSource` from its own folder and the
 * ticker just looks one up. Two things fall out of that:
 *   - a source the client doesn't have simply renders nothing, instead of
 *     falling through a switch (VISION §4.2, constraint 2);
 *   - chip building is a pure function per source, so it is unit-testable
 *     without mounting the ticker.
 */
import type { ReactNode } from "react";

import type { DashboardResponse } from "../types";
import type { ChipColorMode, WidgetDisplayPrefs } from "../preferences";
import { scopeSourceData } from "../utils/widgetScope";

/** One rendered chip plus the stable key the ticker wraps it with. */
export interface TickerChip {
  key: string;
  node: ReactNode;
}

/** Everything a source needs to build its chips. */
export interface TickerContext {
  /** The widget id this bucket is for (sports_nfl, news_bbc, …). */
  tab: string;
  /** The resolved data source (sports, rss, …). */
  source: string;
  dashboard: DashboardResponse | null;
  comfort: boolean;
  chipColorMode: ChipColorMode;
  widgetDisplay?: WidgetDisplayPrefs;
  /** Starred prediction markets, live across windows. */
  predictionsWatchlist: ReadonlySet<string>;
  onChipClick?: (
    widgetType: string,
    itemId: string | number,
    url?: string,
  ) => void;
}

export interface TickerSource {
  /**
   * Build this source's chips from its slice of dashboard.data.
   *
   * Receives the payload raw — most sources get an array, fantasy gets a
   * `{ leagues: [...] }` object — and returns an empty array when it has
   * nothing to show (missing prefs, empty payload).
   */
  chips(raw: unknown, ctx: TickerContext): TickerChip[];
}

/**
 * Narrow a raw payload to this widget's own rows.
 *
 * Shared by the array-shaped sources: the dashboard is keyed by coarse
 * source, so an NFL widget must scope the shared `sports` payload down to
 * its configured leagues (likewise symbols for finance, feed URLs for rss).
 */
export function scopedRows<T>(raw: unknown, ctx: TickerContext): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const config = ctx.dashboard?.channels?.find(
    (c) => c.channel_type === ctx.tab,
  )?.config as Record<string, unknown> | undefined;
  return scopeSourceData(ctx.source, raw, config) as T[];
}
