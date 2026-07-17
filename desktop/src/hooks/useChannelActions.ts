/**
 * Channel CRUD actions for the app window.
 *
 * Uses TanStack Query mutations with automatic dashboard cache
 * invalidation — no manual fetchDashboard() threading required.
 */
import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { channelsApi, toggleChannelVisibility } from "../api/client";
import { queryKeys } from "../api/queries";
import type { ChannelType } from "../api/client";

const channelName: Record<string, string> = {
  finance: "Finance",
  sports: "Sports",
  fantasy: "Fantasy",
  rss: "RSS",
};

interface ChannelActions {
  handleToggleChannel: (channelType: ChannelType, visible: boolean) => Promise<void>;
  handleAddChannel: (channelType: ChannelType) => Promise<void>;
  handleDeleteChannel: (channelType: ChannelType) => Promise<void>;
}

// `prefs` and `setPrefs` were used to clean up `pinnedSources` on
// channel delete. With pin-to-sidebar removed, the hook no longer
// needs them — sidebar updates flow from the dashboard refetch.
export function useChannelActions(): ChannelActions {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleToggleChannel = useCallback(
    async (channelType: ChannelType, visible: boolean) => {
      try {
        await toggleChannelVisibility(channelType, visible, true);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } catch (err) {
        console.error("[Scrollr] Channel toggle failed:", err);
        toast.error(`Couldn't ${visible ? "show" : "hide"} ${channelName[channelType] ?? channelType}`);
      }
    },
    [queryClient],
  );

  const handleAddChannel = useCallback(
    async (channelType: ChannelType) => {
      try {
        await channelsApi.create(channelType);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        navigate({
          to: "/channel/$type",
          params: { type: channelType },
        });
        toast.success(`${channelName[channelType] ?? channelType} added`);
      } catch (err) {
        console.error("[Scrollr] Channel add failed:", err);
        toast.error(`Couldn't add ${channelName[channelType] ?? channelType}`);
      }
    },
    [queryClient, navigate],
  );

  const handleDeleteChannel = useCallback(
    async (channelType: ChannelType) => {
      try {
        await channelsApi.delete(channelType);
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        // Sidebar now derives from dashboard.channels (filtered to
        // enabled), so no preference cleanup is needed here — the
        // dashboard refetch above triggers the sidebar update.
        navigate({ to: "/feed" });
        toast.success(`${channelName[channelType] ?? channelType} removed`);
      } catch (err) {
        console.error("[Scrollr] Channel delete failed:", err);
        toast.error(`Couldn't remove ${channelName[channelType] ?? channelType}`);
      }
    },
    [queryClient, navigate],
  );

  return { handleToggleChannel, handleAddChannel, handleDeleteChannel };
}
