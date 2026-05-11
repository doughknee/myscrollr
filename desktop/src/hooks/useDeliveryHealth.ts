/**
 * useDeliveryHealth — derive a single, user-facing health state from
 * delivery mode + dashboard freshness + auth/tier.
 *
 * Why this exists:
 *   The shell already tracks `deliveryMode: "polling" | "sse"` and the
 *   dashboard query has a `dataUpdatedAt` timestamp, but neither alone
 *   tells the user whether the app is *actually* delivering data right
 *   now. The user cares about a single signal: "is what I'm looking at
 *   live, stale, or wrong?" This hook collapses the inputs into that
 *   one signal, plus a tier-aware "sse-active" highlight that gives
 *   Ultimate users visible feedback that they're getting the realtime
 *   stream they're paying for.
 *
 *   Pre-Phase-2, this signal was either invisible (no UI for normal
 *   operation) or too late (`ConnectionBanner` only fires for SSE
 *   outages on Ultimate tier). The new ConnectionIndicator + ticker
 *   edge strip both consume this hook so they always agree.
 *
 * State machine:
 *
 *     live      — `deliveryMode === "sse"` AND data fresh (<60s)
 *                 (Ultimate/super_user only — for them this is
 *                 "your premium realtime stream is working")
 *     polling   — data fresh (<60s) but on polling-only delivery
 *                 (the default for non-Ultimate tiers; not an error)
 *     stale     — last successful update was 60s–5min ago
 *                 (data is shown but visibly aging)
 *     offline   — last successful update was >5min ago OR no data yet
 *                 (assume something is broken; user should see it)
 *
 * Inputs are cheap to derive — the hook is safe to call anywhere.
 *
 * Note: we do NOT subscribe to a separate timer. The component
 * consuming this hook re-renders whenever its parent does (which
 * happens on dashboard updates and route changes). For surfaces that
 * need to TICK with time (e.g. "30s ago" → "31s ago"), the consumer
 * should set its own interval and call this hook with the resulting
 * "now". The hook accepts an optional `now` parameter for testing
 * and explicit re-derivation.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions } from "../api/queries";
import type { DeliveryMode } from "../types";
import type { SubscriptionTier } from "../auth";

export type DeliveryHealthState = "live" | "polling" | "stale" | "offline";

/** Tiers that are *expected* to receive SSE — only these can show "live". */
const SSE_TIERS = new Set<SubscriptionTier>(["uplink_ultimate", "super_user"]);

/** Data older than this is "stale" (yellow). */
const STALE_THRESHOLD_MS = 60_000;

/** Data older than this is "offline" (red). */
const OFFLINE_THRESHOLD_MS = 5 * 60_000;

export interface DeliveryHealth {
  /** Coarse state used to drive color and label. */
  state: DeliveryHealthState;
  /** Whether the user's tier benefits from SSE (drives the gradient ring). */
  sseEligible: boolean;
  /** ms since last successful dashboard fetch, or null if no fetch yet. */
  ageMs: number | null;
  /** Convenience: human-readable "X ago" or "live" / "offline". */
  label: string;
  /** Detailed tooltip copy describing the current state. */
  description: string;
}

interface UseDeliveryHealthArgs {
  deliveryMode: DeliveryMode;
  tier: SubscriptionTier;
  /**
   * Override "now" for derivation — used by tests. Defaults to the
   * current time at render. The hook does NOT recompute on a timer,
   * so consumers that want ticking labels should pass a stateful now.
   */
  now?: number;
}

export function useDeliveryHealth({
  deliveryMode,
  tier,
  now,
}: UseDeliveryHealthArgs): DeliveryHealth {
  // Read-only subscription to the existing dashboard query so we can
  // pull `dataUpdatedAt` without triggering a fetch. `enabled: false`
  // would make the query inert; instead we just don't override
  // anything — the shell already manages this query's lifecycle.
  const dashboardQuery = useQuery({
    ...dashboardQueryOptions(),
    notifyOnChangeProps: ["dataUpdatedAt"],
  });

  return useMemo(() => {
    const sseEligible = SSE_TIERS.has(tier);
    const lastUpdate = dashboardQuery.dataUpdatedAt || 0;
    const t = now ?? Date.now();
    const ageMs = lastUpdate > 0 ? t - lastUpdate : null;

    // Choose the state. Order matters: offline beats stale beats fresh.
    let state: DeliveryHealthState;
    if (ageMs === null || ageMs > OFFLINE_THRESHOLD_MS) {
      state = "offline";
    } else if (ageMs > STALE_THRESHOLD_MS) {
      state = "stale";
    } else if (deliveryMode === "sse" && sseEligible) {
      state = "live";
    } else {
      state = "polling";
    }

    const label = labelFor(state, ageMs);
    const description = descriptionFor(state, sseEligible, ageMs);

    return { state, sseEligible, ageMs, label, description };
  }, [deliveryMode, tier, dashboardQuery.dataUpdatedAt, now]);
}

function labelFor(state: DeliveryHealthState, ageMs: number | null): string {
  switch (state) {
    case "live":
      return "Live";
    case "polling":
      return "Polling";
    case "stale":
      return ageMs ? `${formatAge(ageMs)} ago` : "Stale";
    case "offline":
      return "Offline";
  }
}

function descriptionFor(
  state: DeliveryHealthState,
  sseEligible: boolean,
  ageMs: number | null,
): string {
  switch (state) {
    case "live":
      return "Connected to the realtime stream — updates as soon as they happen.";
    case "polling":
      return sseEligible
        ? "Realtime stream is reconnecting. Polling every minute meanwhile."
        : "Polling every minute. Upgrade to Uplink Ultimate for realtime SSE updates.";
    case "stale": {
      const ago = ageMs ? formatAge(ageMs) : "a while";
      return `No update in ${ago}. Data on screen may be slightly behind.`;
    }
    case "offline":
      return "No connection to Scrollr. Check your network — data shown is from the last successful fetch.";
  }
}

/**
 * Render an age in milliseconds as a short human label. Caps out at
 * minutes; longer than that and the state machine has already flipped
 * to "offline" so we don't surface anything more verbose than "5 min".
 */
function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  return `${min} min`;
}
