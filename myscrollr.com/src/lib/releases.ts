/**
 * Release-history data layer for the /releases page.
 *
 * Two data sources, layered:
 *
 * 1. Build-time snapshot — `scripts/fetch-releases.mjs` (prebuild)
 *    writes `./releases.generated.ts`. That file is gitignored and
 *    absent on fresh clones, so it is loaded via `import.meta.glob`
 *    rather than a static import (a static import of a missing module
 *    breaks `npm run dev` — the exact latestVersion.generated trap).
 *    When absent, the snapshot is `[]`.
 *
 * 2. Live refresh — `fetchLiveReleases()` hits the GitHub REST API
 *    from the browser on mount. Returns `[]` on ANY failure (offline,
 *    rate-limited, timeout) so callers can keep the build-time data.
 *
 * This module is the single source of truth for the ReleaseEntry type
 * and the parsing/sorting helpers. The generated file re-declares the
 * interface inline (it must be self-contained), structurally identical.
 */

import { compare, valid } from 'semver'

export interface ReleaseEntry {
  /** Git tag, e.g. "desktop-v1.0.20". */
  tag: string
  /** Bare semver, e.g. "1.0.20" (tag minus the "desktop-v" prefix). */
  version: string
  /** Release title, e.g. "Scrollr Desktop v1.0.20 — FIFA World Cup 2026". */
  name: string
  /** The exciting part: text after the last "—" in `name`, else the
   *  first `##` heading in `body`, else "". */
  headline: string
  /** ISO publish timestamp (GitHub `published_at`). */
  date: string
  /** Raw GitHub-flavored-markdown release notes. */
  body: string
  /** GitHub release page URL. */
  url: string
  prerelease: boolean
}

/** Canonical API constant — GitHub follows the rename redirect. */
export const RELEASES_API_URL =
  'https://api.github.com/repos/doughknee/myscrollr/releases?per_page=50'

/** Human fallback link when no data is available. */
export const RELEASES_PAGE_URL =
  'https://github.com/doughknee/myscrollr/releases'

const DESKTOP_TAG_PREFIX = 'desktop-v'

/**
 * Extract the human "headline" from a release.
 * Priority: text after the LAST em-dash in the name ("Scrollr Desktop
 * v1.0.20 — FIFA World Cup 2026" -> "FIFA World Cup 2026"), then the
 * first `##` heading in the body, then "".
 *
 * Mirrored in scripts/fetch-releases.mjs — keep in sync.
 */
export function parseHeadline(name: string, body: string): string {
  const emDash = name.lastIndexOf('—')
  if (emDash !== -1) {
    const after = name.slice(emDash + 1).trim()
    if (after) return after
  }
  const heading = /^##\s+(.+?)\s*$/m.exec(body)
  return heading ? heading[1].trim() : ''
}

/**
 * SemVer precedence, including beta/rc/final. Historical partial numeric
 * labels are padded; malformed display labels sort deterministically.
 * Returns <0 when a<b, 0 when equal, >0 when a>b.
 */
export function compareVersions(a: string, b: string): number {
  const normalize = (v: string) =>
    /^\d+(\.\d+)?$/.test(v) ? `${v}${v.includes('.') ? '.0' : '.0.0'}` : v
  const av = valid(normalize(a))
  const bv = valid(normalize(b))
  return av && bv ? compare(av, bv) : a.localeCompare(b)
}

export type SortKey = 'version' | 'date'
export type SortDir = 'asc' | 'desc'

/** Stable, non-mutating sort of releases by version or publish date. */
export function sortReleases(
  entries: ReadonlyArray<ReleaseEntry>,
  key: SortKey,
  dir: SortDir,
): Array<ReleaseEntry> {
  const sign = dir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    const cmp =
      key === 'version'
        ? compareVersions(a.version, b.version)
        : (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)
    return sign * cmp
  })
}

/**
 * Map one raw GitHub API release object to a ReleaseEntry.
 * Returns null for tags outside the desktop release train
 * (anything not matching /^desktop-v/).
 *
 * Mirrored in scripts/fetch-releases.mjs — keep in sync.
 */
export function mapGitHubRelease(raw: unknown): ReleaseEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const tag = typeof r.tag_name === 'string' ? r.tag_name : ''
  if (!tag.startsWith(DESKTOP_TAG_PREFIX)) return null
  const name = typeof r.name === 'string' && r.name !== '' ? r.name : tag
  const body = typeof r.body === 'string' ? r.body : ''
  return {
    tag,
    version: tag.slice(DESKTOP_TAG_PREFIX.length),
    name,
    headline: parseHeadline(name, body),
    date: typeof r.published_at === 'string' ? r.published_at : '',
    body,
    url: typeof r.html_url === 'string' ? r.html_url : RELEASES_PAGE_URL,
    prerelease: r.prerelease === true,
  }
}

/**
 * Client-side refresh of the release list straight from GitHub.
 * 10s AbortController timeout; resolves to [] on ANY failure so the
 * caller can keep rendering the build-time snapshot.
 */
export async function fetchLiveReleases(): Promise<Array<ReleaseEntry>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .map(mapGitHubRelease)
      .filter((entry): entry is ReleaseEntry => entry !== null)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

// ── Build-time snapshot (optional module) ──────────────────────────
// import.meta.glob returns an empty object when the file doesn't exist,
// which is exactly the behavior a gitignored generated module needs.
const generatedModules = import.meta.glob<{
  RELEASES?: ReadonlyArray<ReleaseEntry>
}>('./releases.generated.ts', { eager: true })

// The index access really can be undefined (the glob matches nothing
// when the generated file is absent) — widen the type accordingly.
const generatedModule = generatedModules['./releases.generated.ts'] as
  { RELEASES?: ReadonlyArray<ReleaseEntry> } | undefined

/** Releases baked in at build time; [] when the generated file is absent. */
export const BUILD_TIME_RELEASES: ReadonlyArray<ReleaseEntry> =
  generatedModule?.RELEASES ?? []
