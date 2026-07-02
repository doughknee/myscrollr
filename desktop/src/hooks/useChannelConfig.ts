/**
 * Shared hook for channel ConfigPanel state management.
 *
 * Handles the error state, auto-dismiss timer, and update mutation
 * that are identical across Finance, Sports, and RSS ConfigPanels.
 */
import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { channelsApi } from "../api/client";
import { queryKeys } from "../api/queries";
import type { ChannelType } from "../api/client";
import type { DashboardResponse } from "../types";

interface UseChannelConfigResult<T> {
  error: string | null;
  setError: (error: string | null) => void;
  saving: boolean;
  updateItems: (next: T) => void;
}

export function useChannelConfig<T>(
  channelType: ChannelType,
  configKey: string,
): UseChannelConfigResult<T> {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Auto-dismiss errors after 4 seconds
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const updateMutation = useMutation({
    // Send the FULL merged config so sibling fields (e.g. finance's
    // asset_class, set on add) survive a partial update. onMutate has already
    // patched the dashboard cache below, so we read the merged config from it.
    mutationFn: (next: T) => {
      const dash = queryClient.getQueryData<DashboardResponse>(
        queryKeys.dashboard,
      );
      const current = dash?.channels?.find(
        (c) => c.channel_type === channelType,
      )?.config as Record<string, unknown> | undefined;
      return channelsApi.update(channelType, {
        config: current ?? { [configKey]: next },
      });
    },
    // Optimistic write so the control responds on the next paint instead of
    // waiting on the POST + dashboard refetch.
    onMutate: async (next: T) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardResponse>(
        queryKeys.dashboard,
      );
      queryClient.setQueryData<DashboardResponse>(queryKeys.dashboard, (old) => {
        if (!old) return old;
        const channels = (old.channels ?? []).map((c) =>
          c.channel_type === channelType
            ? {
                ...c,
                config: {
                  ...((c.config as Record<string, unknown>) ?? {}),
                  [configKey]: next,
                },
              }
            : c,
        );
        return { ...old, channels };
      });
      return { previous };
    },
    onError: (err, _next, ctx) => {
      const prev = (ctx as { previous?: DashboardResponse } | undefined)
        ?.previous;
      if (prev) queryClient.setQueryData(queryKeys.dashboard, prev);
      // Tier-limit 403s come back as "Your Free plan allows..." — show
      // the server's message verbatim instead of our generic toast so
      // users understand why the save was refused and what to change.
      const msg = err instanceof Error && err.message ? err.message : "";
      if (msg && msg.toLowerCase().includes("plan allows")) {
        toast.error(msg);
      } else {
        toast.error("Failed to save \u2014 try again");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });

  const updateItems = useCallback(
    (next: T) => updateMutation.mutate(next),
    [updateMutation],
  );

  return {
    error,
    setError,
    saving: updateMutation.isPending,
    updateItems,
  };
}
