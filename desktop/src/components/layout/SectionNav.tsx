/**
 * SectionNav — the switch between Home and Settings.
 *
 * It used to carry five entries (Home | App | Ticker | Account |
 * Updates) because settings were spread across three routes and two
 * tabs. The settings rail owns intra-settings navigation now, so this is
 * back to what it actually is: a two-way switch between the dashboard
 * and the settings surface.
 *
 * Kept rather than deleted because Home still needs a way across, and
 * because it is the WidgetBar's occupant on that page.
 */
import { useNavigate } from "@tanstack/react-router";
import { Segmented, type SegmentedOption } from "../widget-bar/Segmented";
import { DEFAULT_SETTINGS_PAGE } from "../settings/pages";

export type SectionKey = "home" | "settings";

const OPTIONS: SegmentedOption<SectionKey>[] = [
  { value: "home", label: "Home" },
  { value: "settings", label: "Settings" },
];

export default function SectionNav({ active }: { active: SectionKey }) {
  const navigate = useNavigate();

  return (
    <Segmented
      ariaLabel="App section"
      value={active}
      options={OPTIONS}
      // Constant id so the indicator slides between the two surfaces
      // instead of vanishing and reappearing when the route remounts.
      layoutGroupId="section-nav"
      onChange={(next) => {
        if (next === active) return;
        if (next === "home") {
          void navigate({ to: "/feed" });
        } else {
          void navigate({
            to: "/customize",
            search: { page: DEFAULT_SETTINGS_PAGE },
          });
        }
      }}
    />
  );
}
