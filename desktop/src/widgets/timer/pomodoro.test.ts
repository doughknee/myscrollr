import { describe, expect, it } from "vitest";
import { DEFAULT_TIMER_POMODORO } from "../../preferences";
import { getPomodoroTiming, reconcileIdlePomodoroTarget } from "./pomodoro";
import type { TimerState } from "./types";

describe("getPomodoroTiming", () => {
  it("derives Pomodoro seconds and cadence from configured prefs", () => {
    const timing = getPomodoroTiming({
      workMins: 40,
      shortBreakMins: 7,
      longBreakMins: 20,
      longBreakEvery: 3,
    });

    expect(timing).toEqual({
      workSecs: 2400,
      shortBreakSecs: 420,
      longBreakSecs: 1200,
      longBreakEvery: 3,
    });
  });

  it("falls back to defaults for invalid values", () => {
    const timing = getPomodoroTiming({
      workMins: 0,
      shortBreakMins: Number.NaN,
      longBreakMins: -5,
      longBreakEvery: 0,
    });

    expect(timing).toEqual({
      workSecs: DEFAULT_TIMER_POMODORO.workMins * 60,
      shortBreakSecs: DEFAULT_TIMER_POMODORO.shortBreakMins * 60,
      longBreakSecs: DEFAULT_TIMER_POMODORO.longBreakMins * 60,
      longBreakEvery: DEFAULT_TIMER_POMODORO.longBreakEvery,
    });
  });
});

describe("reconcileIdlePomodoroTarget", () => {
  const idlePomodoro: TimerState = {
    mode: "pomodoro",
    startedAt: null,
    bankedMs: 0,
    targetSecs: 1500,
    completedSessions: 2,
  };

  it("updates an idle Pomodoro target to the configured work duration", () => {
    expect(reconcileIdlePomodoroTarget(idlePomodoro, 2400)).toEqual({
      ...idlePomodoro,
      targetSecs: 2400,
    });
  });

  it("preserves running or partially elapsed Pomodoro timers", () => {
    expect(
      reconcileIdlePomodoroTarget(
        { ...idlePomodoro, startedAt: 123, targetSecs: 1500 },
        2400,
      ),
    ).toEqual({ ...idlePomodoro, startedAt: 123, targetSecs: 1500 });

    expect(
      reconcileIdlePomodoroTarget(
        { ...idlePomodoro, bankedMs: 1000, targetSecs: 1500 },
        2400,
      ),
    ).toEqual({ ...idlePomodoro, bankedMs: 1000, targetSecs: 1500 });
  });

  it("preserves Countdown and Stopwatch targets", () => {
    expect(
      reconcileIdlePomodoroTarget(
        { ...idlePomodoro, mode: "countdown", targetSecs: 300 },
        2400,
      ),
    ).toEqual({ ...idlePomodoro, mode: "countdown", targetSecs: 300 });

    expect(
      reconcileIdlePomodoroTarget(
        { ...idlePomodoro, mode: "stopwatch", targetSecs: 0 },
        2400,
      ),
    ).toEqual({ ...idlePomodoro, mode: "stopwatch", targetSecs: 0 });
  });
});
