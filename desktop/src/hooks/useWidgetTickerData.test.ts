import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { LS_CLOCK_FORMAT, LS_TIMER_STATE } from "../constants";
import { useWidgetTickerData } from "./useWidgetTickerData";
import type { WidgetPrefs } from "../preferences";

const storeValues = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../lib/store", () => ({
  getStore: vi.fn((key: string, fallback: unknown) => (
    storeValues.has(key) ? storeValues.get(key) : fallback
  )),
  onStoreChange: vi.fn(() => vi.fn()),
  setStore: vi.fn(),
}));

function makeWidgetPrefs(widgetsOnTicker: string[]): WidgetPrefs {
  return {
    enabledWidgets: widgetsOnTicker,
    widgetsOnTicker,
    pinnedWidgets: {},
    clock: {
      ticker: {
        localTime: false,
        showTimezones: false,
        excludedTimezones: [],
      },
    },
    timer: {
      ticker: { activeTimer: true },
      pomodoro: {
        workMins: 25,
        shortBreakMins: 5,
        longBreakMins: 15,
        longBreakEvery: 4,
      },
    },
    weather: { ticker: { excludedCities: [] } },
    sysmon: {
      refreshInterval: 2,
      tempUnit: "celsius",
      ticker: {
        cpu: false,
        memory: false,
        gpu: false,
        gpuPower: false,
      },
    },
    uptime: {
      url: "",
      pollInterval: 60,
      ticker: { excludedMonitors: [] },
    },
    github: {
      repos: [],
      pollInterval: 120,
      ticker: { excludedRepos: [] },
    },
  };
}

function makeTimerPrefs(activeTimer: boolean): WidgetPrefs {
  const prefs = makeWidgetPrefs(["timer"]);
  return {
    ...prefs,
    timer: {
      ...prefs.timer,
      ticker: { activeTimer },
    },
  };
}

afterEach(() => {
  cleanup();
  storeValues.clear();
});

describe("useWidgetTickerData", () => {
  it("keeps clock and timer chips in separate buckets", async () => {
    storeValues.set(LS_CLOCK_FORMAT, "12h");
    storeValues.set(LS_TIMER_STATE, {
      mode: "stopwatch",
      startedAt: null,
      bankedMs: 65_000,
      targetSecs: 0,
      completedSessions: 0,
    });

    const prefs = makeWidgetPrefs(["clock", "timer"]);
    const { result } = renderHook(() => useWidgetTickerData(prefs));

    await waitFor(() => {
      expect(result.current.clock).toEqual([]);
      expect(result.current.timer).toEqual([
        {
          id: "timer",
          kind: "timer",
          label: "Timer",
          value: "01:05",
          detail: "Stopwatch",
        },
      ]);
    });
  });

  it("suppresses timer chips when the timer ticker setting is disabled", async () => {
    storeValues.set(LS_TIMER_STATE, {
      mode: "stopwatch",
      startedAt: null,
      bankedMs: 65_000,
      targetSecs: 0,
      completedSessions: 0,
    });

    const prefs = makeTimerPrefs(false);
    const { result } = renderHook(() => useWidgetTickerData(prefs));

    await waitFor(() => {
      expect(result.current.timer).toEqual([]);
    });
  });

  it("uses configured Pomodoro cadence in timer ticker detail", async () => {
    storeValues.set(LS_TIMER_STATE, {
      mode: "pomodoro",
      startedAt: null,
      bankedMs: 60_000,
      targetSecs: 1500,
      completedSessions: 2,
    });

    const prefs = makeWidgetPrefs(["timer"]);
    const customPrefs = {
      ...prefs,
      timer: {
        ...prefs.timer,
        pomodoro: {
          ...prefs.timer.pomodoro,
          longBreakEvery: 3,
        },
      },
    };
    const { result } = renderHook(() => useWidgetTickerData(customPrefs));

    await waitFor(() => {
      expect(result.current.timer).toHaveLength(1);
    });
    expect(result.current.timer[0]?.detail).toBe("Pomodoro · 2/3 sessions");
  });
});
