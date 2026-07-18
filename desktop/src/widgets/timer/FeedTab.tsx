import { useCallback, useState } from "react";
import { TimerReset } from "lucide-react";
import { Timer, loadTimerState, switchedTimerState } from "./Timer";
import { WidgetBar } from "../../components/widget-bar/Bar";
import {
  SelectMenu,
  type SelectOption,
} from "../../components/widget-bar/SelectMenu";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { useShell } from "../../shell-context";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import type { TimerPomodoroConfig } from "../../preferences";
import type { TimerMode } from "./types";
import type { FeedTabProps, WidgetManifest } from "../../types";

export const timerWidget: WidgetManifest = {
  id: "timer",
  name: "Timer",
  tabLabel: "Timer",
  description: "Pomodoro, countdown, and stopwatch tools",
  hex: "#f59e0b",
  icon: TimerReset,
  info: {
    about:
      "The Timer widget provides Pomodoro sessions, countdown timers, and a stopwatch as a focused desktop control surface.",
    usage: [
      "Choose Pomodoro, Countdown, or Stopwatch from the mode selector.",
      "Use Space to start or pause and R to reset while the timer feed is focused.",
      "A running timer automatically appears on the ticker.",
      "Adjust Pomodoro session lengths and long-break cadence from the top bar.",
    ],
  },
  FeedTab: TimerFeedTab,
};

const minuteOptions = (from: number, to: number, step: number): SelectOption<string>[] =>
  Array.from({ length: (to - from) / step + 1 }, (_, i) => {
    const v = from + i * step;
    return { value: String(v), label: `${v} min` };
  });

const WORK_OPTIONS = minuteOptions(10, 60, 5);
const SHORT_BREAK_OPTIONS = minuteOptions(1, 15, 1);
const LONG_BREAK_OPTIONS = minuteOptions(5, 30, 5);
const EVERY_OPTIONS: SelectOption<string>[] = [2, 3, 4, 5, 6].map((n) => ({
  value: String(n),
  label: `${n} sessions`,
}));

const MODE_OPTIONS: SegmentedOption<TimerMode>[] = [
  { value: "pomodoro", label: "Pomodoro" },
  { value: "countdown", label: "Countdown" },
  { value: "stopwatch", label: "Stopwatch" },
];

function TimerFeedTab(props: FeedTabProps) {
  // Timer state lives here so the bar's mode tabs and the Timer body
  // drive one machine (the bar renders only in comfort mode; compact
  // keeps its in-body tabs).
  const [timerState, setTimerState] = useState(loadTimerState);
  const [confirmSwitch, setConfirmSwitch] = useState<TimerMode | null>(null);

  const requestSwitchMode = useCallback(
    (m: TimerMode) => {
      if (m === timerState.mode) return;
      // Running or partially-elapsed timer: confirm before discarding
      // (the dialog renders inside the Timer body).
      if (timerState.startedAt !== null || timerState.bankedMs > 0)
        setConfirmSwitch(m);
      else setTimerState((p) => switchedTimerState(p, m));
    },
    [timerState.mode, timerState.startedAt, timerState.bankedMs],
  );

  return (
    <div className="flex min-h-full flex-col">
      {props.mode === "comfort" && (
        <TimerBar mode={timerState.mode} onSwitchMode={requestSwitchMode} />
      )}
      <div className="p-3">
        <Timer
          compact={props.mode === "compact"}
          state={timerState}
          setState={setTimerState}
          confirmSwitch={confirmSwitch}
          setConfirmSwitch={setConfirmSwitch}
          onRequestSwitchMode={requestSwitchMode}
        />
      </div>
    </div>
  );
}

function TimerBar({
  mode,
  onSwitchMode,
}: {
  mode: TimerMode;
  onSwitchMode: (m: TimerMode) => void;
}) {
  const { prefs, onPrefsChange } = useShell();
  const { config, update } = useWidgetConfig("timer", prefs, onPrefsChange);
  const setPomodoro = useCallback(
    (patch: Partial<TimerPomodoroConfig>) => {
      update({ pomodoro: { ...config.pomodoro, ...patch } });
    },
    [update, config.pomodoro],
  );
  return (
    <WidgetBar>
      <Segmented
        ariaLabel="Timer mode"
        value={mode}
        onChange={onSwitchMode}
        options={MODE_OPTIONS}
      />
      {mode === "pomodoro" && (
        <div className="ml-auto flex min-w-0 shrink items-center gap-2">
          <SelectMenu
            ariaLabel="Work session length"
            prefix="Work"
            value={String(config.pomodoro.workMins)}
            options={WORK_OPTIONS}
            onChange={(v) => setPomodoro({ workMins: Number(v) })}
          />
          <SelectMenu
            ariaLabel="Short break length"
            prefix="Break"
            value={String(config.pomodoro.shortBreakMins)}
            options={SHORT_BREAK_OPTIONS}
            onChange={(v) => setPomodoro({ shortBreakMins: Number(v) })}
          />
          <SelectMenu
            ariaLabel="Long break length"
            prefix="Long break"
            value={String(config.pomodoro.longBreakMins)}
            options={LONG_BREAK_OPTIONS}
            onChange={(v) => setPomodoro({ longBreakMins: Number(v) })}
          />
          <SelectMenu
            ariaLabel="Sessions before a long break"
            prefix="Every"
            value={String(config.pomodoro.longBreakEvery)}
            options={EVERY_OPTIONS}
            onChange={(v) => setPomodoro({ longBreakEvery: Number(v) })}
          />
        </div>
      )}
    </WidgetBar>
  );
}
