import { DEFAULT_TIMER_POMODORO } from "../../preferences";
import type { TimerPomodoroConfig } from "../../preferences";
import type { TimerState } from "./types";

export interface PomodoroTiming {
  workSecs: number;
  shortBreakSecs: number;
  longBreakSecs: number;
  longBreakEvery: number;
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getPomodoroTiming(config: TimerPomodoroConfig): PomodoroTiming {
  return {
    workSecs: positiveNumber(config.workMins, DEFAULT_TIMER_POMODORO.workMins) * 60,
    shortBreakSecs: positiveNumber(config.shortBreakMins, DEFAULT_TIMER_POMODORO.shortBreakMins) * 60,
    longBreakSecs: positiveNumber(config.longBreakMins, DEFAULT_TIMER_POMODORO.longBreakMins) * 60,
    longBreakEvery: positiveNumber(config.longBreakEvery, DEFAULT_TIMER_POMODORO.longBreakEvery),
  };
}

export function reconcileIdlePomodoroTarget(
  state: TimerState,
  workSecs: number,
): TimerState {
  if (
    state.mode !== "pomodoro" ||
    state.startedAt !== null ||
    state.bankedMs !== 0 ||
    state.targetSecs === workSecs
  ) {
    return state;
  }

  return { ...state, targetSecs: workSecs };
}
