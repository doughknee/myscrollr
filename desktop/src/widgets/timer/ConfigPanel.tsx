import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  SliderRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { DEFAULT_TIMER_TICKER, DEFAULT_TIMER_POMODORO } from "../../preferences";
import type { TimerPomodoroConfig } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const LONG_BREAK_OPTIONS = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

export default function TimerConfigPanel({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("timer", prefs, onPrefsChange);

  const setPomodoro = useCallback(
    (patch: Partial<TimerPomodoroConfig>) => {
      update({ pomodoro: { ...config.pomodoro, ...patch } });
    },
    [update, config.pomodoro],
  );

  const resetAll = useCallback(() => {
    update({
      ticker: { ...DEFAULT_TIMER_TICKER },
      pomodoro: { ...DEFAULT_TIMER_POMODORO },
    });
  }, [update]);

  const timerIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-widget-timer)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2h4" />
      <path d="M12 14l3-3" />
      <circle cx="12" cy="14" r="8" />
    </svg>
  );

  return (
    <ConfigPanelLayout
      icon={timerIcon}
      hex="var(--color-widget-timer)"
      title="Timer Settings"
      subtitle="Pomodoro, countdown, and stopwatch"
      onReset={resetAll}
    >
      <Section title="Ticker">
        <ToggleRow
          label="Active timer"
          description="Show running or paused timers on the scrolling ticker"
          checked={config.ticker.activeTimer}
          onChange={(v) => setTicker({ activeTimer: v })}
        />
        <TickerPinSection widgetId="timer" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

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
    </ConfigPanelLayout>
  );
}
