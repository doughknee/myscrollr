/**
 * The GitHub widget's data (SCROLLR-312): one board entry per tracked repo,
 * and what its bar cell says about it.
 *
 * Connected, everything comes from core's POST /github/board with the user's
 * own token: each repo's chosen workflows, its PRs and its issues as the
 * repo's modes ask. Signed in but not connected, core's shared fallback
 * (GET /github/runs) gives each repo its latest run; signed out there is no
 * core session to ask, so the app calls GitHub directly for public repos.
 * Either way the bar draws the same pills.
 */
import { fetch } from "@tauri-apps/plugin-http";
import { LS_GITHUB_BOARD } from "../../constants";
import { getStore, setStore } from "../../lib/store";
import { isSignedOut } from "../../auth";
import { githubApi } from "../../api/client";
import type { GitHubBoardRepo, GitHubBoardRun, GitHubPRRow, GitHubRepoRow, GitHubRunRow } from "../../api/client";
import { newRepo } from "./config";
import type { GitHubTrackedRepo } from "./config";
import type { GitHubChipData } from "../../types";

// ── Repo names ─────────────────────────────────────────────────

/** Valid GitHub owner/repo name: alphanumeric, hyphens, dots, underscores. */
const GITHUB_NAME_RE = /^[a-zA-Z0-9_.-]+$/;

/**
 * Parse a GitHub repo URL (or "owner/name") into "owner/name".
 *
 * Accepts https://github.com/owner/repo, …/owner/repo/anything/else,
 * github.com/owner/repo and owner/repo.
 */
export function parseRepoUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match =
    trimmed.match(/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)/i) ?? trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!GITHUB_NAME_RE.test(owner) || !GITHUB_NAME_RE.test(repo)) return null;
  return `${owner}/${repo}`;
}

export const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** "owner/name" → "name". */
export const repoName = (repo: string) => repo.slice(repo.indexOf("/") + 1);

// ── Fetch ──────────────────────────────────────────────────────

type RunState = GitHubBoardRun["state"];

/** GitHub's status/conclusion as a board state. */
function runState(status: string | undefined, conclusion: string | null | undefined): RunState {
  if (status && status !== "completed") return "running";
  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") return "passing";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") return "failing";
  return "none";
}

/** A latest-run answer (core's fallback, or GitHub itself) as a board entry: one workflow pill. */
export function fromRun(repo: string, row: GitHubRunRow | undefined): GitHubBoardRepo {
  if (!row?.available) return { repo, available: false, stale: row?.stale, workflows: [] };
  const state = runState(row.status, row.conclusion || null);
  return {
    repo,
    available: true,
    stale: row.stale,
    workflows: [{ name: row.name || "CI", state, at: (state === "running" ? row.run_started_at : row.updated_at) || undefined, url: row.html_url || undefined }],
  };
}

/** Signed out: GitHub's public API, one call per repo. Errors read as unavailable. */
async function fetchDirect(repo: string): Promise<GitHubBoardRepo> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Scrollr/1.0" },
    });
    if (!res.ok) return fromRun(repo, undefined);
    const run = ((await res.json()) as { workflow_runs?: Array<Record<string, string | null>> }).workflow_runs?.[0];
    if (!run) return fromRun(repo, undefined);
    return fromRun(repo, {
      repo,
      available: true,
      status: run.status ?? undefined,
      conclusion: run.conclusion ?? undefined,
      name: run.name ?? undefined,
      html_url: run.html_url ?? undefined,
      run_started_at: run.run_started_at ?? undefined,
      updated_at: run.updated_at ?? undefined,
    });
  } catch {
    return fromRun(repo, undefined);
  }
}

/**
 * The widget's fetch, one entry per tracked repo in config order. Connected:
 * the board. Not connected (or an older core without /github/board): each
 * repo's latest run through core. Signed out: GitHub directly.
 */
export async function fetchBoard(tracked: GitHubTrackedRepo[]): Promise<GitHubBoardRepo[]> {
  if (tracked.length === 0) return [];
  if (isSignedOut()) return Promise.all(tracked.map((t) => fetchDirect(t.repo)));
  const board = await githubApi
    .board(tracked.map(({ repo, workflows, prs, issues }) => ({ repo, workflows, prs, issues })))
    .catch(() => null);
  if (board?.connected) {
    return tracked.map((t) => board.repos.find((r) => sameRepo(r.repo, t.repo)) ?? { repo: t.repo, available: false, workflows: [] });
  }
  const res = await githubApi.runs(tracked.map((t) => t.repo));
  return tracked.map((t) => fromRun(t.repo, res.runs.find((r) => sameRepo(r.repo, t.repo))));
}

/**
 * The one board query (the shell's 60 s poll and the widget page share its
 * key, so they never double-fetch). Keyed on the whole config: a changed
 * mode or tick refetches at once, which is what moves the page's preview.
 */
export function githubBoardQuery(tracked: GitHubTrackedRepo[], authenticated: boolean) {
  return {
    queryKey: ["github-board", authenticated, JSON.stringify(tracked)],
    queryFn: async () => {
      const data = await fetchBoard(tracked);
      saveBoard(data);
      return data;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  };
}

// ── The cell: pills, worst first (canvas B3, T3) ───────────────

/**
 * `red` a failing workflow or check; `run` a workflow running; `you` PRs
 * that need you; `ok` a passing workflow; `quiet` counts that ask nothing
 * of you (all open PRs, new issues, issues assigned).
 */
export type PillKind = "red" | "run" | "you" | "ok" | "quiet";

export interface GitHubPill {
  kind: PillKind;
  text: string;
  /** Where a click on the cell goes when this is its most urgent pill. */
  url: string;
}

/** The order on the bar: the worst first, then the quiet counts. */
const RANK: Record<PillKind, number> = { red: 0, run: 1, you: 2, ok: 3, quiet: 4 };

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

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * A repo's pills, worst first: `✗ deploy · 12m`, `◌ apply · 3m`, `2 PRs for
 * you`, `✓ test`, then `3 open PRs`, `1 new issue`, `2 assigned`. Counts of
 * zero and workflows with no result say nothing. `t` is the repo's config
 * (its PR mode decides which PR pill); absent, PRs read as "mine".
 */
export function pillsFor(r: GitHubBoardRepo, t?: Pick<GitHubTrackedRepo, "prs" | "issues">, now = Date.now()): GitHubPill[] {
  const home = `https://github.com/${r.repo}`;
  const out: GitHubPill[] = [];
  for (const w of [...(r.checks ?? []), ...r.workflows]) {
    const url = w.url || `${home}/actions`;
    const age = shortAge(w.at, now);
    if (w.state === "failing") out.push({ kind: "red", text: age ? `✗ ${w.name} · ${age}` : `✗ ${w.name}`, url });
    else if (w.state === "running") out.push({ kind: "run", text: age ? `◌ ${w.name} · ${age}` : `◌ ${w.name}`, url });
    else if (w.state === "passing") out.push({ kind: "ok", text: `✓ ${w.name}`, url });
  }
  const prs = r.prs;
  if (prs && prs.count > 0) {
    const url = prs.count === 1 ? prs.items[0]?.html_url || `${home}/pulls` : `${home}/pulls`;
    if ((t?.prs ?? "mine") === "all") out.push({ kind: "quiet", text: `${prs.count} open ${plural(prs.count, "PR")}`, url });
    else out.push({ kind: "you", text: `${prs.count} ${plural(prs.count, "PR")} for you`, url });
  }
  const is = r.issues;
  if (is && !is.error && is.count > 0) {
    const url = is.count === 1 ? is.items[0]?.url || `${home}/issues` : `${home}/issues`;
    out.push({ kind: "quiet", text: t?.issues === "new" ? `${is.count} new ${plural(is.count, "issue")}` : `${is.count} assigned`, url });
  }
  // Array.prototype.sort is stable: inside a kind, checks then workflows in the chosen order, then PRs, then issues.
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

// ── The cell's two lines (canvas board C4 · D) ─────────────────

export type LineTone = "red" | "accent" | "dim" | "faint";

/** Line 1's right side: is it broken? `deploy failed · 12m`, `apply running · 3m`, `all green · 1h`. */
export interface GitHubStatus {
  text: string;
  tone: LineTone;
}

/** Line 2: what needs you, named. `Review` · the PR's title · `sample-dev +1`. */
export interface GitHubNeed {
  tag: string;
  tone: LineTone;
  text: string;
  /** Who, and `+N` more of the same kind. */
  who: string;
  url: string;
}

/** 308's rule, client side: a review asked of you, or yours with changes requested or red checks. */
const needsYou = (p: GitHubPRRow) =>
  p.review_requested || (p.is_mine && (p.review_state === "changes_requested" || p.checks_state === "failing"));

const more = (n: number) => (n > 0 ? `+${n}` : "");
const joinWho = (...parts: string[]) => parts.filter(Boolean).join(" ");

/** The newest of these runs' times, or "". */
const newest = (runs: GitHubBoardRun[]) =>
  runs.reduce<string>((a, r) => (r.at && (!a || Date.parse(r.at) > Date.parse(a)) ? r.at : a), "");

/** Line 1: the first failing run or check, else the first running, else all green with its age. */
export function statusFor(r: GitHubBoardRepo, now = Date.now()): GitHubStatus | null {
  const all = [...(r.checks ?? []), ...r.workflows];
  const age = (at?: string) => (shortAge(at, now) ? ` · ${shortAge(at, now)}` : "");
  const bad = all.find((w) => w.state === "failing");
  if (bad) return { text: `${bad.name} failed${age(bad.at)}`, tone: "red" };
  const run = all.find((w) => w.state === "running");
  if (run) return { text: `${run.name} running${age(run.at)}`, tone: "accent" };
  const ok = all.filter((w) => w.state === "passing");
  return ok.length ? { text: `all green${age(newest(ok))}`, tone: "dim" } : null;
}

/**
 * Line 2: the one thing that needs you, by name. A PR that needs you (a
 * review, changes asked of yours, your red checks); else the commit that
 * broke a run; else a new or assigned issue; else the newest open PR (All
 * open); else the commit a run is building. Null: nothing to name.
 */
export function needFor(r: GitHubBoardRepo): GitHubNeed | null {
  const home = `https://github.com/${r.repo}`;
  const prs = r.prs?.items ?? [];
  const mine = prs.filter(needsYou);
  if (mine.length) {
    const p = mine[0];
    const [tag, tone]: [string, LineTone] = p.review_requested
      ? ["Review", "accent"]
      : p.review_state === "changes_requested"
        ? ["Changes", "red"]
        : ["Checks failed", "red"];
    return { tag, tone, text: p.title, who: joinWho(p.review_requested ? p.author : `#${p.number}`, more(mine.length - 1)), url: p.html_url || `${home}/pulls` };
  }
  const runs = [...(r.checks ?? []), ...r.workflows];
  const broke = runs.find((w) => w.state === "failing" && w.commit);
  if (broke) return { tag: "Broke on", tone: "faint", text: broke.commit!, who: broke.by_you ? "you" : broke.actor ?? "", url: broke.url || `${home}/actions` };
  const is = r.issues;
  if (is && !is.error && is.items.length) {
    const i = is.items[0];
    return { tag: "Issue", tone: "dim", text: i.title, who: more(is.count - 1), url: i.url || `${home}/issues` };
  }
  if (prs.length) {
    const p = prs[0];
    return { tag: p.draft ? "Draft" : "PR", tone: "dim", text: p.title, who: joinWho(p.author, more(prs.length - 1)), url: p.html_url || `${home}/pulls` };
  }
  const building = runs.find((w) => w.state === "running" && w.commit);
  if (building) return { tag: "Building", tone: "faint", text: building.commit!, who: building.by_you ? "you" : building.actor ?? "", url: building.url || `${home}/actions` };
  return null;
}

/** A repo's worst state, its dot: red, the accent (running or needs you), green, or nothing to say. */
export type GitHubWorst = "red" | "accent" | "ok" | "none";

export function worstOf(pills: readonly GitHubPill[]): GitHubWorst {
  const k = pills[0]?.kind;
  return k === "red" ? "red" : k === "run" || k === "you" ? "accent" : k === "ok" ? "ok" : "none";
}

/** The newest event a repo's cell knows of: a run, a check, a PR update, an issue opened. */
export function latestAt(r: GitHubBoardRepo): string | undefined {
  const all = [
    ...r.workflows.map((w) => w.at),
    ...(r.checks ?? []).map((c) => c.at),
    ...(r.prs?.items ?? []).map((p) => p.updated_at),
    ...(r.issues?.items ?? []).map((i) => i.created_at),
  ].filter((s): s is string => !!s && !Number.isNaN(Date.parse(s)));
  return all.length ? all.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : undefined;
}

/**
 * The approximate width of a pill: 12px mono at 0.6em a character, 14px of
 * padding, a 6px gap. ponytail: an estimate, not a measurement, so a cell
 * decides its pills before paint and never re-lays them while up (§P.8);
 * measure with a canvas if a font ever runs wider.
 */
export const PILL_CH_PX = 7.2;
const PILL_PAD_PX = 14;
const PILL_GAP_PX = 6;
export const pillWidth = (text: string) => Math.ceil([...text].length * PILL_CH_PX) + PILL_PAD_PX;

/**
 * How many pills fit in `width`: the rest become one `+N` pill, which must
 * fit too. All of them when they fit as they are.
 */
export function fitPills(pills: readonly GitHubPill[], width: number): { shown: GitHubPill[]; more: number } {
  let used = 0;
  for (let i = 0; i < pills.length; i++) {
    used += (i ? PILL_GAP_PX : 0) + pillWidth(pills[i].text);
    if (used > width) {
      // Step back until the shown pills and the "+N" fit.
      let n = i;
      while (n > 0) {
        const shown = pills.slice(0, n);
        const w = shown.reduce((s, p, j) => s + (j ? PILL_GAP_PX : 0) + pillWidth(p.text), 0);
        if (w + PILL_GAP_PX + pillWidth(`+${pills.length - n}`) <= width) break;
        n--;
      }
      return { shown: pills.slice(0, n), more: pills.length - n };
    }
  }
  return { shown: [...pills], more: 0 };
}

/**
 * One tracked repo as the bar draws it: pills worst first, the dot, the
 * age, the most urgent link. Quiet hours empty the pills (the slot greys,
 * the page goes). No flash: the ticker adds it (`githubChip`).
 */
export function repoChip(
  r: GitHubBoardRepo,
  t: Pick<GitHubTrackedRepo, "prs" | "issues"> | undefined,
  quiet = false,
  now = Date.now(),
): GitHubChipData {
  const pills = quiet ? [] : pillsFor(r, t, now);
  return {
    id: `github-${r.repo}`,
    repo: r.repo,
    label: repoName(r.repo),
    pills,
    worst: worstOf(pills),
    status: quiet ? null : statusFor(r, now),
    need: quiet ? null : needFor(r),
    age: shortAge(latestAt(r), now),
    url: pills[0]?.url ?? `https://github.com/${r.repo}`,
    quiet,
    available: r.available,
  };
}

// ── Flash (308's rule) ─────────────────────────────────────────

/** What a repo's flash remembers: the last verdict and the token. */
export interface FlashMemo {
  worst: GitHubWorst;
  needs: number;
  /** Counts worthy changes; 0 until the first. */
  token: number;
  tone: "up" | "down";
}

/**
 * One flash per worthy change: the repo's worst state changed, or more PRs
 * need you. A poll that changed nothing (or only lowered the count) keeps
 * the token. The first sighting never flashes.
 */
export function nextFlash(prev: FlashMemo | undefined, worst: GitHubWorst, needs: number): FlashMemo {
  if (!prev) return { worst, needs, token: 0, tone: "up" };
  if (worst !== prev.worst || needs > prev.needs) {
    return { worst, needs, token: prev.token + 1, tone: worst === "red" ? "down" : "up" };
  }
  return { ...prev, worst, needs };
}

// ── Your repos picker (SCROLLR-307) ────────────────────────────

/** Core's /github/board answers at most this many repos (maxRepos). */
export const MAX_REPOS = 20;

/**
 * The first-load rule: with nothing tracked, start from the repos with
 * recent Actions activity. Never adds to an existing list (null = leave it).
 */
export function autoPick(tracked: GitHubTrackedRepo[], rows: GitHubRepoRow[]): GitHubTrackedRepo[] | null {
  if (tracked.length > 0) return null;
  const active = rows.filter((r) => r.active).slice(0, MAX_REPOS);
  return active.length > 0 ? active.map((r) => newRepo(r.full_name)) : null;
}

// ── Store persistence (the ticker windows read it) ─────────────

export function loadBoard(): GitHubBoardRepo[] {
  const v = getStore<unknown>(LS_GITHUB_BOARD, []);
  return Array.isArray(v) ? v.filter((r): r is GitHubBoardRepo => !!r && typeof r.repo === "string" && Array.isArray(r.workflows)) : [];
}

/** Writes only when something changed, so followers do not re-render. */
export function saveBoard(repos: GitHubBoardRepo[]): void {
  if (JSON.stringify(repos) === JSON.stringify(loadBoard())) return;
  setStore(LS_GITHUB_BOARD, repos);
}
