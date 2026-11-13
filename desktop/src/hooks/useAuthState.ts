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
import { forgetAccountData } from "../api/queries";
import { onStoreChange } from "../lib/store";
import type { SubscriptionTier } from "../auth";
import type { DashboardResponse } from "../types";

interface UseAuthStateReturn {
  authenticated: boolean;
  tier: SubscriptionTier;
  loggingIn: boolean;
  setLoggingIn: (v: boolean) => void;
  /**
   * The one-time Logto authorization URL for the in-flight login attempt,
   * or null when none is pending. Powers the "copy the sign-in link"
   * fallback (SCROLLR-8) — cleared whenever loggingIn is set back to
   * false, whether that's a completed login, a failure, or Cancel.
   */
  authUrl: string | null;
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
  const [loggingIn, setLoggingInRaw] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // The URL is only ever meaningful while a login is in flight — clearing
  // it alongside loggingIn means every path that ends the attempt (a
  // completed login, a failure, or the user clicking Cancel) also clears
  // the fallback link, with nothing extra to remember at each call site.
  const setLoggingIn = useCallback((v: boolean) => {
    setLoggingInRaw(v);
    if (!v) setAuthUrl(null);
  }, []);

  // The attempt in flight. Setting loggingIn to false from outside (Cancel
  // on the overlay, Escape) aborts it, so its listener, timer and callback
  // server go with it (D2-11).
  const loginAbortRef = useRef<AbortController | null>(null);
  const cancelableSetLoggingIn = useCallback((v: boolean) => {
    if (!v) {
      loginAbortRef.current?.abort();
      loginAbortRef.current = null;
    }
    setLoggingIn(v);
  }, [setLoggingIn]);

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

  // A refresh the server refused usually runs in a ticker window (it owns
  // the proactive timer), so the sign-out it causes reaches this window only
  // as a store change (D3-5). This window's own sign-out does not fire it.
  useEffect(
    () =>
      onStoreChange("scrollr:auth", (value) => {
        if (value || !authenticatedRef.current) return;
        authenticatedRef.current = false;
        setAuthenticated(false);
        setTier("free");
        setSessionExpired(true);
        void forgetAccountData(queryClient);
      }),
    [queryClient],
  );

  const handleLogin = useCallback(async () => {
    if (!isAuthConfigured()) {
      toast.error("Desktop auth is not configured for this build");
      return;
    }

    loginAbortRef.current?.abort();
    const controller = new AbortController();
    loginAbortRef.current = controller;
    setLoggingIn(true);
    try {
      const result = await authLogin(setAuthUrl, controller.signal);
      if (controller.signal.aborted) return; // cancelled: no toast
      if (result) {
        setAuthenticated(true);
        setTier(getTier());
        setSessionExpired(false);
        // Fetch the new account's profile and GitHub data now, not on
        // their next poll (SCROLLR-472).
        void forgetAccountData(queryClient, { refetch: true });
      } else {
        const detail = getLastLoginError();
        toast.error(detail
          ? `Sign-in failed: ${detail}`
          : "Sign-in failed — please try again");
      }
    } finally {
      // A cancelled attempt ends after the user may have started a new one:
      // only the current attempt may close the overlay.
      if (loginAbortRef.current === controller) {
        loginAbortRef.current = null;
        setLoggingIn(false);
      }
    }
  }, [queryClient, setLoggingIn]);

  const handleLogout = useCallback(async () => {
    authenticatedRef.current = false; // not "expired": the store listener stays quiet
    await invoke("stop_sse").catch(() => {});
    // Await it: clearAuth persists the removal, and an unawaited
    // rejection here would leave scrollr:auth on disk after a "sign out".
    await authLogout().catch((err) =>
      console.error("[Scrollr] Sign-out failed to clear stored auth:", err),
    );
    setAuthenticated(false);
    setTier("free");
    setSessionExpired(false);
    void forgetAccountData(queryClient);
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
    setLoggingIn: cancelableSetLoggingIn,
    authUrl,
    sessionExpired,
    setSessionExpired,
    handleLogin,
    handleLogout,
    syncAuthFromDashboard,
    refreshTier,
  };
}
