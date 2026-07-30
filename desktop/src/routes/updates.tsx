/**
 * Updates route — the updater and version info, split out of the App
 * settings tab so it has its own entry in the section nav.
 *
 * It sat under Customize → App alongside themes and window behaviour,
 * which buried the one control people go looking for deliberately:
 * "am I on the latest version?". About rides along because the version
 * string is the first thing anyone reads out when reporting a bug.
 */
import { createFileRoute } from "@tanstack/react-router";
import RouteError from "../components/RouteError";
import PageLayout from "../components/layout/PageLayout";
import SectionNav from "../components/layout/SectionNav";
import { WidgetBar } from "../components/widget-bar/Bar";
import UpdatesSettings from "../components/settings/UpdatesSettings";
import { useShell } from "../shell-context";

export const Route = createFileRoute("/updates")({
  component: UpdatesRoute,
  errorComponent: RouteError,
});

function UpdatesRoute() {
  const shell = useShell();
  const { prefs, onPrefsChange } = shell;

  return (
    <PageLayout title="Updates" width="wide" noTopPadding>
      <WidgetBar>
        <SectionNav active="updates" />
      </WidgetBar>

      <div className="pt-4">
        <UpdatesSettings
          startup={prefs.startup}
          onStartupChange={(startup) => onPrefsChange({ ...prefs, startup })}
          appVersion={shell.appVersion}
        />
      </div>
    </PageLayout>
  );
}
