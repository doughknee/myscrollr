/**
 * One request per SSE burst (SCROLLR-463, PF-2). Every window merges CDC
 * records into its own cache, but only the main window runs the safety-net
 * refetch: it is the single poller and broadcasts through the store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({
  label: "main",
  handler: null as null | ((e: { payload: unknown }) => void),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: h.label }) }));
vi.mock("./useTauriListener", () => ({
  useTauriListener: (_event: string, handler: (e: { payload: unknown }) => void) => {
    h.handler = handler;
  },
}));

import { useDashboardCDC } from "./useDashboardCDC";
import { queryKeys } from "../api/queries";
import { SSE_REFETCH_DELAY_MS } from "../cdc";

const burst = {
  payload: {
    data: [
      { action: "update", record: { symbol: "AAPL", price: 201 }, changes: {}, metadata: { table_name: "trades" } },
      { action: "update", record: { symbol: "AAPL", price: 202 }, changes: {}, metadata: { table_name: "trades" } },
    ],
  },
};

describe("dashboard safety-net refetch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("two ticker windows and the main window make one request per burst, and all three merge", async () => {
    let requests = 0;
    const merged: unknown[] = [];
    for (const label of ["ticker", "ticker-2", "main"]) {
      h.label = label;
      const qc = new QueryClient();
      qc.setQueryData(queryKeys.dashboard, { data: { finance: [{ symbol: "AAPL", price: 200 }] } });
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
      renderHook(
        () => {
          useDashboardCDC();
          // The observer every window holds (App.tsx / __root.tsx): what makes an invalidation refetch.
          useQuery({
            queryKey: queryKeys.dashboard,
            queryFn: async () => {
              requests++;
              return { data: { finance: [] } };
            },
            staleTime: Infinity,
          });
        },
        { wrapper },
      );
      await act(async () => {
        h.handler!(burst);
        await vi.advanceTimersByTimeAsync(SSE_REFETCH_DELAY_MS + 50);
      });
      merged.push((qc.getQueryData(queryKeys.dashboard) as { data: { finance: { price: number }[] } }).data.finance[0]?.price);
    }
    expect(requests).toBe(1);
    // The ticker windows keep the locally merged value (the main window's refetch replaces its own).
    expect(merged.slice(0, 2)).toEqual([202, 202]);
  });
});
