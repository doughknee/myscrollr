/**
 * Atomic config hook for sports channel.
 *
 * Reads the full config, merges changes locally, and writes the complete
 * object to avoid data loss from the partial-write behavior of useChannelConfig.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { channelsApi } from "../api/client";
import type { ChannelType } from "../api/client";
import { queryKeys } from "../api/queries";
import { useShellData } from "../shell-context";
import { normalizeSportsDisplayConfig } from "../channels/sports/view";
import type { Venue } from "../preferences";

export interface FavoriteTeam {
  teamId: number;
  teamName: string;
}

export interface SportsDisplayPrefs {
  showUpcoming: Venue;
  showFinal: Venue;
  showLogos: Venue;
  showTimer: Venue;
}

export interface SportsConfig {
  leagues: string[];
  display: SportsDisplayPrefs;
  favoriteTeams: Record<string, FavoriteTeam>;
}

const DEFAULT_DISPLAY: SportsDisplayPrefs = {
  showUpcoming: "both",
  showFinal: "both",
  showLogos: "both",
  showTimer: "both",
};

export function useSportsConfig(channelType: string = "sports") {
  const { channels } = useShellData();
  const queryClient = useQueryClient();

  // Read current config from the channels data (comes via dashboard response).
  // channelType is the specific widget row (e.g. "sports_nfl") post widget-split;
  // defaults to the legacy coarse "sports" channel for back-compat.
  const sportsChannel = channels.find((c) => c.channel_type === channelType);
  const raw = (sportsChannel?.config ?? {}) as Record<string, unknown>;

  const config: SportsConfig = useMemo(() => {
    // v1.0.2: normalize raw.display through `migrateVenue` so
    // pre-venue-enum boolean configs (stored server-side by clients on
    // <v1.0.2) deserialize to valid Venue values. `normalizeSportsDisplayConfig`
    // returns a SportsDisplayConfig with all four fields populated.
    const normalizedDisplay = normalizeSportsDisplayConfig(raw.display);
    return {
      leagues: Array.isArray(raw.leagues) ? (raw.leagues as string[]) : [],
      display: {
        showUpcoming: normalizedDisplay.showUpcoming ?? DEFAULT_DISPLAY.showUpcoming,
        showFinal: normalizedDisplay.showFinal ?? DEFAULT_DISPLAY.showFinal,
        showLogos: normalizedDisplay.showLogos ?? DEFAULT_DISPLAY.showLogos,
        showTimer: normalizedDisplay.showTimer ?? DEFAULT_DISPLAY.showTimer,
      },
      favoriteTeams:
        typeof raw.favoriteTeams === "object" && raw.favoriteTeams !== null
          ? (raw.favoriteTeams as Record<string, FavoriteTeam>)
          : {},
    };
  }, [raw]);

  const mutation = useMutation({
    mutationFn: (next: SportsConfig) =>
      channelsApi.update(channelType as ChannelType, {
        config: next as unknown as Record<string, unknown>,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: () => {
      toast.error("Failed to save \u2014 try again");
    },
  });

  const setLeagues = useCallback(
    (leagues: string[]) => mutation.mutate({ ...config, leagues }),
    [config, mutation],
  );

  const setDisplay = useCallback(
    (partial: Partial<SportsDisplayPrefs>) =>
      mutation.mutate({
        ...config,
        display: { ...config.display, ...partial },
      }),
    [config, mutation],
  );

  const setFavoriteTeam = useCallback(
    (league: string, team: FavoriteTeam | null) => {
      const newFavorites = { ...config.favoriteTeams };
      if (team) {
        newFavorites[league] = team;
      } else {
        delete newFavorites[league];
      }
      mutation.mutate({ ...config, favoriteTeams: newFavorites });
    },
    [config, mutation],
  );

  return {
    config,
    leagues: config.leagues,
    display: config.display,
    favoriteTeams: config.favoriteTeams,
    setLeagues,
    setDisplay,
    setFavoriteTeam,
    saving: mutation.isPending,
  };
}
