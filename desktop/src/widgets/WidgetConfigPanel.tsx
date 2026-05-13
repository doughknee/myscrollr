import type { AppPreferences } from "../preferences";
import ClockConfigPanel from "./clock/ConfigPanel";
import TimerConfigPanel from "./timer/ConfigPanel";
import WeatherConfigPanel from "./weather/ConfigPanel";
import SysmonConfigPanel from "./sysmon/ConfigPanel";
import UptimeConfigPanel from "./uptime/ConfigPanel";
import GitHubConfigPanel from "./github/ConfigPanel";

interface WidgetConfigPanelProps {
  widgetId: string;
  prefs: AppPreferences;
  onPrefsChange: (prefs: AppPreferences) => void;
}

/** Routes a widget ID to its config panel component. */
export default function WidgetConfigPanel({
  widgetId,
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  switch (widgetId) {
    case "clock":
      return (
        <ClockConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    case "timer":
      return (
        <TimerConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    case "weather":
      return (
        <WeatherConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    case "sysmon":
      return (
        <SysmonConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    case "uptime":
      return (
        <UptimeConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    case "github":
      return (
        <GitHubConfigPanel prefs={prefs} onPrefsChange={onPrefsChange} />
      );
    default:
      return (
        <div className="flex items-center justify-center h-full text-fg-3 text-xs">
          No settings available for this widget.
        </div>
      );
  }
}
