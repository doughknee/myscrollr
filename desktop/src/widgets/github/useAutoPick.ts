import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { githubApi } from "../../api/client";
import { updateWidgetPrefs } from "../../preferences";
import { autoPick } from "./types";
import type { AppPreferences } from "../../preferences";

/**
 * Zero setup (SCROLLR-312, canvas F3): connected to GitHub with nothing
 * tracked, the repos with recent Actions runs go on the bar without the
 * widget's page ever being opened. The shell runs it, and it is the only
 * place this happens: once a session, and only into an empty list. Same
 * query keys as the GitHub page, so the two never double-fetch.
 */
export function useGitHubAutoPick(
  prefs: AppPreferences,
  onTicker: boolean,
  authenticated: boolean,
  persist: (next: AppPreferences) => void,
): void {
  const empty = onTicker && authenticated && prefs.widgets.github.repos.length === 0;
  const { data: status } = useQuery({ queryKey: ["github-status"], queryFn: githubApi.status, enabled: empty });
  const { data: yours } = useQuery({
    queryKey: ["github-repos"],
    queryFn: githubApi.repos,
    enabled: empty && !!status?.connected,
    retry: false,
  });
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !yours) return;
    picked.current = true;
    const repos = autoPick(prefs.widgets.github.repos, yours.repos);
    if (repos) persist(updateWidgetPrefs(prefs, "github", { repos }));
  }, [yours, prefs, persist]);
}
