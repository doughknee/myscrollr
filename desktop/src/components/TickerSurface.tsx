import { useEffect, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { displayGeometry, FILL_CONTROLS_W } from "../lib/tickerDisplay";
import { DISPLAY_HEADER_H } from "./pages/pagePlan";
import type { ReactNode } from "react";
import type { TickerDisplay } from "../lib/tickerDisplay";

export default function TickerSurface({
  display,
  onExit,
  onSettings,
  error,
  children,
}: {
  display: TickerDisplay;
  onExit: () => void;
  onSettings: () => void;
  error?: string | null;
  children: (fillHeight?: number) => ReactNode;
}) {
  const filled = display.mode !== "docked";
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [active, setActive] = useState(true);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = () => {
    setActive(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setActive(false), 5000);
  };
  useEffect(() => {
    const resize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    resize();
    wake();
    return () => {
      window.removeEventListener("resize", resize);
      clearTimeout(idle.current);
    };
  }, []);
  useEffect(() => {
    if (!filled) return;
    wake();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [filled, onExit]);
  if (!filled) return <>{children()}</>;
  const geometry = displayGeometry(
    size.width,
    size.height,
    display.mode,
    display.readingSize,
  );
  return (
    <div
      data-fill-display={display.mode}
      className="relative h-screen w-full overflow-hidden bg-base-150"
      // Keep pointer visibility under the native webview's control.
      // Controls retain their own space and remain reachable while idle.
      onPointerMove={wake}
      onPointerEnter={wake}
      onPointerDown={wake}
      onFocusCapture={wake}
    >
      <div
        className="absolute left-0 top-0 flex items-center"
        style={{
          width: geometry.width - (geometry.grid ? 0 : FILL_CONTROLS_W),
          height: geometry.height,
          zoom: geometry.scale,
        }}
      >
        {children(geometry.grid ? geometry.height : undefined)}
      </div>
      <div
        className="absolute right-0 z-50 flex h-16 items-center justify-center gap-1 border-l border-edge bg-base-150 px-2"
        style={{ width: FILL_CONTROLS_W, zoom: geometry.scale * (geometry.grid ? DISPLAY_HEADER_H / 64 : 1), top: geometry.grid ? 0 : (geometry.height - 64) / 2 }}
        data-fill-controls=""
        data-active={active ? "" : undefined}
        onMouseEnter={wake}
      >
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
          onClick={onSettings}
        >
          <Settings size={18} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Exit full display"
          title="Exit full display (Esc)"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
          onClick={onExit}
        >
          <LogOut size={18} aria-hidden />
        </button>
      </div>
      {error && (
        <div
          role="alert"
          className="absolute bottom-3 left-3 right-3 bg-base-150 p-3 text-sm text-fg"
        >
          {error}
        </div>
      )}
      <style>{`
        [data-fill-controls] { color: var(--color-fg-3); }
        [data-fill-controls][data-active], [data-fill-controls]:focus-within { color: var(--color-fg); }
      `}</style>
    </div>
  );
}
