/**
 * useAddWidget — the single "add a catalog item" flow.
 *
 * Adds either kind of widget from one entry point so the Catalog and the
 * per-widget Info page stay in lockstep:
 *   - DATA widget → POST /users/me/widgets (with the widget's addConfig),
 *     optimistically inserted into the dashboard cache so the Sidebar +
 *     "Added" badge flip on the next paint, then reconciled with the server.
 *   - UTILITY widget → written into preferences (enabled + on-ticker +
 *     auto-pinned to the static zone).
 * Both then navigate to the new widget's feed.
 *
 * Extracted from catalog.tsx (2026-07-01) when the Info page grew its own
 * Add CTA — duplicating the optimistic/auto-pin logic would have let the two
 * surfaces drift.
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { defaultPinForNewWidget } from "../preferences";
import type { CatalogItem } from "../marketplace";
import { dataWidgetsApi } from "../api/client";
import type { DataWidgetRow, DataWidgetType } from "../api/client";
import { queryKeys } from "../api/queries";
import type { DashboardResponse } from "../types";
import { useShell } from "../shell-context";

export function useAddWidget(): (item: CatalogItem) => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { prefs, onPrefsChange } = useShell();

  return useCallback(
    async (item: CatalogItem) => {
      if (item.kind === "data") {
        const widgetType = item.id as DataWidgetType;

        // Optimistic insert: write a placeholder channel into the
        // dashboard cache immediately so the Sidebar + CatalogCard
        // "Added" badge flip on the next paint. Without this the user
        // saw a 0.5-1s gap between click and any visible state change
        // — the network round-trip to `POST /users/me/widgets` plus
        // the forced `/dashboard` refetch were both on the critical
        // path. CDC + a background refetch reconcile the placeholder
        // with the real row a moment later.
        const optimisticChannel: DataWidgetRow & { logto_sub: string } = {
          id: -Date.now(), // ephemeral negative id, replaced on reconcile
          widget_type: widgetType,
          enabled: true,
          ticker_enabled: true,
          config: item.addConfig ?? {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          logto_sub: "",
        };

        const previous = queryClient.getQueryData<DashboardResponse>(
          queryKeys.dashboard,
        );

        queryClient.setQueryData<DashboardResponse>(
          queryKeys.dashboard,
          (old) => {
            if (!old) {
              return {
                data: {},
                channels: [optimisticChannel],
              } as DashboardResponse;
            }
            // Don't double-insert if the channel is somehow already
            // present (e.g. CDC raced us).
            const existing = old.widgets ?? [];
            if (existing.some((c) => c.widget_type === widgetType)) {
              return old;
            }
            return {
              ...old,
              channels: [...existing, optimisticChannel],
            };
          },
        );

        // Navigate immediately — the channel page's queries will fire
        // in parallel with the create call below.
        navigate({
          to: "/widget/$id",
          params: { id: item.id },
        });
        toast.success(`${item.name} added`);

        // Fire the network call without blocking the UI. On success
        // we reconcile the optimistic row with the server response.
        // On failure we roll back and surface the error.
        dataWidgetsApi
          // Report enabled utility-widget count so the server slot gate counts
          // every widget (utilities live only in local preferences).
          .create(widgetType, item.addConfig ?? {}, prefs.widgets.enabledWidgets.length)
          .then((created) => {
            queryClient.setQueryData<DashboardResponse>(
              queryKeys.dashboard,
              (old) => {
                if (!old) return old;
                const channels = (old.widgets ?? []).map((c) =>
                  c.id === optimisticChannel.id
                    ? ({ ...created, logto_sub: c.logto_sub } as DataWidgetRow & {
                        logto_sub: string;
                      })
                    : c,
                );
                return { ...old, channels };
              },
            );
            // Resync NOW, refetching mounted queries: the user is
            // already sitting on the widget's feed page (we navigated
            // optimistically), and its data (dashboard.data[source])
            // only exists server-side once the row is created. With
            // refetchType "none" the mounted query never refetched and
            // the feed stayed empty until Configure forced one — the
            // v1.1.0 "data appears only after visiting Configure" bug.
            queryClient.invalidateQueries({
              queryKey: queryKeys.dashboard,
              refetchType: "active",
            });
            // The sports channel page reads /sports (["sports","full"]),
            // not /dashboard — without this the mounted MLS/NFL feed
            // keeps its pre-create empty payload indefinitely (no
            // refetch trigger ever fires in a single always-focused
            // Tauri window).
            queryClient.invalidateQueries({
              queryKey: ["sports", "full"],
              refetchType: "active",
            });
          })
          .catch((err) => {
            // Roll back the optimistic insert.
            queryClient.setQueryData<DashboardResponse>(
              queryKeys.dashboard,
              previous,
            );
            const message =
              err instanceof Error ? err.message : "Failed to add widget";
            toast.error(`Couldn't add ${item.name}: ${message}`);
          });
      } else {
        const nextEnabled = [...prefs.widgets.enabledWidgets, item.id];
        const nextOnTicker = [...prefs.widgets.widgetsOnTicker, item.id];
        // Auto-pin newly added widgets to the right side so they land
        // in the static pinned zone instead of disappearing into the
        // scrolling tape. Preserve any existing pin config (re-adding
        // a previously-removed widget honors the user's last choice).
        // Walkthrough fix 2026-05-11 — see preferences.ts:defaultPinForNewWidget.
        const nextPinned = { ...prefs.widgets.pinnedWidgets };
        if (!nextPinned[item.id]) {
          nextPinned[item.id] = defaultPinForNewWidget();
        }
        onPrefsChange({
          ...prefs,
          widgets: {
            ...prefs.widgets,
            enabledWidgets: nextEnabled,
            widgetsOnTicker: nextOnTicker,
            pinnedWidgets: nextPinned,
          },
        });
        toast.success(`${item.name} added`);
        navigate({ to: "/widget/$id", params: { id: item.id } });
      }
    },
    [navigate, queryClient, prefs, onPrefsChange],
  );
}
