/**
 * Desktop-local channel registry.
 *
 * Discovers channel FeedTab components at build time from this
 * directory. Each channel module exports a named `{id}Channel`
 * conforming to ChannelManifest.
 */
import { createRegistry } from "../lib/createRegistry";
import type { ChannelManifest } from "../types";

const modules = import.meta.glob<Record<string, ChannelManifest>>("./*/FeedTab.tsx", {
  eager: true,
});

const { get, getAll, ORDER } = createRegistry<ChannelManifest>(
  modules,
  "Channel",
  ["finance", "sports", "fantasy", "rss", "predictions"],
);

/** Look up a channel by id. */
export const getChannel = get;

/** Get all registered channels in canonical order. */
export const getAllChannels = getAll;

/** Canonical display order for channel tabs. */
export const CHANNEL_ORDER = ORDER;
