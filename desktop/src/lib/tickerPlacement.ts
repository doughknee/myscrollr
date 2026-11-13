import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getAllWindows } from "@tauri-apps/api/window";
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
  // A window that was destroyed can no longer say it recovered.
  const keepOnly = (labels: string[]) =>
    setSeen((s) => Object.fromEntries(Object.entries(s).filter(([label]) => labels.includes(label))));
  // D2-7: `ticker-windows-changed` is not sent when a sync stops early, and a
  // window's last report can land after it, so failures are also checked
  // against the windows that exist now.
  const pruneToLiveWindows = () =>
    getAllWindows()
      .then((ws) => keepOnly(ws.map((w) => w.label)))
      .catch(() => {});
  useTauriListener<Placement>(PLACEMENT, (e) => {
    setSeen((s) => ({ ...s, [e.payload.label]: e.payload }));
    void pruneToLiveWindows();
  });
  useTauriListener<string[]>("ticker-windows-changed", (e) => keepOnly(e.payload));
  // Results sent before this page opened are asked for again.
  useEffect(() => {
    emit(PLACEMENT_ASK).catch(() => {});
  }, []);
  return Object.values(seen).filter((p) => p.failed);
}
