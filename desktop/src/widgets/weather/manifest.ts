import { lazy } from "react";
import { CloudSun } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * weather widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
export const weatherWidget: WidgetManifest = {
  id: "weather",
  name: "Weather",
  tabLabel: "Weather",
  description: "Current conditions for your locations",
  hex: "#0ea5e9",
  icon: CloudSun,
  info: {
    about:
      "The Weather widget shows current weather conditions for one or more " +
      "locations on your ticker. Weather data updates automatically.",
    usage: [
      "Search for a city in the feed view to add it to your weather locations.",
      "Each location appears on the ticker with temperature, conditions, and an icon.",
      "Add multiple cities to track weather across different locations.",
      "Switch between °F and °C under Settings → Appearance → Units & formats.",
    ],
  },
  FeedTab: lazy(() => import("./FeedTab")),
};
