import { RefreshCw, Download } from "lucide-react";
import { motion } from "motion/react";
import { openExternal } from "../lib/openExternal";
import UpdateErrorNotice from "./UpdateErrorNotice";
import { updateBusy } from "../lib/updateState";
import { updateController, useUpdateController } from "../lib/updateController";
import {
  backdropMotion,
  overlaySurfaceMotion,
} from "../lib/motion";

// The app's filled accent button (same classes as the Home empty-state CTAs).
const PRIMARY_BUTTON =
  "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-ui-meta font-semibold text-surface hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60";
const DOWNLOAD_URL = "https://myscrollr.com/download";

interface Props {
  appVersion: string;
  minVersion: string;
}

export function UpdateRequiredOverlay({ appVersion, minVersion }: Props) {
  const state = useUpdateController();
  const runUpdate = async () => {
    await updateController.check();
    await updateController.install();
  };
  const busy = updateBusy(state);

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-[1000] flex items-center justify-center"
    >
      <motion.div
        variants={backdropMotion}
        className="absolute inset-0 bg-surface/95 backdrop-blur-sm"
      />
      <motion.div
        variants={overlaySurfaceMotion}
        className="relative max-w-md w-full mx-6 rounded-2xl border border-edge bg-surface-2 p-8 text-center shadow-xl"
      >
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Download size={22} />
        </div>
        <h2 className="mb-2 text-lg font-bold text-fg">
          Update required
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-fg-3">
          This version of Scrollr ({appVersion}) is older than the minimum
          the service now supports ({minVersion}). Update to keep your
          widgets streaming — your data and settings carry over.
        </p>

        {state.phase === "ready" ? (
          <button
            type="button"
            onClick={() => void updateController.restart()}
            className={PRIMARY_BUTTON}
          >
            <RefreshCw size={14} />
            Restart to finish updating
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runUpdate()}
            disabled={busy}
            className={PRIMARY_BUTTON}
          >
            <Download size={14} />
            {busy ? "Updating…" : "Update now"}
          </button>
        )}

        {busy && (
          <p className="mt-3 text-xs text-fg-3">{state.phase === "checking" ? "Checking the selected update channel…" : "Updating Scrollr…"}</p>
        )}
        <UpdateErrorNotice state={state} className="mt-3" />
        {state.error && (
          <button
            type="button"
            onClick={() => void openExternal(DOWNLOAD_URL).catch(() => {})}
            className="mt-3 cursor-pointer text-ui-meta font-medium text-accent hover:underline"
          >
            Download the installer instead
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
