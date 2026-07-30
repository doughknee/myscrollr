// ── Mandatory-update blocking overlay ───────────────────────────
//
// Rendered by the dashboard shell when useUpdateGate says the installed
// version is older than the API's minimum (breaking deploy). Unlike the
// startup toast (dismissible, user can disable it in Settings), this
// covers the whole window until the update is installed — the app would
// otherwise render broken data against the new API.
//
// The update flow reuses the exact plugin mechanics from the startup
// check: shared lock, downloadAndInstall with progress, relaunch.

import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { RefreshCw, Download } from "lucide-react";
import { motion } from "motion/react";
import { tryAcquireUpdateLock, releaseUpdateLock } from "../lib/updateState";
import {
  backdropMotion,
  overlaySurfaceMotion,
} from "../lib/motion";

interface Props {
  appVersion: string;
  minVersion: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "downloading"; detail: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function UpdateRequiredOverlay({ appVersion, minVersion }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const runUpdate = async () => {
    if (!tryAcquireUpdateLock()) {
      setPhase({
        kind: "error",
        message: "Another update is already running. Try again in a moment.",
      });
      return;
    }
    setPhase({ kind: "downloading", detail: "Checking for the update…" });
    try {
      const update = await check();
      if (!update) {
        // Server minimum is ahead of the release feed (deploy ordering
        // gap). Nothing to install yet — say so instead of spinning.
        setPhase({
          kind: "error",
          message:
            "The update isn't available yet. Please try again in a few minutes.",
        });
        return;
      }
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength ?? 0;
          const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
          setPhase({
            kind: "downloading",
            detail: total
              ? `Downloading… ${mb(downloaded)} / ${mb(total)} MB`
              : "Downloading…",
          });
        }
      });
      setPhase({ kind: "ready" });
    } catch (err) {
      setPhase({
        kind: "error",
        message: `Update failed: ${String(err)}. You can also reinstall from myscrollr.com/download.`,
      });
    } finally {
      releaseUpdateLock();
    }
  };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-[1000] flex items-center justify-center"
    >
      <motion.div
        variants={backdropMotion}
        className="absolute inset-0 bg-base-100/95 backdrop-blur-sm"
      />
      <motion.div
        variants={overlaySurfaceMotion}
        className="relative max-w-md w-full mx-6 rounded-2xl border border-base-300/40 bg-base-200/80 p-8 text-center shadow-xl"
      >
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Download size={22} />
        </div>
        <h2 className="mb-2 text-lg font-bold text-base-content">
          Update required
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-base-content/55">
          This version of Scrollr ({appVersion}) is older than the minimum
          the service now supports ({minVersion}). Update to keep your
          widgets streaming — your data and settings carry over.
        </p>

        {phase.kind === "ready" ? (
          <button
            type="button"
            onClick={() => void relaunch()}
            className="btn btn-primary btn-sm w-full"
          >
            <RefreshCw size={14} />
            Restart to finish updating
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runUpdate()}
            disabled={phase.kind === "downloading"}
            className="btn btn-primary btn-sm w-full"
          >
            <Download size={14} />
            {phase.kind === "downloading" ? "Updating…" : "Update now"}
          </button>
        )}

        {phase.kind === "downloading" && (
          <p className="mt-3 text-xs text-base-content/40">{phase.detail}</p>
        )}
        {phase.kind === "error" && (
          <p className="mt-3 text-xs text-error/70">{phase.message}</p>
        )}
      </motion.div>
    </motion.div>
  );
}
