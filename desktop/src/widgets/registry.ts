/**
 * Desktop-local widget registry.
 *
 * Discovers widget FeedTab components at build time from this
 * directory only. Each widget module exports a named `{id}Widget`
 * conforming to WidgetManifest.
 */
import { createRegistry } from "../lib/createRegistry";
import type { WidgetManifest } from "../types";

const modules = import.meta.glob<Record<string, WidgetManifest>>("./*/FeedTab.tsx", {
  eager: true,
});

const { get, getAll, ORDER } = createRegistry<WidgetManifest>(
  modules,
  "Widget",
  ["clock", "timer", "weather", "sysmon", "uptime", "github"],
);

/** Look up a widget by id. */
export const getWidget = get;

/** Get all registered widgets in canonical order. */
export const getAllWidgets = getAll;

/** Canonical display order for widget tabs. */
export const WIDGET_ORDER = ORDER;
