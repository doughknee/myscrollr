import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
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

function ClockFeedTab({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <WorldClock compact={mode === "compact"} />
    </div>
  );
}
