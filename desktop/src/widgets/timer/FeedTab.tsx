import { TimerReset } from "lucide-react";
import { Timer } from "./Timer";
import { GearMenu } from "../../components/widget-bar/GearMenu";
import { useShell } from "../../shell-context";
import TimerSettings from "./Settings";
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
      "Enable active timer ticker output from the gear menu.",
      "Adjust Pomodoro session lengths and long-break cadence from the gear menu.",
    ],
  },
  FeedTab: TimerFeedTab,
};

function TimerFeedTab(props: FeedTabProps) {
  return (
    <div className="relative flex min-h-full flex-col">
      {/* Comfort mode floats the gear top-right — the widget's settings
          surface once the Configure page dies. */}
      {props.mode === "comfort" && (
        <div className="absolute right-3 top-3 z-10">
          <TimerGear />
        </div>
      )}
      <TimerFeedBody {...props} />
    </div>
  );
}

function TimerGear() {
  const { prefs, onPrefsChange } = useShell();
  return (
    <GearMenu ariaLabel="Timer settings" panelClassName="right-0 w-80">
      <TimerSettings prefs={prefs} onPrefsChange={onPrefsChange} />
    </GearMenu>
  );
}

function TimerFeedBody({ mode }: FeedTabProps) {
  return (
    <div className="p-3">
      <Timer compact={mode === "compact"} />
    </div>
  );
}
