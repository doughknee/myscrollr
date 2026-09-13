import { describe, expect, it } from 'vitest'
import { OverviewContent } from './OverviewPage'
import { renderWithRouter } from './testRouter'
import {
  desktop,
  failed,
  loaded,
  loading,
  overview,
  presence,
  revenue,
  support,
  website,
} from './dashboardFixtures'
import type { OverviewContentProps } from './OverviewPage'

function render(overrides: Partial<OverviewContentProps> = {}) {
  return renderWithRouter(
    <OverviewContent
      presence={loaded(presence)}
      desktop={loaded(desktop)}
      website={loaded(website)}
      revenue={loaded(revenue)}
      support={loaded(support)}
      service={loaded(overview)}
      {...overrides}
    />,
  )
}

/** Strip tags so a sentence split across spans still reads as a sentence. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
}

describe('OverviewContent', () => {
  it('leads with the two headline lines and the five sentences', async () => {
    const body = text(await render())
    expect(body).toContain('Running fine.')
    expect(body).toContain('Support needs you.')
    expect(body).toContain('12people have Scrollr open right now,')
    expect(body).toContain('9 with the ticker on screen.')
    expect(body).toContain('3people are waiting for a reply from us,')
    expect(body).toContain('2customers pay.')
    expect(body).toContain('1person signed up in the last 24 hours,')
    expect(body).toContain('Scores, prices, markets and news are up to date,')
    expect(body).toContain('all within the last few minutes.')
  })

  it('shows one verdict per row', async () => {
    const body = text(await render())
    expect(body).toContain('Live')
    expect(body).toContain('Needs you')
    expect(body).toContain('New money')
    expect(body).toContain('Growing')
    expect(body).toContain('All good')

    // A day with nothing to compare against is judged, not guessed at.
    const early = text(
      await render({
        service: loaded({
          ...overview,
          accounts: {
            ...overview.accounts,
            new_today: { value: 1, delta: 1, available: true },
          },
        }),
      }),
    )
    expect(early).toContain('Too early to compare')
  })

  it('colours the number only when the verdict is red or amber', async () => {
    const html = await render({
      service: loaded({
        ...overview,
        ingest: [{ table: 'trades', age_seconds: 7200, has_data: true }],
      }),
    })
    // Support is red, so its number carries the error colour.
    expect(html).toContain('text-error')
    // A green row's number stays base-content: no primary-coloured number.
    expect(html).not.toContain('tracking-[-0.04em] tabular-nums text-primary')
  })

  it('opens no detail panel until a row asks for one', async () => {
    const closed = text(await render())
    expect(closed).not.toContain('Waiting for the customer to reply')
    expect(closed).not.toContain('Monitors showing a ticker')

    const open = text(await render({ initialOpen: 'support' }))
    expect(open).toContain('Waiting for the customer to reply')
    expect(open).not.toContain('Monitors showing a ticker')
  })

  it('shows the support facts, note and queue action when that row is open', async () => {
    const html = await render({ initialOpen: 'support' })
    const body = text(html)
    expect(body).toContain('Waiting for us to reply')
    expect(body).toContain('Finished without a reply (spam, duplicates)')
    expect(body).toContain('All tickets ever')
    expect(body).toContain('#104')
    expect(body).toContain('on, sent after a 30 min hold')
    expect(body).toContain('only 1 of the 59 were sent from inside the app')
    expect(html).toContain('href="/admin/support"')
  })

  it('makes the support action the only filled button', async () => {
    const supportPanel = await render({ initialOpen: 'support' })
    expect(supportPanel).toContain('bg-error')
    for (const row of ['right_now', 'money', 'growth', 'feeds'] as const) {
      const html = await render({ initialOpen: row })
      expect(html).not.toContain('bg-error px-4')
    }
  })

  it('never renders a number a row cannot back', async () => {
    const body = text(
      await render({
        initialOpen: 'right_now',
        presence: loaded({
          ...presence,
          available: false,
          note: 'Live presence is unavailable right now.',
          active_users: 0,
          ticker_users: 0,
          screens: 0,
        }),
        revenue: loaded({
          ...revenue,
          paying_now: { ...revenue.paying_now, available: false, paying: 0 },
          paying_now_note: 'The customer snapshot could not be read.',
        }),
      }),
    )
    expect(body).toContain('Nobody is reporting yet.')
    expect(body).toContain('Live presence is unavailable right now.')
    expect(body).toContain('The customer snapshot could not be read.')
    expect(body).not.toContain('0people have Scrollr open')
    expect(body).not.toContain('0customers pay')
    expect(body).toContain('Not reporting yet')
  })

  it('goes grey and quiet when nobody is here, and amber on a stale feed', async () => {
    const body = text(
      await render({
        presence: loaded({ ...presence, active_users: 0, ticker_users: 0 }),
        service: loaded({
          ...overview,
          ingest: [
            { table: 'games', age_seconds: 90, has_data: true },
            { table: 'trades', age_seconds: 7200, has_data: true },
            { table: 'markets', age_seconds: 120, has_data: true },
            { table: 'rss_items', age_seconds: 200, has_data: true },
          ],
        }),
      }),
    )
    expect(body).toContain('Quiet')
    expect(body).toContain('Stale')
    expect(body).toContain('Stock prices have not updated for 2 hours.')
    // Stale is not broken, so the headline still says things run.
    expect(body).toContain('Running fine.')
  })

  it('says something is broken when a feed has no data at all', async () => {
    const body = text(
      await render({
        service: loaded({
          ...overview,
          ingest: [
            { table: 'games', age_seconds: 90, has_data: true },
            { table: 'trades', age_seconds: 0, has_data: false },
          ],
        }),
      }),
    )
    expect(body).toContain('Something is broken.')
    expect(body).toContain('A feed is broken')
    expect(body).toContain('Stock prices are not reporting any data.')
  })

  it('spells the feed ages out in words when the row is open', async () => {
    const body = text(await render({ initialOpen: 'feeds' }))
    expect(body).toContain('Sports scores last updated')
    expect(body).toContain('1 minute ago')
    expect(body).toContain('Our servers running')
    expect(body).toContain('2 of 2')
    expect(body).toContain('1.6.7')
  })

  it('formats money from minor units and never sums currencies', async () => {
    const body = text(await render({ initialOpen: 'money' }))
    expect(body).toContain('$113.46 USD came in today.')
    expect(body).toContain('$979.02 USD earned ever.')
    expect(body).toContain('Earned today after Stripe fees')
    expect(body).not.toContain('$133.46')
  })

  it('carries no period selector and no definitions accordion', async () => {
    const html = await render()
    expect(html).not.toContain('Last 7 days')
    expect(html).not.toContain('How to read these numbers')
    expect(html).not.toContain('period=')
  })

  it('keeps a failed source inside its own row', async () => {
    const html = await render({
      initialOpen: 'money',
      revenue: failed('Could not load revenue'),
      support: loading(),
    })
    expect(html).toContain('Could not load revenue')
    expect(html).toContain('Retry')
    expect(text(html)).toContain('Support is not reporting yet.')
    // The other rows are unharmed.
    expect(text(html)).toContain('people have Scrollr open right now,')
  })

  it('drops a clause it has no second half for', async () => {
    const body = text(
      await render({
        presence: loaded({ ...presence, ticker_users: 0 }),
        support: loaded({
          ...support,
          needs_attention: { total: 0, paying: 0 },
        }),
      }),
    )
    expect(body).toContain('people have Scrollr open right now.')
    expect(body).toContain('0people are waiting for a reply from us.')
    expect(body).not.toContain('one of them since')
    expect(body).toContain('Clear')
  })
})
