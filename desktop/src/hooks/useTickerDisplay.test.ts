/**
 * A host with no native display (the website's embed answered null for
 * `ticker_display`, SCROLLR-451) gets the docked bar, not a crash in App.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "ticker", show: async () => {}, hide: async () => {} }),
}));
vi.mock("./useTauriListener", () => ({ useTauriListener: () => {} }));

import { useTickerDisplay } from "./useTickerDisplay";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

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
    expect(emit).toHaveBeenCalledWith("ticker-placement", { label: "ticker", monitor: "", failed: false });
  });

  // SCROLLR-405: a hidden window cannot show its own error, so the failure is sent to the main window.
  it("tells the main window when the first placement fails", async () => {
    vi.mocked(emit).mockClear();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ticker_display") return { monitor: "DISPLAY2", mode: "docked", readingSize: 100, suspended: false, pageLeader: true } as never;
      if (cmd === "position_ticker") throw "no such monitor";
      return null as never;
    });
    const { result } = renderHook(() => useTickerDisplay(prefs));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(emit).toHaveBeenCalledWith("ticker-placement", { label: "ticker", monitor: "DISPLAY2", failed: true });
  });
});
