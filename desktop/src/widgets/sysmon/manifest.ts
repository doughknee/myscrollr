import { lazy } from "react";
import { Activity } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * sysmon widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
export const sysmonWidget: WidgetManifest = {
  id: "sysmon",
  name: "System Monitor",
  tabLabel: "System",
  description: "Live CPU, memory, and GPU stats",
  hex: "#06b6d4",
  icon: Activity,
  info: {
    about:
      "The System Monitor widget shows live stats for your computer on the ticker, including CPU usage, memory, and GPU.",
    usage: [
      "CPU, memory, and GPU usage appear on the ticker.",
      "Turn individual stats on or off from the Stats menu in the top bar.",
      "The feed view shows detailed real-time stats including temperatures and a full breakdown.",
      "Pin it to a ticker row from Home to keep it in a fixed spot.",
    ],
  },
  desktopOnly: true,
  FeedTab: lazy(() => import("./FeedTab")),
};
