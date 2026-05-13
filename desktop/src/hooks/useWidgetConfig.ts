/**
 * Shared hook for widget ConfigPanel state management.
 *
 * Eliminates the identical `update` and `setTicker` callbacks
 * repeated across all 5 widget ConfigPanels.
 */
import { useCallback } from "react";
import { savePrefs } from "../preferences";
import type { AppPreferences, WidgetPrefs } from "../preferences";

/** Subset of WidgetPrefs that are per-widget config objects (not arrays). */
type WidgetConfigKey = "clock" | "timer" | "weather" | "sysmon" | "uptime" | "github";

/** The config object for a given widget key. */
type WidgetConfig<K extends WidgetConfigKey> = WidgetPrefs[K];

/** The ticker sub-config for a widget (every widget config has a `ticker` field). */
type TickerConfig<K extends WidgetConfigKey> = WidgetConfig<K> extends { ticker: infer T } ? T : never;

export interface WidgetConfigPanelProps {
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

export interface UseWidgetConfigResult<K extends WidgetConfigKey> {
  config: WidgetConfig<K>;
  update: (patch: Partial<WidgetConfig<K>>) => void;
  setTicker: (patch: Partial<TickerConfig<K>>) => void;
}

export function useWidgetConfig<K extends WidgetConfigKey>(
  widgetKey: K,
  prefs: AppPreferences,
  onPrefsChange: (prefs: AppPreferences) => void,
): UseWidgetConfigResult<K> {
  const config = prefs.widgets[widgetKey];

  const update = useCallback(
    (patch: Partial<WidgetConfig<K>>) => {
      const next: AppPreferences = {
        ...prefs,
        widgets: {
          ...prefs.widgets,
          [widgetKey]: { ...prefs.widgets[widgetKey], ...patch },
        },
      };
      onPrefsChange(next);
      savePrefs(next);
    },
    [prefs, onPrefsChange, widgetKey],
  );

  const setTicker = useCallback(
    (patch: Partial<TickerConfig<K>>) => {
      const current = prefs.widgets[widgetKey] as unknown as { ticker: object };
      update({ ticker: { ...current.ticker, ...patch } } as unknown as Partial<WidgetConfig<K>>);
    },
    [update, prefs.widgets, widgetKey],
  );

  return { config, update, setTicker };
}
