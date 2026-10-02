/**
 * The GitHub widget's config (SCROLLR-312), kept in `prefs.widgets.github`.
 *
 * Each tracked repo says what it watches: some workflows, its pull requests
 * and its issues. Quiet hours and the flash are app-wide. Pure: no imports,
 * so preferences.ts can migrate with it.
 */

export type GitHubPRMode = "off" | "mine" | "all";
export type GitHubIssueMode = "off" | "assigned" | "new";

export interface GitHubTrackedRepo {
  /** "owner/name". */
  repo: string;
  /**
   * Workflow names to show. Absent: the ones that ran on the default branch
   * in the last 30 days (core resolves it on every fetch, so a new repo and
   * a migrated one need no extra call); the checklist writes a list on the
   * first tick.
   */
  workflows?: string[];
  prs: GitHubPRMode;
  issues: GitHubIssueMode;
}

export interface GitHubQuietHours {
  on: boolean;
  /** Local "HH:MM"; the window may wrap midnight. */
  from: string;
  to: string;
}

export interface GitHubWidgetConfig {
  repos: GitHubTrackedRepo[];
  quietHours: GitHubQuietHours;
  /** A repo flashes once when its worst state changes or more needs you. */
  flash: boolean;
}

export const GITHUB_QUIET_DEFAULT: GitHubQuietHours = { on: false, from: "22:00", to: "08:00" };

export const GITHUB_DEFAULTS: GitHubWidgetConfig = { repos: [], quietHours: GITHUB_QUIET_DEFAULT, flash: true };

/** A newly added repo: recent workflows, the PRs that need you, no issues. */
export function newRepo(repo: string): GitHubTrackedRepo {
  return { repo, prs: "mine", issues: "off" };
}

const NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRS: readonly string[] = ["off", "mine", "all"];
const ISSUES: readonly string[] = ["off", "assigned", "new"];

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * One stored entry, whatever release wrote it: 1.7.0's `{owner, repo}`,
 * a bare "owner/name", or this release's `{repo: "owner/name", ...}`. Each
 * field is checked on its own: a bad mode falls back to its default and
 * never costs the repo. Null only when no repo name can be read.
 */
function entry(raw: unknown): GitHubTrackedRepo | null {
  if (typeof raw === "string") return NAME.test(raw.trim()) ? newRepo(raw.trim()) : null;
  const o = obj(raw);
  if (!o) return null;
  const name =
    typeof o.owner === "string" && typeof o.repo === "string" && !o.repo.includes("/")
      ? `${o.owner}/${o.repo}`
      : typeof o.repo === "string"
        ? o.repo.trim()
        : "";
  if (!NAME.test(name)) return null;
  const out = newRepo(name);
  if (typeof o.prs === "string" && PRS.includes(o.prs)) out.prs = o.prs as GitHubPRMode;
  if (typeof o.issues === "string" && ISSUES.includes(o.issues)) out.issues = o.issues as GitHubIssueMode;
  if (Array.isArray(o.workflows)) out.workflows = o.workflows.filter((w): w is string => typeof w === "string");
  return out;
}

/**
 * The stored `github` block, migrated on load. Never loses a repo: every
 * entry with a readable name is kept (once, case-insensitively), in order.
 * 1.7.0's `bar` keeps its quiet hours and flash; its other switches go.
 */
export function migrateGitHub(raw: unknown): GitHubWidgetConfig {
  const o = obj(raw);
  const repos: GitHubTrackedRepo[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(o?.repos) ? o.repos : []) {
    const e = entry(r);
    if (e && !seen.has(e.repo.toLowerCase())) {
      seen.add(e.repo.toLowerCase());
      repos.push(e);
    }
  }
  const bar = obj(o?.bar);
  const q = obj(o?.quietHours);
  const quietHours: GitHubQuietHours = { ...GITHUB_QUIET_DEFAULT };
  const on = q ? q.on : bar?.quiet;
  const from = q ? q.from : bar?.quietFrom;
  const to = q ? q.to : bar?.quietTo;
  if (typeof on === "boolean") quietHours.on = on;
  if (typeof from === "string" && HHMM.test(from)) quietHours.from = from;
  if (typeof to === "string" && HHMM.test(to)) quietHours.to = to;
  const flash = typeof o?.flash === "boolean" ? o.flash : typeof bar?.flash === "boolean" ? bar.flash : true;
  return { repos, quietHours, flash };
}

/** Inside quiet hours at local time `now`. A window may wrap midnight; from = to is never. */
export function inQuietHours(q: GitHubQuietHours, now: Date = new Date()): boolean {
  if (!q.on || q.from === q.to) return false;
  const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return q.from < q.to ? t >= q.from && t < q.to : t >= q.from || t < q.to;
}
