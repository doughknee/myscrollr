/**
 * Atomic config hook for sports channel.
 *
 * Reads the full config, merges changes locally, and writes the complete
 * object to avoid data loss from the partial-write behavior of useDataWidgetConfig.
 */
import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { dataWidgetsApi } from "../api/client";
import type { WidgetId } from "../api/client";
import type { DashboardResponse } from "../types";
import { queryKeys } from "../api/queries";
import { useShellData } from "../shell-context";
import {
  normalizeSportsDisplayConfig,
  SPORTS_WINDOW_DEFAULTS,
} from "../datawidgets/sports/view";
import type { Venue } from "../preferences";

export interface FavoriteTeam {
  teamId: number;
  teamName: string;
}

export interface SportsDisplayPrefs {
  /** Day window (v1.1.3 Time Controls) — see SportsDisplayConfig. */
  daysBack: number;
  daysAhead: number;
  showLogos: Venue;
  showTimer: Venue;
}

export interface SportsConfig {
  leagues: string[];
  display: SportsDisplayPrefs;
  favoriteTeams: Record<string, FavoriteTeam>;
}

const DEFAULT_DISPLAY: SportsDisplayPrefs = {
  daysBack: SPORTS_WINDOW_DEFAULTS.daysBack,
  daysAhead: SPORTS_WINDOW_DEFAULTS.daysAhead,
  showLogos: "both",
  showTimer: "both",
};

export function useSportsConfig(widgetType: string = "sports") {
  const { channels } = useShellData();
  const queryClient = useQueryClient();

  // Read current config from the channels data (comes via dashboard response).
  // widgetType is the specific widget row (e.g. "sports_nfl") post widget-split;
  // defaults to the legacy coarse "sports" channel for back-compat.
  const sportsChannel = channels.find((c) => c.widget_type === widgetType);
  const raw = (sportsChannel?.config ?? {}) as Record<string, unknown>;

  const config: SportsConfig = useMemo(() => {
    // `normalizeSportsDisplayConfig` handles both legacy migrations:
    // v1.0.2 boolean→Venue for the cosmetic toggles, and v1.1.3
    // showUpcoming/showFinal→day-window mapping (an "off" toggle
    // becomes 0 days on that side).
    const normalizedDisplay = normalizeSportsDisplayConfig(raw.display);
    return {
      leagues: Array.isArray(raw.leagues) ? (raw.leagues as string[]) : [],
      display: {
        daysBack: normalizedDisplay.daysBack ?? DEFAULT_DISPLAY.daysBack,
        daysAhead: normalizedDisplay.daysAhead ?? DEFAULT_DISPLAY.daysAhead,
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
      dataWidgetsApi.update(widgetType, {
        config: next as unknown as Record<string, unknown>,
      }),
    // Optimistic write: patch this channel's config in the dashboard cache
    // immediately so toggles/team/league changes flip on the next paint
    // instead of waiting on the POST + dashboard refetch (the old behavior
    // felt like the control "took forever" to respond). Roll back on error;
    // reconcile with the server on settle.
    onMutate: async (next: SportsConfig) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard });
      const previous = queryClient.getQueryData<DashboardResponse>(
        queryKeys.dashboard,
      );
      queryClient.setQueryData<DashboardResponse>(queryKeys.dashboard, (old) => {
        if (!old) return old;
        const channels = (old.widgets ?? []).map((c) =>
          c.widget_type === widgetType
            ? { ...c, config: next as unknown as Record<string, unknown> }
            : c,
        );
        return { ...old, channels };
      });
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      const prev = (ctx as { previous?: DashboardResponse } | undefined)?.previous;
      if (prev) queryClient.setQueryData(queryKeys.dashboard, prev);
      toast.error("Failed to save \u2014 try again");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
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
