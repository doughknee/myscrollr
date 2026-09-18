import { describe, expect, it } from 'vitest'
import {
  analyticsDesktopVerdict,
  analyticsGrowthVerdict,
  analyticsRevenueVerdict,
  analyticsSupportVerdict,
  isStale,
  verdicts,
  versionsVerdict,
} from './overviewVerdicts'
import type { VerdictInput } from './overviewVerdicts'

const healthy: VerdictInput = {
  presence: { available: true, active_users: 3 },
  support: { open_cases: 0 },
  money: {
    available: true,
    past_due: 0,
    new_paying_today: 0,
    net_today: 0,
  },
  growth: { available: true, value: 4, previous: 2, comparable: true },
  feeds: [
    { table: 'games', age_seconds: 120, has_data: true },
    { table: 'trades', age_seconds: 60, has_data: true },
    { table: 'markets', age_seconds: 90, has_data: true },
    { table: 'rss_items', age_seconds: 200, has_data: true },
  ],
}

function only(overrides: Partial<VerdictInput>) {
  return verdicts({ ...healthy, ...overrides })
}

describe('verdicts', () => {
  it('reads a healthy page as live, clear, growing and all good', () => {
    const v = verdicts(healthy)
    expect(v.right_now).toEqual({ tone: 'good', label: 'Live' })
    expect(v.support).toEqual({ tone: 'good', label: 'Clear' })
    expect(v.money).toEqual({ tone: 'none', label: 'Nothing new' })
    expect(v.growth).toEqual({ tone: 'good', label: 'Growing' })
    expect(v.feeds).toEqual({ tone: 'good', label: 'All good' })
    expect(v.headline).toEqual(['Running fine.', 'Nothing needs you.'])
  })

  it('calls nobody being here quiet, and presence that cannot report grey', () => {
    expect(
      only({ presence: { available: true, active_users: 0 } }).right_now,
    ).toEqual({ tone: 'none', label: 'Quiet' })
    expect(
      only({ presence: { available: false, active_users: 0 } }).right_now,
    ).toEqual({ tone: 'none', label: 'Not reporting yet' })
    expect(only({ presence: null }).right_now.tone).toBe('none')
  })

  it('turns support red as soon as one person is waiting', () => {
    const v = only({ support: { open_cases: 1 } })
    expect(v.support).toEqual({ tone: 'bad', label: 'Needs you' })
    expect(v.headline[1]).toBe('Support needs you.')
  })

  it('puts a failed payment ahead of new money, and names it in the headline', () => {
    const v = only({
      money: {
        available: true,
        past_due: 1,
        new_paying_today: 1,
        net_today: 900,
      },
    })
    expect(v.money).toEqual({ tone: 'bad', label: 'Payment failed' })
    expect(v.headline[1]).toBe('A payment failed.')
  })

  it('lets support outrank a failed payment in the second line', () => {
    const v = only({
      support: { open_cases: 2 },
      money: {
        available: true,
        past_due: 1,
        new_paying_today: 0,
        net_today: 0,
      },
    })
    expect(v.headline[1]).toBe('Support needs you.')
  })

  it('counts either a new customer or money in as new money', () => {
    const base = { available: true, past_due: 0 }
    expect(
      only({ money: { ...base, new_paying_today: 1, net_today: 0 } }).money,
    ).toEqual({ tone: 'good', label: 'New money' })
    expect(
      only({ money: { ...base, new_paying_today: 0, net_today: 500 } }).money,
    ).toEqual({ tone: 'good', label: 'New money' })
    expect(
      only({ money: { ...base, new_paying_today: 0, net_today: -500 } }).money
        .label,
    ).toBe('Nothing new')
    expect(only({ money: null }).money.label).toBe('Not reporting yet')
  })

  it('refuses to judge growth it cannot compare', () => {
    expect(
      only({
        growth: { available: true, value: 4, previous: 0, comparable: false },
      }).growth,
    ).toEqual({ tone: 'none', label: 'Too early to compare' })
    expect(
      only({
        growth: { available: false, value: 0, previous: 0, comparable: false },
      }).growth,
    ).toEqual({ tone: 'none', label: 'Not reporting yet' })
  })

  it('calls flat growth growing and a fall slow', () => {
    expect(
      only({
        growth: { available: true, value: 2, previous: 2, comparable: true },
      }).growth.label,
    ).toBe('Growing')
    expect(
      only({
        growth: { available: true, value: 1, previous: 2, comparable: true },
      }).growth,
    ).toEqual({ tone: 'warn', label: 'Slow' })
  })

  it('gives sports scores half a day and every other feed half an hour', () => {
    expect(
      isStale({ table: 'games', age_seconds: 11 * 3600, has_data: true }),
    ).toBe(false)
    expect(
      isStale({ table: 'games', age_seconds: 13 * 3600, has_data: true }),
    ).toBe(true)
    expect(
      isStale({ table: 'trades', age_seconds: 29 * 60, has_data: true }),
    ).toBe(false)
    expect(
      isStale({ table: 'trades', age_seconds: 31 * 60, has_data: true }),
    ).toBe(true)
    // An empty table is broken, not stale — the age of nothing is not a wait.
    expect(isStale({ table: 'trades', age_seconds: 0, has_data: false })).toBe(
      false,
    )
  })

  it('says something is broken only for a feed with no data at all', () => {
    const stale = only({
      feeds: [{ table: 'trades', age_seconds: 3600, has_data: true }],
    })
    expect(stale.feeds).toEqual({ tone: 'warn', label: 'Stale' })
    expect(stale.headline[0]).toBe('Running fine.')

    const broken = only({
      feeds: [{ table: 'trades', age_seconds: 0, has_data: false }],
    })
    expect(broken.feeds).toEqual({ tone: 'bad', label: 'A feed is broken' })
    expect(broken.headline[0]).toBe('Something is broken.')
  })

  it('does not claim things are running fine with no readings', () => {
    expect(only({ feeds: null }).feeds).toEqual({
      tone: 'none',
      label: 'No readings',
    })
    expect(only({ feeds: [] }).headline[0]).toBe('Nothing to report.')
  })
})

// ── The Analytics sections (SCROLLR-220) ─────────────────────────

/**
 * Each section's rule is the Overview's own, read on the selected period.
 * These tests are the thresholds themselves: what makes a section green,
 * what makes it amber, and — the rule that matters most — what makes it
 * decline to judge at all.
 */

const trend = (
  value: number,
  previous: number,
  comparable = true,
  available = true,
) => ({ available, value, previous, comparable })

describe('analyticsGrowthVerdict', () => {
  it('is green when sign-ups held or grew, amber when they fell', () => {
    expect(analyticsGrowthVerdict(trend(19, 19))).toEqual({
      tone: 'good',
      label: 'Growing',
    })
    expect(analyticsGrowthVerdict(trend(31, 19))).toEqual({
      tone: 'good',
      label: 'Growing',
    })
    expect(analyticsGrowthVerdict(trend(19, 31))).toEqual({
      tone: 'warn',
      label: 'Slow',
    })
  })

  it('refuses to judge a period it cannot compare or measure', () => {
    expect(analyticsGrowthVerdict(trend(19, 31, false))).toEqual({
      tone: 'none',
      label: 'Too early to compare',
    })
    expect(analyticsGrowthVerdict(trend(0, 0, true, false))).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
    expect(analyticsGrowthVerdict(null)).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
  })
})

describe('analyticsDesktopVerdict', () => {
  it('calls a fall in app user-hours Falling, not Slow', () => {
    expect(analyticsDesktopVerdict(trend(8.7, 12))).toEqual({
      tone: 'warn',
      label: 'Falling',
    })
    expect(analyticsDesktopVerdict(trend(12, 8.7))).toEqual({
      tone: 'good',
      label: 'Growing',
    })
  })

  it('is grey before there is a period to compare against', () => {
    expect(analyticsDesktopVerdict(trend(8.7, 0, false))).toEqual({
      tone: 'none',
      label: 'Too early to compare',
    })
    expect(analyticsDesktopVerdict(null)).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
  })
})

describe('analyticsRevenueVerdict', () => {
  const money = (
    over: Partial<Parameters<typeof analyticsRevenueVerdict>[0]> = {},
  ) => ({
    available: true,
    past_due: 0,
    new_paying_today: 0,
    net_today: 0,
    ...over,
  })

  it('puts a failed payment ahead of any amount that came in', () => {
    expect(
      analyticsRevenueVerdict(money({ past_due: 1, net_today: 5000 })),
    ).toEqual({ tone: 'bad', label: 'Payment failed' })
  })

  it('is green on new money and grey on a quiet period', () => {
    expect(analyticsRevenueVerdict(money({ net_today: 4620 }))).toEqual({
      tone: 'good',
      label: 'New money',
    })
    expect(analyticsRevenueVerdict(money({ new_paying_today: 1 }))).toEqual({
      tone: 'good',
      label: 'New money',
    })
    expect(analyticsRevenueVerdict(money())).toEqual({
      tone: 'none',
      label: 'Nothing new',
    })
  })

  it('says Not measured rather than Nothing new with no ledger', () => {
    expect(analyticsRevenueVerdict(money({ available: false }))).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
    expect(analyticsRevenueVerdict(null)).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
  })
})

describe('analyticsSupportVerdict', () => {
  it('is red while anyone is waiting on us and green when nobody is', () => {
    expect(analyticsSupportVerdict({ open_cases: 12 })).toEqual({
      tone: 'bad',
      label: 'Needs you',
    })
    expect(analyticsSupportVerdict({ open_cases: 0 })).toEqual({
      tone: 'good',
      label: 'Clear',
    })
  })

  it('does not report a clear queue it never read', () => {
    expect(analyticsSupportVerdict(null)).toEqual({
      tone: 'none',
      label: 'Not measured',
    })
  })
})

describe('versionsVerdict', () => {
  const build = (version: string, share: number, error_rate: number) => ({
    version,
    share,
    error_rate,
  })

  it('has nothing to judge when no desktop traffic arrived', () => {
    expect(
      versionsVerdict({
        desktop_total: 0,
        current_share: 0,
        versions: [],
      }),
    ).toEqual({
      verdict: { tone: 'none', label: 'Nothing to report' },
      erroring: null,
    })
  })

  it('is healthy once the newest build holds most of the traffic', () => {
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.84,
        versions: [build('1.6.7', 0.84, 0.004), build('1.6.1', 0.16, 0.01)],
      }),
    ).toEqual({
      verdict: { tone: 'good', label: 'Healthy' },
      erroring: null,
    })
  })

  it('calls a rollout slow while the newest build is under half', () => {
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.49,
        versions: [build('1.6.7', 0.49, 0.004), build('1.6.1', 0.51, 0.01)],
      }),
    ).toEqual({
      verdict: { tone: 'warn', label: 'Rollout is slow' },
      erroring: null,
    })
  })

  it('names the erroring build, and errors outrank a slow rollout', () => {
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.3,
        versions: [build('1.6.7', 0.3, 0.004), build('1.6.1', 0.7, 0.09)],
      }),
    ).toEqual({
      verdict: { tone: 'bad', label: 'Something is erroring' },
      erroring: '1.6.1',
    })
  })

  it('names the worst of several erroring builds', () => {
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.6,
        versions: [
          build('1.6.7', 0.6, 0.03),
          build('1.6.1', 0.2, 0.15),
          build('1.5.2', 0.2, 0.05),
        ],
      }).erroring,
    ).toBe('1.6.1')
  })

  it('ignores a high error rate on a build barely anyone is calling from', () => {
    // 4% of traffic erroring hard is a fleet problem; 1% is one broken proxy.
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.96,
        versions: [build('1.6.7', 0.96, 0.001), build('0.9.0', 0.04, 0.8)],
      }).verdict,
    ).toEqual({ tone: 'good', label: 'Healthy' })
  })

  it('treats the threshold rate itself as not yet erroring', () => {
    expect(
      versionsVerdict({
        desktop_total: 4000,
        current_share: 0.9,
        versions: [build('1.6.7', 0.9, 0.02)],
      }).verdict,
    ).toEqual({ tone: 'good', label: 'Healthy' })
  })
})
