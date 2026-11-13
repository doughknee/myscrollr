import { lazy } from "react";
import { Clock } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * clock widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
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
  FeedTab: lazy(() => import("./FeedTab")),
};
