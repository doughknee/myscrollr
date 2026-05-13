import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { DEFAULT_CLOCK_TICKER } from "../../preferences";
import { LS_CLOCK_FORMAT, LS_CLOCK_TIMEZONES } from "../../constants";
import { loadTimezones, loadFormat, tzLabel } from "./storage";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

type ClockFormat = "12h" | "24h";

const FORMAT_OPTIONS: { value: ClockFormat; label: string }[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
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
      subtitle="Local time and world clocks"
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
        <TickerPinSection widgetId="clock" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>
    </ConfigPanelLayout>
  );
}
