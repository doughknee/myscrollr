/**
 * WindowControls — minimize / maximize / close for the frameless
 * window on Windows/Linux, rendered inline at the right edge of the
 * TopBar (Claude-desktop-style single chrome row). macOS keeps native
 * decorations (traffic lights), so this renders nothing there.
 */
import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Tooltip from "./Tooltip";

export const IS_MACOS =
  (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform === "macOS" || /Mac/.test(navigator.platform);

const appWindow = getCurrentWindow();

const btnBase =
  "flex items-center justify-center w-11 h-full transition-colors duration-150";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  // Track maximize state for the restore/maximize icon swap
  useEffect(() => {
    if (IS_MACOS) return;
    appWindow.isMaximized().then(setMaximized).catch(() => {});

    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await appWindow.onResized(() => {
        appWindow.isMaximized().then(setMaximized).catch(() => {});
      });
    };
    setup();
    return () => unlisten?.();
  }, []);

  if (IS_MACOS) return null;

  return (
    // h-full: fill whatever chrome row hosts the controls. Callers
    // position the cluster flush against the window corner (native
    // title-bar hit target).
    <div className="flex items-center h-full">
      {/* Minimize */}
      <Tooltip content="Minimize" side="bottom">
        <button
          onClick={() => appWindow.minimize()}
          className={`${btnBase} text-fg-3 hover:text-fg hover:bg-surface-hover`}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect fill="currentColor" width="10" height="1" rx="0.5" />
          </svg>
        </button>
      </Tooltip>

      {/* Maximize / Restore */}
      <Tooltip content={maximized ? "Restore" : "Maximize"} side="bottom">
        <button
          onClick={() => appWindow.toggleMaximize()}
          className={`${btnBase} text-fg-3 hover:text-fg hover:bg-surface-hover`}
          aria-label={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            // Restore icon — two overlapping rectangles
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="2"
                y="3"
                width="7"
                height="7"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M3 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          ) : (
            // Maximize icon — single rectangle
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                rx="1"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          )}
        </button>
      </Tooltip>

      {/* Close */}
      <Tooltip content="Close" side="bottom">
        <button
          onClick={() => appWindow.close()}
          className={`${btnBase} text-fg-3 hover:text-fg hover:bg-error/80 hover:text-white`}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}
