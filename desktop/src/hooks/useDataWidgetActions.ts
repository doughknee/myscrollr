/**
 * DataWidgetRow CRUD actions for the app window.
 *
 * Uses TanStack Query mutations with automatic dashboard cache
 * invalidation — no manual fetchDashboard() threading required.
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataWidgetsApi, toggleDataWidgetVisibility } from "../api/client";
import { queryKeys } from "../api/queries";
import type { WidgetId } from "../api/client";

const widgetName: Record<string, string> = {
  finance: "Finance",
  sports: "Sports",
  fantasy: "Fantasy",
  rss: "RSS",
};

interface DataWidgetActions {
  handleToggleDataWidget: (widgetType: WidgetId, visible: boolean) => Promise<void>;
  handleAddDataWidget: (widgetType: WidgetId) => Promise<void>;
  handleDeleteDataWidget: (widgetType: WidgetId) => Promise<void>;
}

// `prefs` and `setPrefs` were used to clean up `pinnedSources` on
// channel delete. With pin-to-sidebar removed, the hook no longer
// needs them — sidebar updates flow from the dashboard refetch.
export function useDataWidgetActions(): DataWidgetActions {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleToggleDataWidget = useCallback(
    async (widgetType: WidgetId, visible: boolean) => {
      try {
        await toggleDataWidgetVisibility(widgetType, visible, true);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch (err) {
        console.error("[Scrollr] Widget toggle failed:", err);
        toast.error(`Couldn't ${visible ? "show" : "hide"} ${widgetName[widgetType] ?? widgetType}`);
      }
    },
    [queryClient],
  );

  const handleAddDataWidget = useCallback(
    async (widgetType: WidgetId) => {
      try {
        await dataWidgetsApi.create(widgetType);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        // The sports channel page reads /sports (["sports","full"]), not
        // /dashboard — same lesson as the v1.1.0 "empty until Configure"
        // bug: invalidate it or the mounted feed never refetches.
        queryClient.invalidateQueries({ queryKey: ["sports", "full"] });
        navigate({
          to: "/widget/$id",
          params: { id: widgetType },
        });
        toast.success(`${widgetName[widgetType] ?? widgetType} added`);
      } catch (err) {
        console.error("[Scrollr] Widget add failed:", err);
        toast.error(`Couldn't add ${widgetName[widgetType] ?? widgetType}`);
      }
    },
    [queryClient, navigate],
  );

  const handleDeleteDataWidget = useCallback(
    async (widgetType: WidgetId) => {
      try {
        await dataWidgetsApi.delete(widgetType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        queryClient.invalidateQueries({ queryKey: ["sports", "full"] });
        // Sidebar now derives from dashboard.widgets (filtered to
        // enabled), so no preference cleanup is needed here — the
        // dashboard refetch above triggers the sidebar update.
        navigate({ to: "/feed" });
        toast.success(`${widgetName[widgetType] ?? widgetType} removed`);
      } catch (err) {
        console.error("[Scrollr] Widget delete failed:", err);
        toast.error(`Couldn't remove ${widgetName[widgetType] ?? widgetType}`);
      }
    },
    [queryClient, navigate],
  );

  return { handleToggleDataWidget, handleAddDataWidget, handleDeleteDataWidget };
}
