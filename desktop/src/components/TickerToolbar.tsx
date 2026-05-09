import { invoke } from "@tauri-apps/api/core";
import { ChevronUp, ChevronDown, AppWindow, EyeOff, MoreVertical } from "lucide-react";
import clsx from "clsx";
import Tooltip from "./Tooltip";
import type { TickerPosition } from "../preferences";

interface TickerToolbarProps {
  position: TickerPosition;
  hovered: boolean;
  onTogglePosition: () => void;
  onHideTicker: () => void;
}

export default function TickerToolbar({
  position,
  hovered,
  onTogglePosition,
  onHideTicker,
}: TickerToolbarProps) {
  const PosIcon = position === "top" ? ChevronDown : ChevronUp;
  const posLabel = position === "top" ? "Move to bottom" : "Move to top";

  function openApp() {
    invoke("show_app_window").catch(() => {});
  }

  const btn = clsx(
    "w-7 h-7 flex items-center justify-center rounded-md",
    "text-fg-3 hover:text-fg hover:bg-surface-hover",
    "transition-colors duration-150",
  );

  return (
    <>
      {/* Persistent right-click hint — always visible on the right
          edge of the ticker. Without this, the right-click context
          menu (channels / widgets / position / Customize) is
          completely undiscoverable. The icon fades to ~25% opacity
          when the user isn't hovering so it doesn't compete with
          chip content, but stays visible enough to invite curiosity.
          Phase 2 (Apr 26) — paired with the one-time
          `tip:ticker-right-click` toast that fires on first launch. */}
      <Tooltip content="Right-click for options" side="bottom">
        <div
          className={clsx(
            "absolute right-1.5 top-1/2 -translate-y-1/2 z-40",
            "w-5 h-5 flex items-center justify-center rounded",
            "text-fg-4 pointer-events-none select-none",
            "transition-opacity duration-200",
            hovered ? "opacity-0" : "opacity-30",
          )}
          aria-hidden
        >
          <MoreVertical size={14} />
        </div>
      </Tooltip>

      <div
        className={clsx(
          "absolute right-0 top-0 bottom-0 z-50 flex items-center",
          "transition-opacity duration-200",
          hovered ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* Gradient fade from transparent to surface */}
        <div className="w-8 h-full bg-gradient-to-r from-transparent to-surface/80" />

        {/* Toolbar body */}
        <div className="h-full flex items-center gap-0.5 pr-2 bg-surface/80 backdrop-blur-sm">
          <Tooltip content="Open Scrollr" side="bottom">
            <button
              onClick={openApp}
              aria-label="Open Scrollr"
              className={btn}
            >
              <AppWindow size={14} />
            </button>
          </Tooltip>

          <Tooltip content={posLabel} side="bottom">
            <button
              onClick={onTogglePosition}
              aria-label={posLabel}
              className={btn}
            >
              <PosIcon size={16} />
            </button>
          </Tooltip>

          <Tooltip content="Hide Ticker" side="bottom">
            <button
              onClick={onHideTicker}
              aria-label="Hide Ticker"
              className={btn}
            >
              <EyeOff size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
