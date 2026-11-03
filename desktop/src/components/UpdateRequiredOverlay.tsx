import { RefreshCw, Download } from "lucide-react";
import { motion } from "motion/react";
import { updateBusy } from "../lib/updateState";
import { updateController, useUpdateController } from "../lib/updateController";
import {
  backdropMotion,
  overlaySurfaceMotion,
} from "../lib/motion";

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

        {state.phase === "ready" ? (
          <button
            type="button"
            onClick={() => void updateController.restart()}
            className="btn btn-primary btn-sm w-full"
          >
            <RefreshCw size={14} />
            Restart to finish updating
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runUpdate()}
            disabled={busy}
            className="btn btn-primary btn-sm w-full"
          >
            <Download size={14} />
            {busy ? "Updating…" : "Update now"}
          </button>
        )}

        {busy && (
          <p className="mt-3 text-xs text-base-content/40">{state.phase === "checking" ? "Checking the selected update channel…" : "Updating Scrollr…"}</p>
        )}
        {state.error && (
          <p className="mt-3 text-xs text-error/70">{state.error}</p>
        )}
      </motion.div>
    </motion.div>
  );
}
