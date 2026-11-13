import { lazy } from "react";
import { TimerReset } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * timer widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
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
      "A running timer automatically appears on the ticker.",
      "Adjust Pomodoro session lengths and long-break cadence from the top bar.",
    ],
  },
  FeedTab: lazy(() => import("./FeedTab")),
};
