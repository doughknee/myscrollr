// ── Startup update check ────────────────────────────────────────
//
// Runs a single update check shortly after the main window mounts.
// On a real update it surfaces a sonner toast with a "Download &
// install" action. On up-to-date or error it stays silent — the
// manual button in Settings → General is the recovery path.
//
// The same-version pub_date suppression logic mirrors the manual
// check in `components/settings/GeneralSettings.tsx`. Keep them in
// sync if you change either one.
//
// We delay 4s so:
//   1) Tauri webview, splash, and React hydration finish first.
//   2) If we're going to toast, it lands after the first paint, not
//      on top of it.
//   3) Brief flaky-network races on launch get a chance to settle.

import { useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { getStore, removeStore, setStore } from "../lib/store";
import { normalizeUpdateDate } from "../lib/updaterDate";

const STARTUP_DELAY_MS = 4_000;
const TOAST_ID = "scrollr-startup-update";

// Storage keys — MUST match GeneralSettings.tsx exactly. Both files
// participate in the same pub_date reconciliation, so the keys are a
// shared contract.
const KEY_LAST_UPDATE_DATE = "scrollr:lastUpdateDate";
const KEY_PENDING_UPDATE = "scrollr:pendingUpdate";

interface PendingUpdate {
  version: string;
  date: string;
}

interface Options {
  /** When false (user disabled it in Settings), the hook does nothing. */
  enabled: boolean;
  /** Current installed version, used to suppress same-version false positives. */
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
        // Reconcile pending → lastUpdateDate. When the user installs
        // via the startup toast, we record KEY_PENDING_UPDATE before
        // the relaunch. On the next launch (now), if the running
        // version matches what's pending, promote that pub_date to
        // KEY_LAST_UPDATE_DATE so subsequent checks know we're up to
        // date for this pub_date. If versions don't match, drop the
        // pending record so it doesn't poison future reconciles.
        //
        // This used to only run inside GeneralSettings.tsx — but
        // users who never opened Settings after an update never got
        // the promotion, which made the "update available" toast
        // fire on EVERY launch indefinitely.
        const pending = getStore<PendingUpdate | null>(KEY_PENDING_UPDATE, null);
        if (pending) {
          if (pending.version === appVersion) {
            // Normalize on promote so a pending row written by an
            // older build (pre-normalization) still lands in the
            // store in canonical form. Falls back to raw if somehow
            // unparseable so we don't lose the seed entirely.
            const promoted = normalizeUpdateDate(pending.date) ?? pending.date;
            setStore(KEY_LAST_UPDATE_DATE, promoted);
          }
          removeStore(KEY_PENDING_UPDATE);
        }

        const update = await check();
        if (cancelled || !update) return;

        // Same-version patch suppression. If the remote version matches
        // what's installed AND the pub_date matches what we last recorded
        // (or there's no record yet, in which case we seed it), treat as
        // up-to-date. Otherwise fall through to the toast — a genuine
        // same-version rebuild has shipped.
        //
        // Dates are normalized through `normalizeUpdateDate` before
        // compare/store. The server emits `...Z` but the Rust updater
        // plugin reformats to `...+00:00` — without normalization the
        // string compare ALWAYS fails and the toast fires every launch.
        // See `lib/updaterDate.ts` for the full backstory.
        if (update.version === appVersion) {
          const normalizedRemote = normalizeUpdateDate(update.date);
          // No usable pub_date from the server: we have nothing to
          // compare against, and seeding `null` would re-toast forever.
          // Trust the same-version response as up-to-date.
          if (normalizedRemote === null) return;

          const storedDate = getStore<string | null>(KEY_LAST_UPDATE_DATE, null);
          if (storedDate === null) {
            // First in-app check on a build the in-app updater never
            // installed (e.g. manual download, or pre-reconcile build).
            // Trust the remote pub_date and seed in normalized form.
            setStore(KEY_LAST_UPDATE_DATE, normalizedRemote);
            return;
          }
          // Compare normalized forms directly. `normalizedRemote` is
          // already canonical; only the stored value needs a
          // round-trip in case it was seeded by an older build that
          // wrote the raw plugin format.
          const normalizedStored = normalizeUpdateDate(storedDate);
          if (normalizedStored === normalizedRemote) {
            // Heal a stored value that wasn't normalized by a prior
            // build. Rewriting it here means the next launch's strict
            // compare would also pass, even without the helper.
            if (storedDate !== normalizedRemote) {
              setStore(KEY_LAST_UPDATE_DATE, normalizedRemote);
            }
            return;
          }
          // Stored date differs from remote: a genuine same-version
          // patched rebuild has shipped. Fall through to the toast.
        }

        showUpdateToast(update, appVersion);
      } catch (err) {
        // Startup check failures are silent. The user can always retry
        // via Settings → General → Updates. We still log so devs can
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

function showUpdateToast(update: Update, appVersion: string) {
  const isPatch = update.version === appVersion;
  const description = isPatch
    ? "A patched build of your current version is ready."
    : `Version ${update.version} is ready to download.`;

  toast.info("Update available", {
    id: TOAST_ID,
    description,
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
  toast.loading("Downloading update…", {
    id: TOAST_ID,
    description: "This may take a minute.",
    duration: Infinity,
  });

  try {
    await update.downloadAndInstall();

    // Record pending state so the next launch can reconcile pub_date.
    // See KEY_PENDING_UPDATE docs in GeneralSettings.tsx for why this
    // is "pending" rather than "last".
    //
    // Date is normalized so the next-launch reconcile writes a clean
    // value into KEY_LAST_UPDATE_DATE — see lib/updaterDate.ts.
    const normalizedDate = normalizeUpdateDate(update.date);
    if (update.version && normalizedDate) {
      const pending: PendingUpdate = {
        version: update.version,
        date: normalizedDate,
      };
      setStore(KEY_PENDING_UPDATE, pending);
    }

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
  }
}
