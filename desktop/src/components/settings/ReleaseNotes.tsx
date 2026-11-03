/** Published history is independent of enrollment and approved update offers. */
import { useCallback, useEffect, useMemo, useState, useId } from "react";
import { open } from "@tauri-apps/plugin-shell";
import clsx from "clsx";
import { ChevronDown, ExternalLink, PackageOpen } from "lucide-react";

import {
  fetchReleases,
  compareVersions,
  formatReleaseDate,
  relativeTime,
  renderReleaseMarkdown,
  RELEASES_PAGE_URL,
  type ReleaseEntry,
} from "../../lib/releases";
import { SelectMenu } from "../widget-bar/SelectMenu";
import type { UpdateChannel } from "../../lib/updateState";
import { CARD_SURFACE } from "./SettingsControls";

// ── Sort state ──────────────────────────────────────────────────

type SortKey = "version" | "date";
type SortDir = "asc" | "desc";

function dateMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Shared row grid — body and skeleton rows must agree on columns:
// Version (+badges) | Headline | relative date | expand chevron.
//
// The calendar-date column and the clickable sort headers were dropped
// when the surface narrowed to a 680px reading column: four columns of
// content did not fit without truncating the headline to uselessness.
// Sorting survives as a menu next to the heading — the version
// comparator is version-aware (numeric segments, not lexical), which is
// worth more than the header affordance was.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_20px] items-center gap-x-3 gap-y-1";

type SortChoice = "date-desc" | "date-asc" | "version-desc" | "version-asc";

const SORT_OPTIONS: { value: SortChoice; label: string }[] = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "version-desc", label: "Version ↓" },
  { value: "version-asc", label: "Version ↑" },
];

// ── Component ───────────────────────────────────────────────────

export default function ReleaseNotes({ channel = "stable", installedVersion, approvedVersion }: { channel?: UpdateChannel; installedVersion?: string; approvedVersion?: string }) {
  const [tab, setTab] = useState<UpdateChannel>(channel);
  const id = useId();
  useEffect(() => { setTab(channel); }, [channel]);
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

  const [sort, setSort] = useState<SortChoice>("date-desc");
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  const [sortKey, sortDir] = sort.split("-") as [SortKey, SortDir];

  const sorted = useMemo(() => {
    if (!releases) return [];
    const copy = releases.filter(r => tab === "beta" ? r.prerelease : !r.prerelease);
    copy.sort((a, b) => {
      const cmp =
        sortKey === "version"
          ? compareVersions(a.version, b.version)
          : dateMs(a.date) - dateMs(b.date);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [releases, sortKey, sortDir, tab]);

  const latestTag = sorted.reduce<ReleaseEntry | null>((best, entry) => !best || compareVersions(entry.version, best.version) > 0 ? entry : best, null)?.tag;

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="font-mono text-ui-section text-fg-4">Release history</h3>
        {releases !== null && releases.length > 0 && (
          <SelectMenu
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            ariaLabel="Sort releases"
          />
        )}
      </div>

      <div role="tablist" aria-label="Release history channel" className="mb-2 flex gap-1 rounded-lg bg-base-200 p-1">
        {(["stable", "beta"] as const).map(value => <button key={value} type="button" role="tab"
          id={`${id}-${value}`} aria-controls={`${id}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
          className={clsx("rounded-md px-3 py-1.5 text-ui-body", tab === value ? "bg-surface-2 text-fg" : "text-fg-3 hover:text-fg")}
          onClick={() => { setTab(value); setExpandedTag(null); }} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "stable" : event.key === "End" ? "beta" : tab === "stable" ? "beta" : "stable";
            setTab(next); setExpandedTag(null); document.getElementById(`${id}-${next}`)?.focus();
          }}>{value === "stable" ? "Stable" : "Beta"}</button>)}
      </div>
      <p className="mb-3 text-ui-meta text-fg-3">Browse published releases. These tabs do not change your update channel; update checks determine availability.</p>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {releases === null ? (
        <SkeletonTable />
      ) : releases.length === 0 ? (
        <EmptyState />
      ) : sorted.length === 0 ? (
        <div className={clsx(CARD_SURFACE, "px-4 py-8 text-ui-body text-fg-3")}>No {tab === "beta" ? "Beta" : "Stable"} releases in this history yet.</div>
      ) : (
        <div className={clsx(CARD_SURFACE, "overflow-hidden")}>
          {sorted.map((entry) => (
            <ReleaseRow
              key={entry.tag}
              entry={entry}
              isLatest={entry.tag === latestTag}
              installed={entry.version === installedVersion}
              approved={entry.version === approvedVersion ? channel : undefined}
              expanded={expandedTag === entry.tag}
              onToggle={() =>
                setExpandedTag((prev) => (prev === entry.tag ? null : entry.tag))
              }
            />
          ))}
        </div>
      )}
      </div>
    </>
  );
}

// ── Release row (collapsed line + expandable notes) ─────────────

function ReleaseRow({
  entry,
  isLatest,
  installed,
  approved,
  expanded,
  onToggle,
}: {
  entry: ReleaseEntry;
  isLatest: boolean;
  installed: boolean;
  approved?: UpdateChannel;
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
    <div className="border-t border-fg/7 first:border-t-0">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={clsx(
          ROW_GRID,
          "w-full px-4 py-3 text-left cursor-pointer",
          expanded ? "bg-surface-hover/50" : "hover:bg-surface-hover/30",
        )}
      >
        {/* Version + badges */}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="break-all font-mono text-ui-body font-semibold">
            v{entry.version}
          </span>
          {isLatest && (
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-ui-chip font-semibold leading-none text-accent">
              Newest {entry.prerelease ? "Beta" : "Stable"}
            </span>
          )}
          {installed && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-ui-chip font-semibold text-accent">Installed</span>}
          {approved && <span className="rounded-full bg-base-300 px-1.5 py-0.5 text-ui-chip text-fg-3">Approved for {approved === "beta" ? "Beta" : "Stable"}</span>}
        </span>

        {/* Headline */}
        <span className="col-start-1 row-start-2 min-w-0 break-words text-ui-body text-fg">
          {entry.headline || entry.name}
        </span>

        {/* Relative age. The calendar date moved into the title
            attribute rather than being dropped outright — it is still
            the thing you want when comparing two releases. */}
        <span
          className="col-start-2 row-start-1 shrink-0 text-ui-chip text-fg-4"
          title={formatReleaseDate(entry.date) || undefined}
        >
          {relativeTime(entry.date)}
        </span>

        <ChevronDown
          size={15}
          className={clsx(
            "col-start-3 row-start-1 justify-self-end text-fg-3",
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
      className={clsx(CARD_SURFACE, "overflow-hidden")}
      aria-busy="true"
      aria-label="Loading releases"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={clsx(ROW_GRID, "border-t border-fg/7 px-4 py-3.5 first:border-t-0")}
        >
          <span className="h-3.5 w-16 rounded bg-base-250" />
          <span
            className="h-3.5 rounded bg-base-250"
            style={{ width: `${45 + ((i * 17) % 40)}%` }}
          />
          <span className="h-3.5 w-14 rounded bg-base-250" />
          <span aria-hidden />
        </div>
      ))}
    </div>
  );
}

// ── Empty / error state ─────────────────────────────────────────

function EmptyState() {
  return (
    <div className={clsx(CARD_SURFACE, "flex flex-col items-center justify-center px-6 py-16 text-center")}>
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
