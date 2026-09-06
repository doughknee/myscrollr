/**
 * Window & startup — what happens when Scrollr launches.
 *
 * Everything about the bar itself (stay above other windows, hide on
 * fullscreen, monitors) moved to the Ticker page with REL-204; this
 * page is the computer's side of things. "Check for updates on startup"
 * lives here rather than on Updates because it is a startup behavior.
 */
import type { StartupPrefs } from "../../../preferences";
import { RowList, SettingsGroup, ToggleRow } from "../SettingsControls";
import { Row } from "./Row";

interface WindowStartupPageProps {
  startup: StartupPrefs;
  onStartupChange: (prefs: StartupPrefs) => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
}

export default function WindowStartupPage({
  startup,
  onStartupChange,
  autostartEnabled,
  onAutostartChange,
}: WindowStartupPageProps) {
  return (
    <SettingsGroup label="Startup">
      <RowList>
        <Row id="autostart">
          <ToggleRow
            label="Launch on system startup"
            description="Automatically open Scrollr when you start your computer"
            checked={autostartEnabled}
            onChange={onAutostartChange}
          />
        </Row>
        <Row id="autoCheck">
          <ToggleRow
            label="Check for updates on startup"
            description="Notify me when a new version is available shortly after launch"
            checked={startup.autoCheckUpdates}
            onChange={(v) =>
              onStartupChange({ ...startup, autoCheckUpdates: v })
            }
          />
        </Row>
      </RowList>
    </SettingsGroup>
  );
}
