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
import type { GitHubRepoRow, GitHubRunRow } from "../../api/client";

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
  const res = await githubApi.runs(repos.map(repoKey));
  const byKey = new Map(res.runs.map((row) => [row.repo.toLowerCase(), row]));
  return repos.map((r) => fromRunRow(r, byKey.get(repoKey(r).toLowerCase())));
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

export function saveRepoData(repos: GitHubRepo[]): void {
  setStore(LS_GITHUB_REPOS, repos);
}
