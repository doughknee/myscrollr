import { describe, expect, it, vi, beforeEach } from "vitest";

const signedOut = vi.fn(() => false);
const runs = vi.fn();
const directFetch = vi.fn();

vi.mock("../../auth", () => ({ isSignedOut: () => signedOut() }));
vi.mock("../../api/client", () => ({ githubApi: { runs: (r: string[]) => runs(r) } }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => directFetch(...a) }));

const { fetchRepos } = await import("./types");

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
