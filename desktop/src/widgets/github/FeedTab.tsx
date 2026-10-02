/**
 * GitHub Actions widget FeedTab.
 *
 * Tracks CI/Actions workflow run status for user-configured GitHub repos.
 * Repos are added via URL input, or, once connected, ticked in the Your
 * repos picker (SCROLLR-307). Connecting GitHub (the Scrollr Desktop GitHub
 * App, brokered by core) adds private repos and the user's own rate limit
 * (SCROLLR-304). Data is cached in the Tauri store
 * for cross-window ticker sync.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { clsx } from "clsx";
import { Github, Plus, X, ExternalLink, Lock } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { FeedTabProps, WidgetManifest } from "../../types";
import Tooltip from "../../components/Tooltip";
import { FEED_CARD, FEED_CARD_STATIC } from "../../components/feedCard";
import QueryErrorBanner from "../../components/QueryErrorBanner";
import LoadingGlyph from "../../components/LoadingGlyph";
import { controlTransition, tooltipMotion } from "../../lib/motion";
import type { GitHubRepo } from "./types";
import {
  parseRepoUrl,
  repoKey,
  fetchRepos,
  loadRepoData,
  saveRepoData,
  toggleRepo,
  autoPick,
  CI_STATUS_LABELS,
  CI_STATUS_COLORS,
  CI_STATUS_TEXT,
} from "./types";
import { useShell } from "../../shell-context";
import { savePrefs, updateWidgetPrefs } from "../../preferences";
import { useSyncedQuery } from "../../hooks/useSyncedQuery";
import { LS_GITHUB_REPOS } from "../../constants";
import { githubApi } from "../../api/client";
import { relativeTime } from "../../utils/format";
import type { GitHubRepoRow } from "../../api/client";

// ── Widget manifest ─────────────────────────────────────────────

export const githubWidget: WidgetManifest = {
  id: "github",
  name: "GitHub",
  tabLabel: "GitHub",
  description: "CI status for your repos — connect GitHub for private ones",
  hex: "#f97316",
  icon: Github,
  info: {
    about:
      "The GitHub widget tracks the latest workflow run status for " +
      "your GitHub repositories. Connect GitHub to include private ones.",
    usage: [
      "Connect GitHub and tick your repos under Your repos; the ones with recent Actions runs start ticked.",
      "Paste a GitHub repo URL to add any other public repo (e.g. https://github.com/org/repo).",
      "Disconnect GitHub any time.",
      "Each repo shows its latest GitHub Actions workflow run status.",
      "Click a repo row to open the workflow run on GitHub.",
    ],
  },
  FeedTab: GitHubFeedTab,
};

// ── FeedTab ─────────────────────────────────────────────────────

/** Seconds between GitHub fetches. Not a user setting (REL-206). */
const POLL_INTERVAL = 120;

const REMOVE_MOTION = {
  hidden: {
    opacity: 0,
    transform: "scale(0.9)",
    pointerEvents: "none" as const,
  },
  visible: {
    opacity: 1,
    transform: "scale(1)",
    pointerEvents: "auto" as const,
  },
};

function GitHubFeedTab({ mode: feedMode }: FeedTabProps) {
  const compact = feedMode === "compact";
  const shell = useShell();
  const configRepos = shell.prefs.widgets.github.repos;

  const [inputUrl, setInputUrl] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Auto-refresh + cross-window sync via useSyncedQuery
  const {
    data: repoData,
    error,
    isFetching,
    refetch,
  } = useSyncedQuery<GitHubRepo>({
    storeKey: LS_GITHUB_REPOS,
    loadFn: loadRepoData,
    saveFn: saveRepoData,
    queryKey: ["github-actions", shell.authenticated, configRepos.map(repoKey)],
    queryFn: () => fetchRepos(configRepos),
    enabled: configRepos.length > 0,
    pollInterval: POLL_INTERVAL,
    retry: 1,
  });

  // ── Write the configured repos (URL box, Remove and the picker) ──

  const setRepos = useCallback(
    (nextRepos: Array<{ owner: string; repo: string }>) => {
      const next = updateWidgetPrefs(shell.prefs, "github", { repos: nextRepos });
      shell.onPrefsChange(next);
      savePrefs(next);

      // Drop removed repos from the cached data the ticker reads.
      const keep = new Set(nextRepos.map(repoKey));
      if (repoData.some((r) => !keep.has(repoKey(r)))) {
        saveRepoData(repoData.filter((r) => keep.has(repoKey(r))));
      }
    },
    [repoData, shell],
  );

  // ── Your repos (SCROLLR-307) ──────────────────────────────────

  const { data: status } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
    enabled: shell.authenticated,
  });
  const { data: yours } = useQuery({
    queryKey: ["github-repos"],
    queryFn: githubApi.repos,
    enabled: shell.authenticated && !!status?.connected,
    retry: false,
  });

  // First load only, and only into an empty list. The ref lives here, not
  // in the picker, so unticking the last repo does not re-tick the rest.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || !yours) return;
    autoPicked.current = true;
    const picked = autoPick(configRepos, yours.repos);
    if (picked) setRepos(picked);
  }, [yours, configRepos, setRepos]);

  const picker =
    status?.connected && yours ? (
      <YourRepos rows={yours.repos} configRepos={configRepos} onChange={setRepos} />
    ) : null;

  // ── Add repo handler ──────────────────────────────────────────

  const handleAddRepo = useCallback(() => {
    const parsed = parseRepoUrl(inputUrl);
    if (!parsed) {
      setInputError("Invalid GitHub URL. Expected: https://github.com/owner/repo");
      return;
    }

    // Check for duplicates
    const key = repoKey(parsed);
    if (configRepos.some((r) => repoKey(r) === key)) {
      setInputError("This repo is already added.");
      return;
    }

    setRepos([...configRepos, parsed]);
    setInputUrl("");
    setInputError(null);
  }, [inputUrl, configRepos, setRepos]);

  // ── Remove repo handler ───────────────────────────────────────

  const removeRepo = useCallback(
    (owner: string, repo: string) => {
      const key = repoKey({ owner, repo });
      setRepos(configRepos.filter((r) => repoKey(r) !== key));
    },
    [configRepos, setRepos],
  );

  // ── Empty state ───────────────────────────────────────────────

  if (configRepos.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center justify-center gap-3">
        <Github size={24} className="text-widget-github/60" />
        <span className="text-xs font-mono text-fg-2 text-center">
          Add a GitHub repo to track CI status
        </span>

        <div className="w-full max-w-sm">
          <GitHubAccount />
        </div>

        {picker && <div className="w-full max-w-sm">{picker}</div>}

        <div className="w-full max-w-sm space-y-2">
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => { setInputUrl(e.target.value); setInputError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddRepo(); }}
            placeholder="https://github.com/owner/repo"
            className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-surface-2 border border-edge text-fg placeholder:text-fg-4 focus:border-widget-github/50 focus:outline-none "
          />
          <button
            onClick={handleAddRepo}
            disabled={!inputUrl.trim()}
            className="w-full text-xs font-mono font-semibold text-widget-github px-3 py-2 rounded-lg bg-widget-github/10 border border-widget-github/25 hover:bg-widget-github/15  disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Plus size={12} />
            Add Repo
          </button>
        </div>

        {inputError && (
          <p className="text-[11px] font-mono text-error text-center max-w-sm">
            {inputError}
          </p>
        )}
      </div>
    );
  }

  // ── Connected state ───────────────────────────────────────────

  const passCount = repoData.filter((r) => r.status === "success").length;
  const failCount = repoData.filter((r) => r.status === "failure").length;

  return (
    <div className="p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold text-widget-github/80 uppercase tracking-wider">
            GitHub
          </span>
          <span className="text-[10px] font-mono text-fg-4">
            {configRepos.length} repo{configRepos.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <GitHubAccount />

      {/* Status summary */}
      <div className="flex items-center gap-3 px-1 text-[11px] font-mono text-fg-3">
        {passCount > 0 && <span className="text-up">{passCount} passing</span>}
        {failCount > 0 && <span className="text-down">{failCount} failing</span>}
        {passCount === 0 && failCount === 0 && repoData.length > 0 && (
          <span className="text-fg-4">checking...</span>
        )}
      </div>

      {/* Error banner */}
      <QueryErrorBanner
        error={error}
        message="Couldn't refresh repository status."
        onRetry={() => void refetch()}
        retrying={isFetching}
      />

      {picker}

      {/* Add repo input */}
      <div className="flex gap-1.5 px-1">
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => { setInputUrl(e.target.value); setInputError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddRepo(); }}
          placeholder="Add another repo..."
          className="flex-1 text-[11px] font-mono px-2.5 py-1.5 rounded-md bg-surface-2 border border-edge text-fg placeholder:text-fg-4 focus:border-widget-github/50 focus:outline-none "
        />
        <Tooltip content="Add repo">
          <button
            onClick={handleAddRepo}
            disabled={!inputUrl.trim()}
            aria-label="Add repo"
            className="text-[11px] font-mono font-semibold text-widget-github px-2.5 py-1.5 rounded-md bg-widget-github/10 border border-widget-github/25 hover:bg-widget-github/15  disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={11} />
          </button>
        </Tooltip>
      </div>
      {inputError && (
        <p className="text-[10px] font-mono text-error px-1">
          {inputError}
        </p>
      )}

      {/* Repo list */}
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        <AnimatePresence initial={false}>
          {configRepos.map((configRepo) => {
            const rd = repoData.find((r) => repoKey(r) === repoKey(configRepo));
            return (
              <motion.div
                key={repoKey(configRepo)}
                layout="position"
                variants={tooltipMotion}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ layout: controlTransition }}
              >
                <RepoRow
                  owner={configRepo.owner}
                  repo={configRepo.repo}
                  data={rd ?? null}
                  compact={compact}
                  onRemove={() => removeRepo(configRepo.owner, configRepo.repo)}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── YourRepos (SCROLLR-307) ─────────────────────────────────────

function activityLabel(r: GitHubRepoRow, now: number): string {
  if (r.last_run_at) return `last run ${relativeTime(r.last_run_at, now, { suffix: true })}`;
  if (r.pushed_at) return `pushed ${relativeTime(r.pushed_at, now, { suffix: true })}`;
  return "";
}

/**
 * The connected user's repos as checkboxes. Ticking writes the same list
 * the URL box writes. Active repos (and anything already ticked) show by
 * default; "Show all" reveals the rest.
 */
function YourRepos({
  rows,
  configRepos,
  onChange,
}: {
  rows: GitHubRepoRow[];
  configRepos: Array<{ owner: string; repo: string }>;
  onChange: (next: Array<{ owner: string; repo: string }>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;

  const ticked = new Set(configRepos.map((r) => repoKey(r).toLowerCase()));
  const isTicked = (r: GitHubRepoRow) => ticked.has(r.full_name.toLowerCase());
  const hiddenCount = rows.filter((r) => !r.active && !isTicked(r)).length;
  const visible = showAll ? rows : rows.filter((r) => r.active || isTicked(r));
  const now = Date.now();

  return (
    <div className="px-1 space-y-1">
      <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-fg-4">
        Your repos
      </div>
      <div className="space-y-0.5">
        {visible.map((r) => (
          <label
            key={r.full_name}
            className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={isTicked(r)}
              onChange={(e) => onChange(toggleRepo(configRepos, r.full_name, e.target.checked))}
              className="shrink-0 accent-widget-github"
            />
            <span className="min-w-0 flex-1 truncate text-left text-[11px] font-mono text-fg">
              {r.full_name}
            </span>
            {r.private && <Lock size={10} aria-label="Private" className="shrink-0 text-fg-4" />}
            <span className="shrink-0 text-[10px] font-mono text-fg-4">{activityLabel(r, now)}</span>
          </label>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-[10px] font-mono text-widget-github hover:underline"
        >
          {showAll ? "Show active only" : `Show all (${hiddenCount} more)`}
        </button>
      )}
    </div>
  );
}

// ── GitHubAccount ───────────────────────────────────────────────

/** After Connect opens the browser: check every 5 s, for 2 minutes. */
const CONNECT_POLL_MS = 5_000;
const CONNECT_WINDOW_MS = 120_000;

const ACCOUNT_BUTTON =
  "shrink-0 text-[11px] font-mono font-semibold px-2.5 py-1 rounded-md border disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Connect GitHub (SCROLLR-304). Core holds the token; this only shows the
 * state and starts or ends the connection. Signed out there is no account
 * to connect, so nothing renders and public repos work as they always did.
 */
function GitHubAccount() {
  const shell = useShell();
  const queryClient = useQueryClient();
  const [waitUntil, setWaitUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const waiting = waitUntil > Date.now();

  const { data: status } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
    enabled: shell.authenticated,
    refetchInterval: waiting ? CONNECT_POLL_MS : POLL_INTERVAL * 1000,
  });

  // Connected while waiting: stop polling and refetch runs with the token.
  useEffect(() => {
    if (waiting && status?.connected) {
      setWaitUntil(0);
      void queryClient.invalidateQueries({ queryKey: ["github-actions"] });
    }
  }, [waiting, status?.connected, queryClient]);

  // End the 5 s cadence when the window closes without a connection.
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

  const disconnect = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await githubApi.disconnect();
      await queryClient.invalidateQueries({ queryKey: ["github-status"] });
      await queryClient.invalidateQueries({ queryKey: ["github-actions"] });
    } catch {
      setActionError("Couldn't disconnect GitHub. Try again.");
    } finally {
      setBusy(false);
    }
  }, [queryClient]);

  if (!shell.authenticated || !status) return null;

  return (
    <div className="px-1 space-y-1">
      <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 border border-edge px-2.5 py-1.5">
        <span className="min-w-0 truncate text-[11px] font-mono text-fg-3">
          {status.connected
            ? `Connected as @${status.login}`
            : waiting
              ? "Finish in your browser…"
              : status.reason
                ? "GitHub needs reconnecting"
                : "Connect GitHub for private repos"}
        </span>
        {status.connected ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className={clsx(ACCOUNT_BUTTON, "text-fg-3 border-edge hover:text-fg")}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className={clsx(
              ACCOUNT_BUTTON,
              "text-widget-github bg-widget-github/10 border-widget-github/25 hover:bg-widget-github/15",
            )}
          >
            {status.reason ? "Reconnect GitHub" : "Connect GitHub"}
          </button>
        )}
      </div>
      {(actionError || (!status.connected && status.reason)) && (
        <p className="text-[10px] font-mono text-error">
          {actionError ?? status.reason}
        </p>
      )}
    </div>
  );
}

// ── RepoRow ─────────────────────────────────────────────────────

function RepoRow({
  owner,
  repo,
  data,
  compact,
  onRemove,
}: {
  owner: string;
  repo: string;
  data: GitHubRepo | null;
  compact: boolean;
  onRemove: () => void;
}) {
  const status = data?.status ?? "unavailable";
  const isLoading = !data;
  const [removeVisible, setRemoveVisible] = useState(false);

  return (
    <motion.div
      onHoverStart={() => setRemoveVisible(true)}
      onHoverEnd={() => setRemoveVisible(false)}
      className={clsx(
        FEED_CARD,
        FEED_CARD_STATIC,
        "relative flex items-center gap-2 overflow-hidden",
        compact && "px-2 py-1.5",
      )}
    >
      {/* Status dot */}
      {isLoading ? (
        <LoadingGlyph size={10} className="text-fg-4" />
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${CI_STATUS_COLORS[status]}${status === "failure" ? " " : ""}`} />
      )}

      {/* Repo name + workflow */}
      <div className="flex-1 min-w-0">
        {data?.runUrl ? (
          <a
            href={data.runUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-fg hover:text-widget-github  truncate block"
          >
            {owner}/{repo}
            <ExternalLink size={9} className="inline ml-1 opacity-40" />
          </a>
        ) : (
          <span className="text-xs font-mono text-fg truncate block">
            {owner}/{repo}
          </span>
        )}
        {!compact && data?.workflowName && (
          <span className="text-[10px] font-mono text-fg-4 truncate block">
            {data.workflowName}
          </span>
        )}
      </div>

      {/* Status label */}
      <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider shrink-0 ${CI_STATUS_TEXT[status]}`}>
        {isLoading ? "Checking" : CI_STATUS_LABELS[status]}
      </span>

      <Tooltip content="Remove repo">
        <motion.button
          type="button"
          initial={false}
          animate={removeVisible ? REMOVE_MOTION.visible : REMOVE_MOTION.hidden}
          transition={controlTransition}
          whileTap={{ transform: "scale(0.95)" }}
          onFocus={() => setRemoveVisible(true)}
          onBlur={() => setRemoveVisible(false)}
          onClick={onRemove}
          aria-label="Remove repo"
          className="absolute right-2 top-2 z-10 flex h-7 min-w-16 items-center justify-center gap-1 rounded-md border border-down/30 bg-surface-3 px-2.5 text-ui-chip font-semibold text-down shadow-md hover:bg-surface-hover"
        >
          Remove <X size={11} />
        </motion.button>
      </Tooltip>
    </motion.div>
  );
}
