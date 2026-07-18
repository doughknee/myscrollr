/**
 * Desktop-local channel registry.
 *
 * Discovers channel FeedTab components at build time from this
 * directory. Each channel module exports a named `{id}DataWidgetRow`
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

/** Look up a channel by id. */
export const getDataWidget = get;

/** Get all registered channels in canonical order. */
export const getAllDataWidgets = getAll;

/** Canonical display order for channel tabs. */
export const CHANNEL_ORDER = ORDER;
