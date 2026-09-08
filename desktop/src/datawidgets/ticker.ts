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
  /**
   * The durable thing this chip is about -- the team, symbol, feed,
   * market or monitor behind it, not the item currently showing (REL-239).
   * It is what a pin attaches to, and what the ticker writes into
   * `data-pin-subject` so a right-click can resolve the chip under the
   * cursor back to a pinnable subject.
   */
  subject?: string;
  /** How to name the subject in a menu ("Yankees", "AAPL", "BBC News"). */
  pinLabel?: string;
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
  /** Freezes a rotating slot's item across renders (see `rotateSlots`). */
  rotationMemo?: RotationMemo;
  /**
   * Subjects of THIS widget that are pinned to the fixed zone. A source
   * drops them from its pool before rotating (`dropPinned`) so a pinned
   * subject is never on the bar twice -- once parked, once scrolling past.
   * Filtering the pool rather than the rendered chips is what keeps a
   * rotating slot from resolving to a pinned item and rendering a hole.
   */
  pinnedSubjects?: ReadonlySet<string>;
  /**
   * Set when the source is being asked for ONE pinned subject's chip
   * rather than for the rail. A pin bypasses the horizon: the fixed zone
   * is the user saying "this one, always", so a pinned team shows its
   * next fixture even when that is a week out.
   */
  pinnedSubject?: string;
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
  /**
   * The one chip for `ctx.pinnedSubject`, ignoring this source's horizon
   * and slot count (REL-239).
   *
   * Returns null when the subject has nothing to show right now -- a
   * team between seasons, a feed that has never published, a symbol the
   * server has no trade for. The fixed zone then renders nothing for it
   * rather than a placeholder: an empty space is honest, and the pin
   * comes back on its own when the subject does.
   */
  pinnedChip?(raw: unknown, ctx: TickerContext): TickerChip | null;
  /**
   * Every subject this widget could pin, for the surfaces that offer a
   * pin without a chip under the cursor (the widget page, the sidebar).
   */
  subjects?(raw: unknown, ctx: TickerContext): Array<{ subject: string; label: string }>;
}

/**
 * Drop pinned subjects from a pool before it rotates.
 *
 * `subjects` returns every subject an item belongs to -- one for a
 * symbol or a feed, two for a game (a fixture is about both teams).
 */
export function dropPinned<T>(
  pool: T[],
  ctx: TickerContext,
  subjects: (item: T) => string | readonly string[],
): T[] {
  const pinned = ctx.pinnedSubjects;
  if (!pinned || pinned.size === 0) return pool;
  return pool.filter((item) => {
    const s = subjects(item);
    return typeof s === "string" ? !pinned.has(s) : !s.some((x) => pinned.has(x));
  });
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
 * What a slot showed last time it was resolved, and at which `turn`.
 *
 * Untyped because one Map is shared across every source on the rail
 * (ScrollrTicker owns a single `useRef`) — each entry is only ever read
 * back by the slot key that wrote it, which is namespaced per source
 * (§8.2), so cross-source collisions can't happen.
 */
interface RotationMemoEntry {
  turn: number;
  item: unknown;
  reserve: unknown;
}

/** Per-ticker cache that lets `rotateSlots` freeze a slot's item across renders. */
export type RotationMemo = Map<string, RotationMemoEntry>;

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
 * When the pool fits, nothing rotates and every item is keyed by `id` --
 * unless a `memo` is supplied (below), in which case every slot, small
 * pool or not, is keyed and frozen the same way.
 *
 * Without `memo`, `cls` is recomputed from `pool` on every call, which
 * makes the *membership* of slot i whatever the live pool says right now
 * -- fine for a pure, one-shot read, but wrong for a ticker: a refetch or
 * a sort-order change reshuffles which item lands at each residue index
 * with no cycle advance, so a visible slot's item can flip with nobody
 * having looked away (CHIP_DESIGN.md rule 6, CHIP_SPEC.md §8.4). Passing
 * `memo` (one persistent `Map` owned by the caller, e.g. a `useRef` in
 * ScrollrTicker) fixes that: a slot's `(item, reserve)` is cached against
 * the `turn` that produced it, and only recomputed from `pool` when
 * `cycles[slotKey]` has actually moved on -- i.e. once the slot has fully
 * left the viewport and come back. A pool change between those moments
 * changes nothing the viewer can see.
 */
export function rotateSlots<T, R>(
  pool: T[],
  slots: number,
  cycles: Readonly<Record<string, number>>,
  keyPrefix: string,
  id: (item: T) => string | number,
  reserve: (cls: T[]) => R,
  memo?: RotationMemo,
): RotatingSlot<T, R>[] {
  if (!memo) {
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

  const k = Math.max(1, slots);
  const out: RotatingSlot<T, R>[] = [];
  for (let i = 0; i < k; i++) {
    const slotKey = `${keyPrefix}-slot-${i}`;
    const turn = cycles[slotKey] ?? 0;
    const cached = memo.get(slotKey);
    if (cached && cached.turn === turn) {
      out.push({ key: slotKey, item: cached.item as T, rotateSlot: slotKey, reserve: cached.reserve as R });
      continue;
    }
    const cls = pool.filter((_, idx) => idx % k === i);
    if (cls.length === 0) {
      memo.delete(slotKey);
      continue;
    }
    const item = cls[turn % cls.length];
    const res = reserve(cls);
    memo.set(slotKey, { turn, item, reserve: res });
    out.push({ key: slotKey, item, rotateSlot: slotKey, reserve: res });
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
