/**
 * Timer settings surface — rendered inside the in-feed gear popover.
 * 2026-07-17 unification: a running timer always reaches the ticker, so
 * only the Pomodoro behavior lives here.
 */
import { useCallback } from "react";
import {
  Section,
  SegmentedRow,
  SliderRow,
} from "../../components/settings/SettingsControls";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import type { TimerPomodoroConfig } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const LONG_BREAK_OPTIONS = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

export default function TimerSettings({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update } = useWidgetConfig("timer", prefs, onPrefsChange);

  const setPomodoro = useCallback(
    (patch: Partial<TimerPomodoroConfig>) => {
      update({ pomodoro: { ...config.pomodoro, ...patch } });
    },
    [update, config.pomodoro],
  );

  return (
    <Section title="Pomodoro">
      <SliderRow
        label="Work session"
        value={config.pomodoro.workMins}
        min={10}
        max={60}
        step={5}
        displayValue={`${config.pomodoro.workMins} min`}
        onChange={(v) => setPomodoro({ workMins: v })}
      />
      <SliderRow
        label="Short break"
        value={config.pomodoro.shortBreakMins}
        min={1}
        max={15}
        step={1}
        displayValue={`${config.pomodoro.shortBreakMins} min`}
        onChange={(v) => setPomodoro({ shortBreakMins: v })}
      />
      <SliderRow
        label="Long break"
        value={config.pomodoro.longBreakMins}
        min={5}
        max={30}
        step={5}
        displayValue={`${config.pomodoro.longBreakMins} min`}
        onChange={(v) => setPomodoro({ longBreakMins: v })}
      />
      <SegmentedRow
        label="Long break every"
        description="Sessions before a long break"
        value={String(config.pomodoro.longBreakEvery)}
        options={LONG_BREAK_OPTIONS}
        onChange={(v) => setPomodoro({ longBreakEvery: Number(v) })}
      />
    </Section>
  );
}
