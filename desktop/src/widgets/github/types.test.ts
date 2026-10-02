import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GitHubPRRow } from "../../api/client";
import type { GitHubRepo } from "./types";

const signedOut = vi.fn(() => false);
const runs = vi.fn();
const directFetch = vi.fn();

vi.mock("../../auth", () => ({ isSignedOut: () => signedOut() }));
const prs = vi.fn(async (_r: string[]): Promise<unknown> => ({ connected: false, repos: [] }));
vi.mock("../../api/client", () => ({ githubApi: { runs: (r: string[]) => runs(r), prs: (r: string[]) => prs(r) } }));
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

// ── SCROLLR-308: pull requests and the chip's state ─────────────

const { needsYou, chipState, nextFlash, shortAge, withPRs, pagePRs, barPrefs, inQuietHours, GITHUB_BAR_DEFAULTS } = await import("./types");

const pr = (n: number, over: Partial<GitHubPRRow> = {}): GitHubPRRow => ({
  number: n,
  title: `PR ${n}`,
  html_url: "",
  author: "bob",
  is_mine: false,
  review_requested: false,
  review_state: "none",
  draft: false,
  head_branch: "b",
  head_sha: `s${n}`,
  updated_at: "2026-10-02T08:00:00Z",
  checks: { total: 0, passed: 0, failed: 0, running: 0 },
  checks_state: "none",
  ...over,
});

const repo = (over: Partial<GitHubRepo> = {}): GitHubRepo => ({
  owner: "o",
  repo: "r",
  status: "success",
  workflowName: "CI",
  runUrl: null,
  commitMessage: null,
  updatedAt: null,
  branch: null,
  startedAt: null,
  ...over,
});

describe("needsYou (SCROLLR-308)", () => {
  it("counts each PR once: a review asked of you, yours with changes requested or failing checks", () => {
    const prs = [
      pr(1, { review_requested: true }),
      // yours, changes requested AND failing: still one
      pr(2, { is_mine: true, review_state: "changes_requested", checks_state: "failing" }),
      pr(3, { is_mine: true, checks_state: "failing" }),
      pr(4, { is_mine: true, review_state: "approved", checks_state: "passing" }),
      pr(5, { review_state: "changes_requested", checks_state: "failing" }), // not yours
    ];
    expect(needsYou(prs).map((p) => p.number)).toEqual([1, 2, 3]);
  });
});

describe("chipState (SCROLLR-308)", () => {
  const failing = { state: "failing" as const, workflow: "deploy", updated_at: "2026-10-02T08:00:00Z" };
  const passing = { state: "passing" as const, workflow: "CI", updated_at: "2026-10-02T08:00:00Z" };

  it("needs you beats broken beats running on yours beats passing", () => {
    const all = { prs: [pr(1, { review_requested: true })], defaultCi: failing, mineRunning: 2 };
    const pulse = { ...GITHUB_BAR_DEFAULTS, pulse: true };
    expect(chipState(repo(all), pulse)).toBe("needs");
    expect(chipState(repo({ ...all, prs: [] }), pulse)).toBe("broken");
    expect(chipState(repo({ ...all, prs: [], defaultCi: passing }), pulse)).toBe("running");
    expect(chipState(repo({ ...all, prs: [], defaultCi: passing, mineRunning: 0 }), pulse)).toBe("passing");
  });

  it("not connected, or no settled default-branch run: today's latest-run form", () => {
    expect(chipState(repo())).toBeUndefined();
    expect(chipState(repo({ prs: [], defaultCi: { state: "running" } }))).toBeUndefined();
    expect(chipState(repo({ prs: [] }))).toBeUndefined();
  });

  it("withPRs merges only an available answer", () => {
    const p = { repo: "o/r", available: true, prs: [pr(1)], default_ci: passing, mine_running: 1, mine_since: "x", mine_branch: "b" };
    expect(withPRs(repo(), p)).toMatchObject({ prs: [pr(1)], defaultCi: passing, mineRunning: 1, mineSince: "x", mineBranch: "b" });
    expect(withPRs(repo(), { ...p, available: false }).prs).toBeUndefined();
  });
});

// ── SCROLLR-309: the GitHub page and what goes on the bar ─────────

describe("pagePRs: the GitHub page's items and their order (SCROLLR-309)", () => {
  // Input deliberately out of order.
  const prs = [
    pr(1, { is_mine: true, checks_state: "failing" }), // yours, failing: 2
    pr(2, { is_mine: true, review_state: "approved", checks_state: "passing" }), // yours, quiet: 3
    pr(3, { is_mine: true, review_state: "changes_requested", checks_state: "failing" }), // changes (and failing): 1, once
    pr(4, { review_requested: true }), // review asked of you: 0
    pr(5, { review_state: "changes_requested" }), // someone else's: never
    pr(6, { review_requested: true, checks_state: "running" }), // review: 0
  ];
  const nums = (bar = GITHUB_BAR_DEFAULTS, quiet = false) => pagePRs(repo({ prs }), bar, quiet).map((p) => p.number);

  it("review requests, then changes requested, then failing checks; each PR once; never someone else's quiet PR", () => {
    expect(nums()).toEqual([4, 6, 3, 1]);
    expect(pagePRs(repo({ prs })).map((p) => [p.repo, p.why])).toEqual([["r", 0], ["r", 0], ["r", 1], ["r", 2]]);
  });

  it("'My other open PRs' adds yours after the ones that need you; the needs-you count does not change", () => {
    const bar = { ...GITHUB_BAR_DEFAULTS, otherPRs: true };
    expect(nums(bar)).toEqual([4, 6, 3, 1, 2]);
    expect(needsYou(prs, bar)).toHaveLength(4);
  });

  it("each switch takes its reason off the page and out of the chip's count", () => {
    expect(nums({ ...GITHUB_BAR_DEFAULTS, reviews: false })).toEqual([3, 1]);
    // PR 3 has changes requested AND failing checks: with changes off it is on the page for its checks.
    expect(nums({ ...GITHUB_BAR_DEFAULTS, changes: false })).toEqual([4, 6, 1, 3]);
    expect(nums({ ...GITHUB_BAR_DEFAULTS, changes: false, failingChecks: false })).toEqual([4, 6]);
    expect(needsYou(prs, { ...GITHUB_BAR_DEFAULTS, reviews: false, changes: false, failingChecks: false })).toEqual([]);
  });

  it("quiet hours: nothing on the page; not connected: nothing", () => {
    expect(nums(GITHUB_BAR_DEFAULTS, true)).toEqual([]);
    expect(pagePRs(repo())).toEqual([]);
  });
});

describe("chipState with the bar prefs (SCROLLR-309)", () => {
  const failing = { state: "failing" as const, workflow: "deploy", updated_at: "2026-10-02T08:00:00Z" };
  const passing = { state: "passing" as const, workflow: "CI", updated_at: "2026-10-02T08:00:00Z" };
  const review = [pr(1, { review_requested: true })];

  it("the pulse is off by default: a run on your branch alone is not a state", () => {
    expect(chipState(repo({ prs: [], defaultCi: passing, mineRunning: 1 }))).toBe("passing");
  });

  it("review requests off: a review alone is not 'needs you'", () => {
    expect(chipState(repo({ prs: review, defaultCi: passing }), { ...GITHUB_BAR_DEFAULTS, reviews: false })).toBe("passing");
  });

  it("failing CI off: a red main is quiet (grey), never the green dot", () => {
    expect(chipState(repo({ prs: [], defaultCi: failing }), { ...GITHUB_BAR_DEFAULTS, failingCi: false })).toBe("quiet");
  });

  it("quiet hours silence every state", () => {
    expect(chipState(repo({ prs: review, defaultCi: failing, mineRunning: 1 }), { ...GITHUB_BAR_DEFAULTS, pulse: true }, true)).toBe("quiet");
    expect(chipState(repo(), GITHUB_BAR_DEFAULTS, true)).toBeUndefined(); // not connected: today's form
  });
});

describe("barPrefs and quiet hours (SCROLLR-309)", () => {
  it("defaults: quiet by default, the four that need you on, the pulse and other PRs off", () => {
    expect(barPrefs(undefined)).toEqual(GITHUB_BAR_DEFAULTS);
    expect(GITHUB_BAR_DEFAULTS).toMatchObject({ failingCi: true, reviews: true, changes: true, failingChecks: true, pulse: false, otherPRs: false, flash: true, quiet: false });
  });

  it("keeps only well-typed stored fields", () => {
    expect(barPrefs({ pulse: true, reviews: "yes", quietFrom: "25:00", quietTo: "07:30" })).toEqual({ ...GITHUB_BAR_DEFAULTS, pulse: true, quietTo: "07:30" });
  });

  const at = (h: number, m = 0) => new Date(2026, 9, 2, h, m);
  it("a window inside one day", () => {
    const bar = { ...GITHUB_BAR_DEFAULTS, quiet: true, quietFrom: "12:00", quietTo: "13:30" };
    expect([at(11, 59), at(12), at(13, 29), at(13, 30)].map((d) => inQuietHours(bar, d))).toEqual([false, true, true, false]);
  });

  it("a window across midnight, and off when the switch is off or the times are equal", () => {
    const bar = { ...GITHUB_BAR_DEFAULTS, quiet: true, quietFrom: "22:00", quietTo: "08:00" };
    expect([at(21, 59), at(22), at(2), at(7, 59), at(8)].map((d) => inQuietHours(bar, d))).toEqual([false, true, true, true, false]);
    expect(inQuietHours({ ...bar, quiet: false }, at(2))).toBe(false);
    expect(inQuietHours({ ...bar, quietTo: "22:00" }, at(22))).toBe(false);
  });
});

describe("nextFlash (SCROLLR-308)", () => {
  it("fires once per change: broke, recovered, more need you; never on a poll that changed nothing", () => {
    const tokens: number[] = [];
    let m = nextFlash(undefined, false, 0); // first sight: no flash
    tokens.push(m.token);
    for (const [broken, needs] of [
      [false, 0], // nothing changed
      [true, 0], // passing → failing
      [true, 0], // same poll again
      [false, 0], // failing → passing
      [false, 1], // needs you up
      [false, 1], // same
      [false, 0], // needs you down: no flash
      [false, 2], // up again
    ] as const) {
      m = nextFlash(m, broken, needs);
      tokens.push(m.token);
    }
    expect(tokens).toEqual([0, 0, 1, 1, 2, 3, 3, 3, 4]);
  });

  it("a break flashes red, everything else green", () => {
    expect(nextFlash(nextFlash(undefined, false, 0), true, 0).tone).toBe("down");
    expect(nextFlash(nextFlash(undefined, true, 0), false, 0).tone).toBe("up");
  });
});

describe("shortAge", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("is at most three characters", () => {
    const ago = (ms: number) => shortAge(new Date(now - ms).toISOString(), now);
    expect(ago(30_000)).toBe("now");
    expect(ago(12 * 60_000)).toBe("12m");
    expect(ago(5 * 3_600_000)).toBe("5h");
    expect(ago(3 * 86_400_000)).toBe("3d");
    expect(ago(60 * 86_400_000)).toBe("8w");
    expect(ago(800 * 86_400_000)).toBe("2y");
    expect(shortAge(undefined, now)).toBe("");
  });
});

describe("fetchRepos with pull requests (SCROLLR-308)", () => {
  beforeEach(() => {
    signedOut.mockReturnValue(false);
    runs.mockReset();
    prs.mockReset();
  });

  it("one /github/prs call for every repo, merged into each record", async () => {
    runs.mockResolvedValue({ connected: true, runs: [{ repo: "o/a", available: true, status: "completed", conclusion: "success" }] });
    prs.mockResolvedValue({
      connected: true,
      repos: [{ repo: "O/A", available: true, prs: [pr(7, { review_requested: true })], mine_running: 0 }],
    } as never);
    const out = await fetchRepos([{ owner: "o", repo: "a" }, { owner: "o", repo: "b" }]);
    expect(prs).toHaveBeenCalledTimes(1);
    expect(prs).toHaveBeenCalledWith(["o/a", "o/b"]);
    expect(out[0].prs?.[0].number).toBe(7);
    expect(out[1].prs).toBeUndefined();
  });

  it("an older core without /github/prs leaves the runs as they were", async () => {
    runs.mockResolvedValue({ connected: true, runs: [{ repo: "o/a", available: true, status: "completed", conclusion: "success" }] });
    prs.mockRejectedValue(new Error("404"));
    const out = await fetchRepos([{ owner: "o", repo: "a" }]);
    expect(out[0]).toMatchObject({ status: "success" });
    expect(out[0].prs).toBeUndefined();
  });
});
