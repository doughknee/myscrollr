import { describe, expect, it, vi, beforeEach } from "vitest";

const signedOut = vi.fn(() => false);
const runs = vi.fn();
const directFetch = vi.fn();

vi.mock("../../auth", () => ({ isSignedOut: () => signedOut() }));
vi.mock("../../api/client", () => ({ githubApi: { runs: (r: string[]) => runs(r) } }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => directFetch(...a) }));

const { fetchRepos, toggleRepo, autoPick } = await import("./types");

describe("Your repos → prefs (SCROLLR-307)", () => {
  const row = (full_name: string, active: boolean) => ({ full_name, private: false, active });

  it("ticking appends owner/repo; unticking removes it, case-insensitively", () => {
    const config = [{ owner: "o", repo: "pasted" }];
    expect(toggleRepo(config, "Org/App", true)).toEqual([
      { owner: "o", repo: "pasted" },
      { owner: "Org", repo: "App" },
    ]);
    expect(toggleRepo([{ owner: "org", repo: "app" }, ...config], "Org/App", false)).toEqual(config);
  });

  it("ticking a repo already in the list (pasted with other casing) adds nothing", () => {
    const config = [{ owner: "org", repo: "app" }];
    expect(toggleRepo(config, "Org/App", true)).toBe(config);
  });

  it("first load with no repos configured ticks the active ones", () => {
    expect(autoPick([], [row("o/a", true), row("o/b", false), row("o/c", true)])).toEqual([
      { owner: "o", repo: "a" },
      { owner: "o", repo: "c" },
    ]);
  });

  it("never adds to an existing list", () => {
    expect(autoPick([{ owner: "x", repo: "y" }], [row("o/a", true)])).toBeNull();
  });

  it("nothing active: leaves the list empty", () => {
    expect(autoPick([], [row("o/a", false)])).toBeNull();
  });

  it("caps the auto-pick at the 20 repos core's runs endpoint answers", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`o/r${i}`, true));
    expect(autoPick([], rows)).toHaveLength(20);
  });
});

describe("fetchRepos (SCROLLR-304)", () => {
  beforeEach(() => {
    signedOut.mockReturnValue(false);
    runs.mockReset();
    directFetch.mockReset();
  });

  it("signed in: asks core and maps its rows by repo, case-insensitively", async () => {
    runs.mockResolvedValue({
      connected: true,
      runs: [
        {
          repo: "Org/Private",
          available: true,
          status: "completed",
          conclusion: "success",
          name: "CI",
          html_url: "https://github.com/Org/Private/actions/runs/1",
          head_branch: "main",
          run_started_at: "2026-10-02T08:00:00Z",
          updated_at: "2026-10-02T08:05:00Z",
          commit_message: "fix",
        },
        { repo: "org/gone", available: false },
      ],
    });
    const out = await fetchRepos([
      { owner: "org", repo: "private" },
      { owner: "org", repo: "gone" },
    ]);
    expect(runs).toHaveBeenCalledWith(["org/private", "org/gone"]);
    expect(directFetch).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({
      status: "success",
      workflowName: "CI",
      branch: "main",
      commitMessage: "fix",
      startedAt: "2026-10-02T08:00:00Z",
    });
    expect(out[1].status).toBe("unavailable");
  });

  it("signed out: no core session, so GitHub directly as before", async () => {
    signedOut.mockReturnValue(true);
    directFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ status: "in_progress", conclusion: null, name: "CI" }] }),
    });
    const out = await fetchRepos([{ owner: "o", repo: "r" }]);
    expect(runs).not.toHaveBeenCalled();
    expect(out[0].status).toBe("in_progress");
  });
});
