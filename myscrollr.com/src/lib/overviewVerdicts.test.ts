import { describe, expect, it } from 'vitest'
import { isStale, verdicts } from './overviewVerdicts'
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
    expect(only({ presence: { available: true, active_users: 0 } }).right_now)
      .toEqual({ tone: 'none', label: 'Quiet' })
    expect(only({ presence: { available: false, active_users: 0 } }).right_now)
      .toEqual({ tone: 'none', label: 'Not reporting yet' })
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
    expect(isStale({ table: 'games', age_seconds: 11 * 3600, has_data: true }))
      .toBe(false)
    expect(isStale({ table: 'games', age_seconds: 13 * 3600, has_data: true }))
      .toBe(true)
    expect(isStale({ table: 'trades', age_seconds: 29 * 60, has_data: true }))
      .toBe(false)
    expect(isStale({ table: 'trades', age_seconds: 31 * 60, has_data: true }))
      .toBe(true)
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
