/**
 * SectionNav — the shared switcher across the app's top-level surfaces.
 *
 * Home, App, Ticker, Account and Updates each render this at the top of
 * their page, so moving between them is one click from wherever you are
 * rather than a trip back through the sidebar. App and Ticker are the
 * two halves of /customize; the rest are their own routes.
 *
 * This deliberately overlaps the sidebar. The sidebar is for getting
 * *into* a surface from anywhere in the app; this is for moving
 * *between* related surfaces once you're in one, which is the pattern
 * you're in when you open settings to change one thing and remember a
 * second.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  Segmented,
  type SegmentedOption,
} from "../widget-bar/Segmented";

/** Which entry is current. Pages pass their own. */
export type SectionKey = "home" | "app" | "ticker" | "account" | "updates";

// Order is deliberate: the surface you spend time in first, then the two
// customisation halves, then the two account-shaped ones.
const OPTIONS: SegmentedOption<SectionKey>[] = [
  { value: "home", label: "Home" },
  { value: "app", label: "App" },
  { value: "ticker", label: "Ticker" },
  { value: "account", label: "Account" },
  { value: "updates", label: "Updates" },
];

export default function SectionNav({ active }: { active: SectionKey }) {
  const navigate = useNavigate();

  return (
    <Segmented
      ariaLabel="App section"
      value={active}
      options={OPTIONS}
      // Constant, not the default per-instance id: each of the five
      // routes renders its own SectionNav, so the control unmounts and
      // remounts on every switch. A shared group id lets motion treat
      // the two as the same element and slide the indicator across,
      // instead of it vanishing and reappearing in the new position.
      layoutGroupId="section-nav"
      onChange={(next) => {
        if (next === active) return;
        switch (next) {
          case "home":
            void navigate({ to: "/feed" });
            break;
          // App and Ticker are one route with a tab in the search params,
          // so these are search-only navigations — /customize reads the
          // param and swaps section without remounting.
          case "app":
            void navigate({ to: "/customize", search: { tab: "app" } });
            break;
          case "ticker":
            void navigate({ to: "/customize", search: { tab: "ticker" } });
            break;
          case "account":
            void navigate({ to: "/account" });
            break;
          case "updates":
            void navigate({ to: "/updates" });
            break;
        }
      }}
    />
  );
}
