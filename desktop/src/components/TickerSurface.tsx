import { useEffect, useRef, useState } from "react";
import { displayGeometry } from "../lib/tickerDisplay";
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
      // Only the controls idle out; moving always wakes them.
      onPointerMove={wake}
      onPointerEnter={wake}
      onPointerDown={wake}
      onFocusCapture={wake}
    >
      <div
        className="absolute left-0 top-0 flex items-center"
        style={{
          width: geometry.width,
          height: geometry.height,
          zoom: geometry.scale,
        }}
      >
        {children(geometry.grid ? geometry.height : undefined)}
      </div>
      <div
        className="absolute right-3 top-3 z-50 flex gap-2 rounded-lg border border-edge bg-base-150 p-2 text-sm text-fg focus-within:opacity-100"
        data-fill-controls=""
        data-active={active ? "" : undefined}
        onMouseEnter={wake}
      >
        <button
          type="button"
          className="rounded px-3 py-2 hover:bg-base-300"
          onClick={onSettings}
        >
          Settings
        </button>
        <button
          type="button"
          className="rounded px-3 py-2 hover:bg-base-300"
          onClick={onExit}
        >
          Exit full display <span className="text-fg-3">Esc</span>
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
        [data-fill-controls] { opacity: 0; pointer-events: none; }
        [data-fill-controls][data-active], [data-fill-controls]:focus-within { opacity: 1; pointer-events: auto; }
      `}</style>
    </div>
  );
}
