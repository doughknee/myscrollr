/**
 * The GitHub widget's Connect GitHub header (SCROLLR-304), against mocked
 * core endpoints: not connected, connected, broken, and signed out.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellContext } from "../../shell-context";
import type { ShellState } from "../../shell-context";
import { loadPrefs } from "../../preferences";
import { githubWidget } from "./FeedTab";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  runs: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(() => Promise.reject(new Error("no tauri in tests"))),
}));
vi.mock("../../auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth")>()),
  isSignedOut: () => false,
}));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  githubApi: {
    status: api.status,
    runs: api.runs,
    connect: api.connect,
    disconnect: api.disconnect,
  },
}));

function mount(authenticated = true) {
  const base = loadPrefs();
  const prefs = {
    ...base,
    widgets: { ...base.widgets, github: { ...base.widgets.github, repos: [{ owner: "o", repo: "r" }] } },
  };
  const shell = { prefs, authenticated, onPrefsChange: vi.fn() } as unknown as ShellState;
  const FeedTab = githubWidget.FeedTab;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShellContext.Provider value={shell}>
        <FeedTab mode="comfort" feedContext={{}} />
      </ShellContext.Provider>
    </QueryClientProvider>,
  );
}

describe("GitHub widget: Connect GitHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.runs.mockResolvedValue({ connected: false, connect: true, runs: [{ repo: "o/r", available: true, status: "completed", conclusion: "success" }] });
  });

  it("not connected: Connect GitHub opens core's authorize URL in the browser", async () => {
    api.status.mockResolvedValue({ connected: false });
    api.connect.mockResolvedValue({ url: "https://github.com/login/oauth/authorize?client_id=x&state=y" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await waitFor(() =>
      expect(api.invoke).toHaveBeenCalledWith("open_external", {
        url: "https://github.com/login/oauth/authorize?client_id=x&state=y",
      }),
    );
    expect(await screen.findByText("Finish in your browser…")).toBeTruthy();
    // Public repos still render through core's fallback.
    expect(await screen.findByText("Passing")).toBeTruthy();
  });

  it("connected: shows the login and disconnects", async () => {
    api.status.mockResolvedValue({ connected: true, login: "octo", since: "2026-10-02T08:00:00Z" });
    api.disconnect.mockResolvedValue({ connected: false });
    mount();
    expect(await screen.findByText("Connected as @octo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalled());
  });

  it("broken: offers Reconnect GitHub with the reason", async () => {
    api.status.mockResolvedValue({ connected: false, login: "octo", reason: "GitHub stopped accepting Scrollr's access. Reconnect GitHub." });
    mount();
    expect(await screen.findByRole("button", { name: "Reconnect GitHub" })).toBeTruthy();
    expect(screen.getByText(/stopped accepting/)).toBeTruthy();
  });

  it("signed out: no Connect button, no status call", async () => {
    mount(false);
    await screen.findByText("o/r");
    expect(api.status).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Connect GitHub/ })).toBeNull();
  });
});
