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
 * Ownership is re-evaluated whenever the set of ticker windows can have
 * moved — a monitor plugged or unplugged, a sync that created or destroyed
 * a ticker, the bar shown or hidden — not only at mount.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriListener } from "./useTauriListener";
import { ownsSharedConnection } from "../lib/windowRole";
import { getValidToken } from "../auth";
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

export function useSharedSSE({ tickerShown }: { tickerShown: boolean }): SharedSSE {
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() =>
    loadPref<DeliveryMode>("deliveryMode", "polling"),
  );
  const ownsRef = useRef(false);
  const activeRef = useRef(false);

  const startSSE = useCallback(async () => {
    if (!ownsRef.current || activeRef.current) return;
    // Claim before the first await: mount and the auth listener can both
    // land here in the same tick, and two `start_sse` calls are two logins.
    activeRef.current = true;
    // Demo mode talks to the no-auth bridge, which ignores the Bearer —
    // use a placeholder so the SSE stream still starts without Logto.
    const token = DEMO ? "demo" : await getValidToken();
    // Ownership can move while the silent refresh is in flight.
    if (!token || !ownsRef.current) {
      activeRef.current = false;
      return;
    }
    setDeliveryMode("sse");
    await invoke("start_sse", { token, apiBase: API_BASE }).catch(() => {
      activeRef.current = false;
      setDeliveryMode("polling");
    });
  }, []);

  const stopSSE = useCallback(async () => {
    if (!ownsRef.current) return;
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
    if (owns) await startSSE();
    else activeRef.current = false;
  }, [startSSE]);

  // A monitor came or went; `sync_ticker_windows` finished creating or
  // destroying ticker windows; this ticker was told to re-place itself.
  useTauriListener("monitors-changed", () => void elect());
  useTauriListener("ticker-windows-changed", () => void elect());
  useTauriListener("ticker-reposition", () => void elect());

  // Mount, and every time the bar is shown or hidden (tray, Ctrl+T, the
  // settings row, the context menu). `tickerShown` is a prop rather than a
  // second `scrollr:settings` subscription: `onStoreChange`'s equality guard
  // writes the cache in the first callback, so a second subscriber to the
  // same key in the same window never fires.
  useEffect(() => {
    void elect();
  }, [tickerShown, elect]);

  // ── Status from Rust ──────────────────────────────────────────
  useTauriListener<{ status: string; code?: number; error?: string }>(
    "sse-status",
    async (event) => {
      const status = event.payload.status;
      setDeliveryMode(status === "connected" ? "sse" : "polling");
      if (status === "auth-expired") {
        // The token died under the stream. Rust stopped retrying; the owner
        // refreshes and reopens, everyone else just showed "polling".
        activeRef.current = false;
        await startSSE();
      }
    },
  );

  return { deliveryMode, startSSE, stopSSE };
}
