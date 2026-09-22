/**
 * Keep the dashboard request's pinned subjects in step with prefs
 * (SCROLLR-9).
 *
 * Pins stay local (`prefs.widgets.pins`), but the server has to know them
 * to guarantee a row for each one, so they ride along on the `/dashboard`
 * request. Both windows own a prefs copy and both fetch the dashboard, so
 * both call this; the module underneath reports whether the set actually
 * changed, and only then is a refetch worth the round trip.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../api/queries";
import { syncPinnedSubjects } from "../api/pinnedSubjects";
import { sourceForWidget } from "../marketplace";
import type { WidgetPin } from "../preferences";

export function usePinnedSubjectsSync(
  pins: readonly WidgetPin[],
  /**
   * Refetch when the set changes. True in the main window, which is the
   * dashboard's only real poller — a pin the user just set should appear
   * on the bar now, not at the next poll. False in the ticker window,
   * whose own query is a cold fallback fed by the main window's
   * broadcast: it still needs the pins recorded for that fallback fetch,
   * but making it poll is exactly what the broadcast exists to avoid.
   */
  refetch = true,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (syncPinnedSubjects(pins, sourceForWidget) && refetch) {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    }
  }, [pins, queryClient, refetch]);
}
