import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { LS_CLOCK_TIMEZONES, LS_TIMER_STATE } from "../constants";
import { useWidgetTickerData } from "./useWidgetTickerData";
import type { UnitsPrefs, WidgetPrefs } from "../preferences";

const UNITS: UnitsPrefs = { temperature: "fahrenheit", timeFormat: "12h" };

const storeValues = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../lib/store", () => ({
  getStore: vi.fn((key: string, fallback: unknown) =>
    storeValues.has(key) ? storeValues.get(key) : fallback,
  ),
  onStoreChange: vi.fn(() => vi.fn()),
  setStore: vi.fn(),
}));

function makeWidgetPrefs(widgetsOnTicker: string[]): WidgetPrefs {
  return {
    enabledWidgets: widgetsOnTicker,
    sidebarOrder: [],
    widgetsOnTicker,
    pins: [],
    timer: {
      pomodoro: {
        workMins: 25,
        shortBreakMins: 5,
        longBreakMins: 15,
        longBreakEvery: 4,
      },
    },
    sysmon: {
      ticker: {
        cpu: false,
        memory: false,
        gpu: false,
        gpuPower: false,
      },
    },
    uptime: {
      url: "",
    },
    github: {
      repos: [],
    },
  };
}

afterEach(() => {
  cleanup();
  storeValues.clear();
});

describe("useWidgetTickerData", () => {
  it("keeps clock and timer chips in separate buckets", async () => {
    storeValues.set(LS_TIMER_STATE, {
      mode: "stopwatch",
      startedAt: null,
      bankedMs: 65_000,
      targetSecs: 0,
      completedSessions: 0,
    });

    const prefs = makeWidgetPrefs(["clock", "timer"]);
    const { result } = renderHook(() => useWidgetTickerData(prefs, UNITS));

    await waitFor(() => {
      expect(result.current.clock.map((c) => c.id)).toEqual(["clock-local"]);
      expect(result.current.timer).toEqual([
        {
          id: "timer",
          kind: "timer",
          label: "Timer",
          value: "01:05",
          detail: "Stopwatch",
          // A stopwatch counts up with no target, so it reports no
          // spine fraction and no end time. startedAt === null is the
          // pause marker.
          paused: true,
          remainingSec: undefined,
          totalSec: undefined,
          endsAt: undefined,
        },
      ]);
    });
  });

  // If you track it, it's on the ticker (docs/CHIP_SPEC.md §8): every
  // saved world clock becomes a chip, with no per-zone exclusion pref.
  it("puts local time and every tracked timezone on the ticker", async () => {
    storeValues.set(LS_CLOCK_TIMEZONES, ["Asia/Tokyo", "Europe/London"]);

    const prefs = makeWidgetPrefs(["clock"]);
    const { result } = renderHook(() => useWidgetTickerData(prefs, UNITS));

    await waitFor(() => {
      expect(result.current.clock.map((c) => c.id)).toEqual([
        "clock-local",
        "clock-Asia/Tokyo",
        "clock-Europe/London",
      ]);
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
    const { result } = renderHook(() => useWidgetTickerData(customPrefs, UNITS));

    await waitFor(() => {
      expect(result.current.timer).toHaveLength(1);
    });
    expect(result.current.timer[0]?.detail).toBe("Pomodoro · 2/3 sessions");
  });
});
