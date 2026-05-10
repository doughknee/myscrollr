/**
 * Unified CDC merge engine — processes all SSE CDC events and merges
 * them directly into the TanStack Query dashboard cache.
 *
 * Called from both the ticker window (App.tsx) and the main window
 * (__root.tsx) so both QueryClients stay current with identical logic.
 *
 * In polling mode (non-Ultimate tiers) the SSE connection never starts,
 * so this hook registers its listener but never fires — zero overhead.
 *
 * In SSE mode (Ultimate tier) CDC events arrive via the Tauri event
 * bus and are merged in-place, giving instant UI updates without
 * waiting for the next polling cycle.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTauriListener } from "./useTauriListener";
import { queryKeys } from "../api/queries";
import { CDC_TABLES, SSE_REFETCH_DELAY_MS } from "../cdc";
import type { CDCTableConfig } from "../cdc";
import type { DashboardResponse } from "../types";

// ── SSE Payload Types ────────────────────────────────────────────

interface CDCRecord {
  action: "insert" | "update" | "delete";
  record: Record<string, unknown>;
  changes: Record<string, unknown>;
  metadata: { table_name: string };
}

interface SSEPayload {
  data?: CDCRecord[];
}

// ── Merge helpers ────────────────────────────────────────────────

/** Apply CDC records for a single table config into the data slice.
 *
 * Exported so `useDashboardCDC.test.ts` can exercise this pure function
 * directly. Not part of the public API — callers outside the hook and
 * its test should keep using the hook. */
export function mergeTableRecords(
  items: unknown[],
  records: CDCRecord[],
  config: CDCTableConfig,
): unknown[] {
  let next = [...items];

  for (const cdc of records) {
    const record = cdc.record as unknown;

    if (cdc.action === "delete") {
      const key = config.keyOf(record);
      next = next.filter((item) => config.keyOf(item) !== key);
    } else {
      // insert or update — validate first
      if (config.validate && !config.validate(cdc.record)) continue;

      const key = config.keyOf(record);
      const idx = next.findIndex((item) => config.keyOf(item) === key);
      if (idx >= 0) {
        next[idx] = record;
      } else if (config.allowInsert !== false) {
        next.push(record);
        if (next.length > config.maxItems) next.shift();
      }
    }
  }

  if (config.sort) {
    next.sort(config.sort);
  }

  return next;
}

/** Apply CDC records for user_channels into the channels array. */
function mergeChannelRecords(
  channels: DashboardResponse["channels"],
  records: CDCRecord[],
): NonNullable<DashboardResponse["channels"]> {
  const updated = [...(channels ?? [])];

  for (const cdc of records) {
    const type = cdc.record.channel_type as string | undefined;
    if (!type) continue;

    const idx = updated.findIndex((ch) => ch.channel_type === type);

    if (cdc.action === "delete") {
      if (idx !== -1) updated.splice(idx, 1);
    } else if (idx !== -1) {
      // CDC payload comes straight from Postgres replication, so the
      // raw column name is still `visible` (the DB column wasn't
      // renamed). The Channel type's canonical field is now
      // `ticker_enabled` — map between them here.
      updated[idx] = {
        ...updated[idx],
        enabled: cdc.record.enabled as boolean,
        ticker_enabled: cdc.record.visible as boolean,
      };
    }
  }

  return updated;
}

// Fantasy tables whose CDC events should trigger a fast dashboard
// re-fetch. Unlike the flat-array tables we merge inline (finance,
// sports, rss), fantasy data arrives as a nested bundle, so the
// simplest correctness story is "invalidate and let the backend's
// freshly-cleared Redis cache serve the new bundle."
const FANTASY_CDC_TABLES = new Set([
  "yahoo_leagues",
  "yahoo_standings",
  "yahoo_matchups",
  "yahoo_rosters",
]);

const FANTASY_REFETCH_DELAY_MS = 250;

// ── Hook ─────────────────────────────────────────────────────────

/**
 * Listens for `sse-event` Tauri events and merges CDC records into
 * the dashboard QueryClient cache. Call once per window.
 */
export function useDashboardCDC(): void {
  const queryClient = useQueryClient();

  // Debounce state for the safety-net and fantasy refetches. Production
  // SSE throughput can hit ~47 events/sec; without coalescing, every
  // event scheduled its own `setTimeout(invalidate, 500)` and we'd queue
  // ~24 simultaneous refetch timers per burst. Trailing-edge debounce
  // collapses a burst into one refetch fired after the storm settles.
  const pendingSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFantasyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingSafetyRef.current) clearTimeout(pendingSafetyRef.current);
      if (pendingFantasyRef.current) clearTimeout(pendingFantasyRef.current);
    };
  }, []);

  useTauriListener<SSEPayload>(
    "sse-event",
    (event) => {
      const records = event.payload?.data;
      if (!Array.isArray(records) || records.length === 0) return;

      // ── Merge into dashboard cache ──────────────────────────
      queryClient.setQueryData<DashboardResponse>(
        queryKeys.dashboard,
        (old) => {
          if (!old) return old;

          let dataChanged = false;
          let nextData = old.data;
          let nextChannels = old.channels;

          // 1. Channel data tables (trades, games, rss_items)
          for (const config of CDC_TABLES) {
            const relevant = records.filter(
              (r) => r.metadata?.table_name === config.table,
            );
            if (relevant.length === 0) continue;

            const current =
              (nextData?.[config.dataKey] as unknown[] | undefined) ?? [];
            const merged = mergeTableRecords(current, relevant, config);

            nextData = { ...nextData, [config.dataKey]: merged };
            dataChanged = true;
          }

          // 2. user_channels table
          const channelRecords = records.filter(
            (r) => r.metadata?.table_name === "user_channels",
          );
          if (channelRecords.length > 0 && nextChannels) {
            nextChannels = mergeChannelRecords(nextChannels, channelRecords);
            dataChanged = true;
          }

          if (!dataChanged) return old;

          return {
            ...old,
            data: nextData,
            channels: nextChannels,
          };
        },
      );

      // ── Fantasy fast-path ───────────────────────────────────
      // If any yahoo_* records arrived we skip the long SSE delay
      // and re-fetch quickly so live scores update in <1s.
      const fantasyTouched = records.some(
        (r) => r.metadata?.table_name && FANTASY_CDC_TABLES.has(r.metadata.table_name),
      );
      if (fantasyTouched) {
        if (pendingFantasyRef.current) clearTimeout(pendingFantasyRef.current);
        pendingFantasyRef.current = setTimeout(() => {
          pendingFantasyRef.current = null;
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        }, FANTASY_REFETCH_DELAY_MS);
        return;
      }

      // ── Safety-net refetch ──────────────────────────────────
      // A full dashboard re-fetch after a short delay ensures the
      // optimistic cache stays consistent with the server. Trailing-edge
      // debounced so a burst of CDC events produces one refetch, not
      // one-per-event.
      if (pendingSafetyRef.current) clearTimeout(pendingSafetyRef.current);
      pendingSafetyRef.current = setTimeout(() => {
        pendingSafetyRef.current = null;
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      }, SSE_REFETCH_DELAY_MS);
    },
    [queryClient],
  );
}
