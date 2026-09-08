/**
 * Auth state management for the app window.
 *
 * Manages authentication state, login/logout handlers, session expiry
 * tracking, and tier synchronization on dashboard load.
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  login as authLogin,
  logout as authLogout,
  isAuthenticated as checkAuth,
  isAuthConfigured,
  getLastLoginError,
  getTier,
  onSessionExpired,
} from "../auth";
import { queryKeys } from "../api/queries";
import type { SubscriptionTier } from "../auth";
import type { DashboardResponse } from "../types";

interface UseAuthStateReturn {
  authenticated: boolean;
  tier: SubscriptionTier;
  loggingIn: boolean;
  setLoggingIn: (v: boolean) => void;
  sessionExpired: boolean;
  setSessionExpired: (v: boolean) => void;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  syncAuthFromDashboard: (dashboard: DashboardResponse | undefined) => void;
  refreshTier: () => void;
}

export function useAuthState(): UseAuthStateReturn {
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(() => checkAuth());
  const [tier, setTier] = useState<SubscriptionTier>(() =>
    checkAuth() ? getTier() : "free",
  );
  const [loggingIn, setLoggingIn] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const authenticatedRef = useRef(authenticated);
  authenticatedRef.current = authenticated;

  // A write that 401s and cannot be refreshed past clears auth deep
  // inside authFetch, where no React state can see it. Without this
  // subscription the banner only appeared if the dashboard query happened
  // to re-run (syncAuthFromDashboard) — and it does not, because
  // fetchDashboard swallows the same 401 and serves the public feed. So
  // the app looked signed in, every write failed with its own toast, and
  // reinstalling was the only way back (REL-238).
  useEffect(
    () =>
      onSessionExpired(() => {
        setAuthenticated(false);
        setTier("free");
        setSessionExpired(true);
      }),
    [],
  );

  const handleLogin = useCallback(async () => {
    if (!isAuthConfigured()) {
      toast.error("Desktop auth is not configured for this build");
      return;
    }

    setLoggingIn(true);
    try {
      const result = await authLogin();
      if (result) {
        setAuthenticated(true);
        setTier(getTier());
        setSessionExpired(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      } else {
        const detail = getLastLoginError();
        toast.error(detail
          ? `Sign-in failed: ${detail}`
          : "Sign-in failed — please try again");
      }
    } finally {
      setLoggingIn(false);
    }
  }, [queryClient]);

  const handleLogout = useCallback(async () => {
    await invoke("stop_sse").catch(() => {});
    // Await it: clearAuth persists the removal, and an unawaited
    // rejection here would leave scrollr:auth on disk after a "sign out".
    await authLogout().catch((err) =>
      console.error("[Scrollr] Sign-out failed to clear stored auth:", err),
    );
    setAuthenticated(false);
    setTier("free");
    setSessionExpired(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  }, [queryClient]);

  const syncAuthFromDashboard = useCallback(
    (dashboard: DashboardResponse | undefined) => {
      const isAuth = checkAuth();

      if (isAuth !== authenticatedRef.current) {
        // Was authenticated and now isn't — show session expired banner
        if (authenticatedRef.current && !isAuth) {
          setSessionExpired(true);
        }

        setAuthenticated(isAuth);
      }

      if (!isAuth) {
        setTier("free");
        return;
      }

      if (dashboard) {
        setTier(getTier());
      }
    },
    [],
  );

  /** Re-read tier from the current JWT (call after a forced token refresh). */
  const refreshTier = useCallback(() => {
    if (checkAuth()) setTier(getTier());
  }, []);

  return {
    authenticated,
    tier,
    loggingIn,
    setLoggingIn,
    sessionExpired,
    setSessionExpired,
    handleLogin,
    handleLogout,
    syncAuthFromDashboard,
    refreshTier,
  };
}
