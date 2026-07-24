// ── Shared update-flow lock ─────────────────────────────────────
//
// The startup auto-check (`hooks/useStartupUpdateCheck.ts`) and the manual
// Settings flow (`components/settings/GeneralSettings.tsx`) both drive the
// same Tauri updater plugin, which is not safe to call concurrently — a
// `check()` fired mid-download, or two parallel downloads, can leave it
// installing against a still-running webview and crash the app on Windows.
//
// Module-level state is fine: only the main window holds the
// `updater:default` capability (see `src-tauri/capabilities/`), so there is
// no cross-window contention.

let updating = false;

/** Take the lock, or return false if another flow already holds it.
 *  On true the caller must call `releaseUpdateLock` when done. */
export function tryAcquireUpdateLock(): boolean {
  if (updating) return false;
  updating = true;
  return true;
}

/** Release the lock. Safe to call even if not held. */
export function releaseUpdateLock(): void {
  updating = false;
}

/** Read the lock without taking it. */
export function isUpdateInProgress(): boolean {
  return updating;
}
