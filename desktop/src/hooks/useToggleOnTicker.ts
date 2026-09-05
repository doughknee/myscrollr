/**
 * The one way to put a widget on the ticker or take it off.
 *
 * Both windows use it -- the ticker's right-click menu and the main
 * window's sidebar -- so they cannot drift: same call to the server,
 * same optimistic update, same fallback. Before this, the two surfaces
 * called `toggleDataWidgetVisibility` with different arguments (one also
 * re-enabled the widget, one did not) and only one of them updated
 * anything optimistically, which is why flipping a widget in one place
 * took a beat to show in the other.
 *
 * Data widgets: flip the row in the dashboard cache immediately, tell the
 * server, invalidate so the truth comes back. On failure, restore the
 * snapshot and report. Utilities: flip the local pref and persist; the
 * cross-window store subscription carries it to the other window.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toggleDataWidgetVisibility } from "../api/client";
import type { WidgetId } from "../api/client";
import { queryKeys } from "../api/queries";
import type { DashboardResponse } from "../types";
import type { AppPreferences } from "../preferences";
import {
  isOnTicker,
  withDataMembership,
  withUtilityToggled,
  type TickerRow,
} from "../utils/tickerMembership";

export function useToggleOnTicker(opts: {
  /** Current prefs, read at call time. */
  getPrefs: () => AppPreferences;
  /** Persist a new prefs object (state + store). */
  persistPrefs: (next: AppPreferences) => void;
  /** Called when the server refuses. Optional: the ticker window has no toaster. */
  onError?: (widgetId: string, turningOn: boolean, err: unknown) => void;
}) {
  const { getPrefs, persistPrefs, onError } = opts;
  const queryClient = useQueryClient();

  return useCallback(
    async (widgetId: string) => {
      const dashboard = queryClient.getQueryData<DashboardResponse>(queryKeys.dashboard);
      const rows: TickerRow[] = dashboard?.widgets ?? [];
      const prefs = getPrefs();
      const on = !isOnTicker(prefs, rows, widgetId);

      if (!rows.some((r) => r.widget_type === widgetId)) {
        persistPrefs(withUtilityToggled(prefs, widgetId));
        return;
      }

      const previous = dashboard;
      queryClient.setQueryData<DashboardResponse>(queryKeys.dashboard, (old) =>
        old ? { ...old, widgets: withDataMembership(old.widgets ?? [], widgetId, on) } : old,
      );
      try {
        await toggleDataWidgetVisibility(widgetId as WidgetId, on, on ? true : undefined);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch (err) {
        if (previous) queryClient.setQueryData(queryKeys.dashboard, previous);
        onError?.(widgetId, on, err);
      }
    },
    [queryClient, getPrefs, persistPrefs, onError],
  );
}
