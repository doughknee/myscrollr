/**
 * ConnectionBanner — reassures users when SSE is down but polling is
 * keeping data current. Applies to every tier: real-time delivery is
 * universal (see useDeliveryHealth), so a dropped stream is always
 * worth explaining.
 *
 * The CDC + polling redundancy means users never actually lose data when
 * the stream drops, but without a visible cue they perceive "the app is
 * broken". This banner explains what's happening so the next 60 seconds
 * of polling-only updates feel intentional instead of suspicious.
 *
 * Dismissal is per delivery-mode: dismissing "polling" suppresses the
 * banner until SSE genuinely recovers or the mode shifts to something
 * different (e.g. "offline") — a fresh outage re-notifies.
 *
 * BOTH transitions are debounced, and that is the whole design:
 *
 *   - A reconnecting stream flaps polling -> sse -> polling every few
 *     seconds. Reacting to each flip made the banner strobe at the top
 *     of the widget, and — worse — every momentary "sse" cleared the
 *     stored dismissal, so the banner reappeared seconds after being
 *     dismissed and could not be got rid of.
 *   - So a degraded mode has to HOLD before the banner appears, and a
 *     recovery has to HOLD before it counts as recovered. A stream that
 *     is merely bouncing changes nothing on screen.
 *
 * The asymmetry is deliberate: appearing is cheap to delay (a two-second
 * blip needs no explanation), while clearing a dismissal is destructive
 * and gets a much longer fuse.
 */
import { useEffect, useRef, useState } from "react";
import { WifiOff, Zap } from "lucide-react";

interface ConnectionBannerProps {
  /** Current delivery mode — from the SSE state source of truth. */
  deliveryMode: "sse" | "polling" | "offline";
}

const DISMISS_STORAGE_KEY = "scrollr:connbanner-dismissed";

/** How long a degraded mode must hold before it's worth telling anyone. */
const SHOW_DELAY_MS = 4_000;

/**
 * How long SSE must hold before a later drop counts as a NEW outage.
 * Long on purpose: this is what stops a flapping stream from wiping a
 * dismissal the user just made.
 */
const RECOVERY_HOLD_MS = 60_000;

export default function ConnectionBanner({
  deliveryMode,
}: ConnectionBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(
    () => localStorage.getItem(DISMISS_STORAGE_KEY) === deliveryMode,
  );
  // The mode we're willing to act on — trails the live one until it
  // proves it's going to stay.
  const [settledMode, setSettledMode] = useState(deliveryMode);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the mode itself. Nothing downstream sees a flap.
  useEffect(() => {
    if (deliveryMode === settledMode) return;
    const t = setTimeout(
      () => setSettledMode(deliveryMode),
      // Recovering to a healthy stream can show immediately — hiding a
      // banner early is never the wrong call. Going degraded waits.
      deliveryMode === "sse" ? 0 : SHOW_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [deliveryMode, settledMode]);

  // Clear the stored dismissal only once SSE has genuinely held, so a
  // reconnect blip can't resurrect a banner the user dismissed.
  useEffect(() => {
    if (recoveryTimer.current) {
      clearTimeout(recoveryTimer.current);
      recoveryTimer.current = null;
    }
    if (settledMode !== "sse") {
      // A different degraded mode than the dismissed one still deserves
      // a fresh notification (offline ≠ polling).
      setDismissed(localStorage.getItem(DISMISS_STORAGE_KEY) === settledMode);
      return;
    }
    recoveryTimer.current = setTimeout(() => {
      setDismissed(false);
      localStorage.removeItem(DISMISS_STORAGE_KEY);
    }, RECOVERY_HOLD_MS);
    return () => {
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
  }, [settledMode]);

  // Every tier expects the live stream now, so any non-sse mode is
  // worth explaining — it means the stream dropped, not that the plan
  // doesn't include it.
  if (dismissed || settledMode === "sse") return null;

  const Icon = settledMode === "offline" ? WifiOff : Zap;
  const message =
    settledMode === "offline"
      ? "You appear to be offline. Data shown is from the last successful fetch."
      : "Live updates paused — using polling. Data is still current.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning"
    >
      <Icon size={12} aria-hidden />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          localStorage.setItem(DISMISS_STORAGE_KEY, settledMode);
        }}
        className="cursor-pointer font-medium text-warning/80 hover:text-warning"
      >
        Dismiss
      </button>
    </div>
  );
}
