/**
 * The GitHub widget's page (SCROLLR-312, canvas board T3) against mocked
 * core endpoints: the Connect state, the two panes, the live preview, the
 * workflows checklist, the PR and issue modes, the picker.
 */
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellContext } from "../../shell-context";
import type { ShellState } from "../../shell-context";
import { loadPrefs } from "../../preferences";
import type { AppPreferences } from "../../preferences";
import type { GitHubTrackedRepo } from "./config";
import { githubWidget } from "./FeedTab";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  runs: vi.fn(),
  repos: vi.fn(),
  board: vi.fn(),
  workflows: vi.fn(),
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
    board: api.board,
    workflows: api.workflows,
    connect: api.connect,
    disconnect: api.disconnect,
  },
}));

const INSTALL_URL = "https://github.com/apps/scrollr-desktop/installations/new";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** Core's board for whatever the page asks: a red deploy, green tests, PRs and issues as the modes say. */
function boardFor(repos: Array<{ repo: string; workflows?: string[]; prs: string; issues: string }>) {
  return {
    connected: true,
    login: "octo",
    repos: repos.map((r) => ({
      repo: r.repo,
      available: true,
      workflows: (r.workflows ?? ["test", "deploy"]).map((name) => ({ name, state: name === "deploy" ? "failing" : "passing", at: ago(12) })),
      checks: [],
      ...(r.prs === "off" ? {} : { prs: r.prs === "all" ? { count: 5, needs_you: 2, items: [] } : { count: 2, needs_you: 2, items: [] } }),
      ...(r.issues === "off" ? {} : { issues: r.issues === "assigned" ? { count: 0, items: [], error: "permission" } : { count: 3, items: [] } }),
    })),
  };
}

/** The page with prefs that really change (onPrefsChange is spied). */
function mount(repos: GitHubTrackedRepo[] = [{ repo: "octo/app", prs: "mine", issues: "off" }], authenticated = true) {
  const base = loadPrefs();
  const spy = vi.fn();
  let latest: AppPreferences = { ...base, widgets: { ...base.widgets, github: { ...base.widgets.github, repos } } };
  function Harness() {
    const [prefs, setPrefs] = useState(latest);
    const shell = {
      prefs,
      authenticated,
      onPrefsChange: (p: AppPreferences) => {
        latest = p;
        spy(p);
        setPrefs(p);
      },
    } as unknown as ShellState;
    const FeedTab = githubWidget.FeedTab;
    return (
      <ShellContext.Provider value={shell}>
        <FeedTab mode="comfort" feedContext={{}} />
      </ShellContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {/* The app's shell: OverflowMenu portals its menu into it. */}
      <div id="app-shell">
        <Harness />
      </div>
    </QueryClientProvider>,
  );
  return { spy, github: () => latest.widgets.github };
}

const preview = () => screen.getByText("On the bar it looks like").parentElement!.querySelector<HTMLElement>("[data-part=preview]")!;
const pillTexts = () => [...preview().querySelectorAll("[data-part=pill]")].map((p) => p.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({ connected: true, login: "octo" });
  api.repos.mockResolvedValue({
    connected: true,
    login: "octo",
    repos: [
      { full_name: "octo/app", private: true, active: true, last_run_at: ago(2 * 1440) },
      { full_name: "octo/site", private: false, active: true },
      { full_name: "octo/dusty", private: false, active: false, pushed_at: "2025-01-01T00:00:00Z" },
    ],
  });
  api.board.mockImplementation(async (repos) => boardFor(repos));
  api.workflows.mockResolvedValue({
    connected: true,
    available: true,
    workflows: [
      { name: "test", path: ".github/workflows/test.yml", last: "passing", ran_recently: true },
      { name: "deploy", path: ".github/workflows/deploy.yml", last: "failing", ran_recently: true },
      { name: "lint", path: ".github/workflows/lint.yml", last: "passing", ran_recently: false },
    ],
  });
});

describe("not connected: the Connect state and nothing else", () => {
  it("Connect GitHub opens core's install URL; no panes, no repos call", async () => {
    api.status.mockResolvedValue({ connected: false });
    api.connect.mockResolvedValue({ url: "https://github.com/apps/scrollr-desktop/installations/new?state=y" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Connect GitHub" }));
    await waitFor(() => expect(api.invoke).toHaveBeenCalledWith("open_external", { url: "https://github.com/apps/scrollr-desktop/installations/new?state=y" }));
    expect(await screen.findByText("Finish in your browser…")).toBeTruthy();
    expect(screen.queryByText("On your bar")).toBeNull();
    expect(api.repos).not.toHaveBeenCalled();
    expect(api.board).not.toHaveBeenCalled();
  });

  it("broken: Reconnect GitHub with the reason", async () => {
    api.status.mockResolvedValue({ connected: false, login: "octo", reason: "GitHub stopped accepting Scrollr's access. Reconnect GitHub." });
    mount();
    expect(await screen.findByRole("button", { name: "Reconnect GitHub" })).toBeTruthy();
    expect(screen.getByText(/stopped accepting/)).toBeTruthy();
  });

  it("signed out: asks to sign in, no status call", () => {
    mount(undefined, false);
    expect(screen.getByText(/Sign in to Scrollr/)).toBeTruthy();
    expect(api.status).not.toHaveBeenCalled();
  });
});

describe("connected: two panes", () => {
  it("left: the account, the repos on your bar, the rule; right: the first repo and its live cell", async () => {
    mount([
      { repo: "octo/app", prs: "mine", issues: "off" },
      { repo: "relentnet/infra", prs: "off", issues: "off" },
    ]);
    expect(await screen.findByText("@octo")).toBeTruthy();
    const list = screen.getByRole("list", { name: "On your bar" });
    await waitFor(() => expect(within(list).getAllByRole("listitem").map((b) => b.textContent)).toEqual(["app3", "infra2"]));
    expect(screen.getByText(/1–2 repos ride the edge in one rotating slot/)).toBeTruthy();
    expect(screen.getByText("octo", { selector: "span.font-mono" })).toBeTruthy();
    await waitFor(() => expect(pillTexts()).toEqual(["✗ deploy · 12m", "2 PRs for you", "✓ test"]));

    fireEvent.click(within(list).getAllByRole("listitem")[1]);
    expect(await screen.findByText("relentnet")).toBeTruthy();
    await waitFor(() => expect(pillTexts()).toEqual(["✗ deploy · 12m", "✓ test"]));
  });

  it("the PR and issue modes write the repo's config, and the preview follows", async () => {
    const { github } = mount();
    await waitFor(() => expect(pillTexts()).toContain("2 PRs for you"));
    fireEvent.click(screen.getByRole("radio", { name: "All open" }));
    expect(github().repos[0]).toMatchObject({ repo: "octo/app", prs: "all", issues: "off" });
    await waitFor(() => expect(pillTexts()).toContain("5 open PRs"));
    expect(api.board).toHaveBeenLastCalledWith([{ repo: "octo/app", workflows: undefined, prs: "all", issues: "off" }]);

    fireEvent.click(screen.getByRole("radio", { name: "Every new issue" }));
    await waitFor(() => expect(pillTexts()).toContain("3 new issues"));
  });

  it("Issues assigned before the permission is approved: Approve on GitHub opens the install page", async () => {
    mount([{ repo: "octo/app", prs: "mine", issues: "assigned" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Approve on GitHub ↗" }));
    expect(api.invoke).toHaveBeenCalledWith("open_external", { url: INSTALL_URL });
  });

  it("workflows: the recent ones start ticked; a tick writes the list, in the repo's order", async () => {
    const { github } = mount();
    const lint = await screen.findByRole("checkbox", { name: /lint/ });
    expect(screen.getByRole("checkbox", { name: /test/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /deploy/ })).toBeChecked();
    expect(lint).not.toBeChecked();
    expect(github().repos[0]).not.toHaveProperty("workflows");
    fireEvent.click(lint);
    expect(github().repos[0].workflows).toEqual(["test", "deploy", "lint"]);
    fireEvent.click(screen.getByRole("checkbox", { name: /deploy/ }));
    expect(github().repos[0].workflows).toEqual(["test", "lint"]);
    await waitFor(() => expect(pillTexts()).toEqual(["2 PRs for you", "✓ test", "✓ lint"]));
  });

  it("Remove from bar takes the repo off the list", async () => {
    const { github } = mount([
      { repo: "octo/app", prs: "mine", issues: "off" },
      { repo: "octo/site", prs: "mine", issues: "off" },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Remove from bar/ }));
    expect(github().repos.map((r) => r.repo)).toEqual(["octo/site"]);
  });
});

describe("+ Add a repo", () => {
  it("first load with nothing tracked: the active repos, with the defaults", async () => {
    const { github } = mount([]);
    await waitFor(() =>
      expect(github().repos).toEqual([
        { repo: "octo/app", prs: "mine", issues: "off" },
        { repo: "octo/site", prs: "mine", issues: "off" },
      ]),
    );
  });

  it("the picker: tick to add with the defaults, untick to remove; inactive ones behind Show all", async () => {
    const { github, spy } = mount([{ repo: "octo/app", prs: "all", issues: "new" }]);
    fireEvent.click(await screen.findByRole("button", { name: /Add a repo/ }));
    const dialog = await screen.findByRole("dialog", { name: "Your repos" });
    expect(spy).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("checkbox", { name: /octo\/app/ })).toBeChecked();
    expect(within(dialog).getByLabelText("Private")).toBeTruthy();
    expect(within(dialog).queryByRole("checkbox", { name: /octo\/dusty/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /octo\/site/ }));
    expect(github().repos).toEqual([
      { repo: "octo/app", prs: "all", issues: "new" },
      { repo: "octo/site", prs: "mine", issues: "off" },
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show all (1 more)" }));
    expect(within(dialog).getByRole("checkbox", { name: /octo\/dusty/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /octo\/app/ }));
    expect(github().repos.map((r) => r.repo)).toEqual(["octo/site"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose repos on GitHub" }));
    expect(api.invoke).toHaveBeenCalledWith("open_external", { url: INSTALL_URL });
  });

  it("a public repo by URL", async () => {
    const { github } = mount();
    fireEvent.click(await screen.findByRole("button", { name: /Add a repo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Track a public repo…" }));
    const field = screen.getByLabelText("Public repo URL");
    fireEvent.change(field, { target: { value: "https://github.com/octo/app" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("That repo is already on your bar.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "https://github.com/vercel/next.js" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(github().repos.map((r) => r.repo)).toEqual(["octo/app", "vercel/next.js"]);
  });
});

describe("the ⋯ menu", () => {
  it("Flash on change and Quiet hours write the app-wide settings", async () => {
    const { github } = mount();
    const trigger = await screen.findByRole("button", { name: "GitHub options" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Flash on change/ }));
    expect(github().flash).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "GitHub options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Quiet hours/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Quiet hours" }));
    expect(github().quietHours).toEqual({ on: true, from: "22:00", to: "08:00" });
    fireEvent.change(screen.getByLabelText("Quiet from"), { target: { value: "21:30" } });
    expect(github().quietHours).toEqual({ on: true, from: "21:30", to: "08:00" });
  });
});
