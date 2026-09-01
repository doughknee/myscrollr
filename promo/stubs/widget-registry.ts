/**
 * Stand-in for desktop/src/widgets/registry.ts.
 *
 * Same reason as stubs/datawidget-registry.ts: that module builds itself
 * with `import.meta.glob`, a Vite build-time transform that webpack
 * cannot execute — the bundle dies on load with "{}.glob is not a
 * function" before a frame renders.
 *
 * ScrollrTicker takes exactly one thing from it, WIDGET_ORDER, and that
 * is a plain literal rather than anything the glob produces. Copied
 * verbatim; if the real one gains an entry this silently falls behind,
 * so keep them together.
 */
import type { WidgetManifest } from "../../desktop/src/types";

export const WIDGET_ORDER = [
  "clock",
  "timer",
  "weather",
  "sysmon",
  "uptime",
  "github",
];

export function getWidget(_id: string): WidgetManifest | undefined {
  return undefined;
}

export function getAllWidgets(): WidgetManifest[] {
  return [];
}
