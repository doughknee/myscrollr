/**
 * Updates.
 *
 * The update state machine and the module-level download lock are
 * unchanged from UpdatesSettings. The lock stays module-level on
 * purpose: the startup auto-check and this manual flow must never
 * download at once — on Windows that re-runs the installer for an
 * already-installed version and crashes the app.
 *
 * State is component-local, so leaving the page resets it. That still
 * holds under the unified surface because only the active page is
 * mounted; switching rail entries unmounts this one.
 *
 * The auto-check toggle moved to Window & startup — the subtitle of the
 * check row points there rather than duplicating the control.
 */
import { useCallback, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { clsx } from "clsx";
import {
  isUpdateInProgress,
  releaseUpdateLock,
  tryAcquireUpdateLock,
} from "../../../lib/updateState";
import { RowList, SettingsButton, SettingsGroup } from "../SettingsControls";
import ReleaseNotes from "../ReleaseNotes";
import PageHeader from "./PageHeader";
import { Row } from "./Row";

type UpdateStatus =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "up-to-date" }
  | { step: "available"; version: string; body: string }
  | { step: "downloading"; downloaded: number; total: number }
  | { step: "ready" }
  | { step: "error"; message: string };

interface UpdatesPageProps {
  appVersion?: string;
}

export default function UpdatesPage({ appVersion }: UpdatesPageProps) {
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
      setStatus({
        step: "error",
        message: "No update available. Try checking again.",
      });
      return;
    }
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
              ? {
                  ...prev,
                  downloaded: prev.downloaded + (event.data.chunkLength ?? 0),
                }
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

  const version = appVersion ? `v${appVersion}` : "—";

  return (
    <>
      <PageHeader
        title="Updates"
        subtitle={<UpdateSubtitle status={status} version={version} />}
      />

      <SettingsGroup>
        <RowList>
          <Row id="checkNow">
            <UpdateRow
              status={status}
              onCheck={handleCheckForUpdates}
              onDownload={handleDownloadAndInstall}
              onRelaunch={handleRelaunch}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      {/* ReleaseNotes owns its own heading so the sort menu can sit
          beside it. */}
      <div data-row="releaseHistory" className="mt-5">
        <ReleaseNotes />
      </div>
    </>
  );
}

// ── Subtitle ────────────────────────────────────────────────────

function UpdateSubtitle({
  status,
  version,
}: {
  status: UpdateStatus;
  version: string;
}) {
  const mono = <span className="font-mono text-accent">{version}</span>;

  switch (status.step) {
    case "available":
      return (
        <>
          You're on {mono} —{" "}
          <span className="text-accent">v{status.version} is available.</span>
        </>
      );
    case "downloading":
      return <>Downloading the update…</>;
    case "ready":
      return <>Update installed — restart to apply it.</>;
    case "checking":
      return <>Checking for updates…</>;
    case "up-to-date":
    case "idle":
    case "error":
    default:
      return <>You're on {mono} — the latest version.</>;
  }
}

// ── Update row ──────────────────────────────────────────────────

function UpdateRow({
  status,
  onCheck,
  onDownload,
  onRelaunch,
}: {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRelaunch: () => void;
}) {
  const row = "flex items-center justify-between gap-4 px-4 py-3";

  switch (status.step) {
    case "idle":
      return (
        <div className={row}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui-body font-medium text-fg">
              Check for new versions
            </span>
            <span className="text-ui-meta text-fg-4">
              Startup auto-check lives under Window &amp; startup.
            </span>
          </div>
          <SettingsButton onClick={onCheck}>Check for updates</SettingsButton>
        </div>
      );

    case "checking":
      return (
        <div className={row}>
          <span className="text-ui-body font-medium text-fg">
            Checking for updates…
          </span>
          <div className="size-4 rounded-full border-2 border-fg-4 border-t-accent" />
        </div>
      );

    case "up-to-date":
      return (
        <div className={row}>
          <span className="text-ui-body font-medium text-accent">
            You're on the latest version
          </span>
          <SettingsButton onClick={onCheck}>Check again</SettingsButton>
        </div>
      );

    case "available":
      return (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ui-body font-medium text-fg">
              Update available:{" "}
              <span className="font-semibold text-accent">
                v{status.version}
              </span>
            </span>
            <SettingsButton tone="accent" onClick={onDownload}>
              Download &amp; install
            </SettingsButton>
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
      const pct =
        status.total > 0
          ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
          : 0;
      return (
        <div className="flex flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-ui-body font-medium text-fg">
              Downloading update…
            </span>
            <span className="font-mono text-ui-chip tabular-nums">
              {status.total > 0 ? `${pct}%` : "…"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Download progress"
            className="h-1 w-full overflow-hidden rounded-full bg-base-300"
          >
            <div
              className={clsx(
                "h-full rounded-full",
                status.total > 0 ? "bg-accent" : "bg-accent/50",
              )}
              style={{ width: status.total > 0 ? `${pct}%` : "30%" }}
            />
          </div>
        </div>
      );
    }

    case "ready":
      return (
        <div className={row}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui-body font-medium text-accent">
              Update installed
            </span>
            <span className="text-ui-meta text-fg-4">
              Restart to apply the update
            </span>
          </div>
          <SettingsButton tone="accent" onClick={onRelaunch}>
            Restart now
          </SettingsButton>
        </div>
      );

    case "error":
      return (
        <div className={row}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui-body font-medium text-error">
              Update failed
            </span>
            <span className="line-clamp-1 text-ui-meta text-fg-4">
              {status.message}
            </span>
          </div>
          <SettingsButton onClick={onCheck}>Retry</SettingsButton>
        </div>
      );
  }
}
