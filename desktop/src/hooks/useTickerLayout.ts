/**
 * useTickerLayout — single source of truth for the multi-row ticker
 * layout, shared by Home (per-source RowSelector + summary strip) and
 * Settings → Ticker (row builder).
 *
 * Why this exists:
 *   Before this hook, both screens computed their own `maxRows`,
 *   `canAddRow`, etc. from the same prefs blob — Home derived from the
 *   actual row count, Settings derived from the tier cap. The values
 *   diverged in practice (e.g. ghost rows on Home, missing affordances
 *   in Settings) even though the underlying state was identical. This
 *   hook collapses both views into a single shape.
 *
 * Design contract:
 *   - `rowCount` is `tickerLayout.rows.length` — what exists today.
 *   - `tierMaxRows` is the cap from the user's subscription tier.
 *   - `canAddRow` is `rowCount < tierMaxRows`.
 *   - `addRow(initialSource?)` appends an empty row (or one already
 *     containing `initialSource`) and returns the new row's index.
 *     If the layout is at the tier cap, returns `null` and is a no-op.
 *
 * All mutations funnel through `setTickerLayout` / `removeTickerRow` /
 * `setSourceTickerRow` from preferences.ts so the persistence
 * invariants stay intact.
 */
import { useCallback, useMemo } from "react";
import {
  setTickerLayout,
  removeTickerRow,
  setSourceTickerRow,
  setWidgetTickerRow,
} from "../preferences";
import { getMaxTickerRows, canCustomizeTickerRows } from "../tierLimits";
import type {
  AppPreferences,
  TickerLayout,
  TickerRowConfig,
} from "../preferences";
import type { SubscriptionTier } from "../auth";

interface UseTickerLayoutResult {
  /** The live layout (rows + per-row overrides). */
  layout: TickerLayout;
  /** `tickerLayout.rows` — convenience accessor. */
  rows: TickerRowConfig[];
  /** Number of rows currently in the layout. */
  rowCount: number;
  /** Max rows allowed by the user's tier (1..3). */
  tierMaxRows: number;
  /** True when `rowCount < tierMaxRows`. */
  canAddRow: boolean;
  /** True when the user's tier unlocks per-row scroll overrides (Ultimate+). */
  canCustomize: boolean;

  /**
   * Append an empty row to the layout. Optionally seed the new row's
   * sources with a single source ID (useful for "+ Add row" from a
   * RowSelector — the click should both create the row and assign the
   * current source to it).
   *
   * Returns the new row's index, or `null` if the layout is already at
   * the tier cap (no-op).
   */
  addRow: (initialSource?: string) => number | null;

  /** Remove the row at `index`. Re-maps widget pins (see `removeTickerRow`). */
  removeRow: (index: number) => void;

  /**
   * Patch a single row in place (used for per-row scroll overrides:
   * scrollMode / direction / speed / mixMode).
   */
  updateRow: (index: number, patch: Partial<TickerRowConfig>) => void;

  /**
   * Move a source (channel ID or widget ID) to the given row.
   * `row === null` removes it from every row entirely.
   *
   * Channel callers must additionally call `channelsApi.update` (or
   * `onToggleChannelTicker`) to flip the server-side `ticker_enabled`
   * flag — this hook only mutates client-side prefs.
   */
  setSourceRow: (sourceId: string, row: number | null) => void;
}

export function useTickerLayout(
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
  tier: SubscriptionTier,
): UseTickerLayoutResult {
  const layout = prefs.appearance.tickerLayout;
  const rows = layout.rows;
  const rowCount = rows.length;
  const tierMaxRows = getMaxTickerRows(tier);
  const canAddRow = rowCount < tierMaxRows;
  const canCustomize = canCustomizeTickerRows(tier);

  const addRow = useCallback(
    (initialSource?: string): number | null => {
      if (rows.length >= tierMaxRows) return null;
      const nextRow: TickerRowConfig = {
        sources: initialSource ? [initialSource] : [],
      };
      // If we're seeding the new row with a source, also strip it from
      // any other row it might already live on. This keeps the
      // single-row-per-source invariant intact (matches
      // `setSourceTickerRow`).
      const baseRows = initialSource
        ? rows.map((r) => ({
            ...r,
            sources: r.sources.filter((s) => s !== initialSource),
          }))
        : rows;
      const newIndex = baseRows.length;
      const withRow = setTickerLayout(prefs, { rows: [...baseRows, nextRow] });
      const next = initialSource && prefs.widgets.enabledWidgets.includes(initialSource)
        ? setWidgetTickerRow(withRow, initialSource, newIndex)
        : withRow;
      onPrefsChange(next);
      return newIndex;
    },
    [prefs, rows, tierMaxRows, onPrefsChange],
  );

  const removeRow = useCallback(
    (index: number) => {
      onPrefsChange(removeTickerRow(prefs, index));
    },
    [prefs, onPrefsChange],
  );

  const updateRow = useCallback(
    (index: number, patch: Partial<TickerRowConfig>) => {
      const nextRows = rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
      onPrefsChange(setTickerLayout(prefs, { rows: nextRows }));
    },
    [prefs, rows, onPrefsChange],
  );

  const setSourceRow = useCallback(
    (sourceId: string, row: number | null) => {
      const next = prefs.widgets.enabledWidgets.includes(sourceId)
        ? setWidgetTickerRow(prefs, sourceId, row)
        : setSourceTickerRow(prefs, sourceId, row);
      onPrefsChange(next);
    },
    [prefs, onPrefsChange],
  );

  return useMemo(
    () => ({
      layout,
      rows,
      rowCount,
      tierMaxRows,
      canAddRow,
      canCustomize,
      addRow,
      removeRow,
      updateRow,
      setSourceRow,
    }),
    [
      layout,
      rows,
      rowCount,
      tierMaxRows,
      canAddRow,
      canCustomize,
      addRow,
      removeRow,
      updateRow,
      setSourceRow,
    ],
  );
}
