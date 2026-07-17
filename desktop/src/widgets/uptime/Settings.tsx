/**
 * Uptime settings surface — rendered inside the in-feed gear popover.
 * 2026-07-17 unification: every tracked monitor reaches the ticker, so
 * only widget-level behavior (polling) lives here.
 */
import {
  Section,
  SliderRow,
} from "../../components/settings/SettingsControls";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { formatPollInterval } from "../../utils/format";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

export default function UptimeSettings({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update } = useWidgetConfig("uptime", prefs, onPrefsChange);

  return (
    <Section title="Polling">
      <SliderRow
        label="Refresh interval"
        description="How often to check monitor status"
        value={config.pollInterval}
        min={30}
        max={300}
        step={30}
        displayValue={formatPollInterval(config.pollInterval)}
        onChange={(v) => update({ pollInterval: v })}
      />
    </Section>
  );
}
