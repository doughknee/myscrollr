/**
 * Customize route — every surface-level presentation control in one
 * place (REL-44). Completes the REL-41 principle: content is
 * widget-level (each widget's bar), presentation is surface-level
 * (here). Two of the five sections behind the shared SectionNav:
 *
 *   App    — appearance, window, startup, shortcuts (the old /settings
 *            page). The default when no tab is given.
 *   Ticker — the row-layout manager (the old /ticker page)
 *
 * Updates moved out to its own route when the nav gained a fifth entry.
 * Account and Home are their own routes too, reachable from the same
 * nav. /settings and /ticker redirect here (tab preselected).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import { WidgetBar } from "../components/widget-bar/Bar";
import SectionNav from "../components/layout/SectionNav";
import TickerSettings from "../components/settings/TickerSettings";
import GeneralSettings from "../components/settings/GeneralSettings";
import { useShell } from "../shell-context";
import { resetCategory, type AppPreferences } from "../preferences";

type CustomizeTab = "ticker" | "app";

export const Route = createFileRoute("/customize")({
  component: CustomizeRoute,
  errorComponent: RouteError,
  validateSearch: (search: Record<string, unknown>): { tab?: CustomizeTab } =>
    search.tab === "app" || search.tab === "ticker"
      ? { tab: search.tab }
      : {},
});

function CustomizeRoute() {
  const shell = useShell();
  const { prefs, onPrefsChange } = shell;
  const { tab: searchTab } = Route.useSearch();
  // App, not Ticker, when nothing is specified: arriving here without a
  // tab means the sidebar's Customize row or the account menu's Settings
  // item, and both read as "the app's settings". Ticker is the narrower
  // of the two and is one click away.
  const [tab, setTab] = useState<CustomizeTab>(searchTab ?? "app");
  // Search-only navigations don't remount the component — without this,
  // Ctrl+, / the tray Settings item / the /settings shim are no-ops when
  // the user is already sitting on /customize.
  useEffect(() => {
    if (searchTab) setTab(searchTab);
  }, [searchTab]);

  return (
    <PageLayout title="Customize" width="wide" noTopPadding>
      {/* Same WCB chrome as every other page — the Segmented is the
          section switch. */}
      <WidgetBar>
        <SectionNav active={tab === "app" ? "app" : "ticker"} />
      </WidgetBar>

      <div className="pt-4">
        {tab === "ticker" ? (
          <TickerSettings prefs={prefs} onPrefsChange={onPrefsChange} />
        ) : (
          <GeneralSettings
            appearance={prefs.appearance}
            window_={prefs.window}
            startup={prefs.startup}
            onAppearanceChange={(appearance) =>
              onPrefsChange({ ...prefs, appearance })
            }
            onWindowChange={(window_) =>
              onPrefsChange({ ...prefs, window: window_ })
            }
            onStartupChange={(startup) => onPrefsChange({ ...prefs, startup })}
            onReset={() => {
              let next: AppPreferences = resetCategory(prefs, "appearance");
              next = resetCategory(next, "window");
              onPrefsChange(next);
            }}
            autostartEnabled={shell.autostartEnabled}
            onAutostartChange={shell.onAutostartChange}
          />
        )}
      </div>
    </PageLayout>
  );
}
