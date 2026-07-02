import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  mapGitHubRelease,
  parseHeadline,
  sortReleases,
} from './releases'
import type { ReleaseEntry } from './releases'

const entry = (overrides: Partial<ReleaseEntry>): ReleaseEntry => ({
  tag: 'desktop-v1.0.0',
  version: '1.0.0',
  name: 'Scrollr desktop-v1.0.0',
  headline: '',
  date: '2026-01-01T00:00:00Z',
  body: '',
  url: 'https://github.com/brandon-relentnet/myscrollr/releases',
  prerelease: false,
  ...overrides,
})

describe('compareVersions', () => {
  it('compares numeric segments, not lexically', () => {
    // Lexical compare says "1.0.20" < "1.0.3" — the whole reason this
    // helper exists is that patch 20 must sort after patch 3.
    expect(compareVersions('1.0.20', '1.0.3')).toBeGreaterThan(0)
    expect(compareVersions('1.0.3', '1.0.20')).toBeLessThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })

  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.20', '1.0.20')).toBe(0)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.1')).toBeLessThan(0)
  })

  it('compares major and minor before patch', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersions('1.1.0', '1.0.99')).toBeGreaterThan(0)
  })

  it('falls back to string compare for non-numeric segments', () => {
    // Deterministic ordering even for odd tags — direction matters less
    // than antisymmetry.
    const ab = compareVersions('1.0.beta', '1.0.alpha')
    const ba = compareVersions('1.0.alpha', '1.0.beta')
    expect(ab).toBeGreaterThan(0)
    expect(ba).toBeLessThan(0)
  })
})

describe('sortReleases', () => {
  const releases = [
    entry({ version: '1.0.3', date: '2026-03-01T00:00:00Z' }),
    entry({ version: '1.0.20', date: '2026-06-12T00:00:00Z' }),
    entry({ version: '1.0.9', date: '2026-04-01T00:00:00Z' }),
  ]

  it('sorts by version descending with numeric segment compare', () => {
    const sorted = sortReleases(releases, 'version', 'desc')
    expect(sorted.map((r) => r.version)).toEqual(['1.0.20', '1.0.9', '1.0.3'])
  })

  it('sorts by version ascending', () => {
    const sorted = sortReleases(releases, 'version', 'asc')
    expect(sorted.map((r) => r.version)).toEqual(['1.0.3', '1.0.9', '1.0.20'])
  })

  it('sorts by date in both directions', () => {
    expect(
      sortReleases(releases, 'date', 'desc').map((r) => r.version),
    ).toEqual(['1.0.20', '1.0.9', '1.0.3'])
    expect(sortReleases(releases, 'date', 'asc').map((r) => r.version)).toEqual(
      ['1.0.3', '1.0.9', '1.0.20'],
    )
  })

  it('does not mutate the input array', () => {
    const input = [...releases]
    sortReleases(input, 'version', 'desc')
    expect(input).toEqual(releases)
  })
})

describe('parseHeadline', () => {
  it('takes the text after the last em-dash in the name', () => {
    expect(
      parseHeadline('Scrollr Desktop v1.0.20 — FIFA World Cup 2026', ''),
    ).toBe('FIFA World Cup 2026')
  })

  it('uses the LAST em-dash when the name contains several', () => {
    expect(parseHeadline('Scrollr — Desktop — Big Fix', '')).toBe('Big Fix')
  })

  it('falls back to the first ## heading in the body', () => {
    const body = 'intro text\n\n## ⚽ New widgets\n\n### Details\nmore'
    expect(parseHeadline('Scrollr desktop-v1.0.19', body)).toBe(
      '⚽ New widgets',
    )
  })

  it('does not mistake ### sub-headings for the headline', () => {
    const body = '### Only a sub-heading here\ntext'
    expect(parseHeadline('Scrollr desktop-v1.0.19', body)).toBe('')
  })

  it('returns empty string when neither source is present', () => {
    expect(parseHeadline('Scrollr desktop-v1.0.19', 'plain text body')).toBe('')
  })

  it('ignores a trailing em-dash with nothing after it', () => {
    expect(parseHeadline('Scrollr v1.0.0 —', '## From Body')).toBe('From Body')
  })
})

describe('mapGitHubRelease', () => {
  const raw = {
    tag_name: 'desktop-v1.0.20',
    name: 'Scrollr Desktop v1.0.20 — FIFA World Cup 2026',
    body: '## ⚽ FIFA World Cup 2026 is in your ticker\n\ndetails',
    html_url:
      'https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.0.20',
    published_at: '2026-06-12T01:31:29Z',
    prerelease: false,
  }

  it('maps a GitHub API release to a ReleaseEntry', () => {
    expect(mapGitHubRelease(raw)).toEqual({
      tag: 'desktop-v1.0.20',
      version: '1.0.20',
      name: 'Scrollr Desktop v1.0.20 — FIFA World Cup 2026',
      headline: 'FIFA World Cup 2026',
      date: '2026-06-12T01:31:29Z',
      body: '## ⚽ FIFA World Cup 2026 is in your ticker\n\ndetails',
      url: 'https://github.com/doughknee/myscrollr/releases/tag/desktop-v1.0.20',
      prerelease: false,
    })
  })

  it('rejects tags that are not desktop releases', () => {
    expect(mapGitHubRelease({ ...raw, tag_name: 'web-v2.0.0' })).toBeNull()
    expect(mapGitHubRelease({ ...raw, tag_name: 'v1.0.20' })).toBeNull()
  })

  it('rejects junk input without throwing', () => {
    expect(mapGitHubRelease(null)).toBeNull()
    expect(mapGitHubRelease('nope')).toBeNull()
    expect(mapGitHubRelease({})).toBeNull()
  })

  it('falls back to the tag when the name is missing', () => {
    const mapped = mapGitHubRelease({ ...raw, name: undefined })
    expect(mapped?.name).toBe('desktop-v1.0.20')
  })
})
