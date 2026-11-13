/**
 * The main window's polls run for every ticker window, so they must keep
 * running while it is hidden (RC-3), and Uptime must be polled from the shell
 * under the page's own key (RC-2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

// One status-page fetch is two requests (page + heartbeats) through the Tauri HTTP plugin.
const h = vi.hoisted(() => ({ fetchKuma: vi.fn((_url: string) => new Promise<never>(() => {})) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: h.fetchKuma }));

vi.mock("../api/queries", () => ({
  dashboardQueryOptions: () => ({ queryKey: ["dashboard"], queryFn: async () => ({}) }),
  weatherQueryOptions: () => ({ queryKey: ["weather"], queryFn: async () => [] }),
}));
vi.mock("../widgets/github/types", () => ({
  githubBoardQuery: () => ({ queryKey: ["github-board"], queryFn: async () => ({}) }),
}));

import { useShellDashboard, useShellWidgetPolling } from "./useShellPolling";
import { uptimeQuery } from "../widgets/uptime/types";
import { loadPrefs } from "../preferences";

const URL = "https://status.example.com/status/main";

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

const observerOf = (client: QueryClient, key: unknown[]) =>
  client.getQueryCache().find({ queryKey: key })?.observers[0];

function prefsWith(enabled: string[], url = URL) {
  const p = loadPrefs();
  return { ...p, widgets: { ...p.widgets, enabledWidgets: enabled, uptime: { ...p.widgets.uptime, url } } };
}

describe("shell polling", () => {
  beforeEach(() => { h.fetchKuma.mockClear(); });

  it("keeps the dashboard poll running while the window is hidden", () => {
    const { client, wrapper } = setup();
    renderHook(() => useShellDashboard("free"), { wrapper });
    expect(observerOf(client, ["dashboard"])?.options.refetchIntervalInBackground).toBe(true);
  });

  it("keeps weather, GitHub and Uptime polling while the window is hidden", () => {
    const { client, wrapper } = setup();
    const prefs = prefsWith(["weather", "github", "uptime"]);
    renderHook(() => useShellWidgetPolling(prefs, true), { wrapper });
    for (const key of [["weather"], ["github-board"], uptimeQuery(URL).queryKey]) {
      expect(observerOf(client, key)?.options.refetchIntervalInBackground).toBe(true);
    }
  });

  it("polls Uptime only when the widget is on and a URL is set", async () => {
    const off = setup();
    renderHook(() => useShellWidgetPolling(prefsWith(["clock"]), true), { wrapper: off.wrapper });
    const noUrl = setup();
    renderHook(() => useShellWidgetPolling(prefsWith(["uptime"], ""), true), { wrapper: noUrl.wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.fetchKuma).not.toHaveBeenCalled();
  });

  it("shares one fetch with the Uptime page's observer", async () => {
    const { wrapper } = setup();
    renderHook(
      () => {
        useShellWidgetPolling(prefsWith(["uptime"]), true);
        useQuery(uptimeQuery(URL)); // the page's observer
      },
      { wrapper },
    );
    await waitFor(() => expect(h.fetchKuma).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.fetchKuma).toHaveBeenCalledTimes(2);
  });
});
