/**
 * GitHub Actions widget FeedTab.
 *
 * Tracks CI/Actions workflow run status for user-configured public
 * GitHub repos. Repos are added individually via URL input. Data is
 * cached in the Tauri store for cross-window ticker sync.
 */
import { useState, useCallback } from "react";
import { Github, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import type { FeedTabProps, WidgetManifest } from "../../types";
import Tooltip from "../../components/Tooltip";
import QueryErrorBanner from "../../components/QueryErrorBanner";
import type { GitHubRepo } from "./types";
import {
  parseRepoUrl,
  repoKey,
  fetchAllRepos,
  loadRepoData,
  saveRepoData,
  CI_STATUS_LABELS,
  CI_STATUS_COLORS,
  CI_STATUS_TEXT,
} from "./types";
import { useShell } from "../../shell-context";
import { savePrefs, updateWidgetPrefs } from "../../preferences";
import { useSyncedQuery } from "../../hooks/useSyncedQuery";
import { LS_GITHUB_REPOS } from "../../constants";

// ── Widget manifest ─────────────────────────────────────────────

export const githubWidget: WidgetManifest = {
  id: "github",
  name: "GitHub",
  tabLabel: "GitHub",
  description: "CI/Actions status for your repos",
  hex: "#f97316",
  icon: Github,
  info: {
    about:
      "The GitHub widget tracks the latest workflow run status for " +
      "your public GitHub repositories.",
    usage: [
      "Paste a GitHub repo URL to add it (e.g. https://github.com/org/repo).",
      "Each repo shows its latest GitHub Actions workflow run status.",
      "Click a repo row to open the workflow run on GitHub.",
      "Hide specific repos from the ticker in the Configure tab.",
    ],
  },
  FeedTab: GitHubFeedTab,
};

// ── FeedTab ─────────────────────────────────────────────────────

function GitHubFeedTab({ mode: feedMode }: FeedTabProps) {
  const compact = feedMode === "compact";
  const shell = useShell();
  const configRepos = shell.prefs.widgets.github.repos;
  const pollInterval = shell.prefs.widgets.github.pollInterval;

  const [inputUrl, setInputUrl] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  // Auto-refresh + cross-window sync via useSyncedQuery
  const { data: repoData, error } = useSyncedQuery<GitHubRepo>({
    storeKey: LS_GITHUB_REPOS,
    loadFn: loadRepoData,
    saveFn: saveRepoData,
    queryKey: ["github-actions", configRepos.map(repoKey)],
    queryFn: () => fetchAllRepos(configRepos),
    enabled: configRepos.length > 0,
    pollInterval,
    retry: 1,
  });

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

    // Save to prefs
    const nextRepos = [...configRepos, parsed];
    const next = updateWidgetPrefs(shell.prefs, "github", { repos: nextRepos });
    shell.onPrefsChange(next);
    savePrefs(next);

    setInputUrl("");
    setInputError(null);
  }, [inputUrl, configRepos, shell]);

  // ── Remove repo handler ───────────────────────────────────────

  const removeRepo = useCallback(
    (owner: string, repo: string) => {
      const key = repoKey({ owner, repo });
      const nextRepos = configRepos.filter((r) => repoKey(r) !== key);
      const next = updateWidgetPrefs(shell.prefs, "github", { repos: nextRepos });
      shell.onPrefsChange(next);
      savePrefs(next);

      // Also remove from cached data
      const nextData = repoData.filter((r) => repoKey(r) !== key);
      saveRepoData(nextData);
    },
    [configRepos, repoData, shell],
  );

  // ── Empty state ───────────────────────────────────────────────

  if (configRepos.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center justify-center gap-3">
        <Github size={24} className="text-widget-github/60" />
        <span className="text-xs font-mono text-fg-2 text-center">
          Add a GitHub repo to track CI status
        </span>

        <div className="w-full max-w-sm space-y-2">
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => { setInputUrl(e.target.value); setInputError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddRepo(); }}
            placeholder="https://github.com/owner/repo"
            className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-surface-2 border border-edge text-fg placeholder:text-fg-4 focus:border-widget-github/50 focus:outline-none transition-colors"
          />
          <button
            onClick={handleAddRepo}
            disabled={!inputUrl.trim()}
            className="w-full text-xs font-mono font-semibold text-widget-github px-3 py-2 rounded-lg bg-widget-github/10 border border-widget-github/25 hover:bg-widget-github/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

      {/* Status summary */}
      <div className="flex items-center gap-3 px-1 text-[11px] font-mono text-fg-3">
        {passCount > 0 && <span className="text-up">{passCount} passing</span>}
        {failCount > 0 && <span className="text-down">{failCount} failing</span>}
        {passCount === 0 && failCount === 0 && repoData.length > 0 && (
          <span className="text-fg-4">checking...</span>
        )}
      </div>

      {/* Error banner */}
      <QueryErrorBanner error={error} />

      {/* Add repo input */}
      <div className="flex gap-1.5 px-1">
        <input
          type="url"
          value={inputUrl}
          onChange={(e) => { setInputUrl(e.target.value); setInputError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") handleAddRepo(); }}
          placeholder="Add another repo..."
          className="flex-1 text-[11px] font-mono px-2.5 py-1.5 rounded-md bg-surface-2 border border-edge text-fg placeholder:text-fg-4 focus:border-widget-github/50 focus:outline-none transition-colors"
        />
        <Tooltip content="Add repo">
          <button
            onClick={handleAddRepo}
            disabled={!inputUrl.trim()}
            aria-label="Add repo"
            className="text-[11px] font-mono font-semibold text-widget-github px-2.5 py-1.5 rounded-md bg-widget-github/10 border border-widget-github/25 hover:bg-widget-github/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
        {configRepos.map((configRepo) => {
          const rd = repoData.find((r) => repoKey(r) === repoKey(configRepo));
          return (
            <RepoRow
              key={repoKey(configRepo)}
              owner={configRepo.owner}
              repo={configRepo.repo}
              data={rd ?? null}
              compact={compact}
              onRemove={() => removeRepo(configRepo.owner, configRepo.repo)}
            />
          );
        })}
      </div>
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

  return (
    <div
      className={`flex items-center gap-2 px-2 rounded-md border border-edge/50 bg-surface-2/30 ${compact ? "py-1.5" : "py-2"}`}
    >
      {/* Status dot */}
      {isLoading ? (
        <Loader2 size={10} className="animate-spin text-fg-4 shrink-0" />
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 ${CI_STATUS_COLORS[status]}${status === "failure" ? " animate-pulse" : ""}`} />
      )}

      {/* Repo name + workflow */}
      <div className="flex-1 min-w-0">
        {data?.runUrl ? (
          <a
            href={data.runUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-fg hover:text-widget-github transition-colors truncate block"
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
        {isLoading ? "" : CI_STATUS_LABELS[status]}
      </span>

      {/* Remove */}
      <Tooltip content="Remove repo">
        <button
          onClick={onRemove}
          aria-label="Remove repo"
          className="text-fg-4 hover:text-error transition-colors shrink-0"
        >
          <Trash2 size={11} />
        </button>
      </Tooltip>
    </div>
  );
}
