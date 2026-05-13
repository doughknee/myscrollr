import { TimerReset } from "lucide-react";
import { Timer } from "./Timer";
import type { FeedTabProps, WidgetManifest } from "../../types";

export const timerWidget: WidgetManifest = {
  id: "timer",
  name: "Timer",
  tabLabel: "Timer",
  description: "Pomodoro, countdown, and stopwatch tools",
  hex: "#f59e0b",
  icon: TimerReset,
  info: {
    about:
      "The Timer widget provides Pomodoro sessions, countdown timers, and a stopwatch as a focused desktop control surface.",
    usage: [
      "Choose Pomodoro, Countdown, or Stopwatch from the mode selector.",
      "Use Space to start or pause and R to reset while the timer feed is focused.",
      "Enable active timer ticker output in the Configure tab.",
      "Adjust Pomodoro session lengths and long-break cadence in Configure.",
    ],
  },
  FeedTab: TimerFeedTab,
};

function TimerFeedTab({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <Timer compact={mode === "compact"} />
    </div>
  );
}
