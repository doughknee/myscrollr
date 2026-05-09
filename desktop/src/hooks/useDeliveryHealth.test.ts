/**
 * useDeliveryHealth tests — derivation invariants for the connection
 * health signal that drives both the main-window ConnectionIndicator
 * and the ticker-window edge strip.
 *
 * Critical contracts:
 *   - State machine transitions at the right thresholds (60s / 5min).
 *   - SSE eligibility is gated to ultimate/super_user — a free-tier
 *     user with deliveryMode="sse" still reads as "polling" because
 *     they shouldn't ever be "live".
 *   - Stale label exposes a human-readable age.
 *   - Description copy matches state.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useDeliveryHealth } from "./useDeliveryHealth";
import type { SubscriptionTier } from "../auth";

// Build a wrapper that seeds the dashboard query cache with a known
// `dataUpdatedAt` so we don't have to fire actual fetches.
function buildHarness(opts: {
  dataUpdatedAt?: number;
  hasData?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
    },
  });

  if (opts.hasData ?? opts.dataUpdatedAt !== undefined) {
    // Pre-populate the dashboard query with a fixture so the hook's
    // `useQuery` reads `dataUpdatedAt` without firing network. The
    // queryKey here MUST match `dashboardQueryOptions().queryKey`.
    client.setQueryData(
      ["dashboard"],
      { channels: [], data: {} },
      { updatedAt: opts.dataUpdatedAt ?? Date.now() },
    );
  }

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client, children });

  return { client, wrapper };
}

function setupHook(args: {
  deliveryMode?: "polling" | "sse";
  tier?: SubscriptionTier;
  now?: number;
  dataUpdatedAt?: number;
  hasData?: boolean;
}) {
  const { wrapper } = buildHarness({
    dataUpdatedAt: args.dataUpdatedAt,
    hasData: args.hasData,
  });
  return renderHook(
    () =>
      useDeliveryHealth({
        deliveryMode: args.deliveryMode ?? "polling",
        tier: args.tier ?? "free",
        now: args.now,
      }),
    { wrapper },
  );
}

describe("useDeliveryHealth — state machine", () => {
  const NOW = 1_700_000_000_000;

  it("returns offline when no data has ever loaded", () => {
    const { result } = setupHook({ now: NOW });
    expect(result.current.state).toBe("offline");
    expect(result.current.ageMs).toBeNull();
  });

  it("returns offline when last update was >5 minutes ago", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 6 * 60_000,
    });
    expect(result.current.state).toBe("offline");
  });

  it("returns stale between 60s and 5 minutes", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 90_000, // 90s ago
    });
    expect(result.current.state).toBe("stale");
    expect(result.current.label).toMatch(/ago/);
  });

  it("returns live for ultimate users with fresh sse data", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 10_000,
      deliveryMode: "sse",
      tier: "uplink_ultimate",
    });
    expect(result.current.state).toBe("live");
    expect(result.current.sseEligible).toBe(true);
    expect(result.current.label).toBe("Live");
  });

  it("returns polling for non-ultimate users even with sse mode", () => {
    // Defensive: shouldn't happen in practice (SSE isn't started for
    // lower tiers), but if backend or a bug puts a Free user in
    // deliveryMode='sse', we still surface 'polling' because they're
    // not eligible for the live label.
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 10_000,
      deliveryMode: "sse",
      tier: "free",
    });
    expect(result.current.state).toBe("polling");
    expect(result.current.sseEligible).toBe(false);
  });

  it("returns polling for ultimate users on polling delivery", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 5_000,
      deliveryMode: "polling",
      tier: "uplink_ultimate",
    });
    expect(result.current.state).toBe("polling");
    expect(result.current.sseEligible).toBe(true);
  });
});

describe("useDeliveryHealth — boundaries", () => {
  const NOW = 1_700_000_000_000;

  it("treats data exactly at 60s as live (boundary inclusive)", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 60_000,
      deliveryMode: "sse",
      tier: "uplink_ultimate",
    });
    // 60_000ms exactly is NOT > STALE_THRESHOLD (60_000), so still fresh.
    expect(result.current.state).toBe("live");
  });

  it("flips to stale just past 60s", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 60_001,
      deliveryMode: "sse",
      tier: "uplink_ultimate",
    });
    expect(result.current.state).toBe("stale");
  });

  it("flips to offline just past 5 minutes", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 5 * 60_000 - 1,
    });
    expect(result.current.state).toBe("offline");
  });
});

describe("useDeliveryHealth — descriptions", () => {
  it("includes 'realtime' in the live description", () => {
    const { result } = setupHook({
      now: 1_700_000_000_000,
      dataUpdatedAt: 1_700_000_000_000 - 1_000,
      deliveryMode: "sse",
      tier: "uplink_ultimate",
    });
    expect(result.current.description).toMatch(/realtime/i);
  });

  it("nudges non-ultimate polling users toward upgrade", () => {
    const { result } = setupHook({
      now: 1_700_000_000_000,
      dataUpdatedAt: 1_700_000_000_000 - 1_000,
      deliveryMode: "polling",
      tier: "free",
    });
    expect(result.current.description.toLowerCase()).toContain("upgrade");
  });

  it("describes the offline state as a connection problem", () => {
    const { result } = setupHook({});
    expect(result.current.description.toLowerCase()).toMatch(/no connection|network/);
  });
});
