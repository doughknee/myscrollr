import { useCallback } from "react";
import { Clock } from "lucide-react";
import { WorldClock } from "./WorldClock";
import { WidgetBar } from "../../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../../components/widget-bar/Segmented";
import { useStoreData } from "../../hooks/useStoreData";
import { LS_CLOCK_FORMAT } from "../../constants";
import { loadFormat, saveFormat } from "./storage";
import type { TimeFormat } from "./types";
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
      "Use the 12h/24h control in the top bar to change clock formatting.",
    ],
  },
  FeedTab: ClockFeedTab,
};

const FORMAT_OPTIONS: SegmentedOption<TimeFormat>[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];

function ClockFeedTab({ mode }: FeedTabProps) {
  // Format lives here (not in the bar or body) because both consume it:
  // the bar's Segmented writes it, WorldClock renders with it. useStoreData
  // only relays *cross-window* writes, so in-window siblings would desync.
  const [format, setFormatState] = useStoreData(LS_CLOCK_FORMAT, loadFormat);
  const handleFormatChange = useCallback(
    (v: TimeFormat) => {
      setFormatState(v);
      saveFormat(v);
    },
    [setFormatState],
  );
  return (
    <div className="flex min-h-full flex-col">
      {mode === "comfort" && (
        <WidgetBar>
          <Segmented
            ariaLabel="Time format"
            value={format}
            onChange={handleFormatChange}
            options={FORMAT_OPTIONS}
          />
        </WidgetBar>
      )}
      <div className="p-3">
        <WorldClock compact={mode === "compact"} fmt={format} />
      </div>
    </div>
  );
}
