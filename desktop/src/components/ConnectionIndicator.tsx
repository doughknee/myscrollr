/** Shared delivery-state icon and color language for the account chip
 * and Status page. */
import { Clock, RefreshCw, WifiOff, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
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
