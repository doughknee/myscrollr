/** The GitHub widget's data and its pills (SCROLLR-312). */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GitHubBoardRepo } from "../../api/client";
import fixture from "../../dev/__fixtures__/github.board.json";

const signedOut = vi.fn(() => false);
const board = vi.fn();
const runs = vi.fn();
const directFetch = vi.fn();

vi.mock("../../auth", () => ({ isSignedOut: () => signedOut() }));
vi.mock("../../api/client", () => ({ githubApi: { board: (r: unknown) => board(r), runs: (r: string[]) => runs(r) } }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => directFetch(...a) }));

const { autoPick, fetchBoard, fitPills, needFor, nextFlash, parseRepoUrl, pillWidth, pillsFor, repoChip, thingsFor, worstOf } = await import("./types");
type Board = import("./types").GitHubBoard;

const NOW = Date.parse("2026-10-02T12:00:00Z");
const repos = fixture.repos as unknown as GitHubBoardRepo[];
const cfg = fixture.config as Array<{ repo: string; prs: "off" | "mine" | "all"; issues: "off" | "assigned" | "new" }>;
const texts = (r: GitHubBoardRepo, i: number) => pillsFor(r, cfg[i], NOW).map((p) => `${p.kind}:${p.text}`);

describe("pills, worst first (canvas B3)", () => {
  it("each fixture repo's row", () => {
    expect(texts(repos[0], 0)).toEqual(["you:2 PRs for you", "ok:✓ test", "ok:✓ deploy", "quiet:1 new issue"]);
    expect(texts(repos[1], 1)).toEqual(["red:✗ deploy · 12m", "ok:✓ test", "quiet:3 open PRs"]);
    // Another CI's failing check on main turns the cell red, by its own name.
    expect(texts(repos[2], 2)).toEqual(["red:✗ vercel · 3m", "ok:✓ build", "ok:✓ lighthouse"]);
    expect(texts(repos[3], 3)).toEqual(["run:◌ apply · 3m", "quiet:2 new issues"]);
  });

  it("the dot is the first pill's kind; nothing to say is none", () => {
    expect(repos.map((r, i) => worstOf(pillsFor(r, cfg[i], NOW)))).toEqual(["accent", "red", "red", "accent"]);
    expect(worstOf([])).toBe("none");
  });

  it("zero counts, workflows with no result and an issues permission error say nothing", () => {
    const r: GitHubBoardRepo = {
      repo: "o/r",
      available: true,
      workflows: [{ name: "nightly", state: "none" }],
      prs: { count: 0, needs_you: 0, items: [] },
      issues: { count: 0, items: [], error: "permission" },
    };
    expect(pillsFor(r, { prs: "mine", issues: "assigned" }, NOW)).toEqual([]);
  });

  it("one PR or issue links to it; more link to the repo's list; a workflow to its run", () => {
    const one: GitHubBoardRepo = { ...repos[0], prs: { count: 1, needs_you: 1, items: repos[0].prs!.items.slice(0, 1) } };
    expect(pillsFor(one, cfg[0], NOW)[0]).toEqual({ kind: "you", text: "1 PR for you", url: "https://github.com/sample/myscrollr/pull/478" });
    expect(pillsFor(repos[0], cfg[0], NOW)[0].url).toBe("https://github.com/sample/myscrollr/pulls");
    expect(pillsFor(repos[1], cfg[1], NOW)[0].url).toBe("https://github.com/sample/scrollr-api/actions/runs/3");
  });

  it("assigned issues read as assigned", () => {
    expect(texts({ ...repos[3], workflows: [] }, 3)).toEqual(["quiet:2 new issues"]);
    expect(pillsFor({ ...repos[3], workflows: [] }, { prs: "mine", issues: "assigned" }, NOW).map((p) => p.text)).toEqual(["2 assigned"]);
  });
});

describe("fitPills: what does not fit becomes +N", () => {
  const pills = pillsFor(repos[0], cfg[0], NOW);
  const all = pills.reduce((s, p, i) => s + (i ? 6 : 0) + pillWidth(p.text), 0);

  it("all of them when they fit", () => {
    expect(fitPills(pills, all)).toEqual({ shown: pills, more: 0 });
  });

  it("one short: the last two go, so the +2 fits", () => {
    const got = fitPills(pills, all - 1);
    expect(got.more).toBeGreaterThan(0);
    expect(got.shown).toEqual(pills.slice(0, pills.length - got.more));
    const used = got.shown.reduce((s, p, i) => s + (i ? 6 : 0) + pillWidth(p.text), 0) + 6 + pillWidth(`+${got.more}`);
    expect(used).toBeLessThanOrEqual(all - 1);
  });

  it("the worst pill is the last to go", () => {
    expect(fitPills(pills, pillWidth(pills[0].text) + 6 + pillWidth("+3")).shown).toEqual([pills[0]]);
    expect(fitPills(pills, 10)).toEqual({ shown: [], more: pills.length });
  });
});

describe("repoChip", () => {
  it("the cell's facts: label, age of the newest event, the most urgent link", () => {
    const c = repoChip(repos[1], cfg[1], false, NOW);
    expect(c).toMatchObject({ id: "github-sample/scrollr-api", label: "scrollr-api", worst: "red", age: "12m", url: "https://github.com/sample/scrollr-api/actions/runs/3", quiet: false });
  });

  it("quiet hours: no pills, no colour, still the age", () => {
    const c = repoChip(repos[1], cfg[1], true, NOW);
    expect(c).toMatchObject({ pills: [], worst: "none", age: "12m", quiet: true });
  });
});

describe("nextFlash", () => {
  it("never on first sight; on the worst state changing or more needing you; not on fewer", () => {
    let m = nextFlash(undefined, "ok", 0);
    expect(m.token).toBe(0);
    m = nextFlash(m, "ok", 0);
    expect(m.token).toBe(0);
    m = nextFlash(m, "red", 0);
    expect(m).toMatchObject({ token: 1, tone: "down" });
    m = nextFlash(m, "red", 2);
    expect(m.token).toBe(2);
    m = nextFlash(m, "red", 1);
    expect(m.token).toBe(2);
  });
});

describe("fetchBoard", () => {
  const tracked = [
    { repo: "o/a", prs: "mine" as const, issues: "off" as const },
    { repo: "o/b", prs: "off" as const, issues: "new" as const, workflows: ["test"] },
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    signedOut.mockReturnValue(false);
  });

  it("connected: one board call with each repo's modes, answered in config order", async () => {
    board.mockResolvedValue({ connected: true, repos: [{ repo: "O/B", available: true, workflows: [] }, { repo: "o/a", available: true, workflows: [] }] });
    const got = await fetchBoard(tracked);
    expect(board).toHaveBeenCalledWith([
      { repo: "o/a", workflows: undefined, prs: "mine", issues: "off" },
      { repo: "o/b", workflows: ["test"], prs: "off", issues: "new" },
    ]);
    expect(got.repos.map((r) => r.repo)).toEqual(["o/a", "O/B"]);
    // An older core sends no fill: none, not undefined.
    expect(got).toMatchObject({ queue: [], shipped: [] });
    expect(runs).not.toHaveBeenCalled();
    const q = { repo: "x/y", number: 1, title: "t", url: "https://github.com/x/y/pull/1", author: "kim", kind: "review" };
    board.mockResolvedValue({ connected: true, repos: [], queue: [q], shipped: [] });
    expect((await fetchBoard(tracked)).queue).toEqual([q]);
  });

  it("not connected (or a core without /github/board): each repo's latest run as one workflow", async () => {
    board.mockResolvedValue({ connected: false, connect: true, repos: [] });
    runs.mockResolvedValue({
      connected: false,
      runs: [
        { repo: "o/a", available: true, status: "completed", conclusion: "failure", name: "CI", updated_at: "2026-10-02T11:00:00Z", html_url: "u" },
        { repo: "o/b", available: false },
      ],
    });
    const { repos: got, queue } = await fetchBoard(tracked);
    expect(got[0].workflows).toEqual([{ name: "CI", state: "failing", at: "2026-10-02T11:00:00Z", url: "u" }]);
    expect(got[1]).toMatchObject({ repo: "o/b", available: false, workflows: [] });
    expect(queue).toEqual([]);
    board.mockRejectedValue(new Error("404"));
    expect((await fetchBoard(tracked)).repos[0].workflows[0].state).toBe("failing");
  });

  it("signed out: GitHub directly, one call a repo", async () => {
    signedOut.mockReturnValue(true);
    directFetch.mockResolvedValue({ ok: true, json: async () => ({ workflow_runs: [{ name: "CI", status: "in_progress", conclusion: null, run_started_at: "2026-10-02T11:58:00Z" }] }) });
    const { repos: got } = await fetchBoard(tracked);
    expect(directFetch).toHaveBeenCalledTimes(2);
    expect(got[0].workflows[0]).toMatchObject({ name: "CI", state: "running", at: "2026-10-02T11:58:00Z" });
    expect(board).not.toHaveBeenCalled();
  });
});

describe("the picker's first load and URLs", () => {
  it("autoPick: the active repos with the defaults, never into an existing list", () => {
    const rows = [
      { full_name: "o/a", private: false, active: true },
      { full_name: "o/b", private: false, active: false },
    ];
    expect(autoPick([], rows)).toEqual([{ repo: "o/a", prs: "mine", issues: "off" }]);
    expect(autoPick([{ repo: "x/y", prs: "off", issues: "off" }], rows)).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...rows[0], full_name: `o/r${i}`, active: true }));
    expect(autoPick([], many)).toHaveLength(6); // AUTO_PICK_MAX: the rate budget, not MAX_REPOS
  });

  it("parseRepoUrl: URLs and owner/name, nothing else", () => {
    expect(parseRepoUrl("https://github.com/Org/App/actions")).toBe("Org/App");
    expect(parseRepoUrl("github.com/o/r.git")).toBe("o/r");
    expect(parseRepoUrl("o/r")).toBe("o/r");
    expect(parseRepoUrl("not a repo")).toBeNull();
  });
});

describe("needFor: line 2 names what needs you (canvas C4 · D)", () => {
  const mine = repos[0].prs!.items[1]; // yours, changes requested, red checks
  const withPRs = (items: typeof mine[]) => ({ ...repos[0], prs: { count: items.length, needs_you: items.length, items } });
  it("a review asked of you leads, by title and author, +N for the rest", () => {
    expect(needFor(repos[0])).toMatchObject({ tag: "Review", tone: "accent", who: "sample-dev +1", url: "https://github.com/sample/myscrollr/pull/478" });
  });
  it("yours: changes requested, else red checks; who is the PR's number", () => {
    expect(needFor(withPRs([mine]))).toMatchObject({ tag: "Changes", tone: "red", text: mine.title, who: "#479" });
    expect(needFor(withPRs([{ ...mine, review_state: "approved" }]))).toMatchObject({ tag: "Checks failed", tone: "red" });
  });
  it("an approved PR of yours with green checks asks nothing: the issue speaks instead", () => {
    expect(needFor(withPRs([{ ...mine, review_state: "approved", checks_state: "passing" }]))).toMatchObject({ tag: "Issue", text: "Sample: the widget page is overwhelming" });
  });
});

describe("thingsFor: the GitHub page's fill (canvas F1)", () => {
  const all = fixture as unknown as Board;
  const things = (n: number, board: Board = all) => thingsFor(board, cfg.slice(0, n), NOW);
  const rows = (n: number, board?: Board) => things(n, board).map((t) => `${t.tag} | ${t.where} | ${t.right} | ${t.title}`);

  it("most urgent first, never what a repo cell names, one cell per link", () => {
    expect(rows(4)).toEqual([
      // A review anywhere the app can see, before changes asked on yours; an untracked repo by its full name.
      "REVIEW | sample-org/docs #61 · kim | 40m | Sample: fix the install steps for Windows",
      // The repo's own copy (with its checks) wins over the queue's.
      "CHANGES ASKED | myscrollr #479 · yours | ✗ 1 of 5 | Connect GitHub: core brokers the Scrollr Desktop app",
      // #478 is myscrollr's line 2; scrollr-api's deploy and scrollr-web's vercel are their line 1; infra #41 its line 2.
      "NEW ISSUE | myscrollr #312 | 3h | Sample: the widget page is overwhelming",
      "NEW ISSUE | infra #40 | 3h | Sample: bump node pool",
      "MERGED | myscrollr #476 · you | 2h | Sample: settings, startup and shortcuts move under App",
      "MERGED | scrollr-api #210 · sample-dev | 16h | Sample: cache the workflow list for ten minutes",
    ]);
    expect(things(4).filter((t) => t.shipped).map((t) => t.tag)).toEqual(["MERGED", "MERGED"]);
  });

  it("a second failing run is a thing; the first is the repo's line 1", () => {
    const red = { ...repos[1], workflows: [...repos[1].workflows, { name: "release", state: "failing" as const, at: "2026-10-02T11:00:00Z", url: "u-release", commit: "v1.7.1", actor: "kim" }] };
    const board: Board = { repos: [repos[0], red], queue: [], shipped: [] };
    expect(rows(2, board)).toContain("RELEASE FAILED | scrollr-api · kim | 1h | v1.7.1");
    expect(rows(2, board).some((r) => r.startsWith("DEPLOY FAILED"))).toBe(false);
  });

  it("a PR's checks on the right: all green, some running", () => {
    const pr = repos[0].prs!.items[0];
    const board = (checks: typeof pr.checks): Board => ({ repos: [{ ...repos[0], prs: { count: 2, needs_you: 2, items: [{ ...pr, number: 1, html_url: "x1" }, { ...pr, checks }] } }], queue: [], shipped: [] });
    expect(things(1, board({ total: 5, passed: 5, failed: 0, running: 0 }))[0]).toMatchObject({ tag: "REVIEW", right: "✓ 5/5", rightTone: "up" });
    expect(things(1, board({ total: 5, passed: 3, failed: 0, running: 2 }))[0]).toMatchObject({ right: "◌ 2 running", rightTone: "accent" });
  });
});
