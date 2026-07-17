/** Uptime settings surface — rendered inside the in-feed gear popover and (until teardown) the Configure page. */
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SliderRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { DEFAULT_UPTIME_TICKER } from "../../preferences";
import { formatPollInterval } from "../../utils/format";
import { LS_UPTIME_MONITORS } from "../../constants";
import { loadMonitors } from "./types";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

export default function UptimeSettings({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("uptime", prefs, onPrefsChange);
  const [monitors] = useStoreData(LS_UPTIME_MONITORS, loadMonitors);
  const { isExcluded: isMonitorExcluded, toggle: toggleMonitor } =
    useTickerExclusion(config.ticker.excludedMonitors, "excludedMonitors", setTicker);

  const resetAll = useCallback(() => {
    update({
      pollInterval: 60,
      ticker: { ...DEFAULT_UPTIME_TICKER },
    });
  }, [update]);

  return (
    <>
      <Section title="Ticker">
        {monitors.map((monitor) => {
          const statusLabel = monitor.status.charAt(0).toUpperCase() + monitor.status.slice(1);
          const uptime = monitor.uptimePercent != null ? `${monitor.uptimePercent.toFixed(1)}%` : "";
          return (
            <ToggleRow
              key={monitor.id}
              label={monitor.name}
              description={[statusLabel, uptime].filter(Boolean).join(" · ")}
              checked={!isMonitorExcluded(monitor.id)}
              onChange={() => toggleMonitor(monitor.id)}
            />
          );
        })}
        {monitors.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-fg-4">
            Connect to Uptime Kuma in the feed tab to choose what shows on the ticker.
          </div>
        )}
        <TickerPinSection widgetId="uptime" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

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

      <div className="flex items-center justify-end px-3 pb-1 pt-2">
        <ResetButton onClick={resetAll} />
      </div>
    </>
  );
}
