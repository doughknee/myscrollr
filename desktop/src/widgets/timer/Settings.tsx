/** Timer settings surface — rendered inside the in-feed gear popover and (until teardown) the Configure page. */
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  SliderRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
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

export default function TimerSettings({
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

  return (
    <>
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
      <div className="flex items-center justify-end px-3 pb-1 pt-2">
        <ResetButton onClick={resetAll} />
      </div>
    </>
  );
}
