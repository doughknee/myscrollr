/**
 * Widget toggle and pin actions.
 *
 * Handles enabling/disabling widgets, toggling their ticker presence,
 * and pinning them to the ticker edges.
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  defaultPinForNewWidget,
  savePrefs,
  toggleWidgetOnTicker,
  toggleWidgetPin,
} from "../preferences";
import type { AppPreferences } from "../preferences";

interface WidgetActions {
  handleToggleWidgetTicker: (widgetId: string) => void;
  handleToggleWidget: (widgetId: string) => void;
  handleTogglePin: (widgetId: string) => void;
}

export function useWidgetActions(
  prefs: AppPreferences,
  setPrefs: React.Dispatch<React.SetStateAction<AppPreferences>>,
  activeItem: string,
): WidgetActions {
  const navigate = useNavigate();

  const handleToggleWidgetTicker = useCallback(
    (widgetId: string) => {
      const next = toggleWidgetOnTicker(prefs, widgetId);
      setPrefs(next);
      savePrefs(next);
    },
    [prefs, setPrefs],
  );

  const handleToggleWidget = useCallback(
    (widgetId: string) => {
      const enabledWidgets = prefs.widgets.enabledWidgets;
      const isEnabled = enabledWidgets.includes(widgetId);
      const nextEnabled = isEnabled
        ? enabledWidgets.filter((id) => id !== widgetId)
        : [...enabledWidgets, widgetId];
      const nextOnTicker = isEnabled
        ? prefs.widgets.widgetsOnTicker.filter((id) => id !== widgetId)
        : [...prefs.widgets.widgetsOnTicker, widgetId];
      // On enable, default-pin the widget to the right of the ticker so
      // it lands in the static pinned zone. Preserve any existing pin
      // config so a re-enable honors the user's last side/row choice.
      // On disable, leave pinnedWidgets alone — keeping the entry means
      // a re-enable later remembers where it was. Walkthrough fix
      // 2026-05-11 — see preferences.ts:defaultPinForNewWidget.
      const nextPinned = { ...prefs.widgets.pinnedWidgets };
      if (!isEnabled && !nextPinned[widgetId]) {
        nextPinned[widgetId] = defaultPinForNewWidget();
      }
      const next: AppPreferences = {
        ...prefs,
        widgets: {
          ...prefs.widgets,
          enabledWidgets: nextEnabled,
          widgetsOnTicker: nextOnTicker,
          pinnedWidgets: nextPinned,
        },
      };
      setPrefs(next);
      savePrefs(next);

      if (!isEnabled) {
        navigate({
          to: "/widget/$id/$tab",
          params: { id: widgetId, tab: "feed" },
        });
      }
      if (isEnabled && activeItem === widgetId) {
        navigate({ to: "/feed" });
      }
    },
    [prefs, setPrefs, activeItem, navigate],
  );

  const handleTogglePin = useCallback(
    (widgetId: string) => {
      setPrefs((prev) => {
        const updated = toggleWidgetPin(prev, widgetId);
        savePrefs(updated);
        return updated;
      });
    },
    [setPrefs],
  );

  return { handleToggleWidgetTicker, handleToggleWidget, handleTogglePin };
}
