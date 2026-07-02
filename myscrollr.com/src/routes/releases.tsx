import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  PackageOpen,
  Sparkles,
} from 'lucide-react'
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

export const Route = createFileRoute('/releases')({
  head: () =>
    seo({
      title: "Scrollr Releases: What's New",
      description:
        'Human-readable release notes for the Scrollr desktop app — every version, what shipped, and why it matters. No commit-log archaeology required.',
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

// ── Signature easing (matches homepage) ────────────────────────
const EASE = [0.22, 1, 0.36, 1] as const

// ── Markdown rendering ──────────────────────────────────────────
// Release bodies are first-party GitHub-flavored markdown (we author
// our own notes), rendered with marked and injected into a scoped
// `.release-notes` wrapper below. <script> tags are stripped
// defensively anyway, and tables get an overflow-x wrapper so wide
// notes scroll inside the row instead of breaking the page on mobile.
marked.use({ gfm: true, breaks: false })

function renderNotes(markdown: string): string {
  const html = marked.parse(markdown, { async: false })
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
}

// Hand-rolled minimal "prose" styles for the rendered notes — the
// Tailwind Typography plugin is not installed. Scoped under
// `.release-notes` so nothing leaks into the rest of the page.
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
.release-notes code { font-family: var(--font-mono); font-size: 0.8em; padding: 0.15em 0.4em; border-radius: 0.375rem; background: color-mix(in srgb, var(--color-base-300) 35%, transparent); color: color-mix(in srgb, var(--color-base-content) 85%, transparent); }
.release-notes pre { margin: 0.9em 0; padding: 0.9em 1em; border-radius: 0.75rem; border: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); background: color-mix(in srgb, var(--color-base-200) 60%, transparent); overflow-x: auto; }
.release-notes pre code { padding: 0; background: none; }
.release-notes blockquote { margin: 0.9em 0; padding: 0.1em 1em; border-left: 2px solid color-mix(in srgb, var(--color-primary) 40%, transparent); color: color-mix(in srgb, var(--color-base-content) 55%, transparent); }
.release-notes hr { margin: 1.5em 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); }
.release-notes .table-wrap { margin: 0.9em 0; overflow-x: auto; border: 1px solid color-mix(in srgb, var(--color-base-300) 25%, transparent); border-radius: 0.75rem; }
.release-notes table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.release-notes th { text-align: left; font-weight: 600; color: var(--color-base-content); padding: 0.6em 0.9em; background: color-mix(in srgb, var(--color-base-200) 70%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--color-base-300) 30%, transparent); white-space: nowrap; }
.release-notes td { padding: 0.55em 0.9em; border-bottom: 1px solid color-mix(in srgb, var(--color-base-300) 18%, transparent); }
.release-notes tr:last-child td { border-bottom: 0; }
.release-notes img { max-width: 100%; border-radius: 0.5rem; }
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

// Shared grid template: version | date | headline | chevron. The
// header row and every release row use the same columns so cells
// align like a real table.
const ROW_GRID =
  'sm:grid sm:grid-cols-[7.5rem_13rem_minmax(0,1fr)_2rem] sm:items-center sm:gap-4'

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
    <div className="min-h-dvh pt-20">
      <style>{RELEASE_NOTES_CSS}</style>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-20 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(52, 211, 153, 0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(52, 211, 153, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        <div className="container relative z-10 !py-0 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center justify-center gap-3 mb-8"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/8 text-primary text-[10px] font-bold rounded-lg border border-primary/15 uppercase tracking-wide">
              <Sparkles size={12} />
              {releases.length > 0
                ? `${releases.length} releases and counting`
                : 'Release notes'}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-black tracking-tight leading-[0.95] mb-6"
          >
            Fresh out of the <span className="text-gradient-primary">Oven</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
            className="text-base text-base-content/45 max-w-lg mx-auto leading-relaxed"
          >
            Every release, in plain English — what shipped, what changed, and
            why it matters. No commit-log archaeology.
          </motion.p>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ── RELEASE TABLE ─────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

        <div className="container relative z-10">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="max-w-5xl mx-auto"
          >
            {sorted.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="relative bg-base-200/40 border border-base-300/25 rounded-xl overflow-hidden">
                {/* Accent top line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px z-10"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent, #34d399 50%, transparent)',
                  }}
                />

                {/* Column headers — clickable sort toggles */}
                <div
                  className={`flex items-center gap-3 px-5 sm:px-6 py-3 border-b border-base-300/25 bg-base-200/60 ${ROW_GRID}`}
                >
                  <SortHeader
                    label="Version"
                    active={sortKey === 'version'}
                    dir={sortDir}
                    onClick={() => handleSort('version')}
                  />
                  <SortHeader
                    label="Date"
                    active={sortKey === 'date'}
                    dir={sortDir}
                    onClick={() => handleSort('date')}
                  />
                  <span className="hidden sm:block text-[10px] font-bold uppercase tracking-wide text-base-content/35">
                    Highlights
                  </span>
                  <span className="hidden sm:block" aria-hidden="true" />
                </div>

                {/* Rows */}
                <ul>
                  {sorted.map((release) => (
                    <ReleaseRow
                      key={release.tag}
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
              </div>
            )}

            {/* GitHub footnote */}
            <p className="mt-6 text-center text-xs text-base-content/35">
              Prefer the raw feed?{' '}
              <a
                href={RELEASES_PAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary/70 hover:text-primary transition-colors inline-flex items-center gap-0.5"
              >
                Browse releases on GitHub
                <ArrowUpRight size={11} />
              </a>
            </p>
          </motion.div>
        </div>
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
      className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer rounded ${
        active
          ? 'text-primary'
          : 'text-base-content/35 hover:text-base-content/60'
      }`}
    >
      {label}
      {active ? (
        dir === 'desc' ? (
          <ArrowDown size={11} />
        ) : (
          <ArrowUp size={11} />
        )
      ) : (
        <ArrowUpDown size={11} className="opacity-50" />
      )}
    </button>
  )
}

// ── Release row ─────────────────────────────────────────────────

function ReleaseRow({
  release,
  isLatest,
  expanded,
  now,
  onToggle,
}: {
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
    <li className="border-b border-base-300/20 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`relative w-full text-left px-5 sm:px-6 py-4 flex flex-col gap-1 cursor-pointer transition-colors hover:bg-base-200/60 ${ROW_GRID} ${
          expanded ? 'bg-base-200/50' : ''
        }`}
      >
        {/* Version + badges */}
        <span className="flex items-center gap-2 pr-8 sm:pr-0">
          <span className="font-mono text-sm font-bold text-base-content">
            v{release.version}
          </span>
          {isLatest ? (
            <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full text-primary bg-primary/10 border border-primary/25">
              Latest
            </span>
          ) : null}
          {release.prerelease ? (
            <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full text-warning bg-warning/10 border border-warning/25">
              Pre-release
            </span>
          ) : null}
        </span>

        {/* Date: absolute + relative (relative is client-only) */}
        <span className="text-xs sm:text-[13px] text-base-content/50">
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
          className={`block text-sm truncate ${
            release.headline
              ? 'text-base-content/65'
              : 'text-base-content/30 italic'
          }`}
        >
          {release.headline || 'Maintenance release'}
        </span>

        {/* Expand chevron */}
        <span className="absolute right-5 top-4 sm:static text-base-content/30">
          <ChevronDown
            size={16}
            className={`transition-transform duration-300 ${
              expanded ? 'rotate-180 text-primary/70' : ''
            }`}
            aria-hidden="true"
          />
        </span>
      </button>

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
            <div className="border-t border-base-300/20 bg-base-100/40 px-5 sm:px-6 py-6">
              {notesHtml ? (
                <div
                  className="release-notes"
                  // First-party content (we author our own release notes);
                  // <script> tags are stripped in renderNotes anyway.
                  dangerouslySetInnerHTML={{ __html: notesHtml }}
                />
              ) : (
                <p className="text-sm text-base-content/40 italic">
                  No release notes for this version.
                </p>
              )}

              <a
                href={release.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-primary/80 hover:text-primary transition-colors"
              >
                View on GitHub
                <ArrowUpRight size={12} />
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

// ── Empty / error state ─────────────────────────────────────────

function EmptyState() {
  return (
    <div className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-10 sm:p-14 text-center overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, #34d399 50%, transparent)',
        }}
      />
      <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center mx-auto mb-5 text-primary/70">
        <PackageOpen size={22} />
      </div>
      <h2 className="text-lg font-bold text-base-content mb-2">
        The oven is preheating
      </h2>
      <p className="text-sm text-base-content/45 leading-relaxed max-w-sm mx-auto mb-6">
        We couldn't load the release history right now. The full changelog
        always lives on GitHub.
      </p>
      <a
        href={RELEASES_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-outline btn-sm"
      >
        View releases on GitHub
        <ArrowUpRight size={12} />
      </a>
    </div>
  )
}
