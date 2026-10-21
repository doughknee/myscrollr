import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SystemHealth } from './SystemHealth'
import { overview } from './dashboardFixtures'
import type { ReactNode } from 'react'

// The public-status link needs no router state to make health evidence readable.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

describe('System health evidence', () => {
  it('distinguishes unavailable readings, no data and stale data', () => {
    const html = renderToStaticMarkup(
      <SystemHealth
        data={{
          ...overview,
          ingest: [
            { table: 'games', has_data: false, age_seconds: 0 },
            { table: 'trades', has_data: true, age_seconds: 3600 },
          ],
        }}
      />,
    )
    expect(html).toContain('No data')
    expect(html).toContain('Stale')
    expect(html).toContain('Unavailable')
    expect(html).not.toContain('Within window')
    expect(html).toContain('not upstream latency')
  })

  it('keeps request connections separate from people and unknown GitHub from zero', () => {
    const html = renderToStaticMarkup(<SystemHealth data={overview} />)
    expect(html).toContain('connections, not people')
    expect(html).toContain('Unavailable')
    expect(html).not.toContain('None linked yet')
    expect(html.match(/Within window/g)).toHaveLength(3)
    const broken = renderToStaticMarkup(
      <SystemHealth
        data={{ ...overview, github: { connections: 5, broken: 2 } }}
      />,
    )
    expect(broken).toContain('2 need reconnecting')
  })
})
