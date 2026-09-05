/**
 * Is a widget on the ticker? One answer, for every surface.
 *
 * Membership lives in two places by necessity: a data widget's is a
 * server field on its row (`ticker_enabled`, gated by `enabled`), a
 * local utility's is `prefs.widgets.widgetsOnTicker`. Every surface that
 * shows or flips that state -- the ticker's right-click menu, the
 * sidebar, the widget page -- used to answer the question its own way,
 * and two of them disagreed: the ticker menu ignored `enabled`, so a
 * disabled widget read as "on" there and "off" in the sidebar.
 *
 * This is the only function that answers it now.
 */
import { isWidgetTickerEnabled } from "../api/client";
import type { AppPreferences } from "../preferences";

export interface TickerRow {
  widget_type: string;
  enabled?: boolean;
  ticker_enabled?: boolean;
}

export type TickerKind = "data" | "utility";

/** Which store owns this widget's membership. */
export function tickerKindOf(
  widgetId: string,
  rows: readonly TickerRow[],
): TickerKind {
  return rows.some((r) => r.widget_type === widgetId) ? "data" : "utility";
}

export function isOnTicker(
  prefs: AppPreferences,
  rows: readonly TickerRow[],
  widgetId: string,
): boolean {
  const row = rows.find((r) => r.widget_type === widgetId);
  if (row) return row.enabled !== false && isWidgetTickerEnabled(row);
  return prefs.widgets.widgetsOnTicker.includes(widgetId);
}

/** The prefs with a utility widget's membership flipped. Pure. */
export function withUtilityToggled(
  prefs: AppPreferences,
  widgetId: string,
): AppPreferences {
  const list = prefs.widgets.widgetsOnTicker;
  const next = list.includes(widgetId)
    ? list.filter((id) => id !== widgetId)
    : [...list, widgetId];
  return { ...prefs, widgets: { ...prefs.widgets, widgetsOnTicker: next } };
}

/** The dashboard rows with a data widget's membership set. Pure. */
export function withDataMembership<T extends TickerRow>(
  rows: readonly T[],
  widgetId: string,
  on: boolean,
): T[] {
  return rows.map((r) =>
    r.widget_type === widgetId
      ? // Turning a widget ON also enables it: a user who asks for a
        // widget on the bar wants the widget, whatever a stale row says.
        { ...r, ticker_enabled: on, ...(on ? { enabled: true } : {}) }
      : r,
  );
}
