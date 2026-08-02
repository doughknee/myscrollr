/**
 * /releases — the changelog as a departures board (terminal editorial).
 *
 * Data flow is unchanged: build-time snapshot from releases.generated.ts
 * renders instantly, then a live GitHub fetch on mount replaces it.
 * Sorting, expandable markdown notes, and the LATEST/PRE-RELEASE badges
 * all carry over from the previous page — only the skin changed.
 */

import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { marked } from 'marked'
import type { ReleaseEntry, SortDir, SortKey } from '@/lib/releases'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import {
  BUILD_TIME_RELEASES,
  RELEASES_PAGE_URL,
  fetchLiveReleases,
  sortReleases,
} from '@/lib/releases'
import { EASE } from '@/lib/animations'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'

export const Route = createFileRoute('/releases')({
  head: () =>
    seo({
      title: "Scrollr Releases: What's New",
      description:
        'Human-readable release notes for the Scrollr desktop app: every version, what shipped, and why it matters. No commit-log archaeology required.',
      path: '/releases',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Releases', path: '/releases' },
        ]),
      ],
    }),
  component: ReleasesPage,
})

// Rows shown before the SHOW ALL expander.
const LEDGER_COLLAPSED_COUNT = 12

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: EASE },
}

// ── Markdown rendering ──────────────────────────────────────────
// Release bodies are first-party GitHub-flavored markdown (we author
// our own notes), rendered with marked and injected into a scoped
// `.release-notes` wrapper below. <script> tags are stripped
// defensively anyway, and tables get an overflow-x wrapper so wide
// notes scroll inside the row instead of breaking the page on mobile.
marked.use({ gfm: true, breaks: false })

function renderNotes(markdown: string): string {
  const raw = marked.parse(markdown, { async: false })
  // Real sanitizer (ship-review follow-up): the regex only stripped
  // <script> blocks, leaving event-handler attributes and javascript:
  // URLs. DOMPurify needs a DOM; rendering only happens client-side
  // (lazy, on row expand), but the module loads during prerender too —
  // hence the fallback.
  const html =
    typeof window !== 'undefined' && typeof DOMPurify.sanitize === 'function'
      ? DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
      : raw.replace(/<script[\s\S]*?<\/script>/gi, '')
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
}

// Hand-rolled minimal "prose" styles for the rendered notes — the
// Tailwind Typography plugin is not installed. Scoped under
// `.release-notes` so nothing leaks into the rest of the page.
// Radii follow the terminal system: 4px controls, 8px cards.
const RELEASE_NOTES_CSS = `
.release-notes { font-size: 0.875rem; line-height: 1.7; color: color-mix(in srgb, var(--color-base-content) 70%, transparent); }
.release-notes > :first-child { margin-top: 0; }
.release-notes > :last-child { margin-bottom: 0; }
.release-notes h1, .release-notes h2 { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.01em; color: var(--color-base-content); margin: 1.75em 0 0.6em; }
.release-notes h3, .release-notes h4 { font-size: 0.92rem; font-weight: 600; color: color-mix(in srgb, var(--color-base-content) 85%, transparent); margin: 1.5em 0 0.5em; }
.release-notes p { margin: 0.75em 0; }
.release-notes strong { font-weight: 600; color: color-mix(in srgb, var(--color-base-content) 90%, transparent); }
.release-notes a { color: var(--color-primary); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 30%, transparent); transition: border-color 0.15s; }
.release-notes a:hover { border-bottom-color: var(--color-primary); }
.release-notes ul, .release-notes ol { margin: 0.75em 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 0.35em; }
.release-notes ul { list-style: disc; }
.release-notes ol { list-style: decimal; }
.release-notes li::marker { color: color-mix(in srgb, var(--color-primary) 60%, transparent); }
.release-notes code { font-family: var(--font-mono); font-size: 0.8em; padding: 0.15em 0.4em; border-radius: 3px; background: color-mix(in srgb, var(--color-base-300) 35%, transparent); color: color-mix(in srgb, var(--color-base-content) 85%, transparent); }
.release-notes pre { margin: 0.9em 0; padding: 0.9em 1em; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); background: color-mix(in srgb, var(--color-base-200) 60%, transparent); overflow-x: auto; }
.release-notes pre code { padding: 0; background: none; }
.release-notes blockquote { margin: 0.9em 0; padding: 0.1em 1em; border-left: 2px solid color-mix(in srgb, var(--color-primary) 40%, transparent); color: color-mix(in srgb, var(--color-base-content) 55%, transparent); }
.release-notes hr { margin: 1.5em 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); }
.release-notes .table-wrap { margin: 0.9em 0; overflow-x: auto; border: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); border-radius: 8px; }
.release-notes table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.release-notes th { text-align: left; font-weight: 600; color: var(--color-base-content); padding: 0.6em 0.9em; background: color-mix(in srgb, var(--color-base-200) 70%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--color-base-300) 30%, transparent); white-space: nowrap; }
.release-notes td { padding: 0.55em 0.9em; border-bottom: 1px solid color-mix(in srgb, var(--color-base-300) 18%, transparent); }
.release-notes tr:last-child td { border-bottom: 0; }
.release-notes img { max-width: 100%; border-radius: 4px; }
`

// ── Date formatting ─────────────────────────────────────────────
// Fixed locale + UTC so the prerendered HTML and client hydration
// produce byte-identical strings regardless of the visitor's locale.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatDate(iso: string): string {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '—' : DATE_FORMAT.format(t)
}

/** "3 weeks ago" — rendered client-side only (see `now` state below). */
function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const seconds = Math.max(0, Math.floor((now - t) / 1000))
  const units: Array<[number, string]> = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ]
  for (const [secs, label] of units) {
    const n = Math.floor(seconds / secs)
    if (n >= 1) return `${n} ${label}${n === 1 ? '' : 's'} ago`
  }
  return 'just now'
}

// ── Page ────────────────────────────────────────────────────────

// Shared grid template: index | version | date | headline | action.
// The column-header row and every release row use the same columns so
// cells align like a real departures board.
// md:, not sm: — at 640-700px the fixed tracks + gaps exceed the
// container and the minmax(0,1fr) HIGHLIGHTS track collapses to 0px;
// the stacked mobile layout already works, so keep it through 767px.
const ROW_GRID =
  'md:grid md:grid-cols-[2.75rem_11.5rem_10.5rem_minmax(0,1fr)_auto] md:items-center md:gap-x-5'

function ReleasesPage() {
  // Build-time snapshot renders instantly (no layout shift, works
  // offline), then a live fetch on mount replaces it if GitHub has
  // something newer.
  const [releases, setReleases] =
    useState<ReadonlyArray<ReleaseEntry>>(BUILD_TIME_RELEASES)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedTag, setExpandedTag] = useState<string | null>(null)
  // Relative timestamps depend on Date.now(), which differs between
  // prerender and hydration — render them only after mount.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchLiveReleases().then((live) => {
      if (cancelled || live.length === 0) return
      setReleases((current) =>
        JSON.stringify(live) === JSON.stringify(current) ? current : live,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  const sorted = useMemo(
    () => sortReleases(releases, sortKey, sortDir),
    [releases, sortKey, sortDir],
  )

  // 50+ releases as a flat wall helps nobody — show the most recent
  // dozen (in the current sort order) behind an expander.
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? sorted : sorted.slice(0, LEDGER_COLLAPSED_COUNT)

  // "Latest" = newest non-prerelease by publish date (matches the badge
  // GitHub shows), independent of the current sort order.
  const latestTag = useMemo(() => {
    let latest: ReleaseEntry | null = null
    for (const r of releases) {
      if (r.prerelease) continue
      if (!latest || (Date.parse(r.date) || 0) > (Date.parse(latest.date) || 0))
        latest = r
    }
    return latest?.tag ?? null
  }, [releases])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="min-h-dvh">
      <style>{RELEASE_NOTES_CSS}</style>

      <PageHeader
        eyebrowLeft="RELEASES ／ CHANGELOG"
        eyebrowRight="SERVED FROM GITHUB RELEASES"
        line1="Every build,"
        line2="dated and signed."
        sub="What shipped, what changed, and why it matters. Every version, in plain English. No commit-log archaeology."
      />

      {/* ── The ledger ───────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer className="pb-14">
          <motion.div {...reveal}>
            <SectionRow
              tag="SEC 01 ／ THE LEDGER"
              stat={
                releases.length > 0 ? `${releases.length} RELEASES` : undefined
              }
            />

            {sorted.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {/* Column headers — clickable sort toggles */}
                <div
                  className={`hidden border-b border-hairline-minor px-3 py-3 ${ROW_GRID}`}
                >
                  <span aria-hidden="true" />
                  <SortHeader
                    label="VERSION"
                    active={sortKey === 'version'}
                    dir={sortDir}
                    onClick={() => handleSort('version')}
                  />
                  <SortHeader
                    label="DATE"
                    active={sortKey === 'date'}
                    dir={sortDir}
                    onClick={() => handleSort('date')}
                  />
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-base-content/40">
                    HIGHLIGHTS
                  </span>
                  <span aria-hidden="true" />
                </div>

                <ul className="m-0 list-none p-0">
                  {visible.map((release, i) => (
                    <ReleaseRow
                      key={release.tag}
                      index={String(i + 1).padStart(2, '0')}
                      release={release}
                      isLatest={release.tag === latestTag}
                      expanded={expandedTag === release.tag}
                      now={now}
                      onToggle={() =>
                        setExpandedTag((t) =>
                          t === release.tag ? null : release.tag,
                        )
                      }
                    />
                  ))}
                </ul>
                {sorted.length > LEDGER_COLLAPSED_COUNT && (
                  <button
                    type="button"
                    aria-expanded={showAll}
                    onClick={() => setShowAll((v) => !v)}
                    className="mt-5 cursor-pointer rounded-[4px] border border-dashed border-base-content/25 px-[18px] py-2.5 font-mono text-xs tracking-[0.08em] text-base-content/55 transition-colors hover:border-primary hover:text-primary"
                  >
                    {showAll
                      ? 'SHOW RECENT ONLY ▴'
                      : `＋ SHOW ALL ${sorted.length} ▾`}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Raw feed ─────────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <motion.div {...reveal}>
            <DeparturesRow
              index="00"
              label="Prefer the raw feed?"
              labelClassName="text-xl"
              meta="Tags, assets, and checksums: every release, straight from the source."
              action="GITHUB RELEASES ↗"
              href={RELEASES_PAGE_URL}
            />
          </motion.div>
        </TerminalContainer>
      </section>
    </div>
  )
}

// ── Sort header button ──────────────────────────────────────────

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label.toLowerCase()}${
        active
          ? `, currently ${dir === 'desc' ? 'descending' : 'ascending'}`
          : ''
      }`}
      className={`cursor-pointer text-left font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        active
          ? 'text-primary'
          : 'text-base-content/40 hover:text-base-content/70'
      }`}
    >
      {label} {active ? (dir === 'desc' ? '↓' : '↑') : '↕'}
    </button>
  )
}

// ── Release row ─────────────────────────────────────────────────

function ReleaseRow({
  index,
  release,
  isLatest,
  expanded,
  now,
  onToggle,
}: {
  index: string
  release: ReleaseEntry
  isLatest: boolean
  expanded: boolean
  now: number | null
  onToggle: () => void
}) {
  // Parse markdown lazily — only when the row is first expanded.
  const notesHtml = useMemo(
    () => (expanded && release.body ? renderNotes(release.body) : ''),
    [expanded, release.body],
  )

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.35, ease: EASE }}
      className="border-b border-hairline-minor"
    >
      {/* Whole-row click expands; the version button carries the a11y
          contract (aria-expanded + keyboard), the RELEASE link opts out. */}
      <div
        onClick={onToggle}
        className={`flex cursor-pointer flex-col items-start gap-1.5 px-3 py-5 transition-colors duration-150 hover:bg-primary/5 ${ROW_GRID} ${
          expanded ? 'bg-primary/5' : ''
        }`}
      >
        <span className="hidden font-mono text-xs text-base-content/40 md:block">
          ↳ {index}
        </span>

        {/* Version + badges + chevron */}
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            className="flex cursor-pointer items-center gap-2 font-display text-lg font-bold uppercase tracking-[0.01em] text-base-content"
          >
            v{release.version}
            <span
              aria-hidden="true"
              className={`text-xs transition-transform duration-300 ${
                expanded ? 'rotate-180 text-primary' : 'text-base-content/40'
              }`}
            >
              ▾
            </span>
          </button>
          {isLatest ? (
            <span className="rounded-[3px] border border-primary/40 px-2 py-[3px] font-mono text-[10px] tracking-[0.12em] text-primary">
              LATEST
            </span>
          ) : null}
          {release.prerelease ? (
            <span className="rounded-[3px] border border-warning/40 px-2 py-[3px] font-mono text-[10px] tracking-[0.12em] text-warning">
              PRE-RELEASE
            </span>
          ) : null}
        </span>

        {/* Date: absolute + relative (relative is client-only) */}
        <span className="font-mono text-xs text-base-content/50">
          {formatDate(release.date)}
          {now !== null && release.date ? (
            <span className="text-base-content/30">
              {' '}
              · {relativeTime(release.date, now)}
            </span>
          ) : null}
        </span>

        {/* Headline */}
        <span
          className={`min-w-0 text-sm md:truncate ${
            release.headline
              ? 'text-base-content/55'
              : 'italic text-base-content/30'
          }`}
        >
          {release.headline || 'Maintenance release'}
        </span>

        {/* GitHub tag link */}
        <a
          href={release.url}
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="whitespace-nowrap font-mono text-sm text-primary md:justify-self-end"
        >
          RELEASE ↗
        </a>
      </div>

      {/* Expanded notes */}
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-6">
              <div className="rounded-[8px] border border-hairline-minor bg-panel px-5 py-6 sm:px-6">
                {notesHtml ? (
                  <div
                    className="release-notes"
                    // First-party content (we author our own release notes);
                    // <script> tags are stripped in renderNotes anyway.
                    dangerouslySetInnerHTML={{ __html: notesHtml }}
                  />
                ) : (
                  <p className="text-sm italic text-base-content/40">
                    No release notes for this version.
                  </p>
                )}

                <a
                  href={release.url}
                  rel="noopener noreferrer"
                  className="mt-6 inline-block font-mono text-xs tracking-[0.1em] text-primary"
                >
                  VIEW ON GITHUB ↗
                </a>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  )
}

// ── Empty / error state ─────────────────────────────────────────

function EmptyState() {
  return (
    <div className="my-8 rounded-[8px] border border-hairline bg-panel px-8 py-12 text-center">
      <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-base-content/45">
        NO RELEASE DATA
      </p>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-base-content/60">
        We couldn't load the release history right now. The full changelog
        always lives on GitHub.
      </p>
      <a
        href={RELEASES_PAGE_URL}
        rel="noopener noreferrer"
        className="mt-6 inline-block rounded-[4px] border border-primary/40 px-4 py-2.5 font-mono text-xs tracking-[0.1em] text-primary transition-colors hover:bg-primary/10"
      >
        GITHUB RELEASES ↗
      </a>
    </div>
  )
}
