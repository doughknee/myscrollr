/**
 * "Signing you in..." overlay shown while a PKCE login is in flight.
 *
 * SCROLLR-8: on Linux inside an AppImage, the browser handoff can fail to
 * launch anything at all (see `open_external` in
 * `desktop/src-tauri/src/commands/open_external.rs`) — the opener call
 * still resolves, so the app has no way to detect the failure and would
 * otherwise sit on this overlay forever with no way out. The copy-link
 * button is the guarantee that a user can always finish sign-in even if
 * the opener never launches a browser: they paste the one-time link
 * themselves.
 */
import { motion } from "motion/react";
import { toast } from "sonner";
import LoadingGlyph from "./LoadingGlyph";
import { backdropMotion, overlaySurfaceMotion } from "../lib/motion";

export default function SigningInOverlay({
  authUrl,
  onCancel,
}: {
  authUrl: string | null;
  onCancel: () => void;
}) {
  const copyLink = async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      toast.success("Sign-in link copied");
    } catch {
      toast.error("Couldn't copy the link — try again");
    }
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Signing in"
      initial="hidden"
      animate="visible"
      exit="exit"
      className="absolute inset-0 z-50 flex items-center justify-center"
    >
      <motion.div
        variants={backdropMotion}
        className="absolute inset-0 bg-surface/80 backdrop-blur-sm"
      />
      <motion.div variants={overlaySurfaceMotion} className="relative text-center">
        <LoadingGlyph size={24} className="mx-auto mb-3 text-accent" />
        <p className="text-sm font-medium text-fg-2">Signing you in...</p>
        <p className="text-xs text-fg-3 mt-1">
          Finish signing in from your browser
        </p>
        {authUrl && (
          <button
            onClick={copyLink}
            className="mt-3 text-xs font-medium text-accent hover:underline"
          >
            Browser didn&apos;t open? Copy the sign-in link
          </button>
        )}
        <div>
          <button
            onClick={onCancel}
            className="mt-4 px-4 py-1.5 rounded-lg text-xs font-medium text-fg-3 hover:text-fg-2 hover:bg-surface-hover "
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
