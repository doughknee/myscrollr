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
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { ApiError, toggleDataWidgetVisibility } from "../api/client";
import type { WidgetId } from "../api/client";
import { queryKeys } from "../api/queries";
import type { DashboardResponse } from "../types";
import type { AppPreferences } from "../preferences";
import { useTauriListener } from "./useTauriListener";
import {
  isOnTicker,
  withDataMembership,
  withUtilityToggled,
  type TickerRow,
} from "../utils/tickerMembership";

/** Ticker window -> main window: a toggle the server refused. */
export const TOGGLE_FAILED_EVENT = "widget-toggle-failed";

interface ToggleFailedPayload {
  widgetId: string;
  on: boolean;
  status?: number;
  message?: string;
}

export function useToggleOnTicker(opts: {
  /** Current prefs, read at call time. */
  getPrefs: () => AppPreferences;
  /** Persist a new prefs object (state + store). */
  persistPrefs: (next: AppPreferences) => void;
  /**
   * Called when the server refuses. Only the main window passes it (it owns
   * the toaster). A window without it forwards the failure to the main
   * window, which calls this on its behalf, so the user always hears.
   */
  onError?: (widgetId: string, turningOn: boolean, err: unknown) => void;
}) {
  const { getPrefs, persistPrefs, onError } = opts;
  const queryClient = useQueryClient();

  // Main window only (it is the one that passes onError). Exactly one window
  // forwards, the one the user clicked in, so there is one toast however many
  // ticker windows exist. The ticker window has no toaster and the main window
  // is usually hidden, so bring it forward to show the message.
  useTauriListener<ToggleFailedPayload>(TOGGLE_FAILED_EVENT, (e) => {
    const { widgetId, on, status, message } = e.payload;
    onError?.(
      widgetId,
      on,
      status === undefined ? new Error(message) : new ApiError(status, message ?? ""),
    );
  });

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

      // An in-flight dashboard refetch would land after the optimistic write
      // and snap the chip back before the server has answered.
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardResponse>(queryKeys.dashboard);
      queryClient.setQueryData<DashboardResponse>(queryKeys.dashboard, (old) =>
        old ? { ...old, widgets: withDataMembership(old.widgets ?? [], widgetId, on) } : old,
      );
      try {
        await toggleDataWidgetVisibility(widgetId as WidgetId, on, on ? true : undefined);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch (err) {
        if (previous) queryClient.setQueryData(queryKeys.dashboard, previous);
        if (onError) {
          onError(widgetId, on, err);
        } else {
          void emit(TOGGLE_FAILED_EVENT, {
            widgetId,
            on,
            status: err instanceof ApiError ? err.status : undefined,
            message: err instanceof Error ? err.message : undefined,
          } satisfies ToggleFailedPayload).catch(() => {});
          void invoke("show_app_window").catch(() => {});
        }
      }
    },
    [queryClient, getPrefs, persistPrefs, onError],
  );
}
