import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { updateController, useUpdateController } from "../lib/updateController";

const TOAST_ID = "scrollr-startup-update";
/** How often an app left open asks the feed again. Hours, not minutes. */
const RECHECK_MS = 6 * 60 * 60 * 1000;
export function useStartupUpdateCheck({ appVersion }: { appVersion: string }) {
  const ran = useRef(false);
  const retryFromToast = useRef(false);
  // Not the progress fields: a download chunk must not render the app shell (SCROLLR-429).
  const state = useUpdateController((s) => ({ phase: s.phase, offerId: s.offerId, version: s.version, error: s.error, errorOperation: s.errorOperation }));
  useEffect(() => {
    if (!appVersion || ran.current) return;
    const timer = setTimeout(() => {
      ran.current = true;
      // Settings may already have checked or started an update during startup.
      if (updateController.getSnapshot().phase === "idle") void updateController.check();
    }, 4_000);
    return () => clearTimeout(timer);
  }, [appVersion]);
  useEffect(() => {
    if (!appVersion) return;
    const timer = setInterval(() => {
      const s = updateController.getSnapshot();
      // Never over an offer or an install in progress: a check discards the
      // offer, and its toast (which the user may have dismissed) would come
      // back. A failed automatic check is retried; a failed download is not.
      if (["idle", "current", "waiting"].includes(s.phase) || (s.phase === "error" && s.errorOperation === "checking")) {
        void updateController.check();
      }
    }, RECHECK_MS);
    return () => clearInterval(timer);
  }, [appVersion]);
  useEffect(() => {
    if (state.phase === "available") {
      retryFromToast.current = false;
      const offer = state.offerId;
      toast.info("Update available", { id: TOAST_ID, description: `Version ${state.version} is ready to download.`, duration: Infinity,
        action: { label: "Update", onClick: () => { void updateController.install(offer); } },
        cancel: { label: "Not now", onClick: () => toast.dismiss(TOAST_ID) } });
    } else if (state.phase === "downloading" || state.phase === "installing") {
      toast.loading(state.phase === "installing" ? "Installing update…" : "Downloading update…", { id: TOAST_ID, duration: Infinity });
    } else if (state.phase === "ready") {
      toast[state.error ? "error" : "success"](state.error ? "Restart needed" : "Update installed", { id: TOAST_ID,
        description: state.error || "Restart to apply.", duration: Infinity,
        action: { label: "Restart now", onClick: () => { void updateController.restart(); } },
        cancel: { label: "Later", onClick: () => toast.dismiss(TOAST_ID) } });
    } else if (state.phase === "error") {
      if (state.errorOperation === "downloading" || retryFromToast.current) {
        toast.error("Could not install update", { id: TOAST_ID, description: state.error, duration: Infinity,
          action: { label: "Check again", onClick: () => { retryFromToast.current = true; void updateController.check(); } },
          cancel: { label: "Later", onClick: () => toast.dismiss(TOAST_ID) } });
      } else toast.dismiss(TOAST_ID); // Automatic feed-check failures stay quiet.
    } else toast.dismiss(TOAST_ID);
  }, [state.phase, state.offerId, state.version, state.error, state.errorOperation]);
}
