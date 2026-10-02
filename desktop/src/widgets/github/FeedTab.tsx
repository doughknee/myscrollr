/**
 * The GitHub widget's page (SCROLLR-312, canvas board T3): two panes.
 *
 * Left: the account, the repos on your bar, "+ Add a repo" (the picker of
 * SCROLLR-307 as a popover, or a URL for any public repo) and the one rule
 * of the bar. Right: the selected repo, a live preview of its bar cell, and
 * what it watches: workflows, pull requests, issues.
 *
 * Not connected: only the Connect state (SCROLLR-304). Core holds the token;
 * this page only reads and writes the widget's config.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { clsx } from "clsx";
import { Github, Lock, MoreHorizontal, Plus, X } from "lucide-react";
import type { FeedTabProps, WidgetManifest } from "../../types";
import OverflowMenu from "../../components/OverflowMenu";
import LoadingGlyph from "../../components/LoadingGlyph";
import RepoCell from "../../components/pages/cells/RepoCell";
import { accentFor, accentStyle, inkFor } from "../../components/pages/cells/parts";
import { useShell } from "../../shell-context";
import { savePrefs, updateWidgetPrefs } from "../../preferences";
import { githubApi } from "../../api/client";
import type { GitHubBoardRepo, GitHubRepoRow, GitHubWorkflowRow } from "../../api/client";
import { relativeTime } from "../../utils/format";
import { autoPick, githubBoardQuery, loadBoard, parseRepoUrl, pillsFor, repoChip, repoName, sameRepo, worstOf, MAX_REPOS } from "./types";
import { newRepo } from "./config";
import type { GitHubIssueMode, GitHubPRMode, GitHubTrackedRepo, GitHubWidgetConfig } from "./config";

// ── Widget manifest ─────────────────────────────────────────────

const HEX = "#f97316";

export const githubWidget: WidgetManifest = {
  id: "github",
  name: "GitHub",
  tabLabel: "GitHub",
  description: "Your repos on the bar: the workflows, pull requests and issues you choose",
  hex: HEX,
  icon: Github,
  info: {
    about:
      "The GitHub widget puts each repo you track on the bar as one cell, " +
      "showing what you chose for it: workflows, pull requests, issues.",
    usage: [
      "Connect GitHub, then add repos with + Add a repo; the ones with recent Actions runs start on the bar.",
      "Pick a repo to choose its workflows, its pull requests (off, the ones that need you, all open) and its issues.",
      "One or two repos share one rotating slot on the bar's edge; three or more get a page, one cell each.",
      "Quiet hours and the flash are in the ⋯ menu.",
    ],
  },
  FeedTab: GitHubFeedTab,
};

/** The app's install page: choose which repos it may see, and approve new permissions. */
const INSTALL_URL = "https://github.com/apps/scrollr-desktop/installations/new";

const openExternal = (url: string) => void invoke("open_external", { url }).catch(() => {});

const PR_OPTIONS: Array<[GitHubPRMode, string]> = [
  ["off", "Off"],
  ["mine", "Only ones that need me"],
  ["all", "All open"],
];
const ISSUE_OPTIONS: Array<[GitHubIssueMode, string]> = [
  ["off", "Off"],
  ["assigned", "Assigned to me"],
  ["new", "Every new issue"],
];

const isDark = () => !document.documentElement.getAttribute("data-theme")?.endsWith("-light");

// ── FeedTab ─────────────────────────────────────────────────────

function GitHubFeedTab(_props: FeedTabProps) {
  const shell = useShell();
  const cfg = shell.prefs.widgets.github;

  const write = useCallback(
    (patch: Partial<GitHubWidgetConfig>) => {
      const next = updateWidgetPrefs(shell.prefs, "github", patch);
      shell.onPrefsChange(next);
      savePrefs(next);
    },
    [shell],
  );
  const setRepos = useCallback((repos: GitHubTrackedRepo[]) => write({ repos }), [write]);

  const { data: status } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
    enabled: shell.authenticated,
  });
  const connected = !!status?.connected;
  const { data: yours, refetch: refetchYours } = useQuery({
    queryKey: ["github-repos"],
    queryFn: githubApi.repos,
    enabled: shell.authenticated && connected,
    retry: false,
  });

  // Back from GitHub (repos chosen, permissions approved): the window
  // regaining focus re-reads the list and the board.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!connected) return;
    const onFocus = () => {
      void refetchYours();
      void queryClient.invalidateQueries({ queryKey: ["github-board"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [connected, refetchYours, queryClient]);

  // First load only, and only into an empty list. The ref lives here, so
  // removing the last repo does not bring the rest back.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !yours) return;
    autoPicked.current = true;
    const picked = autoPick(cfg.repos, yours.repos);
    if (picked) setRepos(picked);
  }, [yours, cfg.repos, setRepos]);

  const { data: board } = useQuery({
    ...githubBoardQuery(cfg.repos, shell.authenticated),
    enabled: connected && cfg.repos.length > 0,
  });
  const boardRows = board ?? loadBoard();

  if (!shell.authenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <Github size={24} className="text-widget-github/60" />
        <p className="text-xs text-fg-2">Sign in to Scrollr, then connect GitHub to put your repos on the bar.</p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex justify-center p-6">
        <LoadingGlyph size={14} className="text-fg-3" />
      </div>
    );
  }
  if (!connected) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 p-6">
        <Github size={24} className="text-widget-github/60" />
        <GitHubAccount />
      </div>
    );
  }
  return (
    <TwoPanes
      cfg={cfg}
      login={status.login ?? ""}
      board={boardRows}
      yours={yours?.repos}
      write={write}
    />
  );
}

// ── The two panes ───────────────────────────────────────────────

function TwoPanes({
  cfg,
  login,
  board,
  yours,
  write,
}: {
  cfg: GitHubWidgetConfig;
  login: string;
  board: GitHubBoardRepo[];
  yours: GitHubRepoRow[] | undefined;
  write: (patch: Partial<GitHubWidgetConfig>) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [quietOpen, setQuietOpen] = useState(false);

  const sel = cfg.repos.find((r) => selected && sameRepo(r.repo, selected)) ?? cfg.repos[0];
  const rowOf = (repo: string) => board.find((b) => sameRepo(b.repo, repo));

  const setRepos = (repos: GitHubTrackedRepo[]) => write({ repos });
  const updateRepo = (repo: string, patch: Partial<GitHubTrackedRepo>) =>
    setRepos(cfg.repos.map((r) => (sameRepo(r.repo, repo) ? { ...r, ...patch } : r)));
  const addRepo = (repo: string) => {
    if (cfg.repos.some((r) => sameRepo(r.repo, repo))) return;
    setRepos([...cfg.repos, newRepo(repo)]);
    setSelected(repo);
  };
  const removeRepo = (repo: string) => {
    setRepos(cfg.repos.filter((r) => !sameRepo(r.repo, repo)));
    setSelected(null);
  };

  const disconnect = async () => {
    try {
      await githubApi.disconnect();
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["github-status"] });
      await queryClient.invalidateQueries({ queryKey: ["github-board"] });
    }
  };

  const addPublic = () => {
    const name = parseRepoUrl(publicUrl ?? "");
    if (!name) return setUrlError("Expected https://github.com/owner/repo");
    if (cfg.repos.some((r) => sameRepo(r.repo, name))) return setUrlError("That repo is already on your bar.");
    addRepo(name);
    setPublicUrl(null);
    setUrlError(null);
  };

  return (
    <div className="grid min-h-[480px] grid-cols-[240px_minmax(0,1fr)]" data-section="github-panes">
      {/* ── Left: account, the repos on the bar, add ── */}
      <div className="flex min-h-0 flex-col gap-1.5 border-r border-edge p-3.5">
        <div className="flex items-center gap-2 px-1.5 pb-2">
          <span className="text-[17px] font-extrabold text-fg">GitHub</span>
          <span className="truncate font-mono text-[11.5px] text-fg-3">@{login}</span>
          <span className="ml-auto">
            <OverflowMenu
              triggerLabel="GitHub options"
              trigger={
                <button type="button" aria-label="GitHub options" className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-surface-hover hover:text-fg">
                  <MoreHorizontal size={15} />
                </button>
              }
              items={[
                { key: "quiet", label: "Quiet hours…", hint: cfg.quietHours.on ? `${cfg.quietHours.from} to ${cfg.quietHours.to}` : "Off", onSelect: () => setQuietOpen((v) => !v) },
                { key: "flash", label: "Flash on change", hint: cfg.flash ? "On" : "Off", onSelect: () => write({ flash: !cfg.flash }) },
                { key: "public", label: "Track a public repo…", onSelect: () => setPublicUrl("") },
                { key: "choose", label: "Choose repos on GitHub ↗", onSelect: () => openExternal(INSTALL_URL) },
                { key: "d", divider: true },
                { key: "disconnect", label: "Disconnect", destructive: true, onSelect: () => void disconnect() },
              ]}
            />
          </span>
        </div>

        {quietOpen && <QuietHours cfg={cfg} write={write} />}

        <span className="px-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">On your bar</span>
        <div className="flex flex-col gap-0.5" role="list" aria-label="On your bar">
          {cfg.repos.map((t) => {
            const row = rowOf(t.repo);
            const pills = row ? pillsFor(row, t) : [];
            const worst = worstOf(pills);
            return (
              <button
                key={t.repo}
                type="button"
                role="listitem"
                onClick={() => setSelected(t.repo)}
                aria-current={sel && sameRepo(sel.repo, t.repo) ? "true" : undefined}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left",
                  sel && sameRepo(sel.repo, t.repo) ? "bg-surface-3 text-fg" : "text-fg-2 hover:bg-surface-2",
                )}
              >
                <span
                  className={clsx(
                    "size-2 shrink-0 rounded-full",
                    worst === "red" ? "bg-down" : worst === "accent" ? "bg-widget-github" : worst === "ok" ? "bg-up" : "bg-fg-4",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{repoName(t.repo)}</span>
                <span className="font-mono text-[11px] text-fg-3">{pills.length || ""}</span>
              </button>
            );
          })}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] text-fg-3 hover:text-fg"
            aria-expanded={adding}
          >
            <Plus size={12} /> Add a repo
          </button>
          {adding && (
            <RepoPicker
              rows={yours}
              tracked={cfg.repos}
              onToggle={(name, on) => (on ? addRepo(name) : removeRepo(name))}
              onClose={() => setAdding(false)}
              onPublic={() => {
                setAdding(false);
                setPublicUrl("");
              }}
            />
          )}
        </div>

        {publicUrl !== null && (
          <div className="flex flex-col gap-1 px-1.5">
            <div className="flex gap-1.5">
              <input
                type="url"
                autoFocus
                aria-label="Public repo URL"
                value={publicUrl}
                onChange={(e) => {
                  setPublicUrl(e.target.value);
                  setUrlError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPublic();
                  if (e.key === "Escape") setPublicUrl(null);
                }}
                placeholder="https://github.com/owner/repo"
                className="min-w-0 flex-1 rounded-md border border-edge bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-fg-4 focus:border-widget-github/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={addPublic}
                disabled={!publicUrl.trim()}
                className="rounded-md border border-widget-github/25 bg-widget-github/10 px-2.5 text-[11px] font-semibold text-widget-github disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {urlError && <p className="text-[11px] text-error">{urlError}</p>}
          </div>
        )}

        <span className="mt-auto px-1.5 pt-4 text-[12px] leading-relaxed text-fg-3">
          1–2 repos ride the edge in one rotating slot. 3 or more get a page, one cell each.
        </span>
      </div>

      {/* ── Right: the selected repo ── */}
      {sel ? (
        <RepoPane
          key={sel.repo}
          t={sel}
          row={rowOf(sel.repo)}
          onChange={(patch) => updateRepo(sel.repo, patch)}
          onRemove={() => removeRepo(sel.repo)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
          <Github size={22} className="text-widget-github/60" />
          <p className="text-[13px] text-fg-2">Nothing on your bar yet.</p>
          <button type="button" onClick={() => setAdding(true)} className="text-[12.5px] font-semibold text-widget-github hover:underline">
            + Add a repo
          </button>
        </div>
      )}
    </div>
  );
}

// ── The selected repo ───────────────────────────────────────────

function RepoPane({
  t,
  row,
  onChange,
  onRemove,
}: {
  t: GitHubTrackedRepo;
  row: GitHubBoardRepo | undefined;
  onChange: (patch: Partial<GitHubTrackedRepo>) => void;
  onRemove: () => void;
}) {
  const owner = t.repo.slice(0, t.repo.indexOf("/"));
  const { data: wf, isPending } = useQuery({
    queryKey: ["github-workflows", t.repo.toLowerCase()],
    queryFn: () => githubApi.workflows(t.repo),
    staleTime: 5 * 60_000,
  });
  const workflows: GitHubWorkflowRow[] = wf?.workflows ?? [];
  // Absent: the ones that ran recently, as core resolves it.
  const ticked = useMemo(
    () => new Set(t.workflows ?? workflows.filter((w) => w.ran_recently).map((w) => w.name)),
    [t.workflows, workflows],
  );
  const toggle = (name: string) => {
    const next = new Set(ticked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // In the list's order; a name the list no longer has is dropped with it.
    onChange({ workflows: workflows.map((w) => w.name).filter((n) => next.has(n)) });
  };

  const dark = isDark();
  const chip = row ? repoChip(row, t, false) : null;
  const permission = t.issues !== "off" && row?.issues?.error === "permission";

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-7 py-5" data-section="github-repo">
      <div className="flex items-center gap-2.5">
        <span className="truncate text-[20px] font-extrabold text-fg">{repoName(t.repo)}</span>
        <span className="font-mono text-[12px] text-fg-3">{owner}</span>
        <button type="button" onClick={onRemove} className="ml-auto flex items-center gap-1 px-2 py-1 text-[12.5px] text-fg-3 hover:text-down">
          <X size={12} /> Remove from bar
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">On the bar it looks like</span>
        <div
          data-part="preview"
          className="h-16 w-[420px] max-w-full overflow-hidden rounded-md border border-edge bg-base-150"
          style={accentStyle(accentFor(HEX, dark), inkFor(HEX, dark))}
        >
          {chip ? (
            <RepoCell chip={chip} width={420} dark={dark} onClick={() => openExternal(chip.url)} />
          ) : (
            <span className="flex h-full items-center gap-2 px-4 text-[12px] text-fg-3">
              <LoadingGlyph size={10} /> Reading GitHub…
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <fieldset className="flex min-w-0 flex-col gap-0.5">
          <legend className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">Workflows</legend>
          {isPending && <span className="px-2.5 text-[12px] text-fg-3">Reading .github/workflows…</span>}
          {!isPending && workflows.length === 0 && <span className="px-2.5 text-[12px] text-fg-3">No workflows in .github/workflows.</span>}
          {workflows.map((w) => (
            <label key={w.path || w.name} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-surface-2">
              <input type="checkbox" checked={ticked.has(w.name)} onChange={() => toggle(w.name)} className="accent-widget-github" />
              <span className="min-w-0 flex-1 truncate text-fg">{w.name}</span>
              <span
                className={clsx(
                  "font-mono text-[11.5px]",
                  w.last === "failing" ? "text-down" : w.last === "running" ? "text-widget-github" : "text-fg-3",
                )}
              >
                {w.last === "none" ? (w.last_at ? "" : "no runs") : w.last}
              </span>
            </label>
          ))}
          <span className="px-2.5 pt-1.5 text-[12px] leading-relaxed text-fg-3">
            Ticked ones show on the bar; a failure, a run or a change in what needs you can flash.
          </span>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-0.5">
          <Radios name={`prs-${t.repo}`} legend="Pull requests" options={PR_OPTIONS} value={t.prs} onChange={(prs) => onChange({ prs })} />
          <div className="pt-3.5">
            <Radios name={`issues-${t.repo}`} legend="Issues" options={ISSUE_OPTIONS} value={t.issues} onChange={(issues) => onChange({ issues })} />
          </div>
          {permission ? (
            <button type="button" onClick={() => openExternal(INSTALL_URL)} className="self-start px-2.5 pt-1.5 text-[12.5px] font-semibold text-widget-github hover:underline">
              Approve on GitHub ↗
            </button>
          ) : (
            <span className="px-2.5 pt-1.5 text-[12px] leading-relaxed text-fg-3">
              Issues needs one more GitHub permission; the first time you turn it on, GitHub asks you to approve it.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Radios<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: Array<[T, string]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">{legend}</legend>
      {options.map(([v, label]) => (
        <label key={v} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg hover:bg-surface-2">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="accent-widget-github" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

// ── Quiet hours ─────────────────────────────────────────────────

function QuietHours({ cfg, write }: { cfg: GitHubWidgetConfig; write: (patch: Partial<GitHubWidgetConfig>) => void }) {
  const q = cfg.quietHours;
  const set = (patch: Partial<typeof q>) => write({ quietHours: { ...q, ...patch } });
  return (
    <div className="mx-1.5 mb-2 flex flex-col gap-1.5 rounded-md border border-edge bg-surface-2 px-2.5 py-2 text-[12px]" data-section="quiet-hours">
      <label className="flex cursor-pointer items-center gap-2 text-fg">
        <input type="checkbox" checked={q.on} onChange={(e) => set({ on: e.target.checked })} className="accent-widget-github" />
        Quiet hours
      </label>
      {q.on && (
        <span className="flex items-center gap-1 font-mono text-fg-3">
          <input type="time" aria-label="Quiet from" value={q.from} onChange={(e) => e.target.value && set({ from: e.target.value })} className="rounded border border-edge bg-surface px-1 text-fg" />
          to
          <input type="time" aria-label="Quiet until" value={q.to} onChange={(e) => e.target.value && set({ to: e.target.value })} className="rounded border border-edge bg-surface px-1 text-fg" />
        </span>
      )}
      <span className="text-fg-3">The bar goes silent for GitHub; this page still shows everything.</span>
    </div>
  );
}

// ── + Add a repo: the picker (SCROLLR-307) ──────────────────────

function activityLabel(r: GitHubRepoRow, now: number): string {
  if (r.last_run_at) return `last run ${relativeTime(r.last_run_at, now, { suffix: true })}`;
  if (r.pushed_at) return `pushed ${relativeTime(r.pushed_at, now, { suffix: true })}`;
  return "";
}

/**
 * The connected user's repos as checkboxes, in a popover. Active repos (and
 * anything already on the bar) show by default; "Show all" reveals the rest.
 */
function RepoPicker({
  rows,
  tracked,
  onToggle,
  onClose,
  onPublic,
}: {
  rows: GitHubRepoRow[] | undefined;
  tracked: GitHubTrackedRepo[];
  onToggle: (fullName: string, on: boolean) => void;
  onClose: () => void;
  onPublic: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const isTicked = (r: GitHubRepoRow) => tracked.some((t) => sameRepo(t.repo, r.full_name));
  const all = rows ?? [];
  const hidden = all.filter((r) => !r.active && !isTicked(r)).length;
  const visible = showAll ? all : all.filter((r) => r.active || isTicked(r));
  const full = tracked.length >= MAX_REPOS;
  const now = Date.now();
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Your repos"
      className="absolute left-0 top-full z-20 mt-1 flex max-h-[360px] w-[320px] flex-col gap-1 overflow-y-auto rounded-lg border border-edge bg-surface p-2 shadow-lg"
    >
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-fg-3">Your repos</span>
      {!rows && <LoadingGlyph size={10} className="m-2 text-fg-3" />}
      {visible.map((r) => (
        <label key={r.full_name} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
          <input
            type="checkbox"
            checked={isTicked(r)}
            disabled={full && !isTicked(r)}
            onChange={(e) => onToggle(r.full_name, e.target.checked)}
            className="shrink-0 accent-widget-github"
          />
          <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-fg">{r.full_name}</span>
          {r.private && <Lock size={10} aria-label="Private" className="shrink-0 text-fg-3" />}
          <span className="shrink-0 font-mono text-[10px] text-fg-3">{activityLabel(r, now)}</span>
        </label>
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start px-1 text-[11px] text-widget-github hover:underline">
          {showAll ? "Show active only" : `Show all (${hidden} more)`}
        </button>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 border-t border-edge px-1 pt-1.5 text-[11px]">
        <button type="button" onClick={() => openExternal(INSTALL_URL)} className="font-semibold text-widget-github hover:underline">
          Choose repos on GitHub
        </button>
        <button type="button" onClick={onPublic} className="text-fg-3 hover:text-fg">
          Track a public repo…
        </button>
      </div>
    </div>
  );
}

// ── Connect (SCROLLR-304) ───────────────────────────────────────

/** After Connect opens the browser: check every 5 s, for 2 minutes. */
const CONNECT_POLL_MS = 5_000;
const CONNECT_WINDOW_MS = 120_000;

/**
 * The Connect state. Core holds the token; this only shows the state and
 * starts the connection.
 */
function GitHubAccount() {
  const queryClient = useQueryClient();
  const [waitUntil, setWaitUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const waiting = waitUntil > Date.now();

  const { data: status } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
    refetchInterval: waiting ? CONNECT_POLL_MS : 120_000,
  });

  // Connected while waiting: stop polling and read the board with the token.
  useEffect(() => {
    if (waiting && status?.connected) {
      setWaitUntil(0);
      void queryClient.invalidateQueries({ queryKey: ["github-board"] });
    }
  }, [waiting, status?.connected, queryClient]);

  useEffect(() => {
    if (!waitUntil) return;
    const t = setTimeout(() => setWaitUntil(0), Math.max(0, waitUntil - Date.now()));
    return () => clearTimeout(t);
  }, [waitUntil]);

  const connect = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await githubApi.connect();
      await invoke("open_external", { url });
      setWaitUntil(Date.now() + CONNECT_WINDOW_MS);
    } catch {
      setActionError("Couldn't start the GitHub connection. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="w-full space-y-1">
      <div className="flex items-center justify-between gap-2 rounded-md border border-edge bg-surface-2 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-fg-3">
          {waiting ? "Finish in your browser…" : status?.reason ? "GitHub needs reconnecting" : "Connect GitHub to put your repos on the bar"}
        </span>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="shrink-0 rounded-md border border-widget-github/25 bg-widget-github/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-widget-github hover:bg-widget-github/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status?.reason ? "Reconnect GitHub" : "Connect GitHub"}
        </button>
      </div>
      {(actionError || status?.reason) && <p className="font-mono text-[10px] text-error">{actionError ?? status?.reason}</p>}
    </div>
  );
}
