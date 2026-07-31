/**
 * Window & startup.
 *
 * "Check for updates on startup" lives here rather than on Updates:
 * it is a startup behavior, and grouping it with autostart puts the two
 * "what happens when Scrollr launches" switches together. The Updates
 * page points at this row instead of duplicating it.
 */
import type { StartupPrefs, WindowPrefs } from "../../../preferences";
import { RowList, SettingsGroup, ToggleRow } from "../SettingsControls";
import { Row } from "./Row";

interface WindowStartupPageProps {
  window_: WindowPrefs;
  onWindowChange: (prefs: WindowPrefs) => void;
  startup: StartupPrefs;
  onStartupChange: (prefs: StartupPrefs) => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
}

export default function WindowStartupPage({
  window_,
  onWindowChange,
  startup,
  onStartupChange,
  autostartEnabled,
  onAutostartChange,
}: WindowStartupPageProps) {
  return (
    <>
      <SettingsGroup label="Window">
        <RowList>
          <Row id="alwaysOnTop">
            <ToggleRow
              label="Always on top"
              description="Keep the ticker above all other windows"
              checked={window_.pinned}
              onChange={(v) => onWindowChange({ ...window_, pinned: v })}
            />
          </Row>
          <Row id="hideFullscreen">
            <ToggleRow
              label="Hide when an app goes fullscreen"
              badge="Windows"
              description="Hides the ticker when YouTube, games, or other apps enter fullscreen so they aren't visually clipped."
              checked={window_.hideOnFullscreen}
              onChange={(v) =>
                onWindowChange({ ...window_, hideOnFullscreen: v })
              }
            />
          </Row>
        </RowList>
      </SettingsGroup>

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
    </>
  );
}
