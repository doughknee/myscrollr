/**
 * DataWidgetRow CRUD actions for the app window.
 *
 * Uses TanStack Query mutations with automatic dashboard cache
 * invalidation — no manual fetchDashboard() threading required.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toggleDataWidgetVisibility } from "../api/client";
import { queryKeys } from "../api/queries";
import { catalogItemById } from "../marketplace";
import type { WidgetId } from "../api/client";

interface DataWidgetActions {
  handleToggleDataWidget: (widgetType: WidgetId, visible: boolean) => Promise<void>;
}

// `prefs` and `setPrefs` were used to clean up `pinnedSources` on
// widget delete. With pin-to-sidebar removed, the hook no longer
// needs them — sidebar updates flow from the dashboard refetch.
export function useDataWidgetActions(): DataWidgetActions {
  const queryClient = useQueryClient();

  const handleToggleDataWidget = useCallback(
    async (widgetType: WidgetId, visible: boolean) => {
      try {
        await toggleDataWidgetVisibility(widgetType, visible, true);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch (err) {
        console.error("[Scrollr] Widget toggle failed:", err);
        toast.error(`Couldn't ${visible ? "show" : "hide"} ${catalogItemById(widgetType)?.name ?? widgetType}`);
      }
    },
    [queryClient],
  );

  return { handleToggleDataWidget };
}
