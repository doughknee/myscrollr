import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VersionsReport } from './VersionsPage'
import type { AdminVersions } from '@/api/admin'

/**
 * The sentence is the page's only claim, so it is the thing worth a test: it
 * must name the build that is erroring, and it must never describe a request
 * counter as a number of people (SCROLLR-222).
 */

const version = (
  name: string,
  share: number,
  error_rate: number,
): AdminVersions['versions'][number] => ({
  version: name,
  share,
  requests: Math.round(share * 48210),
  client_errors: 0,
  server_errors: 0,
  error_rate,
})

const healthy: AdminVersions = {
  generated_at: '2026-09-18T12:00:00Z',
  days: 30,
  current_release: '1.6.7',
  current_share: 0.84,
  desktop_total: 48210,
  unrecognized: 3907,
  versions: [version('1.6.7', 0.84, 0.003), version('1.6.1', 0.16, 0.009)],
  platforms: [
    { platform: 'windows', share: 0.71, requests: 34229 },
    { platform: 'macos', share: 0.22, requests: 10606 },
    { platform: 'linux', share: 0.07, requests: 3375 },
  ],
}

const text = (data: AdminVersions) =>
  renderToStaticMarkup(<VersionsReport data={data} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')

describe('VersionsReport', () => {
  it('leads with the share of traffic on the newest build', () => {
    expect(text(healthy)).toContain(
      '84% of desktop traffic is on 1.6.7, the newest build anyone is running. Nothing is erroring more than usual.',
    )
  })

  it('names the build that is erroring', () => {
    expect(
      text({
        ...healthy,
        current_share: 0.41,
        versions: [version('1.6.7', 0.41, 0.003), version('1.6.1', 0.44, 0.09)],
      }),
    ).toContain('1.6.1 is erroring more than usual.')
  })

  it('says only that the window is empty when nothing arrived', () => {
    const html = text({
      ...healthy,
      current_release: '',
      current_share: 0,
      desktop_total: 0,
      versions: [],
      platforms: [],
    })
    expect(html).toContain('No desktop traffic in this window.')
    expect(html).toContain('Nothing to report')
  })

  it('keeps Unrecognized visible even with no desktop traffic', () => {
    // The canary: a silently empty page is the failure this page exists to
    // catch, so the count that would reveal it never disappears with the
    // charts.
    expect(
      text({
        ...healthy,
        desktop_total: 0,
        current_share: 0,
        versions: [],
        platforms: [],
      }),
    ).toContain('Unrecognized:')
  })

  it('never describes a request counter as people, users or installs', () => {
    for (const data of [
      healthy,
      { ...healthy, desktop_total: 0, versions: [], platforms: [] },
    ]) {
      const html = text(data)
      // The footnote is the one place the words may appear, and only to deny
      // that the figures mean either of them. "User agent" is the HTTP header
      // by its own name, not a claim about anybody.
      const body = html
        .replace('not a count of people', '')
        .replace('are not installs', '')
        .replace(/user agents?/gi, '')
      expect(body).not.toMatch(/\bpeople\b|\busers?\b|\binstalls?\b/i)
    }
  })
})
