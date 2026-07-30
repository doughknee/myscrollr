/**
 * Whether a source is on the ticker, and how it got there.
 *
 * The ticker is single-row. It previously supported two or three rows
 * with per-row source assignment, and these helpers reported which row a
 * source landed on; that whole layer was removed because configuring it
 * confused more people than it helped. What remains is the question that
 * actually matters to a user: is this thing scrolling, pinned, or off.
 */
import { isWidgetTickerEnabled } from "../api/client";
import type { AppPreferences } from "../preferences";

interface DataWidgetTickerInfo {
  widget_type: string;
  enabled?: boolean;
  ticker_enabled?: boolean;
}

export interface EffectiveWidgetTickerStatus {
  kind: "off" | "scrolling" | "pinned";
}

export function formatTickerStatus(onTicker: boolean): string {
  return onTicker ? "On ticker" : "Not on ticker";
}

export function formatEffectiveWidgetTickerStatus(
  status: EffectiveWidgetTickerStatus,
): string {
  if (status.kind === "pinned") return "Pinned";
  return formatTickerStatus(status.kind === "scrolling");
}

export function isDataWidgetOnTicker(
  _prefs: AppPreferences,
  widget: DataWidgetTickerInfo,
): boolean {
  if (widget.enabled === false) return false;
  return isWidgetTickerEnabled(widget);
}

export function getEffectiveWidgetTickerStatus(
  prefs: AppPreferences,
  widgetId: string,
): EffectiveWidgetTickerStatus {
  const onTicker = prefs.widgets.widgetsOnTicker.includes(widgetId);
  if (!onTicker) return { kind: "off" };
  // A pin still outranks scrolling — it parks the source at the head of
  // the row rather than letting it cycle.
  return prefs.widgets.pinnedWidgets[widgetId]
    ? { kind: "pinned" }
    : { kind: "scrolling" };
}
