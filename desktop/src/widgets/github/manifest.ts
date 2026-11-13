import { lazy } from "react";
import { Github } from "lucide-react";
import type { WidgetManifest } from "../../types";

/**
 * github widget manifest. Kept apart from its feed screen so the ticker window,
 * which needs only the name, colour, icon and copy, does not load the screen
 * (SCROLLR-408): `FeedTab` is fetched when the widget's page opens.
 */
export const HEX = "#f97316";

export const githubWidget: WidgetManifest = {
  id: "github",
  name: "GitHub",
  tabLabel: "GitHub",
  description: "CI and pull requests that need you, from your GitHub",
  hex: HEX,
  icon: Github,
  info: {
    about:
      "The GitHub widget puts each repo you track on the bar as one cell, " +
      "showing what you chose for it: workflows, pull requests, issues.",
    usage: [
      "Connect GitHub, then add repos with + Add a repo; the two you pushed to last start on the bar.",
      "Pick a repo to choose its workflows, its pull requests (off, the ones that need you, all open) and its issues.",
      "GitHub gets its own page on the bar: a cell per repo, and spare columns fill with what needs you next, then what just shipped.",
      "Quiet hours and the flash are in the ⋯ menu.",
    ],
  },
  FeedTab: lazy(() => import("./FeedTab")),
};
