/**
 * UpdatesSettings — the Updates section of the settings hub.
 *
 * Split out of GeneralSettings when the hub gained its own nav strip
 * (Home | App | Ticker | Account | Updates): the updater is the one
 * thing in there a user comes looking for deliberately, rather than
 * something they stumble across while changing a theme. "About" rides
 * along because the version number is the first thing anyone checks
 * before reporting a bug.
 *
 * The update state machine lives here rather than in the shell because
 * it is scoped to this view — nothing else reads it, and it must reset
 * when the user navigates away mid-check.
 */
import { useState, useCallback, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  tryAcquireUpdateLock,
  releaseUpdateLock,
  isUpdateInProgress,
} from "../../lib/updateState";
import clsx from "clsx";
import type { StartupPrefs } from "../../preferences";
import { Section, ToggleRow } from "./SettingsControls";
import ReleaseNotes from "./ReleaseNotes";

// ── Update state machine ────────────────────────────────────────

type UpdateStatus =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "up-to-date" }
  | { step: "available"; version: string; body: string }
  | { step: "downloading"; downloaded: number; total: number }
  | { step: "ready" }
  | { step: "error"; message: string };

// ── Props ───────────────────────────────────────────────────────

interface UpdatesSettingsProps {
  startup: StartupPrefs;
  onStartupChange: (next: StartupPrefs) => void;
  /** App version string, e.g. "1.1.15". Undefined until the shell resolves it. */
  appVersion?: string;
}

// ── Component ───────────────────────────────────────────────────

export default function UpdatesSettings({
  startup,
  onStartupChange,
  appVersion,
}: UpdatesSettingsProps) {
  const [status, setStatus] = useState<UpdateStatus>({ step: "idle" });
  const pendingUpdate = useRef<Update | null>(null);

  const handleCheckForUpdates = useCallback(async () => {
    if (isUpdateInProgress()) {
      setStatus({
        step: "error",
        message: "Another update is already in progress.",
      });
      return;
    }

    setStatus({ step: "checking" });
    try {
      const update = await check();
      if (!update) {
        pendingUpdate.current = null;
        setStatus({ step: "up-to-date" });
        return;
      }

      pendingUpdate.current = update;
      setStatus({
        step: "available",
        version: update.version,
        body: update.body ?? "",
      });
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) {
      setStatus({ step: "error", message: "No update available. Try checking again." });
      return;
    }

    // Refuse to start if the startup auto-check is already downloading.
    // Two concurrent downloads against the same plugin can put it in a
    // state where the install spawn crashes the app on Windows.
    if (!tryAcquireUpdateLock()) {
      setStatus({
        step: "error",
        message: "Another update is already in progress.",
      });
      return;
    }

    setStatus({ step: "downloading", downloaded: 0, total: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          setStatus((prev) =>
            prev.step === "downloading"
              ? { ...prev, total: event.data.contentLength ?? 0 }
              : prev,
          );
        } else if (event.event === "Progress") {
          setStatus((prev) =>
            prev.step === "downloading"
              ? { ...prev, downloaded: prev.downloaded + (event.data.chunkLength ?? 0) }
              : prev,
          );
        }
      });

      setStatus({ step: "ready" });
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      releaseUpdateLock();
    }
  }, []);

  const handleRelaunch = useCallback(async () => {
    try {
      await relaunch();
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return (
    <div className="space-y-4">
      <Section title="Updates" variant="card">
        <ToggleRow
          label="Check for updates on startup"
          description="Notify me when a new version is available shortly after launch"
          checked={startup.autoCheckUpdates}
          onChange={(v) => onStartupChange({ ...startup, autoCheckUpdates: v })}
        />
        <UpdateRow
          status={status}
          onCheck={handleCheckForUpdates}
          onDownload={handleDownloadAndInstall}
          onRelaunch={handleRelaunch}
        />
      </Section>

      {/* No Section wrapper: the release table brings its own bordered
          chrome, and nesting it in a card boxed a box. */}
      <ReleaseNotes />

      {/* Version as a footnote rather than a card. It's reference
          information you read once \u2014 usually to quote it in a bug
          report \u2014 not something you act on, so it doesn't earn the
          same weight as the updater above it. */}
      <p className="px-1 pt-1 text-ui-meta text-fg-4">
        Version {appVersion ? `v${appVersion}` : "\u2014"}
      </p>
    </div>
  );
}

// ── Update row component ────────────────────────────────────────

interface UpdateRowProps {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRelaunch: () => void;
}

function UpdateRow({ status, onCheck, onDownload, onRelaunch }: UpdateRowProps) {
  switch (status.step) {
    case "idle":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <span className="text-ui-meta">Check for new versions</span>
          <button
            onClick={onCheck}
            className="text-ui-chip font-medium px-2.5 py-1 rounded-md bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300 cursor-pointer"
          >
            Check for updates
          </button>
        </div>
      );

    case "checking":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <span className="text-ui-meta">Checking for updates...</span>
          <div className="w-4 h-4 border-2 border-fg-4 border-t-accent rounded-full " />
        </div>
      );

    case "up-to-date":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-meta text-accent leading-tight">
              You're on the latest version
            </span>
          </div>
          <button
            onClick={onCheck}
            className="text-ui-chip font-medium px-2.5 py-1 rounded-md text-fg-3 hover:text-fg-2 hover:bg-base-250/50 cursor-pointer"
          >
            Check again
          </button>
        </div>
      );

    case "available":
      return (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-ui-muted leading-tight">
                Update available: <span className="text-accent font-semibold">v{status.version}</span>
              </span>
            </div>
            <button
              onClick={onDownload}
              className="text-ui-chip font-semibold px-2.5 py-1 rounded-md bg-accent text-surface hover:bg-accent/90 cursor-pointer shrink-0 ml-4"
            >
              Download & install
            </button>
          </div>
          {status.body && (
            <div className="max-h-32 overflow-y-auto scrollbar-thin rounded-md bg-base-200/50 px-2.5 py-2">
              <p className="text-ui-meta leading-relaxed whitespace-pre-wrap">
                {status.body}
              </p>
            </div>
          )}
        </div>
      );

    case "downloading": {
      const pct = status.total > 0
        ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
        : 0;
      return (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-ui-meta leading-tight">
              Downloading update...
            </span>
            <span className="text-ui-chip tabular-nums">
              {status.total > 0 ? `${pct}%` : "..."}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Download progress"
            className="w-full h-1 rounded-full bg-base-300 overflow-hidden"
          >
            <div
              className={clsx(
                "h-full rounded-full ",
                status.total > 0 ? "bg-accent" : "bg-accent/50 ",
              )}
              style={{ width: status.total > 0 ? `${pct}%` : "30%" }}
            />
          </div>
        </div>
      );
    }

    case "ready":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-meta text-accent leading-tight">
              Update installed
            </span>
            <span className="text-ui-meta leading-tight">
              Restart to apply the update
            </span>
          </div>
          <button
            onClick={onRelaunch}
            className="text-ui-chip font-semibold px-2.5 py-1 rounded-md bg-accent text-surface hover:bg-accent/90 cursor-pointer"
          >
            Restart now
          </button>
        </div>
      );

    case "error":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-meta text-error leading-tight">
              Couldn't check for updates
            </span>
            <span className="text-ui-meta leading-tight line-clamp-1">
              {status.message}
            </span>
          </div>
          <button
            onClick={onCheck}
            className="text-ui-chip font-medium px-2.5 py-1 rounded-md text-fg-3 hover:text-fg-2 hover:bg-base-250/50 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
  }
}
