/**
 * Customize route — every surface-level presentation control in one
 * place (REL-44). Completes the REL-41 principle: content is
 * widget-level (each widget's bar), presentation is surface-level
 * (here). Two sections behind the standard WCB Segmented:
 *
 *   Ticker — the row-layout manager (the old /ticker page)
 *   App    — appearance, window, startup, updates, about (the old
 *            /settings page)
 *
 * Account stays its own page: it's identity, not presentation.
 * /settings and /ticker redirect here (tab preselected).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import { WidgetBar } from "../components/widget-bar/Bar";
import {
  Segmented,
  type SegmentedOption,
} from "../components/widget-bar/Segmented";
import TickerSettings from "../components/settings/TickerSettings";
import GeneralSettings from "../components/settings/GeneralSettings";
import { useShell } from "../shell-context";
import { resetCategory, type AppPreferences } from "../preferences";

type CustomizeTab = "ticker" | "app";

const TAB_OPTIONS: SegmentedOption<CustomizeTab>[] = [
  { value: "ticker", label: "Ticker" },
  { value: "app", label: "App" },
];

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
  const { tab: initialTab } = Route.useSearch();
  const [tab, setTab] = useState<CustomizeTab>(initialTab ?? "ticker");

  return (
    <PageLayout title="Customize" width="wide" stableChrome>
      {/* Same WCB chrome as every other page — the Segmented is the
          section switch. */}
      <WidgetBar>
        <Segmented
          ariaLabel="Customize section"
          value={tab}
          onChange={setTab}
          options={TAB_OPTIONS}
        />
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
            appVersion={shell.appVersion}
          />
        )}
      </div>
    </PageLayout>
  );
}
