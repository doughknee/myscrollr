/**
 * Startup — the computer's side of things: what happens when it
 * starts and when Scrollr launches.
 *
 * Everything about the bar itself (stay above other windows, hide on
 * fullscreen, monitors) lives on the Ticker page since REL-204. The
 * old "Check for updates on startup" switch is gone (REL-206): the
 * check always runs, Updates has a manual one for the impatient.
 *
 * "Launch at login" is owned by the Tauri autostart plugin, not prefs;
 * "Reset all settings" turns it off explicitly (SettingsSurface).
 */
import type { StartupPrefs } from "../../../preferences";
import { RowList, SettingsGroup, ToggleRow } from "../SettingsControls";
import { Row } from "./Row";

interface StartupPageProps {
  startup: StartupPrefs;
  onStartupChange: (prefs: StartupPrefs) => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
}

export default function StartupPage({
  startup,
  onStartupChange,
  autostartEnabled,
  onAutostartChange,
}: StartupPageProps) {
  return (
    <SettingsGroup label="Startup">
      <RowList>
        <Row id="autostart">
          <ToggleRow
            label="Launch at login"
            description="Open Scrollr when you sign in to your computer"
            checked={autostartEnabled}
            onChange={onAutostartChange}
          />
        </Row>
        <Row id="startInBackground">
          <ToggleRow
            label="Start in the background"
            description="Show only the ticker. Open the Scrollr window from the tray when you want it."
            checked={startup.startInBackground}
            onChange={(v) =>
              onStartupChange({ ...startup, startInBackground: v })
            }
          />
        </Row>
      </RowList>
    </SettingsGroup>
  );
}
