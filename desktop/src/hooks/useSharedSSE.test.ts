/**
 * Ownership election re-arms the owner-only proactive token refresh
 * (SCROLLR-257): a window that becomes owner later (ticker destroyed on a
 * monitor change) still holds a spent non-owner timer, so `elect` must call
 * `rearmRefresh`. A window that never owns must not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  owns: false,
  handlers: new Map<string, () => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("./useTauriListener", () => ({
  useTauriListener: (event: string, handler: () => void) => {
    h.handlers.set(event, handler);
  },
}));
vi.mock("../lib/windowRole", () => ({ ownsSharedConnection: async () => h.owns }));
vi.mock("../auth", () => ({
  getValidToken: vi.fn(async () => "tok"),
  rearmRefresh: vi.fn(),
}));
vi.mock("../preferences", () => ({ loadPref: (_k: string, d: unknown) => d }));
vi.mock("../config", () => ({ API_BASE: "http://x", DEMO: false }));

import { useSharedSSE } from "./useSharedSSE";
import { rearmRefresh } from "../auth";

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
