/**
 * useRemoveWidget — the single "remove a widget" flow, shared by the
 * per-widget info page and the sidebar context menu (v1.1.2) so the two
 * surfaces can't drift:
 *   - DATA widget → DELETE /users/me/widgets/{type}, dashboard refetch,
 *     success toast with Undo (re-creates the row with the config it had,
 *     so a mis-click doesn't lose a watchlist). The slot frees immediately.
 *   - UTILITY widget → disabled via the undoable prefs path (settings
 *     preserved, Undo in the toast).
 *
 * Errors are surfaced as toasts here — callers never need a catch.
 */
import { useCallback, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { dataWidgetsApi } from "../api/client";
import type { WidgetId } from "../api/client";
import { queryKeys } from "../api/queries";
import type { CatalogItem } from "../marketplace";
import { disableWidget } from "../preferences";
import { ShellContext } from "../shell-context";
import type { DashboardResponse } from "../types";
import { useUndoableAction } from "./useUndoableAction";
import type { UndoShellPlumbing } from "./useUndoableAction";

/**
 * `shell` is only for callers OUTSIDE the shell provider (RootLayout's
 * sidebar menu passes its own prefs + persistPrefs). Inside, omit.
 */
export function useRemoveWidget(
  shell?: UndoShellPlumbing,
): (item: CatalogItem) => Promise<void> {
  const queryClient = useQueryClient();
  const undoable = useUndoableAction(shell);
  const ctx = useContext(ShellContext);
  const prefs = (shell ?? ctx)?.prefs;

  return useCallback(
    async (item: CatalogItem) => {
      // `item.source` rather than isUtilityWidget(item.id): the CatalogItem is
      // already in hand, so this reads the widget the user actually clicked.
      // Looking it up by id again would re-query mutable module state, and a
      // catalog refresh landing between render and click would answer about a
      // different catalog than the one that produced this item.
      if (item.source) {
        // The row's config, captured before the delete so Undo can put
        // back the same watchlist / feeds rather than the catalog default.
        const row = queryClient
          .getQueryData<DashboardResponse>(queryKeys.dashboard)
          ?.widgets?.find((w) => w.widget_type === item.id);
        try {
          await dataWidgetsApi.delete(item.id);
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          toast.success(`${item.name} removed`, {
            description: "Its slot is free for another widget.",
            action: {
              label: "Undo",
              onClick: () => {
                dataWidgetsApi
                  .create(
                    item.id,
                    row?.config ?? item.addConfig ?? {},
                    prefs?.widgets.enabledWidgets.length,
                  )
                  .then(() => {
                    queryClient.invalidateQueries({
                      queryKey: queryKeys.dashboard,
                    });
                    toast.success(`${item.name} restored`);
                  })
                  .catch(() => toast.error(`Couldn't restore ${item.name}`));
              },
            },
          });
        } catch (err) {
          console.error("[Scrollr] Remove failed:", err);
          toast.error(`Couldn't remove ${item.name}`);
        }
      } else {
        // Utilities live in prefs — undoable, settings preserved.
        undoable(
          {
            label: `Removed ${item.name}`,
            description: "Its slot is free for another widget.",
          },
          (current) => disableWidget(current, item.id),
        );
      }
    },
    [queryClient, undoable, prefs],
  );
}
