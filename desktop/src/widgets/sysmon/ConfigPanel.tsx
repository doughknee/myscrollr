/**
 * Sysmon ConfigPanel — thin wrapper (in-widget config pass, PR 6).
 * The settings body moved to ./Settings.tsx, which the FeedTab now
 * mounts in a gear popover; this page renders the same component until
 * the configure-page teardown deletes it.
 */
import SysmonSettings from "./Settings";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

export default function SysmonConfigPanel(props: WidgetConfigPanelProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="w-full max-w-2xl mx-auto pb-8">
          <SysmonSettings {...props} />
        </div>
      </div>
    </div>
  );
}
