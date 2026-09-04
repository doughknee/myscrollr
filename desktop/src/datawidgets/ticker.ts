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
  /**
   * Set when this chip is a rotating SLOT rather than a fixed item: the
   * key stays, the content cycles. The ticker tags the wrapper with it
   * and counts how many times the slot has left the viewport, and the
   * source reads that count back out of `ctx.cycles` to decide what the
   * slot shows this lap.
   */
  rotateSlot?: string;
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
  /**
   * How many times each rotating slot has left the viewport, by slot key.
   * A slot's content advances only when this changes, which is how a chip
   * never swaps while someone is reading it. Absent from callers that do
   * not scroll (the fantasy preview): nothing rotates there.
   */
  cycles?: Readonly<Record<string, number>>;
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

/** One rotating position on the rail. */
export interface RotatingSlot<T, R> {
  /** Stable key; the slot keeps it while its item changes. */
  key: string;
  item: T;
  /** Present on slots that rotate; absent when the pool fit and nothing does. */
  rotateSlot?: string;
  /** What the chip must reserve so no item in this slot's class resizes it. */
  reserve?: R;
}

/**
 * Cycle a pool through a fixed number of slots, one step per lap.
 *
 * Shared by every source that can produce more chips than a bar should
 * hold at once. The horizon decides what is eligible; this decides how
 * many are on the rail, and the rest come round instead of being dropped.
 * The user configures none of it -- the number is the source's own
 * judgement of its chip width and its typical volume, and the rail just
 * works.
 *
 * Each slot owns a residue class of the pool: slot i shows pool[i], then
 * pool[i+k], then pool[i+2k], advancing when ITS cycle count does. Slots
 * leave the viewport at different moments, so each has its own count and
 * none of them need to agree for every item to come round. `reserve` is
 * computed over the class, not the whole pool, so a slot only reserves
 * the width it will actually use.
 *
 * When the pool fits, nothing rotates and every item is keyed by `id`.
 */
export function rotateSlots<T, R>(
  pool: T[],
  slots: number,
  cycles: Readonly<Record<string, number>>,
  keyPrefix: string,
  id: (item: T) => string | number,
  reserve: (cls: T[]) => R,
): RotatingSlot<T, R>[] {
  if (pool.length <= slots) {
    return pool.map((item) => ({ key: `${keyPrefix}-${id(item)}`, item }));
  }
  const k = Math.max(1, slots);
  const out: RotatingSlot<T, R>[] = [];
  for (let i = 0; i < k; i++) {
    const cls = pool.filter((_, idx) => idx % k === i);
    if (cls.length === 0) continue;
    const slotKey = `${keyPrefix}-slot-${i}`;
    const turn = cycles[slotKey] ?? 0;
    out.push({ key: slotKey, item: cls[turn % cls.length], rotateSlot: slotKey, reserve: reserve(cls) });
  }
  return out;
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
  const config = ctx.dashboard?.widgets?.find(
    (c) => c.widget_type === ctx.tab,
  )?.config as Record<string, unknown> | undefined;
  return scopeSourceData(ctx.source, raw, config) as T[];
}
