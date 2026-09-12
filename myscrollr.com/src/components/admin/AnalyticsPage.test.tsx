import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DesktopContent,
  GrowthContent,
  RevenueContent,
  SupportContent,
  Tabs,
  signupDays,
} from './AnalyticsPage'
import { renderWithRouter } from './testRouter'
import { Bars } from './ui'
import {
  audience,
  desktop,
  failed,
  loaded,
  loading,
  notComparable,
  revenue,
  signup,
  support,
  unavailable,
  website,
} from './dashboardFixtures'

describe('Tabs', () => {
  it('is a tab list with one selected tab and the rest out of the tab order', () => {
    const html = renderToStaticMarkup(
      <Tabs view="revenue" onChange={() => {}} />,
    )
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    expect(html).toContain(
      'id="tab-revenue" aria-selected="true" aria-controls="panel-revenue" tabindex="0"',
    )
    expect(html).toContain('id="tab-growth" aria-selected="false"')
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3)
  })
})

describe('signupDays', () => {
  it('fits the log window to the period', () => {
    expect(signupDays('24h')).toBe(7)
    expect(signupDays('7d')).toBe(7)
    expect(signupDays('30d')).toBe(30)
    expect(signupDays('lifetime')).toBe(30)
  })
})

describe('GrowthContent', () => {
  const render = (
    overrides: Partial<Parameters<typeof GrowthContent>[0]> = {},
  ) =>
    renderWithRouter(
      <GrowthContent
        period="7d"
        audience={loaded(audience)}
        website={loaded(website)}
        signup={loaded(signup)}
        application="website"
        {...overrides}
      />,
    )

  it('shows audience, website and a collapsed signup diagnostics section', async () => {
    const html = await render()
    expect(html).toContain('Registered users')
    expect(html).toContain('>183<')
    expect(html).toContain('Lifetime registrations')
    expect(html).toContain('Known purged')
    expect(html).toContain('Staff excluded')
    expect(html).toContain('Top referrers')
    expect(html).toContain('google.com')
    expect(html).toContain('Downloads by OS')
    expect(html).toContain('Signup diagnostics')
    expect(html).toContain('Registration started')
    expect(html).toContain('Verification code')
    expect(html).toContain('last 7 days')
  })

  it('never totals the visitors curve', async () => {
    const html = await render()
    // 300 + 400 + 500: the sum must not appear anywhere.
    expect(html).not.toContain('1,200')
    expect(html).not.toContain('>1200<')
    expect(html).toContain('Uniques do not add up')
    expect(html).toContain('peak 500')
  })

  it('renders the signed-in caveat and a non-comparable note without a delta', async () => {
    const html = await render()
    expect(html).toContain('authentication, not usage')
    expect(html).toContain('nothing complete to compare with')
    expect(html).toContain('(+50%)') // new accounts is comparable
    const none = await render({
      audience: loaded({
        ...audience,
        new: { ...audience.new, comparison: notComparable },
      }),
    })
    expect(none).not.toContain('(+50%)')
  })

  it('renders notes for unavailable sources instead of numbers', async () => {
    const html = await render({
      audience: loaded({
        ...audience,
        available: false,
        note: 'Logto is unreachable and no local fallback exists.',
        total: 0,
      }),
      website: loaded({
        ...website,
        available: false,
        note: 'POSTHOG_API_KEY is not set.',
      }),
    })
    expect(html).toContain('Logto is unreachable')
    expect(html).toContain('POSTHOG_API_KEY is not set.')
    expect(html).not.toContain('text-3xl font-bold tabular-nums">0<')
  })

  it('flags partial website coverage', async () => {
    const html = await render()
    expect(html).toContain('Partial history')
    expect(html).toContain('Collection started 11 September 2026.')
  })

  it('has independent loading and error states', async () => {
    const html = await render({
      audience: loading(),
      website: failed('Website analytics took too long. Please retry.'),
      signup: loading(),
    })
    expect(html).toContain('Loading audience')
    expect(html).toContain('Website analytics took too long')
    expect(html).toContain('Loading signup diagnostics')
  })
})

describe('DesktopContent', () => {
  const render = (
    overrides: Partial<Parameters<typeof DesktopContent>[0]> = {},
  ) =>
    renderWithRouter(
      <DesktopContent
        period="7d"
        desktop={loaded(desktop)}
        filters={{}}
        {...overrides}
      />,
    )

  it('shows headline metrics, peak, retention and the widget table with samples', async () => {
    const html = await render()
    expect(html).toContain('>34<')
    expect(html).toContain('412.5 h')
    expect(html).toContain('301.3 h')
    expect(html).toContain('60-second samples')
    expect(html).toContain('>19<')
    expect(html).toContain('Day 1 retention')
    expect(html).toContain('60%')
    expect(
      html.match(/No cohort is old enough\./g)?.length,
    ).toBeGreaterThanOrEqual(2)
    expect(html).toContain('of 27 measured ticker users')
    expect(html).toContain('NFL')
    expect(html).toContain('74%')
    expect(html).toContain('+3 / −1')
    expect(html).toContain('25 / 22')
    expect(html).toContain('href="/admin/versions"')
  })

  it('shows additions and removals as a dash under a per-computer filter', async () => {
    const html = await renderWithRouter(
      <DesktopContent
        period="7d"
        desktop={loaded({
          ...desktop,
          widgets: {
            ...desktop.widgets,
            changes_available: false,
            changes_note:
              'Additions and removals carry no OS or version, so they cannot be filtered by computer; clear the OS and version filters to see them.',
          },
        })}
        filters={{ os: 'windows' }}
      />,
    )
    expect(html).toContain('cannot be filtered by computer')
    expect(html).not.toMatch(/\+\d+ \/ −\d+/)
  })

  it('shows a breakdown that could not be read as its note, not as an empty table', async () => {
    const html = await renderWithRouter(
      <GrowthContent
        period="7d"
        audience={loaded(audience)}
        website={loaded({
          ...website,
          top_paths: null,
          breakdown_note:
            'One or more breakdowns could not be read from PostHog: 429.',
        })}
        signup={loaded(signup)}
        application="website"
      />,
    )
    expect(html).toContain('could not be read from PostHog: 429')
  })

  it('shows repeat users as a dash when the API sent null', async () => {
    const html = await render()
    // Clock: repeat_users null, comparison not comparable.
    expect(html).toContain('Clock')
    expect(html).toContain('>—<')
    expect(html).toContain('nothing complete to compare with')
  })

  it('builds filters only from the options the API listed', async () => {
    const html = await render({ filters: { os: 'windows' } })
    expect(html).toContain('name="os"')
    expect(html).toContain('windows (30)')
    expect(html).toContain('name="plan"')
    const none = await render({
      desktop: loaded({
        ...desktop,
        filters: { os: [], version: null, plan: [], applied: {} },
      }),
    })
    expect(none).not.toContain('name="os"')
  })

  it('keeps the legacy series in its own labelled section', async () => {
    const html = await render()
    expect(html).toContain('Legacy measurement')
    expect(html).toContain('never merged with presence')
    expect(html).toContain('Participating accounts')
    expect(html).toContain('Opted-in signed-in accounts only.')
  })

  it('renders unavailable metrics as notes and partial coverage', async () => {
    const html = await render({
      desktop: loaded({
        ...desktop,
        unique_users: unavailable('No presence rows in this window.'),
        peak: {
          ...desktop.peak,
          available: false,
          note: 'No minute samples yet.',
        },
        legacy: null,
      }),
    })
    expect(html).toContain('No presence rows in this window.')
    expect(html).toContain('No minute samples yet.')
    expect(html).toContain('Partial history')
    expect(html).toContain('not available for this window')
    expect(html).not.toContain('text-3xl font-bold tabular-nums">0<')
  })

  it('has loading and error states', async () => {
    expect(await render({ desktop: loading() })).toContain(
      'Loading desktop usage',
    )
    expect(await render({ desktop: failed('boom') })).toContain('boom')
  })
})

describe('RevenueContent', () => {
  const render = (
    overrides: Partial<Parameters<typeof RevenueContent>[0]> = {},
  ) =>
    renderWithRouter(
      <RevenueContent period="7d" revenue={loaded(revenue)} {...overrides} />,
    )

  it('shows paying now, the plan mix and per-currency earnings without summing', async () => {
    const html = await render()
    expect(html).toContain('Paying now')
    expect(html).toContain('>2<')
    expect(html).toContain('Plan mix')
    expect(html).toContain('lifetime')
    expect(html).toContain('monthly')
    expect(html).toContain('Earnings in USD')
    expect(html).toContain('Earnings in EUR')
    expect(html).toContain('$123.45 USD')
    expect(html).toContain('-$9.99 USD')
    expect(html).toContain('$113.46 USD')
    expect(html).toContain('€20.00 EUR')
    expect(html).toContain('$4.12 USD')
    expect(html).not.toContain('13346')
    expect(html).not.toContain('$133.46')
  })

  it('lists movements and unclassified lines as excluded', async () => {
    const html = await render()
    expect(html).toContain('Movements of funds — excluded from net')
    expect(html).toContain('payout × 1')
    expect(html).toContain('-$110.00 USD')
    expect(html).toContain('Unclassified — excluded from net')
    expect(html).toContain('topup × 1')
  })

  it('shows the comparison honestly: a zero previous window is a note, never a delta', async () => {
    const html = await render()
    // new paying: previous 0 → the API refuses the comparison; the note
    // shows and no "+1" badge is drawn.
    expect(html).toContain(
      'The previous period was zero, so there is nothing to compare against.',
    )
    expect(html).not.toContain('>+1<')
    // net: comparable with a pct.
    expect(html).toContain('(+126.9%)')
  })

  it('never renders the paying snapshot as zero when it could not be read', async () => {
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
    expect(html).not.toContain('Canceled')
    expect(html).not.toMatch(/Paying now[\s\S]{0,400}>0</)
  })

  it('draws negative earnings buckets below a zero baseline and labels partial edges', () => {
    const html = renderToStaticMarkup(
      <Bars
        buckets={[
          {
            start: '2026-09-04T12:00:00Z',
            end: '2026-09-05T12:00:00Z',
            value: 940,
          },
          {
            start: '2026-09-05T12:00:00Z',
            end: '2026-09-06T12:00:00Z',
            value: -999,
          },
          {
            start: '2026-09-06T12:00:00Z',
            end: '2026-09-07T12:00:00Z',
            value: 0,
            partial: true,
          },
        ]}
        step="24h0m0s"
        label="Per bucket"
      />,
    )
    // The negative bar exists with a positive height, and there is a baseline.
    expect(html).toContain('data-negative=""')
    expect(html).not.toMatch(/height="-/)
    expect(html).toContain('<line')
    expect(html).toContain('low -999')
    expect(html).toContain('edge buckets partial')
  })

  it('stamps cache state and coverage and renders unavailable notes', async () => {
    const html = await render()
    expect(html).toContain('Cached from Stripe at')
    expect(html).toContain('One Stripe account, live mode.')
    const off = await render({
      revenue: loaded({
        ...revenue,
        earnings: {
          ...revenue.earnings,
          available: false,
          note: 'STRIPE_SECRET_KEY is not set.',
        },
        new_paying: {
          ...revenue.new_paying,
          available: false,
          note: 'No charge history.',
        },
      }),
    })
    expect(off).toContain('STRIPE_SECRET_KEY is not set.')
    expect(off).toContain('No charge history.')
    expect(off).not.toContain('$0.00')
  })

  it('has loading and error states', async () => {
    expect(await render({ revenue: loading() })).toContain('Loading revenue')
    expect(
      await render({ revenue: failed('Could not load revenue') }),
    ).toContain('Could not load revenue')
  })
})

describe('SupportContent', () => {
  const render = (
    overrides: Partial<Parameters<typeof SupportContent>[0]> = {},
  ) =>
    renderWithRouter(
      <SupportContent period="7d" support={loaded(support)} {...overrides} />,
    )

  it('shows buckets with paying overlays, curves and the backlog estimate', async () => {
    const html = await render()
    expect(html).toContain('2 paying')
    expect(html).toContain('40 closed · 11 dismissed · 1 paying')
    expect(html).toContain('href="/admin/support"')
    expect(html).toContain('Backlog (estimate)')
    expect(html).toContain('reopenings are not reconstructable')
    expect(html).toContain('Tickets created per bucket')
    expect(html).toContain('Tickets completed per bucket')
    expect(html).toContain('1 from paying customers')
    expect(html).toContain('pipeline group needs_you')
    expect(html).toContain('Created per day uses opened_at')
  })

  it('carries sample counts with medians and renders an unavailable median as its note', async () => {
    const html = await render()
    expect(html).toContain('2.5 h')
    expect(html).toContain('n=4')
    expect(html).toContain('No ticket completed in this window.')
    expect(html).not.toContain('>0 h<')
  })

  it('has loading and error states', async () => {
    expect(await render({ support: loading() })).toContain(
      'Loading support summary',
    )
    expect(await render({ support: failed('nope') })).toContain('nope')
  })
})
