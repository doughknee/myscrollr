/** Sysmon settings surface — rendered inside the in-feed gear popover and (until teardown) the Configure page. */
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { DEFAULT_SYSMON_TICKER } from "../../preferences";
import type { TempUnit } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const REFRESH_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
];

const TEMP_OPTIONS: { value: TempUnit; label: string }[] = [
  { value: "celsius", label: "\u00B0C" },
  { value: "fahrenheit", label: "\u00B0F" },
];

export default function SysmonSettings({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("sysmon", prefs, onPrefsChange);

  const resetAll = useCallback(() => {
    update({
      refreshInterval: 2,
      tempUnit: "celsius",
      ticker: { ...DEFAULT_SYSMON_TICKER },
    });
  }, [update]);

  return (
    <>
      <Section title="Ticker">
        <ToggleRow
          label="CPU usage"
          description="Show how busy your processor is on the ticker"
          checked={config.ticker.cpu}
          onChange={(v) => setTicker({ cpu: v })}
        />
        <ToggleRow
          label="Memory usage"
          description="Show how much memory is being used on the ticker"
          checked={config.ticker.memory}
          onChange={(v) => setTicker({ memory: v })}
        />
        <ToggleRow
          label="GPU usage"
          description="Show how busy your graphics card is on the ticker"
          checked={config.ticker.gpu}
          onChange={(v) => setTicker({ gpu: v })}
        />
        <ToggleRow
          label="GPU power draw"
          description="Show graphics card wattage on the ticker"
          checked={config.ticker.gpuPower}
          onChange={(v) => setTicker({ gpuPower: v })}
        />
        <TickerPinSection widgetId="sysmon" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

      <Section title="Display">
        <SegmentedRow
          label="Update speed"
          description="How often the numbers update"
          value={String(config.refreshInterval)}
          options={REFRESH_OPTIONS}
          onChange={(v) => update({ refreshInterval: Number(v) })}
        />
        <SegmentedRow
          label="Temperature"
          value={config.tempUnit}
          options={TEMP_OPTIONS}
          onChange={(v) => update({ tempUnit: v })}
        />
      </Section>
      <div className="flex items-center justify-end px-3 pb-1 pt-2">
        <ResetButton onClick={resetAll} />
      </div>
    </>
  );
}
