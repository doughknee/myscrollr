import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DesktopContent,
  GrowthContent,
  RevenueContent,
  SectionNav,
  SignupDiagnostics,
  SupportContent,
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
import {
  analyticsGrowthVerdict,
  analyticsSupportVerdict,
} from '@/lib/overviewVerdicts'

const growing = analyticsGrowthVerdict({
  available: true,
  value: 12,
  previous: 8,
  comparable: true,
})
const tooEarly = analyticsGrowthVerdict({
  available: true,
  value: 12,
  previous: 8,
  comparable: false,
})
const notMeasured = analyticsGrowthVerdict(null)

describe('SectionNav', () => {
  const render = (view: 'growth' | 'desktop' | 'revenue' | 'support') =>
    renderToStaticMarkup(
      <SectionNav
        view={view}
        period="7d"
        verdicts={{
          growth: growing,
          desktop: tooEarly,
          revenue: notMeasured,
          support: analyticsSupportVerdict({ open_cases: 3 }),
        }}
        onView={() => {}}
        onPeriod={() => {}}
      />,
    )

  it('lists the four sections with a verdict dot and marks the current one', () => {
    const html = render('revenue')
    expect(html).toContain('Growth')
    expect(html).toContain('Desktop usage')
    expect(html).toContain('Revenue')
    expect(html).toContain('Support')
    // Exactly one row is current, and it is the one ?view= named.
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="true"[\s\S]*?Revenue/)
    // Verdict colours are literal classes, never interpolated.
    expect(html).toContain('bg-primary')
    expect(html).toContain('bg-error')
    expect(html).toContain('bg-base-400')
  })

  it('carries the period footnote, and drops the comparison for lifetime', () => {
    expect(render('growth')).toContain(
      'This week vs the week before. Staff and test accounts excluded.',
    )
    const lifetime = renderToStaticMarkup(
      <SectionNav
        view="growth"
        period="lifetime"
        verdicts={{
          growth: notMeasured,
          desktop: notMeasured,
          revenue: notMeasured,
          support: notMeasured,
        }}
        onView={() => {}}
        onPeriod={() => {}}
      />,
    )
    expect(lifetime).toContain('Everything so far, with nothing to compare')
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
        verdict={growing}
        audience={loaded(audience)}
        website={loaded(website)}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Are new people showing up, and do they stick?')
    expect(html).toContain('12 people')
    expect(html).toContain('signed up this week, up from 8 the week before.')
    expect(html).toContain('100 of 183 accounts have finished setting up.')
    expect(html).toContain('Growing')
  })

  it('lists its facts, including the previous window when it compares', async () => {
    const html = await render()
    expect(html).toContain('Signed up this week')
    expect(html).toContain('The week before')
    expect(html).toContain('Accounts in total')
    expect(html).toContain('Never finished setting up')
    expect(html).toContain('>83<')
    expect(html).toContain('Deleted their account')
    // The two facts nothing measures read "unknown", never a derived zero.
    expect(html).toContain('Signed up from the desktop app')
    expect(html).toContain('Came back a second day')
    expect(html.match(/>unknown</g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('folds everything it used to show into a closed More detail', async () => {
    const html = await render()
    expect(html).toContain('More detail')
    expect(html).not.toContain('<details open')
    expect(html).toContain('Registered users')
    expect(html).toContain('>183<')
    expect(html).toContain('Lifetime registrations')
    expect(html).toContain('Known purged')
    expect(html).toContain('Staff excluded')
    expect(html).toContain('Top referrers')
    expect(html).toContain('google.com')
    expect(html).toContain('Downloads by OS')
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

  it('drops the comparison clause and greys the verdict when not comparable', async () => {
    const html = await render({
      verdict: tooEarly,
      audience: loaded({
        ...audience,
        new: { ...audience.new, comparison: notComparable },
      }),
    })
    expect(html).toContain('signed up this week. 100 of 183 accounts')
    expect(html).not.toMatch(/signed up this week, /)
    expect(html).toContain('Too early to compare')
  })

  it('says it cannot say rather than showing a zero when sign-ups are unmeasurable', async () => {
    const html = await render({
      verdict: notMeasured,
      audience: loaded({
        ...audience,
        new: unavailable('Logto returned no registration timestamps.'),
      }),
    })
    expect(html).toContain('We cannot say yet.')
    expect(html).toContain('Logto returned no registration timestamps.')
    expect(html).toContain('Not measured')
    expect(html).not.toContain('0 people')
  })

  it('renders notes for unavailable sources instead of numbers', async () => {
    const html = await render({
      verdict: notMeasured,
      audience: loaded({
        ...audience,
        available: false,
        note: 'Logto is unreachable and no local fallback exists.',
        total: 0,
      }),
    })
    expect(html).toContain('Logto is unreachable')
    expect(html).toContain('We cannot say yet.')
    expect(html).not.toContain('text-3xl font-bold tabular-nums">0<')
  })

  it('keeps an unreadable website inside its own folded block', async () => {
    const html = await render({
      website: loaded({
        ...website,
        available: false,
        note: 'POSTHOG_API_KEY is not set.',
      }),
    })
    expect(html).toContain('POSTHOG_API_KEY is not set.')
    // Website sign-ups are then a fact nobody can state.
    expect(html).toContain('Signed up on the website')
  })

  it('flags partial website coverage inside More detail', async () => {
    const html = await render()
    expect(html).toContain('Partial history')
    expect(html).toContain('Collection started 11 September 2026.')
  })

  it('has independent loading and error states', async () => {
    expect(await render({ audience: loading() })).toContain('Loading audience')
    const site = await render({
      website: failed('Website analytics took too long. Please retry.'),
    })
    expect(site).toContain('Website analytics took too long')
  })
})

describe('SignupDiagnostics', () => {
  it('is a closed disclosure of its own, below everything else', async () => {
    const html = await renderWithRouter(
      <SignupDiagnostics
        period="7d"
        signup={loaded(signup)}
        application="website"
      />,
    )
    expect(html).toContain('Signup diagnostics')
    expect(html).not.toContain('<details open')
    expect(html).toContain('Registration started')
    expect(html).toContain('Verification code')
    expect(html).toContain('last 7 days')
    expect(
      await renderWithRouter(
        <SignupDiagnostics
          period="7d"
          signup={loading()}
          application="website"
        />,
      ),
    ).toContain('Loading signup diagnostics')
  })
})

describe('DesktopContent', () => {
  const render = (
    overrides: Partial<Parameters<typeof DesktopContent>[0]> = {},
  ) =>
    renderWithRouter(
      <DesktopContent
        period="7d"
        verdict={growing}
        desktop={loaded(desktop)}
        filters={{}}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Who is actually using the app, and how much?')
    expect(html).toContain('34 people')
    expect(html).toContain('ran the app this week, for 412.5 h between them.')
    expect(html).toContain('The ticker was on screen for 301.3 h of that.')
  })

  it('lists its facts from presence, peak, retention and widgets', async () => {
    const html = await render()
    expect(html).toContain('People who ran the app')
    expect(html).toContain('Hours the app was open, everyone added up')
    expect(html).toContain('Most people online at once')
    // 2+ screens bucket, day-1 retention, and the widget with most hours.
    expect(html).toContain('Using two or more monitors')
    expect(html).toContain('Came back the next day')
    expect(html).toContain('12 of 20')
    expect(html).toContain('Most-shown widget')
    expect(html).toContain('NFL · 210.5 h')
    expect(html).toContain('Widgets added this week')
    expect(html).toContain('Widgets removed this week')
  })

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
        verdict={growing}
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
    // The added/removed facts refuse to state a total the filter ignores.
    expect(html).toMatch(/Widgets added this week[\s\S]{0,200}>unknown</)
  })

  it('shows a breakdown that could not be read as its note, not as an empty table', async () => {
    const html = await renderWithRouter(
      <GrowthContent
        period="7d"
        verdict={growing}
        audience={loaded(audience)}
        website={loaded({
          ...website,
          top_paths: null,
          breakdown_note:
            'One or more breakdowns could not be read from PostHog: 429.',
        })}
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
      verdict: notMeasured,
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
    expect(html).toContain('We cannot say yet.')
    expect(html).toContain('Not measured')
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
      <RevenueContent
        period="7d"
        verdict={growing}
        revenue={loaded(revenue)}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Is money coming in?')
    expect(html).toContain('$113.46')
    expect(html).toContain('came in this week, up from $50.00 USD the week before.')
    expect(html).toContain('2 customers pay, 1 on the lifetime plan.')
    expect(html).toContain('$979.02 USD earned ever.')
  })

  it('lists its facts in the primary currency only', async () => {
    const html = await render()
    expect(html).toContain('Earned this week, after Stripe fees')
    expect(html).toContain('The week before')
    expect(html).toContain('Earned ever')
    expect(html).toContain('Paying customers')
    expect(html).toContain('On the lifetime plan')
    expect(html).toContain('On a free trial')
    expect(html).toContain('Payment failed')
    expect(html).toContain('Cancelling')
    expect(html).toContain('Refunds this week')
    expect(html).toContain('$9.99')
    // The EUR ledger never joins the USD facts.
    expect(html).not.toContain('$133.46')
  })

  it('says nothing came in rather than writing a zero as the headline', async () => {
    const html = await render({
      verdict: notMeasured,
      revenue: loaded({
        ...revenue,
        earnings: {
          ...revenue.earnings,
          net: { value: 0, available: true, comparison: notComparable },
        },
      }),
    })
    expect(html).toContain('Nothing')
    expect(html).toContain('came in this week.')
    expect(html).not.toContain('the week before.')
  })

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
      verdict: notMeasured,
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
    // The customer facts read "unknown" rather than a snapshot of zero.
    expect(html).toMatch(/Paying customers[\s\S]{0,200}>unknown</)
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
      verdict: notMeasured,
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
    expect(off).toContain('We cannot say yet.')
    expect(off).toContain('Not measured')
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
      <SupportContent
        period="7d"
        verdict={analyticsSupportVerdict({ open_cases: 3 })}
        support={loaded(support)}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain(
      'How much are we owing people, and how fast do we pay it back?',
    )
    expect(html).toContain('3 people')
    expect(html).toContain('are waiting on us.')
    expect(html).toContain('4 tickets finished this week.')
    expect(html).toContain('Needs you')
  })

  it('lists its facts and says "unknown" where nothing records the answer', async () => {
    const html = await render()
    expect(html).toContain('Waiting for us')
    expect(html).toContain('Waiting for the customer')
    expect(html).toContain('Finished this week')
    expect(html).toContain('Longest wait')
    expect(html).toContain('2 days')
    expect(html).toContain('Typical first reply')
    expect(html).toContain('2 h 30 m')
    // Who wrote a reply is not recorded, so these four state nothing.
    expect(html).toContain('Answered by the bot alone')
    expect(html).toContain('Answered after you edited the draft')
    expect(html).toContain('From paying customers')
    expect(html).toContain('Escalated to a person')
    expect(html.match(/>unknown</g)).toHaveLength(4)
  })

  it('reads Clear and drops the finished clause when the queue is empty', async () => {
    const html = await render({
      verdict: analyticsSupportVerdict({ open_cases: 0 }),
      support: loaded({
        ...support,
        needs_attention: { total: 0, paying: 0 },
        completed_in_period: unavailable('No ticket closed in this window.'),
      }),
    })
    expect(html).toContain('0 people')
    expect(html).toContain('are waiting on us.')
    expect(html).not.toContain('tickets finished this week')
    expect(html).toContain('Clear')
  })

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
