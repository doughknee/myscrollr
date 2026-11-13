/**
 * The one SSE connection, driven by the one window that owns it.
 *
 * Both entries mount this: the ticker (`App.tsx`, once per monitor) and the
 * main window (`routes/__root.tsx`). `startSSE`/`stopSSE` are no-ops in a
 * window that is not the owner, so a caller never has to ask — the three
 * entry points (mount, auth change, `auth-expired`) read the same as before.
 *
 * Every window still LISTENS: `sse-status` is broadcast, so `deliveryMode`
 * is correct everywhere, and CDC events keep flowing to non-owners
 * untouched (`useDashboardCDC`).
 *
 * The owner keeps the stream alive: when it cannot start (the token refresh
 * failed once, the start call failed) or Rust gave it up (401, repeated
 * oversized frames) it retries with backoff for as long as the user is
 * still signed in, and stops once nothing usable is stored (RC-4).
 *
 * Ownership is re-evaluated whenever the set of ticker windows can have
 * moved — a monitor plugged or unplugged, a sync that created or destroyed
 * a ticker, the bar shown or hidden — not only at mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriListener } from "./useTauriListener";
import { ownsSharedConnection } from "../lib/windowRole";
import { getValidToken, isSignedOut, rearmRefresh, signOutGeneration } from "../auth";
import { loadPref } from "../preferences";
import { API_BASE, DEMO } from "../config";
import type { DeliveryMode } from "../types";

export interface SharedSSE {
  /** `sse` while the stream is up, `polling` otherwise. Live in every window. */
  deliveryMode: DeliveryMode;
  /** Open the stream. No-op unless this window owns it, or it is already up. */
  startSSE: () => Promise<void>;
  /** Tear the stream down. No-op unless this window owns it. */
  stopSSE: () => Promise<void>;
}

/** Retry delays for a stream that will not start: 2 s, 4 s ... 60 s. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

interface Options {
  tickerShown: boolean;
  /**
   * Called in this window after the stream comes back up following a gap, so
   * the window that polls the dashboard can catch up on what it missed.
   * Not called for the first connection.
   */
  onReconnect?: () => void;
}

export function useSharedSSE({ tickerShown, onReconnect }: Options): SharedSSE {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    loadPref<DeliveryMode>("deliveryMode", "polling"),
  );
  const ownsRef = useRef(false);
  const activeRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const startRef = useRef<() => Promise<void>>(async () => {});
  const connectedRef = useRef(false);
  // A 401 gets one immediate retry (the normal token rotation must not
  // leave a visible gap); a second 401 before a connection waits.
  const quickRetryUsedRef = useRef(false);
  const forceRefreshRef = useRef(false);
  // The token the stream was last started with: on a 401 it is the one the
  // server refused, so a refresh is spent only if nobody has made one (D3-6).
  const startedTokenRef = useRef<string | undefined>(undefined);
  // Oversized-frame aborts follow a "connected", which resets the backoff,
  // so they count on their own. ponytail: kept until stopSSE; a server that
  // misbehaved once waits longer next time, capped at RETRY_MAX_MS.
  const oversizeAbortsRef = useRef(0);
  const everConnectedRef = useRef(false);
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  // Try again later, unless the session is really over or we no longer own
  // the stream. One timer at a time.
  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current || !ownsRef.current || (!DEMO && isSignedOut())) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** attemptRef.current, RETRY_MAX_MS);
    attemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void startRef.current();
    }, delay);
  }, []);

  const startSSE = useCallback(async () => {
    if (!ownsRef.current || activeRef.current) return;
    // Claim before the first await: mount and the auth listener can both
    // land here in the same tick, and two `start_sse` calls are two logins.
    activeRef.current = true;
    // Demo mode talks to the no-auth bridge, which ignores the Bearer —
    // use a placeholder so the SSE stream still starts without Logto.
    // After a 401 the stored token is wrong whatever its local expiry says
    // (a clock behind the server's, a key rotated), so refresh it.
    const force = forceRefreshRef.current;
    forceRefreshRef.current = false;
    const gen = signOutGeneration();
    const token = DEMO ? "demo" : await getValidToken(force, startedTokenRef.current);
    // Ownership can move while the silent refresh is in flight, and the
    // user can sign out (D2-6): a stream started now would outlive it.
    if (!token || !ownsRef.current || gen !== signOutGeneration()) {
      activeRef.current = false;
      forceRefreshRef.current = force; // the refresh did not happen: still owed
      scheduleRetry(); // a refresh that failed once may work in a moment
      return;
    }
    setDeliveryMode("sse");
    startedTokenRef.current = token;
    await invoke("start_sse", { token, apiBase: API_BASE }).catch(() => {
      activeRef.current = false;
      setDeliveryMode("polling");
      scheduleRetry();
    });
  }, [scheduleRetry]);
  startRef.current = startSSE;

  const stopSSE = useCallback(async () => {
    if (!ownsRef.current) return;
    clearRetry();
    attemptRef.current = 0;
    oversizeAbortsRef.current = 0;
    activeRef.current = false;
    setDeliveryMode("polling");
    await invoke("stop_sse").catch(() => {});
  }, []);

  // ── Election ──────────────────────────────────────────────────
  //
  // Losing ownership must NOT call `stop_sse`: the window that just took
  // over has already started, and Rust cancelled our task when it did.
  // Stopping here would kill the new owner's connection instead, which is
  // the gap where the banner appears.
  const elect = useCallback(async () => {
    const owns = await ownsSharedConnection();
    if (owns === ownsRef.current) return;
    ownsRef.current = owns;
    if (owns) {
      // Proactive refresh is owner-only, so a window that just took over
      // (ticker destroyed on a monitor change, main taking over) arms it now.
      rearmRefresh();
      await startSSE();
    }
    else {
      clearRetry();
      activeRef.current = false;
    }
  }, [startSSE, clearRetry]);

  useEffect(() => clearRetry, [clearRetry]);

  // A monitor came or went; `sync_ticker_windows` finished creating or
  // destroying ticker windows; this ticker was told to re-place itself.
  useTauriListener("monitors-changed", () => void elect());
  useTauriListener("ticker-windows-changed", () => void elect());
  useTauriListener("ticker-reposition", () => void elect());

  // Mount, and every time the bar is shown or hidden (tray, Ctrl+T, the
  // settings row, the context menu). `tickerShown` is a prop: App.tsx already
  // follows `scrollr:settings`, so a second subscription here would only
  // duplicate it.
  useEffect(() => {
    void elect();
  }, [tickerShown, elect]);

  // ── Status from Rust ──────────────────────────────────────────
  useTauriListener<{ status: string; code?: number; error?: string; message?: string }>(
    "sse-status",
    async (event) => {
      const { status, message } = event.payload;
      setDeliveryMode(status === "connected" ? "sse" : "polling");
      if (status === "connected") {
        attemptRef.current = 0;
        quickRetryUsedRef.current = false;
        const wasConnected = connectedRef.current;
        connectedRef.current = true;
        // Events missed while the stream was down are gone: catch up once.
        if (!wasConnected && everConnectedRef.current) onReconnectRef.current?.();
        everConnectedRef.current = true;
        return;
      }
      connectedRef.current = false; // anything but "connected" is a gap
      // Rust has given up on the stream: a 401, or repeated oversized frames
      // (the only "error" it sends with a message). The owner reopens it
      // with a fresh token, through the backoff so a server that keeps
      // refusing is not hammered (SCROLLR-470).
      if (status === "auth-expired") {
        activeRef.current = false;
        forceRefreshRef.current = true;
        if (!quickRetryUsedRef.current) {
          quickRetryUsedRef.current = true;
          await startSSE();
        } else scheduleRetry();
      } else if (status === "error" && message) {
        activeRef.current = false;
        oversizeAbortsRef.current += 1;
        attemptRef.current = Math.max(attemptRef.current, oversizeAbortsRef.current);
        scheduleRetry();
      }
    },
  );

  return { deliveryMode, startSSE, stopSSE };
}
