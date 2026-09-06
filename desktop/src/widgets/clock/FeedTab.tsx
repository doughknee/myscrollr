import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
import { WidgetBar } from "../../components/widget-bar/Bar";
import { SearchBox } from "../../components/widget-bar/SearchBox";
import { useShell } from "../../shell-context";
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
      "Switch between 12h and 24h under Settings → Appearance → Units & formats.",
    ],
  },
  FeedTab: ClockFeedTab,
};

function ClockFeedTab({ mode }: FeedTabProps) {
  // 12h/24h is an app-wide setting (Appearance → Units & formats).
  const format = useShell().prefs.appearance.units.timeFormat;
  // The add-timezone query lives here because the bar writes it and the
  // body renders from it.
  const [addQuery, setAddQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const comfort = mode === "comfort";
  return (
    <div className="flex min-h-full flex-col">
      {comfort && (
        <WidgetBar>
          <div className="ml-auto">
            <SearchBox
              inputRef={searchRef}
              query={addQuery}
              onQueryChange={setAddQuery}
              resultCount={null}
              ariaLabel="Add time zone"
              noun="time zones"
            />
          </div>
        </WidgetBar>
      )}
      <div className="p-3">
        <WorldClock
          compact={mode === "compact"}
          fmt={format}
          addQuery={comfort ? addQuery : undefined}
          onAddQueryChange={comfort ? setAddQuery : undefined}
        />
      </div>
    </div>
  );
}
