/**
 * Start-with-the-computer default for NEW installs (SCROLLR-263).
 *
 * `initStore` leaves `FRESH_INSTALL_KEY` behind when it finds a brand-new
 * store (no migration marker, nothing to migrate). This consumes it once:
 * enable the OS autostart entry, then show one notice. An existing install
 * has no marker, so an upgrade never touches its setting, and the marker is
 * cleared BEFORE `enable()` so a user who later turns it off is never
 * re-enabled, whatever happens to the call.
 *
 * Runs from the main window only (one per process; App.tsx runs once per
 * ticker window and must not call this).
 */
import { enable } from "@tauri-apps/plugin-autostart";
import { FRESH_INSTALL_KEY, readStoreShared, removeStorePersisted } from "./store";
import { showTipOnce, TIP_IDS } from "./tips";
import type { AppPreferences } from "../preferences";

export async function applyAutostartDefault(
  prefs: AppPreferences,
  onPrefsChange: (next: AppPreferences) => void,
  openStartupSettings: () => void,
): Promise<boolean> {
  // Shared read: the marker may have been written by a ticker window's init.
  if (!(await readStoreShared<boolean>(FRESH_INSTALL_KEY))) return false;
  await removeStorePersisted(FRESH_INSTALL_KEY);
  try {
    await enable();
  } catch (err) {
    // e.g. Linux without a writable autostart dir: no entry, so no notice.
    console.error("[Scrollr] Default autostart failed:", err);
    return false;
  }
  showTipOnce(TIP_IDS.AUTOSTART_DEFAULT, prefs, onPrefsChange, {
    title: "Scrollr will start with your computer",
    description: "Change it in Settings › Startup.",
    duration: 10_000,
    actionLabel: "Open Startup settings",
    onAction: openStartupSettings,
  });
  return true;
}
