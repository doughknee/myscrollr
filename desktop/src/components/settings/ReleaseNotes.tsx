/**
 * ReleaseNotes — the sortable release-history table.
 *
 * Lives under Updates rather than on its own page: the version you're on
 * and the list of what shipped are the same question asked twice, and
 * splitting them meant the updater and its changelog were two clicks
 * apart. The account menu still offers "What's new" as a way in — it's a
 * more inviting label than "Updates" — it just lands here now.
 *
 * Data comes from GitHub Releases at runtime (see lib/releases.ts for the
 * contract shared with myscrollr.com). Version and Date headers toggle
 * asc/desc — version compares numeric segments, not lexically — and
 * default to newest first. A row expands in place to rendered markdown
 * plus a "View on GitHub" link. Newest stable wears "Latest";
 * prereleases wear "Pre-release".
 *
 * States: skeleton rows while fetching, and a card linking to the GitHub
 * releases page when nothing loads (offline, rate-limited, or genuinely
 * empty) — never a blank space.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  PackageOpen,
} from "lucide-react";

import {
  fetchReleases,
  compareVersions,
  formatReleaseDate,
  relativeTime,
  renderReleaseMarkdown,
  RELEASES_PAGE_URL,
  type ReleaseEntry,
} from "../../lib/releases";

// ── Sort state ──────────────────────────────────────────────────

type SortKey = "version" | "date";
type SortDir = "asc" | "desc";

function dateMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Shared row grid — header and body rows must agree on columns:
// Version (+badges) | Date | Headline | expand chevron.
const ROW_GRID =
  "grid grid-cols-[minmax(130px,160px)_130px_1fr_24px] items-center gap-3";

// ── Component ───────────────────────────────────────────────────

export default function ReleaseNotes() {
  // null = loading, [] = nothing available (error/offline/empty).
  const [releases, setReleases] = useState<ReleaseEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchReleases().then((entries) => {
      if (!cancelled) setReleases(entries);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  // NOTE: no setter-inside-updater here — updater functions must be
  // pure (StrictMode double-invokes them in dev, which would toggle
  // the direction twice and turn the click into a no-op).
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc"); // fresh column starts newest/highest first
      }
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    if (!releases) return [];
    const copy = [...releases];
    copy.sort((a, b) => {
      const cmp =
        sortKey === "version"
          ? compareVersions(a.version, b.version)
          : dateMs(a.date) - dateMs(b.date);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [releases, sortKey, sortDir]);

  // "Latest" = newest stable by publish date (GitHub's own convention);
  // if every entry is a prerelease, the newest one overall wins.
  const latestTag = useMemo(() => {
    if (!releases || releases.length === 0) return null;
    const stable = releases.filter((r) => !r.prerelease);
    const pool = stable.length > 0 ? stable : releases;
    return pool.reduce((best, r) => (dateMs(r.date) > dateMs(best.date) ? r : best))
      .tag;
  }, [releases]);

  return (
    <>
      {releases === null ? (
        <SkeletonTable />
      ) : releases.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-xl border border-edge/35 bg-base-150/35">
          {/* ── Header row ── */}
          <div
            role="row"
            className={clsx(ROW_GRID, "border-b border-edge/40 bg-base-200/50 px-4 py-2")}
          >
            <SortHeader
              label="Version"
              active={sortKey === "version"}
              dir={sortDir}
              onClick={() => toggleSort("version")}
            />
            <SortHeader
              label="Date"
              active={sortKey === "date"}
              dir={sortDir}
              onClick={() => toggleSort("date")}
            />
            <span role="columnheader" className="text-ui-section">
              Headline
            </span>
            <span aria-hidden />
          </div>

          {/* ── Rows ── */}
          <div>
            {sorted.map((entry) => (
              <ReleaseRow
                key={entry.tag}
                entry={entry}
                isLatest={entry.tag === latestTag}
                expanded={expandedTag === entry.tag}
                onToggle={() =>
                  setExpandedTag((prev) => (prev === entry.tag ? null : entry.tag))
                }
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Sortable column header ──────────────────────────────────────

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <span
      role="columnheader"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        onClick={onClick}
        className={clsx(
          "flex items-center gap-1 rounded-md px-1 py-0.5 -mx-1 text-ui-section cursor-pointer",
          active ? "text-accent" : "hover:text-fg-2",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp size={11} strokeWidth={2.5} />
          ) : (
            <ArrowDown size={11} strokeWidth={2.5} />
          )
        ) : (
          <ArrowUpDown size={11} className="opacity-50" />
        )}
      </button>
    </span>
  );
}

// ── Release row (collapsed line + expandable notes) ─────────────

function ReleaseRow({
  entry,
  isLatest,
  expanded,
  onToggle,
}: {
  entry: ReleaseEntry;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Render markdown lazily — only the expanded row pays the parse cost.
  const notesHtml = useMemo(
    () => (expanded ? renderReleaseMarkdown(entry.body) : ""),
    [expanded, entry.body],
  );

  // Links inside release notes must open in the system browser, not
  // navigate the webview — intercept anchor clicks and route through
  // the shell opener (same pattern as the rest of the app).
  const handleNotesClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor?.href) {
      e.preventDefault();
      open(anchor.href).catch(() => {});
    }
  }, []);

  return (
    <div className="border-b border-edge/25 last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={clsx(
          ROW_GRID,
          "w-full px-4 py-3 text-left cursor-pointer",
          expanded ? "bg-base-150/60" : "hover:bg-base-150/50",
        )}
      >
        {/* Version + badges */}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-ui-body font-semibold">
            v{entry.version}
          </span>
          {isLatest && (
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-ui-chip font-semibold leading-none text-accent">
              Latest
            </span>
          )}
          {entry.prerelease && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-ui-chip font-semibold leading-none text-amber-400">
              Pre-release
            </span>
          )}
        </span>

        {/* Date — calendar + relative age */}
        <span className="flex flex-col">
          <span className="text-ui-body">{formatReleaseDate(entry.date) || "—"}</span>
          <span className="text-ui-chip">{relativeTime(entry.date)}</span>
        </span>

        {/* Headline */}
        <span className="truncate text-ui-muted">
          {entry.headline || entry.name}
        </span>

        <ChevronDown
          size={15}
          className={clsx(
            "justify-self-end text-fg-3 ",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expanded notes */}
      {expanded && (
        <div className="overflow-hidden">
            <div className="border-t border-edge/25 bg-base-100/40 px-4 py-4">
              {entry.body.trim() ? (
                <div
                  className="release-notes-md"
                  onClick={handleNotesClick}
                  dangerouslySetInnerHTML={{ __html: notesHtml }}
                />
              ) : (
                <p className="text-ui-meta">No notes for this release.</p>
              )}
              <div className="mt-4 flex justify-end border-t border-edge/25 pt-3">
                <button
                  onClick={() => open(entry.url).catch(() => {})}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui-chip font-medium text-fg-3 hover:bg-base-250/50 hover:text-fg-2 cursor-pointer"
                >
                  <ExternalLink size={12} />
                  View on GitHub
                </button>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}

// ── Loading skeleton ────────────────────────────────────────────

function SkeletonTable() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-edge/35 bg-base-150/35"
      aria-busy="true"
      aria-label="Loading releases"
    >
      <div className={clsx(ROW_GRID, "border-b border-edge/40 bg-base-200/50 px-4 py-2")}>
        <span className="text-ui-section">Version</span>
        <span className="text-ui-section">Date</span>
        <span className="text-ui-section">Headline</span>
        <span aria-hidden />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={clsx(ROW_GRID, "border-b border-edge/25 px-4 py-3.5 last:border-b-0")}
        >
          <span className="h-3.5 w-16 rounded bg-base-250" />
          <span className="h-3.5 w-24 rounded bg-base-250" />
          <span
            className="h-3.5 rounded bg-base-250"
            style={{ width: `${45 + ((i * 17) % 40)}%` }}
          />
          <span aria-hidden />
        </div>
      ))}
    </div>
  );
}

// ── Empty / error state ─────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-edge/35 bg-base-150/35 px-6 py-16 text-center">
      <PackageOpen size={28} className="mb-3 text-fg-3 opacity-60" />
      <h3 className="text-ui-body font-semibold">Couldn't load release notes</h3>
      <p className="mt-1 max-w-sm text-ui-meta">
        You might be offline, or GitHub may be taking a breather. The full
        version history is always available on GitHub.
      </p>
      <button
        onClick={() => open(RELEASES_PAGE_URL).catch(() => {})}
        className="mt-4 flex items-center gap-1.5 rounded-lg bg-accent/10 px-3.5 py-1.5 text-ui-body font-semibold text-accent hover:bg-accent/20 cursor-pointer"
      >
        <ExternalLink size={14} />
        View releases on GitHub
      </button>
    </div>
  );
}
