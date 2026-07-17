import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
import { GearMenu } from "../../components/widget-bar/GearMenu";
import { useShell } from "../../shell-context";
import ClockSettings from "./Settings";
import type { FeedTabProps, WidgetManifest } from "../../types";

export const clockWidget: WidgetManifest = {
  id: "clock",
  name: "Clock",
  tabLabel: "Clock",
  description: "Local time and world clocks",
  hex: "#6366f1",
  icon: Clock,
  info: {
    about:
      "The Clock widget displays your local time and world clocks for tracking multiple time zones.",
    usage: [
      "Your local time appears in the Clock feed and can appear on the ticker.",
      "Add world clocks from the feed view to track more time zones.",
      "Turn on world clocks in Configure to include selected time zones on the ticker.",
      "Use the 12h/24h control to change clock formatting.",
    ],
  },
  FeedTab: ClockFeedTab,
};

function ClockFeedTab(props: FeedTabProps) {
  return (
    <div className="relative flex min-h-full flex-col">
      {/* Comfort mode floats the gear top-right — the widget's settings
          surface once the Configure page dies. */}
      {props.mode === "comfort" && (
        <div className="absolute right-3 top-3 z-10">
          <ClockGear />
        </div>
      )}
      <ClockFeedBody {...props} />
    </div>
  );
}

function ClockGear() {
  const { prefs, onPrefsChange } = useShell();
  return (
    <GearMenu ariaLabel="Clock settings" panelClassName="right-0 w-80">
      <ClockSettings prefs={prefs} onPrefsChange={onPrefsChange} />
    </GearMenu>
  );
}

function ClockFeedBody({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <WorldClock compact={mode === "compact"} />
    </div>
  );
}
