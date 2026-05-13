export type TimerMode = "pomodoro" | "countdown" | "stopwatch";

export interface TimerState {
  mode: TimerMode;
  startedAt: number | null;
  bankedMs: number;
  targetSecs: number;
  completedSessions: number;
}
