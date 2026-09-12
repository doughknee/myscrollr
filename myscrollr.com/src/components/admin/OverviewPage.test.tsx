import { describe, expect, it } from 'vitest'
import { OverviewContent } from './OverviewPage'
import { renderWithRouter } from './testRouter'
import {
  audience,
  desktop,
  failed,
  loaded,
  loading,
  notComparable,
  overview,
  presence,
  revenue,
  support,
  unavailable,
  website,
} from './dashboardFixtures'
import type { OverviewContentProps } from './OverviewPage'

function render(overrides: Partial<OverviewContentProps> = {}) {
  return renderWithRouter(
    <OverviewContent
      period="7d"
      presence={loaded(presence)}
      audience={loaded(audience)}
      desktop={loaded(desktop)}
      website={loaded(website)}
      revenue={loaded(revenue)}
      support={loaded(support)}
      service={loaded(overview)}
      {...overrides}
    />,
  )
}

describe('OverviewContent', () => {
  it('leads with the live headline verbatim and labels now versus period', async () => {
    const html = await render()
    expect(html).toContain('12 active users · 9 with ticker(s) · 14 screens')
    expect(html).toContain('refreshed every 30 s')
    expect(html).toContain('Current')
    expect(html).toContain('Last 7 days')
    // Breakdown chips, in their fixed order.
    expect(html).toContain('unlocked 11 · locked 1 · unknown 1')
    expect(html).toContain('0 3 · 1 7 · 2+ 2')
    // The legacy figure stays secondary and available.
    expect(html).toContain('Recently seen (legacy, 15 min)')
    expect(html).toContain('>21<')
  })

  it('shows the staff-excluded badge linking to settings when any report says so', async () => {
    const html = await render()
    expect(html).toContain('Staff excluded')
    expect(html).toContain('href="/admin/settings"')
    expect(html).toContain('4 staff/test excluded')

    const none = await render({
      presence: loaded({ ...presence, staff_excluded: false }),
      audience: loaded({ ...audience, staff_excluded: false }),
      desktop: loaded({ ...desktop, staff_excluded: false }),
      website: loaded({ ...website, staff_excluded: false }),
    })
    expect(none).not.toContain('Staff excluded')
  })

  it('carries the period into every analytics link', async () => {
    const html = await render({ period: '30d' })
    expect(html).toContain('href="/admin/analytics?period=30d&amp;view=growth"')
    expect(html).toContain(
      'href="/admin/analytics?period=30d&amp;view=desktop"',
    )
    expect(html).toContain(
      'href="/admin/analytics?period=30d&amp;view=revenue"',
    )
    expect(html).toContain(
      'href="/admin/analytics?period=30d&amp;view=support"',
    )
    expect(html).toContain('Last 30 days')
  })

  it('renders a delta only when the API called it comparable', async () => {
    const html = await render()
    // New accounts: comparable, with a percentage.
    expect(html).toContain('+4')
    expect(html).toContain('(+50%)')
    // Website visitors: not comparable — the note, never a delta.
    expect(html).toContain('nothing complete to compare with')

    const none = await render({
      audience: loaded({
        ...audience,
        new: { ...audience.new, comparison: notComparable },
      }),
      desktop: loaded({
        ...desktop,
        unique_users: { ...desktop.unique_users, comparison: notComparable },
      }),
    })
    expect(none).not.toContain('(+50%)')
    expect(none).not.toContain('+4<')
  })

  it('never renders an unavailable metric as a number, not even zero', async () => {
    const html = await render({
      audience: loaded({
        ...audience,
        new: unavailable('Logto could not be reached.'),
      }),
      desktop: loaded({
        ...desktop,
        unique_users: unavailable('Presence has no rows yet.'),
      }),
      revenue: loaded({
        ...revenue,
        earnings: {
          ...revenue.earnings,
          available: false,
          note: 'Stripe is not configured.',
        },
        new_paying: {
          ...revenue.new_paying,
          available: false,
          note: 'Charge history is unavailable.',
        },
      }),
    })
    expect(html).toContain('Logto could not be reached.')
    expect(html).toContain('Presence has no rows yet.')
    expect(html).toContain('Stripe is not configured.')
    expect(html).toContain('Charge history is unavailable.')
    expect(html).not.toContain('text-3xl font-bold tabular-nums">0<')
    expect(html).not.toContain('$0.00')
  })

  it('formats earnings from minor units with the currency code and never sums currencies', async () => {
    const html = await render()
    expect(html).toContain('$113.46 USD')
    expect(html).toContain('€20.00 EUR')
    expect(html).toContain('Lifetime net (USD)')
    expect(html).toContain('$979.02 USD')
    expect(html).toContain('never added together')
    // 11346 + 2000 in either presentation.
    expect(html).not.toContain('13346')
    expect(html).not.toContain('$133.46')
  })

  it('shows the paying snapshot as unavailable, not zero, when Stripe rows could not be read', async () => {
    const html = await render({
      revenue: loaded({
        ...revenue,
        paying_now: {
          ...revenue.paying_now,
          available: false,
          paying: 0,
          free: 0,
        },
        paying_now_note: 'The customer snapshot could not be read.',
      }),
    })
    expect(html).toContain('The customer snapshot could not be read.')
    expect(html).not.toContain('0 free')
  })

  it('overlays paying counts on support buckets only when non-zero', async () => {
    const html = await render()
    expect(html).toContain('2 paying')
    expect(html).toContain('3 paying')
    expect(html).toContain('40 closed')
    expect(html).toContain('2d 2h')
    expect(html).toContain('Ticket #104')
    expect(html).toContain('armed · 30 min hold')
    expect(html).toContain('verified account association')
    expect(html).not.toContain('0 paying')
  })

  it('says when live presence is unavailable instead of showing zeros', async () => {
    const html = await render({
      presence: loaded({
        ...presence,
        available: false,
        headline: 'unavailable',
        note: 'Live presence is unavailable right now (Redis could not be read).',
        active_users: 0,
        ticker_users: 0,
        screens: 0,
        session_state: null,
      }),
    })
    expect(html).toContain('Redis could not be read')
    expect(html).not.toContain('0 active users')
  })

  it('renders each area independently while loading and on error', async () => {
    const html = await render({
      presence: loading(),
      audience: loading(),
      desktop: failed('Desktop usage took too long. Please retry.'),
      website: loading(),
      revenue: failed('Could not load revenue'),
      support: loading(),
      service: loading(),
    })
    expect(html).toContain('Reading live presence')
    expect(html).toContain('Loading registered accounts')
    expect(html).toContain('Desktop usage took too long')
    expect(html).toContain('Could not load revenue')
    expect(html).toContain('Retry')
    expect(html).not.toContain('active users ·')
  })

  it('keeps the last presence reading on screen when a poll fails', async () => {
    const html = await render({
      presence: {
        data: presence,
        error: 'stream refused',
        loading: false,
        retry: () => {},
      },
    })
    expect(html).toContain('12 active users · 9 with ticker(s) · 14 screens')
    expect(html).toContain('Last refresh failed: stream refused')
  })

  it('flags partial history and the service caveats', async () => {
    const html = await render()
    expect(html).toContain('Partial history')
    expect(html).toContain('Presence reporting began 10 September 2026.')
    expect(html).toContain('Summed across 2 replicas.')
    expect(html).toContain('Downloads, not installs.')
    expect(html).toContain('>empty<')
    expect(html).toContain('How to read these numbers')
  })
})
