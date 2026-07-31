// ── Startup update check ────────────────────────────────────────
//
// Runs a single update check shortly after the main window mounts.
// On a real update it surfaces a sonner toast with a "Download &
// install" action. On up-to-date or error it stays silent — the
// manual button in Customize → Updates is the recovery path.
//
// We delay 4s so:
//   1) Tauri webview, splash, and React hydration finish first.
//   2) If we're going to toast, it lands after the first paint, not
//      on top of it.
//   3) Brief flaky-network races on launch get a chance to settle.
//
// Same-version detection was removed in v1.0.16. The Rust comparator
// is back to its default (`remote.version > current_version`), so
// `check()` only ever resolves to an `Update` when the server
// genuinely advertises a newer version. There is no longer any
// pub_date suppression machinery on the JS side — see lib.rs comment
// near the updater plugin init for the rationale.

import { useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { tryAcquireUpdateLock, releaseUpdateLock } from "../lib/updateState";

const STARTUP_DELAY_MS = 4_000;
const TOAST_ID = "scrollr-startup-update";

interface Options {
  /** When false (user disabled it in Settings), the hook does nothing. */
  enabled: boolean;
  /** Current installed version, shown in the toast description. */
  appVersion: string;
}

export function useStartupUpdateCheck({ enabled, appVersion }: Options) {
  // Latch so the check runs at most once per mount, even if React strict
  // mode double-invokes effects or props change after the first run.
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (!appVersion) return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;

        showUpdateToast(update, appVersion);
      } catch (err) {
        // Startup check failures are silent. The user can always retry
        // via Customize → Updates. We still log so devs can
        // see what's going wrong during local development.
        console.warn("[Scrollr] Startup update check failed:", err);
      }
    }, STARTUP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, appVersion]);
}

// ── Toast flow ──────────────────────────────────────────────────
//
// Three states the toast walks through:
//   1) Prompt — "Update available, [Update] [Not now]"
//   2) Downloading — replaces the prompt with a progress message
//   3) Done — "Restart to apply, [Restart now]"
//
// We use a single toast id (`TOAST_ID`) so sonner replaces the toast
// in place rather than stacking new ones.

function showUpdateToast(update: Update, _appVersion: string) {
  toast.info("Update available", {
    id: TOAST_ID,
    description: `Version ${update.version} is ready to download.`,
    duration: Infinity,
    action: {
      label: "Update",
      onClick: () => {
        // Fire-and-forget. downloadAndInstall is async but sonner's
        // action handler is sync — we just kick it off and let the
        // toast updates drive UX from here.
        void runDownloadAndInstall(update);
      },
    },
    cancel: {
      label: "Not now",
      onClick: () => toast.dismiss(TOAST_ID),
    },
  });
}

async function runDownloadAndInstall(update: Update) {
  // Refuse to start if Settings is already running an update. Keeps
  // the user from racing two downloads against the same plugin.
  if (!tryAcquireUpdateLock()) {
    toast.error("Update already in progress", {
      id: TOAST_ID,
      description: "Another update is running. Try again once it finishes.",
      duration: 6_000,
    });
    return;
  }

  toast.loading("Downloading update…", {
    id: TOAST_ID,
    description: "Starting download…",
    duration: Infinity,
  });

  let downloaded = 0;
  let total = 0;

  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        total = event.data.contentLength;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength ?? 0;
        toast.loading("Downloading update…", {
          id: TOAST_ID,
          description: formatProgress(downloaded, total),
          duration: Infinity,
        });
      }
    });

    toast.success("Update installed", {
      id: TOAST_ID,
      description: "Restart to apply.",
      duration: Infinity,
      action: {
        label: "Restart now",
        onClick: () => {
          void relaunch();
        },
      },
      cancel: {
        label: "Later",
        onClick: () => toast.dismiss(TOAST_ID),
      },
    });
  } catch (err) {
    toast.error("Couldn't install update", {
      id: TOAST_ID,
      description: err instanceof Error ? err.message : String(err),
      duration: 8_000,
    });
  } finally {
    releaseUpdateLock();
  }
}

function formatProgress(downloaded: number, total: number): string {
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  if (total > 0) {
    return `${mb(downloaded)} / ${mb(total)} MB`;
  }
  return `${mb(downloaded)} MB downloaded`;
}
