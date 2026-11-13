import { lazy } from "react";
import { HeartPulse } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * uptime widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
export const uptimeWidget: WidgetManifest = {
  id: "uptime",
  name: "Uptime",
  tabLabel: "Uptime",
  description: "Monitor status from Uptime Kuma",
  hex: "#10b981",
  icon: HeartPulse,
  info: {
    about:
      "The Uptime widget connects to your Uptime Kuma status page and " +
      "shows real-time monitor statuses on your ticker.",
    usage: [
      "Paste your Uptime Kuma public status page URL to connect.",
      "All monitors from your status page appear with their current status.",
    ],
  },
  FeedTab: lazy(() => import("./FeedTab")),
};
