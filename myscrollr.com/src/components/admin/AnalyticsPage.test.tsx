import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DesktopContent,
  GrowthContent,
  RevenueContent,
  SectionNav,
  SignupDiagnostics,
  SupportContent,
  Week1ReturnContent,
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
  analyticsRevenueVerdict,
  analyticsSupportVerdict,
} from '@/lib/overviewVerdicts'

const rising = analyticsGrowthVerdict({
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
// Growth and desktop usage are grey whichever way they went (SCROLLR-223), so
// the green dot in the nav now has to come from a section that still has one.
const newMoney = analyticsRevenueVerdict({
  available: true,
  past_due: 0,
  new_paying_today: 1,
  net_today: 900,
})

describe('Week1ReturnContent', () => {
  it('recognizes a measured zero return count omitted by the API', () => {
    const html = renderToStaticMarkup(
      <Week1ReturnContent
        report={loaded({
          generated_at: '2026-10-20T00:00:00Z',
          definition: 'Weekly UTC cohorts.',
          cohorts: [
            {
              week_start: '2026-10-05',
              week_end: '2026-10-11',
              mature: true,
              signups: 10,
              rate_pct: 0,
            },
          ],
        })}
      />,
    )
    expect(html).toContain('0 of 10 returned')
    expect(html).not.toContain('Unknown')
    expect(html).not.toContain('Pending')
  })

  it('keeps immature cohorts pending and missing return counts unknown', () => {
    const html = renderToStaticMarkup(
      <Week1ReturnContent
        report={loaded({
          generated_at: '2026-10-20T00:00:00Z',
          definition: 'Weekly UTC cohorts.',
          cohorts: [
            {
              week_start: '2026-10-05',
              week_end: '2026-10-11',
              mature: true,
              signups: 29,
            },
            {
              week_start: '2026-10-12',
              week_end: '2026-10-18',
              mature: false,
              signups: 34,
            },
          ],
        })}
      />,
    )
    expect(html).toContain('Unknown of 29 returned')
    expect(html).toContain('Unavailable')
    expect(html).not.toContain('0 of 29 returned')
    expect(html).toContain('Pending')
    expect(html).toContain('Not yet available')
    expect(html).toContain('independent of time window')
    expect(html).not.toContain('<details open')
  })

  it('does not invent a rate when no cohort has matured', () => {
    const html = renderToStaticMarkup(
      <Week1ReturnContent
        report={loaded({
          generated_at: '2026-10-20T00:00:00Z',
          definition: 'Weekly cohorts',
          cohorts: [],
        })}
      />,
    )
    expect(html).toContain('No weekly cohort has matured yet.')
    expect(html).not.toContain('0%')
  })
})

describe('SectionNav', () => {
  const render = (view: 'growth' | 'desktop' | 'revenue' | 'support') =>
    renderToStaticMarkup(
      <SectionNav
        view={view}
        period="7d"
        verdicts={{
          growth: rising,
          desktop: tooEarly,
          revenue: newMoney,
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

  it('keeps the time controls without the redundant population disclosure', () => {
    expect(render('growth')).not.toContain('Window &amp; population')
    expect(render('growth')).toContain('aria-label="Time window"')
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
    expect(lifetime).toMatch(/aria-pressed="true"[^>]*>Lifetime</)
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
        verdict={rising}
        audience={loaded(audience)}
        website={loaded(website)}
        desktop={loaded(desktop)}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Are new people showing up, and do they stick?')
    expect(html).toContain('12 people')
    expect(html).toContain(
      'signed up in the last 7 days, up from 8 the previous 7 days.',
    )
    expect(html).toContain('100 of 183 accounts have finished setting up.')
    expect(html).toContain('Up from 8')
  })

  it('lists its facts, including the previous window when it compares', async () => {
    const html = await render()
    expect(html).toContain('Signed up in the last 7 days')
    expect(html).toContain('The previous 7 days')
    expect(html).toContain('Accounts in total')
    expect(html).toContain('Never finished setting up')
    expect(html).toContain('>83<')
    expect(html).toContain('Known deleted accounts')
  })

  it('reads sign-up source from applicationId without duplicating legacy retention', async () => {
    const html = await render()
    expect(html).toContain('Signed up from the desktop app')
    expect(html).toContain('>7<') // audience.signup_source.desktop
    expect(html).not.toContain('Came back a second day')
    // Neither is inferred from the other: unknown is its own bucket and is
    // not added to either side.
    expect(html).not.toContain('>11<')
  })

  it('keeps signup source unknown when the source cannot measure it', async () => {
    const html = await render({
      audience: loaded({
        ...audience,
        signup_source: {
          desktop: 0,
          website: 0,
          unknown: 0,
          available: false,
          note: 'Application ids are not configured.',
        },
      }),
      desktop: loaded({
        ...desktop,
        legacy: {
          ...desktop.legacy!,
          retention: {
            ...desktop.legacy!.retention,
            d1: {
              day: 1,
              eligible: 0,
              returned: 0,
              rate: 0,
              available: false,
              note: 'No cohort is old enough.',
            },
          },
        },
      }),
    })
    expect(html).toContain('Signed up from the desktop app')
    expect(html).not.toContain('Came back a second day')
    expect(html.match(/>unknown</g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('omits day-one return when the legacy series is absent entirely', async () => {
    const html = await render({ desktop: loaded({ ...desktop, legacy: null }) })
    expect(html).not.toContain('Came back a second day')
  })

  it('keeps acquisition detail in a closed dialog', async () => {
    const html = await render()
    expect(html).toContain('Acquisition details')
    expect(html).toContain('<dialog')
    expect(html).not.toContain('<dialog open')
    expect(html).not.toContain('<details open')
    expect(html).toContain('From signup to setup')
    expect(html).toContain('>183<')
    expect(html).toContain('Lifetime registrations')
    expect(html).toContain('Known deleted accounts')
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
    expect(html).toContain('signed up in the last 7 days. 100 of 183 accounts')
    expect(html).not.toMatch(/signed up in the last 7 days, /)
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
        verdict={rising}
        desktop={loaded(desktop)}
        filters={{}}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Who is actually using the app, and how much?')
    expect(html).toContain('34 people')
    expect(html).toContain(
      'ran the app in the last 7 days, for 412.5 h between them.',
    )
    expect(html).toContain('The ticker was on screen for 301.3 h of that.')
  })

  it('keeps active filter values and reset available while loading or failed', async () => {
    for (const report of [
      loading<typeof desktop>(),
      failed<typeof desktop>('Desktop report unavailable'),
    ]) {
      const html = await render({
        desktop: report,
        filters: { os: 'windows', version: '1.7.1' },
      })
      expect(html).toContain('name="os"')
      expect(html).toContain('name="version"')
      expect(html).toContain('value="windows" selected')
      expect(html).toContain('Reset filters')
    }
  })

  it('retains filters when the API cannot measure unique users', async () => {
    const html = await render({
      desktop: loaded({
        ...desktop,
        unique_users: unavailable('No presence data'),
      }),
      filters: { os: 'windows' },
    })
    expect(html).toContain('No presence data')
    expect(html).toContain('name="os"')
    expect(html).toContain('Reset filters')
  })

  it('lists its facts from presence, peak, retention and widgets', async () => {
    const html = await render()
    expect(html).toContain('People who ran the app')
    expect(html).toContain('App hours · all users')
    expect(html).toContain('Peak simultaneous users')
    // 2+ screens bucket, day-1 retention, and the widget with most hours.
    expect(html).toContain('Using two or more monitors')
    expect(html).toContain('Day 1 retention')
    expect(html).toContain(
      'All mature cohorts · independent of time, OS, version and plan filters.',
    )
    expect(html.split('Usage details')[0]).not.toContain('Day 1 retention')
    expect(html).toContain('12 of 20')
    expect(html).toContain('What stays on screen')
    expect(html).toContain('NFL')
    expect(html).toContain('210.5 h')
    expect(html).toContain('Widgets added in the last 7 days')
    expect(html).toContain('Widgets removed in the last 7 days')
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
    expect(html).toContain(
      '12 of 20 mature accounts returned on exactly day 1.',
    )
    expect(html).not.toContain('>0%</strong>')
    expect(
      html.match(/No cohort is old enough\./g)?.length,
    ).toBeGreaterThanOrEqual(2)
    expect(html).toContain('of 27 measured ticker users')
    expect(html).toContain('NFL')
    expect(html).toContain('74%')
    // Configuration figures are available in their focused metric view.
    expect(html).toContain('Configuration')
    expect(html).toContain('Find a widget')
    expect(html).toContain('href="/admin/versions?view=traffic"')
  })

  it('shows additions and removals as a dash under a per-computer filter', async () => {
    const html = await renderWithRouter(
      <DesktopContent
        period="7d"
        verdict={rising}
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
    expect(html).toMatch(
      /Widgets added in the last 7 days[\s\S]{0,200}>unknown</,
    )
  })

  it('shows a breakdown that could not be read as its note, not as an empty table', async () => {
    const html = await renderWithRouter(
      <GrowthContent
        period="7d"
        verdict={rising}
        audience={loaded(audience)}
        website={loaded({
          ...website,
          top_paths: null,
          breakdown_note:
            'One or more breakdowns could not be read from PostHog: 429.',
        })}
        desktop={loaded(desktop)}
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
    expect(html).toContain('Windows (30)')
    expect(html).toContain('value="windows" selected=""')
    expect(html).toContain('macOS (4)')
    expect(html).toContain('name="plan"')
    const none = await render({
      desktop: loaded({
        ...desktop,
        filters: { os: [], version: null, plan: [], applied: {} },
      }),
    })
    expect(none).toContain('name="os"')
    expect(none).toContain('name="version"')
    expect(none).toContain('name="plan"')
  })

  it('shows one usage source without the legacy duplicate', async () => {
    const html = await render()
    expect(html).not.toContain('Legacy measurement')
    expect(html).not.toContain('Participating accounts')
    expect(html).toContain('Measured by Scrollr')
    expect(html).toContain('Do people return?')
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
        verdict={rising}
        revenue={loaded(revenue)}
        {...overrides}
      />,
    )

  it('asks its question and answers it in one sentence', async () => {
    const html = await render()
    expect(html).toContain('Is money coming in?')
    expect(html).toContain('$113.46')
    expect(html).toContain(
      'came in in the last 7 days, up from $50.00 USD the previous 7 days.',
    )
    expect(html).toContain('2 customers pay, 1 on the lifetime plan.')
    expect(html).toContain('$979.02 USD earned ever.')
  })

  it('lists its facts in the primary currency only', async () => {
    const html = await render()
    expect(html).toContain('Earned in the last 7 days, after Stripe fees')
    expect(html).toContain('The previous 7 days')
    expect(html).toContain('Earned ever')
    expect(html).toContain('Paying customers')
    expect(html).toContain('On the lifetime plan')
    expect(html).toContain('On a free trial')
    expect(html).toContain('Payment failed')
    expect(html).toContain('Cancelling')
    expect(html).toContain('Refunds in the last 7 days')
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
    expect(html).toContain('came in in the last 7 days.')
    expect(html).not.toContain('the previous 7 days.')
  })

  it('shows paying now, the plan mix and per-currency earnings without summing', async () => {
    const html = await render()
    expect(html).toContain('Paying now')
    expect(html).toContain('>2<')
    expect(html).toContain('Plan mix')
    expect(html).toContain('lifetime')
    expect(html).toContain('Monthly')
    expect(html).toContain('Earnings in USD')
    expect(html).toContain('Earnings in EUR')
    const text = html.replace(/<[^>]*>/g, '')
    expect(text).toContain('$123.45 USD')
    expect(text).toContain('-$9.99 USD')
    expect(text).toContain('$113.46 USD')
    expect(text).toContain('€20.00 EUR')
    expect(text).toContain('$4.12 USD')
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
      'What needs attention, and how quickly do we respond?',
    )
    expect(html).toContain('3 people')
    expect(html).toContain('are waiting on us.')
    expect(html).toContain('4 tickets finished in the last 7 days.')
    expect(html).toContain('Needs you')
  })

  it('lists its facts and says "unknown" where nothing records the answer', async () => {
    const html = await render()
    expect(html).toContain('Waiting for us')
    expect(html).toContain('Waiting for the customer')
    expect(html).toContain('Finished in the last 7 days')
    expect(html).toContain('Longest wait')
    expect(html).toContain('2 days')
    expect(html).toContain('Typical first reply')
    expect(html).toContain('2 h 30 m')
  })

  it('counts who answered, and leaves only the paying fact unknown', async () => {
    const html = await render()
    expect(html).toContain('Answered by the bot alone')
    expect(html).toContain('>5<')
    expect(html).toContain('Answered after you edited the draft')
    expect(html).toContain('>2<')
    expect(html).toContain('Escalated to a person')
    expect(html).toContain('>3<')
    // Support cases carry no account, so this one stays unmeasurable.
    expect(html).toContain('From paying customers')
    expect(html.match(/>unknown</g)).toHaveLength(1)
  })

  it('shows a real zero rather than "unknown" when nobody answered anything', async () => {
    const html = await render({
      support: loaded({
        ...support,
        replied_by_bot: 0,
        replied_after_edit: 0,
        escalated: 0,
      }),
    })
    expect(html).toContain('Answered by the bot alone')
    expect(html.match(/>unknown</g)).toHaveLength(1)
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
    expect(html).not.toContain('tickets finished in the last 7 days')
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
    expect(html).toContain('2 h 30 m')
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
