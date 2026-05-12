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
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { DEFAULT_CLOCK_TICKER, DEFAULT_CLOCK_POMODORO } from "../../preferences";
import { LS_CLOCK_FORMAT, LS_CLOCK_TIMEZONES } from "../../constants";
import { loadTimezones, loadFormat, tzLabel } from "./storage";
import type { ClockPomodoroConfig } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

type ClockFormat = "12h" | "24h";

const FORMAT_OPTIONS: { value: ClockFormat; label: string }[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];

const LONG_BREAK_OPTIONS = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

export default function ClockConfigPanel({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("clock", prefs, onPrefsChange);
  const [format, setFormatState] = useStoreData(LS_CLOCK_FORMAT, loadFormat);
  const [timezones] = useStoreData(LS_CLOCK_TIMEZONES, loadTimezones);
  const { isExcluded: isTimezoneExcluded, toggle: toggleTimezone } =
    useTickerExclusion(config.ticker.excludedTimezones, "excludedTimezones", setTicker);

  const setPomodoro = useCallback(
    (patch: Partial<ClockPomodoroConfig>) => {
      update({ pomodoro: { ...config.pomodoro, ...patch } });
    },
    [update, config.pomodoro],
  );

  const handleFormatChange = useCallback(
    (v: ClockFormat) => {
      setFormatState(v);
      setStore(LS_CLOCK_FORMAT, v);
    },
    [],
  );

  const resetAll = useCallback(() => {
    update({
      ticker: { ...DEFAULT_CLOCK_TICKER },
      pomodoro: { ...DEFAULT_CLOCK_POMODORO },
    });
    setStore(LS_CLOCK_FORMAT, "12h");
    setFormatState("12h");
  }, [update]);

  const clockIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-widget-clock)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );

  return (
    <ConfigPanelLayout
      icon={clockIcon}
      hex="var(--color-widget-clock)"
      title="Clock Settings"
      subtitle="World clocks and Pomodoro timer"
      onReset={resetAll}
    >
      {/* Ticker */}
      <Section title="Ticker">
        <SegmentedRow
          label="Time format"
          description="12-hour or 24-hour clock"
          value={format}
          options={FORMAT_OPTIONS}
          onChange={handleFormatChange}
        />
        <ToggleRow
          label="Local time"
          description="Show your local clock on the scrolling ticker"
          checked={config.ticker.localTime}
          onChange={(v) => setTicker({ localTime: v })}
        />
        <ToggleRow
          label="Show world clocks"
          description="Include configured timezones on the ticker"
          checked={config.ticker.showTimezones}
          onChange={(v) => setTicker({ showTimezones: v })}
        />
        {config.ticker.showTimezones && timezones.map((tz) => (
          <ToggleRow
            key={tz}
            label={tzLabel(tz)}
            checked={!isTimezoneExcluded(tz)}
            onChange={() => toggleTimezone(tz)}
          />
        ))}
        {config.ticker.showTimezones && timezones.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-fg-4">
            Add world clocks in the Clock tab to see them here.
          </div>
        )}
        <ToggleRow
          label="Active timer"
          description="Show running timers on the ticker"
          checked={config.ticker.activeTimer}
          onChange={(v) => setTicker({ activeTimer: v })}
        />
        <TickerPinSection widgetId="clock" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

      {/* Pomodoro */}
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
