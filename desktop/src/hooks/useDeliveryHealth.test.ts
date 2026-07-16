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

  it("returns live with fresh sse data", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 10_000,
      deliveryMode: "sse",
    });
    expect(result.current.state).toBe("live");
    expect(result.current.label).toBe("Live");
  });

  // Regression guard for REL-27: this hook used to gate "live" behind
  // SSE_TIERS (ultimate/super_user), so a Free user on a working
  // stream rendered "Polling". Real-time is universal — tier is not an
  // input to delivery health at all.
  it("returns live on sse regardless of tier", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 10_000,
      deliveryMode: "sse",
    });
    expect(result.current.state).toBe("live");
  });

  it("returns polling on polling delivery (stream reconnecting)", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 5_000,
      deliveryMode: "polling",
    });
    expect(result.current.state).toBe("polling");
  });

  it("never upsells a tier in the polling description", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 5_000,
      deliveryMode: "polling",
    });
    expect(result.current.description).not.toMatch(/upgrade|ultimate/i);
    expect(result.current.description).toMatch(/reconnect/i);
  });
});

describe("useDeliveryHealth — boundaries", () => {
  const NOW = 1_700_000_000_000;

  it("treats data exactly at 60s as live (boundary inclusive)", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 60_000,
      deliveryMode: "sse",
    });
    // 60_000ms exactly is NOT > STALE_THRESHOLD (60_000), so still fresh.
    expect(result.current.state).toBe("live");
  });

  it("flips to stale just past 60s", () => {
    const { result } = setupHook({
      now: NOW,
      dataUpdatedAt: NOW - 60_001,
      deliveryMode: "sse",
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
    });
    expect(result.current.description).toMatch(/realtime/i);
  });

  // The old "nudges non-ultimate polling users toward upgrade" test
  // lived here. It asserted copy that became false when real-time went
  // universal (REL-27) — polling is now a reconnect state, not a plan
  // limit. The state-machine block asserts the replacement copy.

  it("describes the offline state as a connection problem", () => {
    const { result } = setupHook({});
    expect(result.current.description.toLowerCase()).toMatch(/no connection|network/);
  });
});
