/**
 * ConnectionIndicator — small visual signal of "is the data on this
 * screen actually live, or am I looking at stale chips?"
 *
 * One icon per state, no text in the good states (the TopBar is icon
 * language; ALL-CAPS labels shouted). Degraded states grow a short
 * label — bad news should be louder than good news:
 *   - **live** (green zap): the realtime stream is carrying updates
 *   - **polling** (mint refresh): stream reconnecting; polls keep data current
 *   - **stale** (amber clock + "X ago"): data is visibly aging
 *   - **offline** (red wifi-off + "Offline"): can't reach the server
 *
 * The icon set matches ConnectionBanner (Zap / WifiOff) and the
 * status page imports DELIVERY_STATE_META below, so every surface
 * speaks the same visual language.
 *
 * The tooltip stays to a few words — clicking opens /status, which
 * explains the state properly. Detail belongs on a page, not a hover.
 */
import clsx from "clsx";
import { Clock, RefreshCw, WifiOff, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Tooltip from "./Tooltip";
import type {
  DeliveryHealth,
  DeliveryHealthState,
} from "../hooks/useDeliveryHealth";

/** Shared state → icon/color language (also used by /status). */
export const DELIVERY_STATE_META: Record<
  DeliveryHealthState,
  { icon: LucideIcon; text: string; bg: string }
> = {
  live: { icon: Zap, text: "text-success", bg: "bg-success/10" },
  polling: { icon: RefreshCw, text: "text-accent", bg: "bg-accent/10" },
  stale: { icon: Clock, text: "text-warning", bg: "bg-warning/10" },
  offline: { icon: WifiOff, text: "text-error", bg: "bg-error/10" },
};

interface ConnectionIndicatorProps {
  health: DeliveryHealth;
  /** Open the status page. */
  onClick: () => void;
  /** Whether the status page is the current route. */
  active?: boolean;
}

export default function ConnectionIndicator({
  health,
  onClick,
  active,
}: ConnectionIndicatorProps) {
  const meta = DELIVERY_STATE_META[health.state];
  const Icon = meta.icon;

  // Good states are icon-only; degraded states earn a label.
  const degraded = health.state === "stale" || health.state === "offline";

  return (
    <Tooltip content={`${health.label} — view status`} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        aria-label={`Connection status: ${health.label}. View status page.`}
        className={clsx(
          "flex items-center justify-center gap-1.5 h-7 rounded-md select-none ",
          degraded ? "px-2" : "w-7",
          // Healthy states sit quietly in the chrome like every other
          // icon; state color is reserved for degraded states (and the
          // status page's tile, which is a hero, not chrome).
          degraded ? meta.text : "text-fg-4 hover:text-fg-2",
          active ? "bg-surface-hover" : "hover:bg-surface-hover",
        )}
      >
        <Icon size={13} strokeWidth={2.2} />
        {degraded && (
          <span className="text-ui-chip font-medium">{health.label}</span>
        )}
      </button>
    </Tooltip>
  );
}
