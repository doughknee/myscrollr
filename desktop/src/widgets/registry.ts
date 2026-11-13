/**
 * Desktop-local widget registry.
 *
 * Discovers widget manifests at build time from this directory only. Each
 * `{id}/manifest.ts` exports a named `{id}Widget` conforming to WidgetManifest.
 * The manifest is the metadata the ticker window needs (name, colour, icon,
 * copy); its `FeedTab` is a lazy import of `{id}/FeedTab.tsx`, so the feed
 * screens load only when a widget's page opens (SCROLLR-408).
 */
import type { WidgetManifest } from "../types";

const modules = import.meta.glob<Record<string, WidgetManifest>>("./*/manifest.ts", {
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
