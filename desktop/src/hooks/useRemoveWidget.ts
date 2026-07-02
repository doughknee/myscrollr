/**
 * useRemoveWidget — the single "remove a widget" flow, shared by the
 * per-widget info page and the sidebar context menu (v1.1.2) so the two
 * surfaces can't drift:
 *   - DATA widget → DELETE /users/me/channels/{type}, dashboard refetch,
 *     success toast. The slot frees immediately.
 *   - UTILITY widget → disabled via the undoable prefs path (settings
 *     preserved, Undo in the toast).
 *
 * Errors are surfaced as toasts here — callers never need a catch.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { channelsApi } from "../api/client";
import type { ChannelType } from "../api/client";
import { queryKeys } from "../api/queries";
import type { CatalogItem } from "../marketplace";
import { disableWidget } from "../preferences";
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

  return useCallback(
    async (item: CatalogItem) => {
      if (item.kind === "data") {
        try {
          await channelsApi.delete(item.id as ChannelType);
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
          toast.success(`${item.name} removed`, {
            description: "Its slot is free for another widget.",
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
    [queryClient, undoable],
  );
}
