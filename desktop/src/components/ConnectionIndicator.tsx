/**
 * ConnectionIndicator — small visual signal of "is the data on this
 * screen actually live, or am I looking at stale chips?"
 *
 * Phase 2 (Apr 26) addition. The shell already owned a delivery-mode
 * banner (`ConnectionBanner.tsx`) but it ONLY surfaces during SSE
 * outages on Ultimate tier — so for normal operation, free-tier users,
 * and silent staleness, the user had no signal at all.
 *
 * This indicator surfaces the four-state derivation from
 * `useDeliveryHealth` (live / polling / stale / offline) as a single
 * dot in the title bar:
 *   - **live** (green pulse with gradient ring on Ultimate): "your
 *     premium realtime stream is doing its job"
 *   - **polling** (mint): "data is current, polling cadence"
 *   - **stale** (amber, with age label): "data is aging, hover for
 *     'X ago'"
 *   - **offline** (red): "we can't reach the server"
 *
 * Hover surfaces the descriptive copy from the hook so the user
 * understands what each state means without a help page.
 */
import clsx from "clsx";
import Tooltip from "./Tooltip";
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

interface ConnectionIndicatorProps {
  health: DeliveryHealth;
  /** Optional className appended to the wrapper. */
  className?: string;
}

export default function ConnectionIndicator({
  health,
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

  // Subtle pulse animation only for live mode — overuse on every
  // state would feel busy. Stale/offline are deliberately static so
  // they read as "frozen" / "dead".
  const pulse = health.state === "live" ? "animate-pulse" : undefined;

  // Gradient ring around the dot only when SSE is eligible AND active.
  // Visually rewards Ultimate users for paying, and never appears
  // for free-tier users (avoids "what's that ring?" confusion).
  const showRing = health.sseEligible && health.state === "live";

  return (
    <Tooltip
      content={`${health.label} — ${health.description}`}
      side="bottom"
    >
      <div
        className={clsx(
          "flex items-center gap-1.5 px-2 h-6 rounded-md select-none",
          "text-[10px] font-mono uppercase tracking-wider",
          health.state === "live" || health.state === "polling"
            ? "text-fg-3"
            : health.state === "stale"
              ? "text-warning"
              : "text-error",
          className,
        )}
        // The Tooltip's clone passes ref through; we just need the
        // hover target to be focusable so keyboard users can read the
        // description too.
        tabIndex={0}
        aria-label={`Connection status: ${health.label}. ${health.description}`}
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
      </div>
    </Tooltip>
  );
}
