/**
 * Widget ticker actions.
 *
 * Handles toggling a widget's presence on the ticker.
 */
import { useCallback } from "react";
import { savePrefs, toggleWidgetOnTicker } from "../preferences";
import type { AppPreferences } from "../preferences";

interface WidgetActions {
  handleToggleWidgetTicker: (widgetId: string) => void;
}

export function useWidgetActions(
  prefs: AppPreferences,
  setPrefs: React.Dispatch<React.SetStateAction<AppPreferences>>,
): WidgetActions {
  const handleToggleWidgetTicker = useCallback(
    (widgetId: string) => {
      const next = toggleWidgetOnTicker(prefs, widgetId);
      setPrefs(next);
      savePrefs(next);
    },
    [prefs, setPrefs],
  );

  return { handleToggleWidgetTicker };
}
