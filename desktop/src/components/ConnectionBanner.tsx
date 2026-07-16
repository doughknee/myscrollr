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
 * banner until SSE recovers or the mode shifts to something different
 * (e.g. "offline") — a fresh outage re-notifies.
 */
import { useEffect, useState } from "react";
import { WifiOff, Zap } from "lucide-react";

interface ConnectionBannerProps {
  /** Current delivery mode — from the SSE state source of truth. */
  deliveryMode: "sse" | "polling" | "offline";
}

const DISMISS_STORAGE_KEY = "scrollr:connbanner-dismissed";

export default function ConnectionBanner({ deliveryMode }: ConnectionBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(() =>
    localStorage.getItem(DISMISS_STORAGE_KEY) === deliveryMode,
  );

  // Reset dismissal whenever the mode flips so a new outage re-notifies.
  useEffect(() => {
    if (deliveryMode === "sse") {
      setDismissed(false);
      localStorage.removeItem(DISMISS_STORAGE_KEY);
    } else {
      // If a different non-sse mode is active (e.g. offline ≠ polling), the
      // stored dismissal no longer matches — re-show.
      setDismissed(localStorage.getItem(DISMISS_STORAGE_KEY) === deliveryMode);
    }
  }, [deliveryMode]);

  // Every tier expects the live stream now, so any non-sse mode is
  // worth explaining — it means the stream dropped, not that the plan
  // doesn't include it.
  const visible = !dismissed && deliveryMode !== "sse";
  if (!visible) return null;

  const Icon = deliveryMode === "offline" ? WifiOff : Zap;
  const message =
    deliveryMode === "offline"
      ? "You appear to be offline. Data shown is from the last successful fetch."
      : "Live updates paused — using polling. Data is still current.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning shrink-0"
    >
      <Icon size={12} aria-hidden />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          localStorage.setItem(DISMISS_STORAGE_KEY, deliveryMode);
        }}
        className="font-medium text-warning/80 hover:text-warning cursor-pointer"
      >
        Dismiss
      </button>
    </div>
  );
}
