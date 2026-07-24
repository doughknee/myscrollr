/**
 * Desktop-local data-widget registry.
 *
 * Discovers data-widget FeedTab components at build time from this
 * directory. Each module exports a named `{id}DataWidget` manifest
 * conforming to DataWidgetManifest.
 */
import type { DataWidgetManifest } from "../types";

const modules = import.meta.glob<Record<string, DataWidgetManifest>>("./*/FeedTab.tsx", {
  eager: true,
});

/** Canonical display order. Anything not listed sorts by id after these. */
const ORDER = ["finance", "sports", "fantasy", "rss", "predictions"];

const registry = new Map<string, DataWidgetManifest>();
for (const mod of Object.values(modules)) {
  for (const [name, value] of Object.entries(mod)) {
    if (name.endsWith("DataWidget") && value && "id" in value && "FeedTab" in value) {
      registry.set(value.id, value);
    }
  }
}

/** Look up a data widget by id. */
export function getDataWidget(id: string): DataWidgetManifest | undefined {
  return registry.get(id);
}

/** Get all registered data widgets in canonical order. */
export function getAllDataWidgets(): DataWidgetManifest[] {
  const known = ORDER.filter((id) => registry.has(id)).map((id) => registry.get(id)!);
  const rest = [...registry.values()]
    .filter((m) => !ORDER.includes(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...known, ...rest];
}
