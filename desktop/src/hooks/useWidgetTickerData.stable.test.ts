/**
 * The clock rebuilds its chips every second but shows hours and minutes. The
 * data object must stay the same while nothing on it changed, or the whole bar
 * re-renders and Continuous rebuilds every chip each second (SCROLLR-463, PF-8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { UnitsPrefs, WidgetPrefs } from "../preferences";

vi.mock("../lib/store", () => ({
  getStore: vi.fn((_k: string, fallback: unknown) => fallback),
  onStoreChange: vi.fn(() => vi.fn()),
  setStore: vi.fn(),
}));

import { useWidgetTickerData } from "./useWidgetTickerData";

const UNITS: UnitsPrefs = { temperature: "fahrenheit", timeFormat: "12h" };
const prefs = {
  enabledWidgets: ["clock"],
  sidebarOrder: [],
  widgetsOnTicker: ["clock"],
  pins: [],
  timer: { pomodoro: { workMins: 25, shortBreakMins: 5, longBreakMins: 15, longBreakEvery: 4 } },
  sysmon: { ticker: { cpu: false, memory: false, gpu: false, gpuPower: false } },
  uptime: { url: "" },
  github: { repos: [], quietHours: { on: false, from: "22:00", to: "08:00" }, flash: true },
} as unknown as WidgetPrefs;

describe("useWidgetTickerData identity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T12:00:10Z"));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns a new object only when a chip changed, not on every clock tick", async () => {
    const seen = new Set<unknown>();
    renderHook(() => {
      const d = useWidgetTickerData(prefs, UNITS);
      seen.add(d);
      return d;
    });
    // One render pass per second, as the real timer delivers them.
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
    }
    // The minute turned once (the shown time changed once): initial, first build, one change.
    expect(seen.size).toBeLessThanOrEqual(4);
  });
});
