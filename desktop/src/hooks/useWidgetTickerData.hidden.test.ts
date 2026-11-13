/**
 * Utilities stop while this window's bar is hidden or suspended (SCROLLR-407,
 * SCROLLR-463 PF-5): no System Monitor probe every 2 s for a bar nobody sees,
 * and one immediate refresh when it comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { UnitsPrefs, WidgetPrefs } from "../preferences";

const h = vi.hoisted(() => ({ visible: true, probes: 0 }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isVisible: async () => h.visible }),
}));
vi.mock("./useSysmonData", () => ({
  fetchSysmonData: vi.fn(async () => {
    h.probes++;
    return {};
  }),
}));
vi.mock("../lib/store", () => ({
  getStore: vi.fn((_k: string, fallback: unknown) => fallback),
  onStoreChange: vi.fn(() => vi.fn()),
  setStore: vi.fn(),
}));

import { useWidgetTickerData } from "./useWidgetTickerData";

const UNITS: UnitsPrefs = { temperature: "fahrenheit", timeFormat: "12h" };
const prefs = {
  enabledWidgets: ["sysmon"],
  sidebarOrder: [],
  widgetsOnTicker: ["sysmon"],
  pins: [],
  timer: { pomodoro: { workMins: 25, shortBreakMins: 5, longBreakMins: 15, longBreakEvery: 4 } },
  sysmon: { ticker: { cpu: false, memory: false, gpu: false, gpuPower: false } },
  uptime: { url: "" },
  github: { repos: [], quietHours: { on: false, from: "22:00", to: "08:00" }, flash: true },
} as unknown as WidgetPrefs;

describe("utilities on a hidden bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.visible = true;
    h.probes = 0;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stops polling the System Monitor while hidden and refreshes once on return", async () => {
    renderHook(() => useWidgetTickerData(prefs, UNITS));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    const running = h.probes;
    expect(running).toBeGreaterThanOrEqual(3); // the first read plus a poll every 2 s

    h.visible = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100); // the next visibility check sees it
    });
    const atHide = h.probes;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(h.probes, "no probe while hidden").toBe(atHide);

    h.visible = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(h.probes - atHide, "one immediate refresh on return, then the poll resumes").toBeGreaterThanOrEqual(1);
  });
});
