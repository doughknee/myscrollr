import { isChannelTickerEnabled } from "../api/client";
import type { AppPreferences } from "../preferences";

interface ChannelTickerInfo {
  channel_type: string;
  enabled?: boolean;
  ticker_enabled?: boolean;
  visible?: boolean;
}

export interface EffectiveWidgetTickerStatus {
  kind: "off" | "scrolling" | "pinned";
  row: number | null;
}

export function formatTickerStatus(row: number | null, rowCount: number): string {
  if (row === null) return "Not on ticker";
  if (rowCount <= 1) return "On ticker";
  return `Row ${row + 1}`;
}

export function formatEffectiveWidgetTickerStatus(
  status: EffectiveWidgetTickerStatus,
  rowCount: number,
): string {
  if (status.kind === "pinned") {
    return rowCount <= 1 ? "Pinned" : `Pinned row ${(status.row ?? 0) + 1}`;
  }
  return formatTickerStatus(status.row, rowCount);
}

export function getEffectiveDataWidgetTickerRow(
  prefs: AppPreferences,
  channel: ChannelTickerInfo,
): number | null {
  if (channel.enabled === false || !isChannelTickerEnabled(channel)) return null;
  return getEffectiveSourceRow(prefs, channel.channel_type);
}

export function getEffectiveWidgetTickerStatus(
  prefs: AppPreferences,
  widgetId: string,
): EffectiveWidgetTickerStatus {
  const onTicker = prefs.widgets.widgetsOnTicker.includes(widgetId);
  const pin = prefs.widgets.pinnedWidgets[widgetId];

  if (pin && onTicker) {
    const pinRow = pin.row ?? 0;
    return rowAllowsSource(prefs, pinRow, widgetId)
      ? { kind: "pinned", row: pinRow }
      : { kind: "off", row: null };
  }

  if (!onTicker) return { kind: "off", row: null };

  const row = getEffectiveSourceRow(prefs, widgetId);
  return row === null
    ? { kind: "off", row: null }
    : { kind: "scrolling", row };
}

function getEffectiveSourceRow(
  prefs: AppPreferences,
  sourceId: string,
): number | null {
  const rows = prefs.appearance.tickerLayout.rows;
  const explicitRow = rows.findIndex((row) => row.sources.includes(sourceId));
  if (explicitRow >= 0) return explicitRow;

  const allSourcesRow = rows.findIndex((row) => row.sources.length === 0);
  return allSourcesRow >= 0 ? allSourcesRow : null;
}

function rowAllowsSource(
  prefs: AppPreferences,
  rowIndex: number,
  sourceId: string,
): boolean {
  const row = prefs.appearance.tickerLayout.rows[rowIndex];
  if (!row) return false;
  return row.sources.length === 0 || row.sources.includes(sourceId);
}
