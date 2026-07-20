/**
 * Desktop-local data-widget registry.
 *
 * Discovers data-widget FeedTab components at build time from this
 * directory. Each module exports a named `{id}DataWidget` manifest
 * conforming to DataWidgetManifest.
 */
import { createRegistry } from "../lib/createRegistry";
import type { DataWidgetManifest } from "../types";

const modules = import.meta.glob<Record<string, DataWidgetManifest>>("./*/FeedTab.tsx", {
  eager: true,
});

const { get, getAll, ORDER } = createRegistry<DataWidgetManifest>(
  modules,
  "DataWidget",
  ["finance", "sports", "fantasy", "rss", "predictions"],
);

/** Look up a data widget by id. */
export const getDataWidget = get;

/** Get all registered data widgets in canonical order. */
export const getAllDataWidgets = getAll;

/** Canonical display order for data-widget tabs. */
export const DATA_WIDGET_ORDER = ORDER;
