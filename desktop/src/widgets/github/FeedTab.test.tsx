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
  repos: vi.fn(),
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
    repos: api.repos,
    connect: api.connect,
    disconnect: api.disconnect,
  },
}));

function mount(authenticated = true, repos = [{ owner: "o", repo: "r" }]) {
  const base = loadPrefs();
  const prefs = {
    ...base,
    widgets: { ...base.widgets, github: { ...base.widgets.github, repos } },
  };
  const shell = { prefs, authenticated, onPrefsChange: vi.fn() } as unknown as ShellState;
  const FeedTab = githubWidget.FeedTab;
  return { shell, ...render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShellContext.Provider value={shell}>
        <FeedTab mode="comfort" feedContext={{}} />
      </ShellContext.Provider>
    </QueryClientProvider>,
  ) };
}

/** The repos the last prefs write configured. */
function lastWrite(shell: ShellState) {
  const calls = vi.mocked(shell.onPrefsChange).mock.calls;
  return calls[calls.length - 1]?.[0].widgets.github.repos;
}

describe("GitHub widget: Your repos (SCROLLR-307)", () => {
  const yours = {
    connected: true,
    login: "octo",
    repos: [
      { full_name: "octo/app", private: true, active: true, last_run_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { full_name: "octo/site", private: false, active: true },
      { full_name: "octo/dusty", private: false, active: false, pushed_at: "2025-01-01T00:00:00Z" },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.runs.mockResolvedValue({ connected: true, runs: [] });
    api.repos.mockResolvedValue(yours);
  });

  it("first load with no repos: ticks the active ones", async () => {
    api.status.mockResolvedValue({ connected: true, login: "octo" });
    const { shell } = mount(true, []);
    await waitFor(() =>
      expect(lastWrite(shell)).toEqual([
        { owner: "octo", repo: "app" },
        { owner: "octo", repo: "site" },
      ]),
    );
  });

  it("existing list: adds nothing; unticking writes the list without it", async () => {
    api.status.mockResolvedValue({ connected: true, login: "octo" });
    const { shell } = mount(true, [{ owner: "octo", repo: "app" }, { owner: "o", repo: "r" }]);
    const app = await screen.findByRole("checkbox", { name: /octo\/app/ });
    expect(shell.onPrefsChange).not.toHaveBeenCalled();
    expect(app).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /octo\/site/ })).not.toBeChecked();
    expect(screen.getByText("last run 2d ago")).toBeTruthy();
    expect(screen.getByLabelText("Private")).toBeTruthy();

    fireEvent.click(app);
    expect(lastWrite(shell)).toEqual([{ owner: "o", repo: "r" }]);
    fireEvent.click(screen.getByRole("checkbox", { name: /octo\/site/ }));
    expect(lastWrite(shell)).toEqual([
      { owner: "octo", repo: "app" },
      { owner: "o", repo: "r" },
      { owner: "octo", repo: "site" },
    ]);
  });

  it("inactive repos stay collapsed until Show all", async () => {
    api.status.mockResolvedValue({ connected: true, login: "octo" });
    mount(true, [{ owner: "o", repo: "r" }]);
    await screen.findByRole("checkbox", { name: /octo\/app/ });
    expect(screen.queryByRole("checkbox", { name: /octo\/dusty/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (1 more)" }));
    expect(screen.getByRole("checkbox", { name: /octo\/dusty/ })).toBeTruthy();
  });

  it("not connected: no picker, no repos call", async () => {
    api.status.mockResolvedValue({ connected: false });
    mount();
    await screen.findByRole("button", { name: "Connect GitHub" });
    expect(api.repos).not.toHaveBeenCalled();
    expect(screen.queryByText("Your repos")).toBeNull();
  });
});

describe("GitHub widget: Connect GitHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.runs.mockResolvedValue({ connected: false, connect: true, runs: [{ repo: "o/r", available: true, status: "completed", conclusion: "success" }] });
    api.repos.mockResolvedValue({ connected: true, repos: [] });
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

describe("GitHub widget: what goes on the bar (SCROLLR-309)", () => {
  const lastBar = (shell: ShellState) => {
    const calls = vi.mocked(shell.onPrefsChange).mock.calls;
    return calls[calls.length - 1]?.[0].widgets.github.bar;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api.runs.mockResolvedValue({ connected: true, runs: [] });
    api.repos.mockResolvedValue({ connected: true, login: "octo", repos: [{ full_name: "o/r", private: false, active: true }] });
    api.status.mockResolvedValue({ connected: true, login: "octo" });
  });

  it("the switches start at their defaults and write the widget's prefs", async () => {
    const { shell } = mount();
    const on = ["Failing CI on main", "Review requests to me", "Changes requested on my PRs", "My PRs with failing checks", "Flash when something changes"];
    const off = ["Runs on my branches (the pulse)", "My other open PRs on the page", "Quiet hours"];
    for (const name of on) expect(await screen.findByRole("checkbox", { name })).toBeChecked();
    for (const name of off) expect(screen.getByRole("checkbox", { name })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "My other open PRs on the page" }));
    expect(lastBar(shell)).toMatchObject({ otherPRs: true, reviews: true, pulse: false });
    fireEvent.click(screen.getByRole("checkbox", { name: "Review requests to me" }));
    expect(lastBar(shell)).toMatchObject({ reviews: false });
  });

  it("quiet hours: turning it on keeps the default times", async () => {
    const { shell } = mount();
    expect(screen.queryByLabelText("Quiet from")).toBeNull();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Quiet hours" }));
    expect(lastBar(shell)).toMatchObject({ quiet: true, quietFrom: "22:00", quietTo: "08:00" });
  });

  it("quiet hours stored: two time fields show the times and edit them", async () => {
    const base = loadPrefs();
    const prefs = { ...base, widgets: { ...base.widgets, github: { repos: [{ owner: "o", repo: "r" }], bar: { quiet: true, quietFrom: "23:00", quietTo: "07:00" } } } };
    const shell = { prefs, authenticated: true, onPrefsChange: vi.fn() } as unknown as ShellState;
    const FeedTab = githubWidget.FeedTab;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ShellContext.Provider value={shell}>
          <FeedTab mode="comfort" feedContext={{}} />
        </ShellContext.Provider>
      </QueryClientProvider>,
    );
    const from = (await screen.findByLabelText("Quiet from")) as HTMLInputElement;
    expect(from.value).toBe("23:00");
    expect((screen.getByLabelText("Quiet until") as HTMLInputElement).value).toBe("07:00");
    fireEvent.change(from, { target: { value: "21:30" } });
    expect(lastBar(shell)).toMatchObject({ quiet: true, quietFrom: "21:30", quietTo: "07:00" });
  });

  it("Choose repos on GitHub opens the app's install page; the list re-reads when the window regains focus", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Choose repos on GitHub" }));
    expect(api.invoke).toHaveBeenCalledWith("open_external", { url: "https://github.com/apps/scrollr-desktop/installations/new" });
    const calls = api.repos.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(api.repos.mock.calls.length).toBeGreaterThan(calls));
  });

  it("a connected account whose install sees no repos still gets the link", async () => {
    api.repos.mockResolvedValue({ connected: true, login: "octo", repos: [] });
    mount(true, []);
    expect(await screen.findByRole("button", { name: "Choose repos on GitHub" })).toBeTruthy();
  });
});
