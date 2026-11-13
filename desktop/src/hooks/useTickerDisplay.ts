import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriListener } from "./useTauriListener";
import { DEFAULT_DISPLAY } from "../lib/tickerDisplay";
import { PLACEMENT_ASK, reportPlacement } from "../lib/tickerPlacement";
import type { Placement } from "../lib/tickerPlacement";
import { TICKER_HEIGHT } from "../preferences";
import type { AppPreferences } from "../preferences";
import type { TickerDisplay } from "../lib/tickerDisplay";

/** One serialized geometry owner per window; data connections remain process-wide. */
export function useTickerDisplay(prefs: AppPreferences) {
  const [display, setDisplay] = useState<TickerDisplay>({
    ...DEFAULT_DISPLAY,
    monitor: "",
    suspended: false,
    pageLeader: getCurrentWindow().label === "ticker",
  });
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(prefs);
  latest.current = prefs;
  const pending = useRef(Promise.resolve());
  const label = getCurrentWindow().label;
  // The last placement result, for the main window's monitors page (SCROLLR-405).
  const placement = useRef<Placement>({ label, monitor: "", failed: false });
  const report = (patch: Partial<Placement>) => {
    placement.current = { ...placement.current, ...patch };
    reportPlacement(placement.current);
  };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const place = useCallback(() => {
    pending.current = pending.current
      .then(async () => {
        if (!mounted.current) return;
        const p = latest.current;
        // A host with no native display (null) gets the docked bar.
        const next =
          (await invoke<TickerDisplay | null>("ticker_display")) ?? {
            ...DEFAULT_DISPLAY,
            monitor: "",
            suspended: false,
            pageLeader: getCurrentWindow().label === "ticker",
          };
        if (!mounted.current) return;
        placement.current.monitor = next.monitor;
        setDisplay(next);
        const win = getCurrentWindow();
        const visible = p.ticker.showTicker && !next.suspended;
        await invoke("set_ticker_visible", { visible });
        if (!visible) {
          await win.hide();
          report({ failed: false });
          return;
        }
        // Fullscreen remains a normal focusable window so Settings can open above it.
        await invoke("pin_window", {
          pinned: next.mode === "docked" && p.window.pinned,
        });
        const args = {
          position: p.window.tickerPosition,
          height: Math.round((TICKER_HEIGHT * p.appearance.tickerScale) / 100),
        };
        await invoke("position_ticker", args);
        await win.show();
        await invoke("position_ticker", args);
        if (mounted.current) setError(null);
        report({ failed: false });
      })
      .catch(() => {
        report({ failed: true });
        if (mounted.current)
          setError(
            "Could not place this display. Open Scrollr to choose a display again.",
          );
      });
  }, []);
  const key = JSON.stringify([
    prefs.window,
    prefs.ticker.showTicker,
    prefs.appearance.tickerScale,
  ]);
  useEffect(place, [place, key]);
  useTauriListener("ticker-reposition", place);
  useTauriListener(PLACEMENT_ASK, () => reportPlacement(placement.current));
  useEffect(() => {
    void invoke("set_hide_on_fullscreen", {
      value: prefs.window.hideOnFullscreen,
    }).catch(() => {});
  }, [prefs.window.hideOnFullscreen]);
  return { display, error };
}
