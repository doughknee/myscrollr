/**
 * ConnectionIndicator — small visual signal of "is the data on this
 * screen actually live, or am I looking at stale chips?"
 *
 * Surfaces the four-state derivation from `useDeliveryHealth`:
 *   - **live** (green pulse + gradient ring): the realtime stream is
 *     carrying updates. Universal — every tier streams (REL-27).
 *   - **polling** (mint): stream is reconnecting; poll keeps data current
 *   - **stale** (amber, with age label): data is aging
 *   - **offline** (red): we can't reach the server
 *
 * The tooltip stays to a few words — clicking opens /status, which
 * explains the state properly and shows the backend's own health.
 * Detail belongs on a page, not in a hover.
 */
import clsx from "clsx";
import Tooltip from "./Tooltip";
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

interface ConnectionIndicatorProps {
  health: DeliveryHealth;
  /** Open the status page. */
  onClick: () => void;
  /** Whether the status page is the current route. */
  active?: boolean;
  /** Optional className appended to the wrapper. */
  className?: string;
}

export default function ConnectionIndicator({
  health,
  onClick,
  active,
  className,
}: ConnectionIndicatorProps) {
  const dotColor =
    health.state === "live"
      ? "bg-success"
      : health.state === "polling"
        ? "bg-accent"
        : health.state === "stale"
          ? "bg-warning"
          : "bg-error";

  // Subtle pulse only for live — overuse on every state would feel
  // busy. Stale/offline are deliberately static so they read as
  // "frozen" / "dead".
  const pulse = health.state === "live" ? "animate-pulse" : undefined;

  // Gradient ring whenever the realtime stream is carrying updates.
  // Real-time is universal (see useDeliveryHealth), so this is a pure
  // status signal — ring = live, no ring = falling back to polling.
  const showRing = health.state === "live";

  return (
    <Tooltip content={`${health.label} — view status`} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={`Connection status: ${health.label}. View status page.`}
        className={clsx(
          "flex items-center gap-1.5 px-2 h-6 rounded-md select-none",
          "text-[10px] font-mono uppercase tracking-wider transition-colors",
          health.state === "live" || health.state === "polling"
            ? "text-fg-3"
            : health.state === "stale"
              ? "text-warning"
              : "text-error",
          active ? "bg-surface-hover" : "hover:bg-surface-hover",
          className,
        )}
      >
        <span className="relative inline-flex w-1.5 h-1.5">
          {showRing && (
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full opacity-60"
              style={{
                background:
                  "conic-gradient(from 0deg, var(--color-success), var(--color-accent), var(--color-info), var(--color-success))",
                animation: "spin 4s linear infinite",
              }}
            />
          )}
          <span
            className={clsx(
              "relative inline-flex w-1.5 h-1.5 rounded-full",
              dotColor,
              pulse,
            )}
          />
        </span>
        <span>{health.label}</span>
      </button>
    </Tooltip>
  );
}
