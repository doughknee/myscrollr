/**
 * Desktop-local widget registry.
 *
 * Discovers widget FeedTab components at build time from this
 * directory only. Each widget module exports a named `{id}Widget`
 * conforming to WidgetManifest.
 */
import type { WidgetManifest } from "../types";

const modules = import.meta.glob<Record<string, WidgetManifest>>("./*/FeedTab.tsx", {
  eager: true,
});

/** Canonical display order for widget tabs. Anything not listed sorts by id
 *  after these. */
export const WIDGET_ORDER = ["clock", "timer", "weather", "sysmon", "uptime", "github"];

const registry = new Map<string, WidgetManifest>();
for (const mod of Object.values(modules)) {
  for (const [name, value] of Object.entries(mod)) {
    if (name.endsWith("Widget") && value && "id" in value && "FeedTab" in value) {
      registry.set(value.id, value);
    }
  }
}

/** Look up a widget by id. */
export function getWidget(id: string): WidgetManifest | undefined {
  return registry.get(id);
}

/** Get all registered widgets in canonical order. */
export function getAllWidgets(): WidgetManifest[] {
  const known = WIDGET_ORDER.filter((id) => registry.has(id)).map((id) => registry.get(id)!);
  const rest = [...registry.values()]
    .filter((m) => !WIDGET_ORDER.includes(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...known, ...rest];
}
