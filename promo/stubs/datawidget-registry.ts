/**
 * Stand-in for desktop/src/datawidgets/registry.ts.
 *
 * That module discovers widget FeedTab components with
 * `import.meta.glob`, which is a Vite build-time transform. Remotion
 * bundles with webpack, where it is a plain property access on
 * import.meta and fails at runtime with "{}.glob is not a function" —
 * the whole bundle dies before a frame renders.
 *
 * Nothing in a ticker render needs it. It reaches the graph through
 * marketplace.ts, and the only thing the ticker asks marketplace is
 * `sourceForWidget`, which falls back to the tab name when the catalog
 * has no entry. Returning nothing here takes exactly that fallback.
 *
 * If a composition ever renders a widget PAGE rather than ticker chips,
 * this becomes wrong and the page will render empty. Build the registry
 * eagerly from explicit imports at that point rather than widening this.
 */
import type { DataWidgetManifest } from "../../desktop/src/types";

export function getDataWidget(_id: string): DataWidgetManifest | undefined {
  return undefined;
}

export function getAllDataWidgets(): DataWidgetManifest[] {
  return [];
}
