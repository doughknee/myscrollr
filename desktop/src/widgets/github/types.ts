/**
 * GitHub Actions widget types, fetch logic, and storage helpers.
 *
 * Signed in, runs come from core's GET /github/runs (SCROLLR-304): with
 * the user's own GitHub token once they connect the Scrollr Desktop GitHub
 * App (private repos included), through core's shared fallback otherwise.
 * Signed out there is no core session to ask, so the app still calls
 * GitHub directly for public repos, exactly as before.
 */
import { fetch } from "@tauri-apps/plugin-http";
import { LS_GITHUB_REPOS } from "../../constants";
import { getStore, setStore } from "../../lib/store";
import { isSignedOut } from "../../auth";
import { githubApi } from "../../api/client";
import type {
  GitHubDefaultCI,
  GitHubPRRow,
  GitHubRepoPRs,
  GitHubRepoRow,
  GitHubRunRow,
} from "../../api/client";

// ── GitHub Actions API response ────────────────────────────────

interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_commit: { message: string } | null;
  updated_at: string;
  /** Already in the response — we just weren't reading them. */
  head_branch: string | null;
  run_started_at: string | null;
}

interface GitHubActionsResponse {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
}

// ── Internal model ─────────────────────────────────────────────

export type CIStatus = "success" | "failure" | "in_progress" | "unavailable";

export const CI_STATUS_LABELS: Record<CIStatus, string> = {
  success: "Passing",
  failure: "Failing",
  in_progress: "Running",
  unavailable: "Unavailable",
};

export const CI_STATUS_COLORS: Record<CIStatus, string> = {
  success: "bg-up",
  failure: "bg-down",
  in_progress: "bg-warning",
  unavailable: "bg-fg-4",
};

export const CI_STATUS_TEXT: Record<CIStatus, string> = {
  success: "text-up",
  failure: "text-down",
  in_progress: "text-warning",
  unavailable: "text-fg-4",
};

export interface GitHubRepo {
  owner: string;
  repo: string;
  status: CIStatus;
  workflowName: string | null;
  runUrl: string | null;
  commitMessage: string | null;
  updatedAt: string | null;
  /** Branch the run is on, e.g. "main". */
  branch: string | null;
  /** When the run started — used for the chip's elapsed value. */
  startedAt: string | null;
  // From core's /github/prs when GitHub is connected (SCROLLR-308);
  // absent otherwise, and the chip keeps its latest-run form.
  prs?: GitHubPRRow[];
  defaultCi?: GitHubDefaultCI;
  mineRunning?: number;
  mineSince?: string;
  mineBranch?: string;
}

// ── Helpers ────────────────────────────────────────────────────

/** Map GitHub API status/conclusion to our CIStatus. */
function toCIStatus(status: string, conclusion: string | null): CIStatus {
  if (status === "in_progress" || status === "queued") return "in_progress";
  if (conclusion === "success") return "success";
  if (conclusion === "failure" || conclusion === "timed_out") return "failure";
  // cancelled, skipped, action_required, stale, etc.
  return "unavailable";
}

/**
 * Parse a GitHub repo URL into owner/repo.
 *
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/anything/else
 *   github.com/owner/repo
 */
/** Valid GitHub owner/repo name: alphanumeric, hyphens, dots, underscores. */
const GITHUB_NAME_RE = /^[a-zA-Z0-9_.-]+$/;

export function parseRepoUrl(
  url: string,
): { owner: string; repo: string } | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  const match = trimmed.match(/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];
  if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(repo)) return null;

  return { owner, repo };
}

/** Format owner/repo as a stable key for exclusion lists. */
export function repoKey(r: { owner: string; repo: string }): string {
  return `${r.owner}/${r.repo}`;
}

// ── Fetch ──────────────────────────────────────────────────────

/**
 * Fetch the latest workflow run for a single repo.
 * Returns a GitHubRepo with status "unavailable" on any error
 * (404, rate limit, network failure) rather than throwing.
 */
export async function fetchRepoStatus(
  owner: string,
  repo: string,
): Promise<GitHubRepo> {
  const unavailable: GitHubRepo = {
    owner,
    repo,
    status: "unavailable",
    workflowName: null,
    runUrl: null,
    commitMessage: null,
    updatedAt: null,
    branch: null,
    startedAt: null,
  };

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Scrollr/1.0",
      },
    });

    if (!res.ok) return unavailable;

    const data = (await res.json()) as GitHubActionsResponse;
    const run = data.workflow_runs?.[0];
    if (!run) return unavailable;

    return {
      owner,
      repo,
      status: toCIStatus(run.status, run.conclusion),
      workflowName: run.name,
      runUrl: run.html_url,
      commitMessage: run.head_commit?.message ?? null,
      updatedAt: run.updated_at,
      branch: run.head_branch,
      startedAt: run.run_started_at,
    };
  } catch {
    return unavailable;
  }
}

/**
 * Fetch status for all configured repos in parallel.
 * Uses Promise.allSettled so one failure doesn't break others.
 */
export async function fetchAllRepos(
  repos: Array<{ owner: string; repo: string }>,
): Promise<GitHubRepo[]> {
  const results = await Promise.allSettled(
    repos.map((r) => fetchRepoStatus(r.owner, r.repo)),
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          owner: repos[i].owner,
          repo: repos[i].repo,
          status: "unavailable" as CIStatus,
          workflowName: null,
          runUrl: null,
          commitMessage: null,
          updatedAt: null,
          branch: null,
          startedAt: null,
        },
  );
}

/** Map core's run row onto the widget model. */
export function fromRunRow(
  r: { owner: string; repo: string },
  row: GitHubRunRow | undefined,
): GitHubRepo {
  return {
    owner: r.owner,
    repo: r.repo,
    status: row?.available
      ? toCIStatus(row.status ?? "", row.conclusion || null)
      : "unavailable",
    workflowName: row?.name || null,
    runUrl: row?.html_url || null,
    commitMessage: row?.commit_message || null,
    updatedAt: row?.updated_at || null,
    branch: row?.head_branch || null,
    startedAt: row?.run_started_at || null,
  };
}

/**
 * The widget's fetch: core when signed in, GitHub directly when signed out.
 */
export async function fetchRepos(
  repos: Array<{ owner: string; repo: string }>,
): Promise<GitHubRepo[]> {
  if (isSignedOut()) return fetchAllRepos(repos);
  const keys = repos.map(repoKey);
  // PRs are an extra: an older core (404) or a hiccup leaves the runs.
  const [res, prs] = await Promise.all([
    githubApi.runs(keys),
    (async () => githubApi.prs(keys))().catch(() => null),
  ]);
  const byKey = new Map(res.runs.map((row) => [row.repo.toLowerCase(), row]));
  const prsByKey = new Map(
    (prs?.connected ? prs.repos : []).map((p) => [p.repo.toLowerCase(), p]),
  );
  return repos.map((r) => {
    const k = repoKey(r).toLowerCase();
    return withPRs(fromRunRow(r, byKey.get(k)), prsByKey.get(k));
  });
}

/** Merge one repo's PR answer into its record. */
export function withPRs(r: GitHubRepo, p: GitHubRepoPRs | undefined): GitHubRepo {
  if (!p?.available) return r;
  return {
    ...r,
    prs: p.prs,
    defaultCi: p.default_ci,
    mineRunning: p.mine_running,
    mineSince: p.mine_since,
    mineBranch: p.mine_branch,
  };
}

// ── The edge chip's state (SCROLLR-308) ────────────────────────

/**
 * The PRs that need you, each once: a review asked of you (or your team),
 * or yours with changes requested or failing checks.
 */
export function needsYou(prs: GitHubPRRow[] = []): GitHubPRRow[] {
  return prs.filter(
    (p) =>
      p.review_requested ||
      (p.is_mine &&
        (p.review_state === "changes_requested" ||
          p.checks_state === "failing")),
  );
}

export type GitHubChipState = "needs" | "broken" | "running" | "passing";

/**
 * Needs you › broken › running on yours › passing. Undefined without PR
 * data (not connected) or with no settled default-branch run: the chip
 * keeps its latest-run form.
 */
export function chipState(r: GitHubRepo): GitHubChipState | undefined {
  if (!r.prs) return undefined;
  if (needsYou(r.prs).length > 0) return "needs";
  if (r.defaultCi?.state === "failing") return "broken";
  if ((r.mineRunning ?? 0) > 0) return "running";
  if (r.defaultCi?.state === "passing") return "passing";
  return undefined;
}

/** "now", "12m", "5h", "3d", "6w", "2y": at most three characters. */
export function shortAge(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  if (d < 700) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 365)}y`;
}

/** What a repo's flash remembers: the last verdict and the token. */
export interface FlashMemo {
  broken: boolean;
  needs: number;
  /** Counts worthy changes; 0 until the first. */
  token: number;
  tone: "up" | "down";
}

/**
 * One flash per worthy change: the default branch broke or recovered, or
 * more PRs need you. A poll that changed nothing (or only lowered the
 * count) keeps the token. The first sighting never flashes.
 */
export function nextFlash(
  prev: FlashMemo | undefined,
  broken: boolean,
  needs: number,
): FlashMemo {
  if (!prev) return { broken, needs, token: 0, tone: "up" };
  if (broken !== prev.broken || needs > prev.needs) {
    return { broken, needs, token: prev.token + 1, tone: broken ? "down" : "up" };
  }
  return { ...prev, broken, needs };
}

// ── Your repos picker (SCROLLR-307) ────────────────────────────

type RepoRef = { owner: string; repo: string };

/** Core's GET /github/runs answers at most this many repos (maxRepos). */
const MAX_AUTO_PICK = 20;

function refOf(fullName: string): RepoRef {
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}

/**
 * The configured list with one of the user's repos ticked or unticked —
 * the same list the URL box writes. Matched case-insensitively, since a
 * pasted URL may not match GitHub's casing.
 */
export function toggleRepo(config: RepoRef[], fullName: string, on: boolean): RepoRef[] {
  const key = fullName.toLowerCase();
  const has = config.some((r) => repoKey(r).toLowerCase() === key);
  if (on === has) return config;
  if (!on) return config.filter((r) => repoKey(r).toLowerCase() !== key);
  return [...config, refOf(fullName)];
}

/**
 * The first-load rule: with nothing configured, start from the repos with
 * recent Actions activity. Never adds to an existing list (null = leave it).
 */
export function autoPick(config: RepoRef[], rows: GitHubRepoRow[]): RepoRef[] | null {
  if (config.length > 0) return null;
  const active = rows.filter((r) => r.active).slice(0, MAX_AUTO_PICK);
  return active.length > 0 ? active.map((r) => refOf(r.full_name)) : null;
}

// ── Store persistence ──────────────────────────────────────────

export function loadRepoData(): GitHubRepo[] {
  return getStore<GitHubRepo[]>(LS_GITHUB_REPOS, []);
}

/** Writes only when something changed, so followers do not re-render. */
export function saveRepoData(repos: GitHubRepo[]): void {
  if (JSON.stringify(repos) === JSON.stringify(loadRepoData())) return;
  setStore(LS_GITHUB_REPOS, repos);
}
