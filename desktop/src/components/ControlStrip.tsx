/**
 * ControlStrip — ambient control bar always visible below the title
 * bar. Surfaces the two most-used global toggles (ticker on/off and
 * pin-on-top) and the connection-status indicator so users never
 * have to dig into Settings → Ticker or Settings → General to do
 * the things they do every day.
 *
 * Pre-IA-refactor, the only canonical home for "toggle the ticker"
 * was Settings → Ticker (3 clicks). The ticker hover toolbar and
 * tray right-click also worked, but neither was discoverable from
 * the main app window. The control strip puts the canonical action
 * in the chrome, exactly once, where new users will see it.
 *
 * Layout: ticker toggle • pin toggle • [spacer] • connection status
 *
 * IA refactor 2026-05-09 — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 */
import { Pin, Radio, RadioTower } from "lucide-react";
import clsx from "clsx";
import Tooltip from "./Tooltip";
import ConnectionIndicator from "./ConnectionIndicator";
import type { DeliveryHealth } from "../hooks/useDeliveryHealth";

// ── Props ───────────────────────────────────────────────────────

interface ControlStripProps {
  /** Whether the standalone ticker window is alive. */
  tickerOn: boolean;
  /** Whether the always-on-top pin is engaged. */
  pinned: boolean;
  /** Connection-health derivation from useDeliveryHealth. */
  health: DeliveryHealth;
  /** Toggle ticker visibility — same contract as Settings → Ticker top toggle. */
  onToggleTicker: () => void;
  /** Toggle always-on-top pin. */
  onTogglePin: () => void;
}

// ── Component ───────────────────────────────────────────────────

export default function ControlStrip({
  tickerOn,
  pinned,
  health,
  onToggleTicker,
  onTogglePin,
}: ControlStripProps) {
  return (
    <div
      role="toolbar"
      aria-label="App controls"
      className="flex items-center gap-1 h-9 shrink-0 px-3 border-b border-edge/40 bg-surface-2/50 select-none"
    >
      {/* Ticker on/off — primary affordance, leftmost so it's the
          first thing the eye lands on. */}
      <Tooltip
        content={tickerOn ? "Hide the ticker window" : "Show the ticker window"}
        side="bottom"
      >
        <button
          type="button"
          role="switch"
          aria-checked={tickerOn}
          onClick={onToggleTicker}
          className={clsx(
            "flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium transition-colors",
            tickerOn
              ? "bg-accent/10 text-accent hover:bg-accent/15"
              : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
          )}
        >
          {tickerOn ? <RadioTower size={12} /> : <Radio size={12} />}
          <span>Ticker {tickerOn ? "on" : "off"}</span>
        </button>
      </Tooltip>

      {/* Pin-on-top — secondary toggle. */}
      <Tooltip
        content={pinned ? "Stop keeping window above others" : "Keep window above other windows"}
        side="bottom"
      >
        <button
          type="button"
          role="switch"
          aria-checked={pinned}
          onClick={onTogglePin}
          className={clsx(
            "flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-medium transition-colors",
            pinned
              ? "bg-info/10 text-info hover:bg-info/15"
              : "text-fg-4 hover:text-fg-2 hover:bg-surface-hover",
          )}
        >
          <Pin size={12} className={clsx(pinned && "fill-current")} />
          <span>{pinned ? "Pinned" : "Pin"}</span>
        </button>
      </Tooltip>

      {/* Spacer — pushes the connection indicator right. */}
      <div className="flex-1" />

      {/* Connection status — friendly Connected / Reconnecting /
          Offline. The existing ConnectionIndicator has live/polling/
          stale/offline states with hover descriptions. */}
      <ConnectionIndicator health={health} />
    </div>
  );
}
