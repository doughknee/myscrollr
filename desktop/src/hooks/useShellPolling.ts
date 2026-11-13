/**
 * The polling the main window does for every ticker window.
 *
 * The main window starts hidden at login and close hides it to the tray.
 * TanStack Query skips interval refetches while the page reports itself
 * hidden unless `refetchIntervalInBackground` is true; Windows webviews never
 * report hidden, but macOS and Linux ones may, which would freeze the bar
 * until the window was opened (RC-3). So every shell-level poll sets it.
 * Page-level queries do not: nobody is looking at them when the window is
 * hidden, and the shell observer on the same key already fetches.
 */
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, weatherQueryOptions } from "../api/queries";
import { githubBoardQuery } from "../widgets/github/types";
import { uptimeQuery } from "../widgets/uptime/types";
import { POLL_INTERVALS } from "../cdc";
import type { AppPreferences } from "../preferences";

import type { SubscriptionTier } from "../auth";

/** The dashboard poll; the tier sets how often. */
export function useShellDashboard(tier: SubscriptionTier) {
  return useQuery({
    ...dashboardQueryOptions(),
    refetchInterval: POLL_INTERVALS[tier],
    refetchIntervalInBackground: true,
  });
}

/**
 * Weather, GitHub and Uptime: permanent observers, so each widget refreshes
 * whichever page is open (their pages mount a second observer on the same
 * key: zero duplicate fetches).
 */
export function useShellWidgetPolling(prefs: AppPreferences, authenticated: boolean) {
  const enabled = prefs.widgets.enabledWidgets;
  const uptimeUrl = prefs.widgets.uptime.url;

  useQuery({
    ...weatherQueryOptions(),
    enabled: enabled.includes("weather"),
    refetchIntervalInBackground: true,
  });

  useQuery({
    ...githubBoardQuery(prefs.widgets.github.repos, authenticated),
    enabled: enabled.includes("github") && prefs.widgets.github.repos.length > 0,
    refetchIntervalInBackground: true,
  });

  useQuery({
    ...uptimeQuery(uptimeUrl),
    enabled: enabled.includes("uptime") && uptimeUrl.length > 0,
    refetchIntervalInBackground: true,
  });
}
