/**
 * A host with no native display (the website's embed answered null for
 * `ticker_display`, SCROLLR-451) gets the docked bar, not a crash in App.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "ticker", show: async () => {}, hide: async () => {} }),
}));
vi.mock("./useTauriListener", () => ({ useTauriListener: () => {} }));

import { useTickerDisplay } from "./useTickerDisplay";
import { invoke } from "@tauri-apps/api/core";

const prefs = {
  window: { tickerPosition: "top", pinned: true, hideOnFullscreen: false },
  ticker: { showTicker: true },
  appearance: { tickerScale: 100 },
} as never;

describe("useTickerDisplay", () => {
  it("falls back to the docked display when the host returns null", async () => {
    const { result } = renderHook(() => useTickerDisplay(prefs));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("position_ticker", expect.anything()));
    expect(result.current.display).toMatchObject({ mode: "docked", suspended: false, pageLeader: true });
    expect(result.current.error).toBeNull();
  });
});
