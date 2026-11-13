/**
 * Ownership election re-arms the owner-only proactive token refresh
 * (SCROLLR-257): a window that becomes owner later (ticker destroyed on a
 * monitor change) still holds a spent non-owner timer, so `elect` must call
 * `rearmRefresh`. A window that never owns must not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  owns: false,
  token: "tok" as string | null,
  signedOut: false,
  handlers: new Map<string, (e?: unknown) => unknown>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("./useTauriListener", () => ({
  useTauriListener: (event: string, handler: (e?: unknown) => unknown) => {
    h.handlers.set(event, handler);
  },
}));
vi.mock("../lib/windowRole", () => ({ ownsSharedConnection: async () => h.owns }));
vi.mock("../auth", () => ({
  getValidToken: vi.fn(async () => h.token),
  isSignedOut: () => h.signedOut,
  rearmRefresh: vi.fn(),
}));
vi.mock("../preferences", () => ({ loadPref: (_k: string, d: unknown) => d }));
vi.mock("../config", () => ({ API_BASE: "http://x", DEMO: false }));

import { useSharedSSE } from "./useSharedSSE";
import { rearmRefresh } from "../auth";
import { invoke } from "@tauri-apps/api/core";

describe("useSharedSSE election", () => {
  beforeEach(() => {
    h.owns = false;
    vi.mocked(rearmRefresh).mockClear();
  });

  it("re-arms the refresh timer only when this window becomes the owner", async () => {
    renderHook(() => useSharedSSE({ tickerShown: true }));
    await act(async () => {});
    expect(rearmRefresh).not.toHaveBeenCalled(); // non-owner: no timer work

    h.owns = true; // the ticker was destroyed; this window takes over
    await act(async () => {
      h.handlers.get("ticker-windows-changed")!();
    });
    expect(rearmRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      h.handlers.get("ticker-windows-changed")!(); // still owner: no re-arm
    });
    expect(rearmRefresh).toHaveBeenCalledTimes(1);
  });
});

const status = (payload: object) => act(async () => { await h.handlers.get("sse-status")!({ payload }); });
const startCalls = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "start_sse").length;

describe("useSharedSSE keeps the stream alive (RC-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockClear();
    h.owns = true;
    h.token = null; // the refresh failed
    h.signedOut = false;
  });
  afterEach(() => vi.useRealTimers());

  it("retries with backoff while signed in, and starts once a token comes back", async () => {
    renderHook(() => useSharedSSE({ tickerShown: true }));
    await act(async () => {});
    expect(startCalls()).toBe(0); // no token: nothing started, a retry is waiting

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(startCalls()).toBe(0); // second failure, next wait is 4 s
    h.token = "tok";
    await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
    expect(startCalls()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(startCalls()).toBe(1);
  });

  it("stops retrying when the session is really over", async () => {
    h.signedOut = true;
    renderHook(() => useSharedSSE({ tickerShown: true }));
    await act(async () => {});
    h.token = "tok";
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(startCalls()).toBe(0);
  });

  it("reopens the stream after Rust gives up on a 401, retrying if the token is not ready", async () => {
    h.token = "tok";
    renderHook(() => useSharedSSE({ tickerShown: true }));
    await act(async () => {});
    expect(startCalls()).toBe(1);

    h.token = null;
    await status({ status: "auth-expired" });
    h.token = "fresh";
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(startCalls()).toBe(2);
  });

  it("refetches once per reconnect, not on the first connection", async () => {
    h.token = "tok";
    const onReconnect = vi.fn();
    renderHook(() => useSharedSSE({ tickerShown: true, onReconnect }));
    await act(async () => {});
    await status({ status: "connected" });
    expect(onReconnect).not.toHaveBeenCalled();
    await status({ status: "connected" }); // still up: nothing missed
    expect(onReconnect).not.toHaveBeenCalled();

    await status({ status: "reconnecting" });
    await status({ status: "connected" });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
