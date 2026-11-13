import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { useTauriListener } from "../hooks/useTauriListener";

/**
 * Where a ticker window's placement stands, told to the main window
 * (SCROLLR-405). A window that could not be placed stays hidden, so the
 * error it holds is unreadable there; each ticker window reports the result
 * of every placement here, and the monitors settings page shows the failures
 * with a retry. Same ask-and-answer shape as `edgeMeasure.ts`.
 */
export const PLACEMENT = "ticker-placement";
export const PLACEMENT_ASK = "ticker-placement:ask";

export interface Placement {
  label: string;
  /** The OS monitor name the window was assigned ("" before the first sync). */
  monitor: string;
  failed: boolean;
}

export function reportPlacement(p: Placement) {
  emit(PLACEMENT, p).catch(() => {});
}

/** Main window: the ticker windows whose last placement failed. */
export function usePlacementFailures(): Placement[] {
  const [seen, setSeen] = useState<Record<string, Placement>>({});
  useTauriListener<Placement>(PLACEMENT, (e) => setSeen((s) => ({ ...s, [e.payload.label]: e.payload })));
  // A window that was destroyed can no longer say it recovered.
  useTauriListener<string[]>("ticker-windows-changed", (e) =>
    setSeen((s) => Object.fromEntries(Object.entries(s).filter(([label]) => e.payload.includes(label)))),
  );
  // Results sent before this page opened are asked for again.
  useEffect(() => {
    emit(PLACEMENT_ASK).catch(() => {});
  }, []);
  return Object.values(seen).filter((p) => p.failed);
}
