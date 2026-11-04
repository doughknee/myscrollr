import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardQueryOptions, queryKeys } from "./queries";
import { ApiError, authFetch, request } from "./client";
import { electionPreviewPath } from "../config";
import type { DashboardResponse } from "../types";
import type { ElectionResult } from "../types/api.generated";

vi.mock("./client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./client")>()),
  authFetch: vi.fn(),
  request: vi.fn(),
}));
vi.mock("../auth", () => ({ isAuthenticated: () => true, hasRefreshToken: () => true }));

const row = {
  id: 71,
  widget_type: "elections",
  enabled: true,
  ticker_enabled: true,
  config: { race_ids: [87476] },
  created_at: "",
  updated_at: "",
};
const race: ElectionResult = {
  id: 87476,
  name: "Tennessee Governor",
  state: "TN",
  election_date: "2026-11-03",
  source_updated_at: "2026-11-04T03:00:00Z",
  percent_reporting: 38,
  candidates: [],
  disputed: false,
  delayed: false,
};
let client: QueryClient;

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "1.8.0-beta.3");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.dashboard, {
    widgets: [row],
    data: { elections: [race] },
  } satisfies DashboardResponse);
});
afterEach(() => {
  client.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const refresh = () => client.fetchQuery({ ...dashboardQueryOptions(), staleTime: 0 });

describe("elections preview and dashboard recovery", () => {
  it("negotiates beta data while retaining pins and leaves the stable URL unchanged", () => {
    expect(electionPreviewPath("/dashboard?pins=x")).toBe("/dashboard?pins=x&preview=elections-national");
    vi.stubGlobal("__APP_VERSION__", "1.8.0");
    expect(electionPreviewPath("/catalog")).toBe("/catalog");
  });
  it("retains counts with original source time on a partial response", async () => {
    vi.mocked(authFetch).mockResolvedValue({ widgets: [row], data: {} });
    const dashboard = await refresh();
    expect(dashboard.data.elections).toEqual([{ ...race, delayed: true }]);
    expect(authFetch).toHaveBeenCalledWith("/dashboard?preview=elections-national");
  });
  it("clears a removed widget and never resurrects another account's count", async () => {
    vi.mocked(authFetch).mockResolvedValue({ widgets: [{ ...row, id: 73 }], data: {} });
    expect((await refresh()).data.elections).toBeUndefined();
    vi.mocked(authFetch).mockResolvedValue({ widgets: [], data: {} });
    expect((await refresh()).data.elections).toBeUndefined();
  });
  it("keeps a signed-in dashboard after a server outage", async () => {
    vi.mocked(authFetch).mockRejectedValue(new ApiError(503, "Temporarily unavailable"));
    await expect(refresh()).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
    expect(client.getQueryData<DashboardResponse>(queryKeys.dashboard)?.data.elections).toEqual([race]);
  });
});
