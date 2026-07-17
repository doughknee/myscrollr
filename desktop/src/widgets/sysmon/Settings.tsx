/**
 * Sysmon settings surface — rendered inside the in-feed gear popover.
 * 2026-07-17 unification: the stat toggles are CONTENT selection — they
 * gate both the feed cards and the ticker chips. (The config keys still
 * live under `ticker` for storage compatibility.)
 */
import {
  Section,
  ToggleRow,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import type { TempUnit } from "../../preferences";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

const REFRESH_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: "1s" },
  { value: "2", label: "2s" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
];

const TEMP_OPTIONS: { value: TempUnit; label: string }[] = [
  { value: "celsius", label: "°C" },
  { value: "fahrenheit", label: "°F" },
];

export default function SysmonSettings({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("sysmon", prefs, onPrefsChange);

  return (
    <>
      <Section title="Stats">
        <ToggleRow
          label="CPU usage"
          description="Track how busy your processor is"
          checked={config.ticker.cpu}
          onChange={(v) => setTicker({ cpu: v })}
        />
        <ToggleRow
          label="Memory usage"
          description="Track how much memory is in use"
          checked={config.ticker.memory}
          onChange={(v) => setTicker({ memory: v })}
        />
        <ToggleRow
          label="GPU usage"
          description="Track how busy your graphics card is"
          checked={config.ticker.gpu}
          onChange={(v) => setTicker({ gpu: v })}
        />
        <ToggleRow
          label="GPU power draw"
          description="Track graphics card wattage"
          checked={config.ticker.gpuPower}
          onChange={(v) => setTicker({ gpuPower: v })}
        />
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
    </>
  );
}
