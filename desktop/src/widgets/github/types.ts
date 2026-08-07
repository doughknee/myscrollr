/**
 * GitHub Actions widget types, fetch logic, and storage helpers.
 *
 * Fetches the latest workflow run status for user-configured public
 * GitHub repos. Uses @tauri-apps/plugin-http to bypass CORS.
 * Each repo is fetched independently so a single failure doesn't
 * break the entire widget.
 */
import { fetch } from "@tauri-apps/plugin-http";
import { LS_GITHUB_REPOS } from "../../constants";
import { getStore, setStore } from "../../lib/store";

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

// ── Store persistence ──────────────────────────────────────────

export function loadRepoData(): GitHubRepo[] {
  return getStore<GitHubRepo[]>(LS_GITHUB_REPOS, []);
}

export function saveRepoData(repos: GitHubRepo[]): void {
  setStore(LS_GITHUB_REPOS, repos);
}
