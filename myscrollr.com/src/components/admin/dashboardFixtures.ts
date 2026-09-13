/**
 * Typed fixtures for the dashboard tests (SCROLLR-210).
 *
 * Every shape here is the API contract as the Go structs define it, so a
 * test that renders one is a test of the real field names. `populated` is a
 * healthy answer; the helpers below derive the honest-failure variants —
 * unavailable metrics, non-comparable comparisons, partial coverage — from it
 * rather than hand-writing a second copy that could drift.
 */

import type { AdminOverview, AdminSettings } from '@/api/admin'
import type {
  Audience,
  Bucket,
  Comparison,
  DesktopUsage,
  Metric,
  PresenceLive,
  Revenue,
  SupportSummary,
  Website,
} from '@/api/adminDashboard'
import type { SignupAnalytics } from '@/api/adminAnalytics'
import type { Report } from './ui'

export const comparable: Comparison = {
  previous: 8,
  delta: 4,
  delta_pct: 50,
  comparable: true,
}

export const notComparable: Comparison = {
  previous: 3,
  comparable: false,
  note: 'The previous 7d starts before measurement began on 11 Sep 2026, so there is nothing complete to compare with.',
}

export const lifetimeComparison: Comparison = {
  comparable: false,
  note: 'Lifetime has no previous period.',
}

export function metric(
  value: number,
  comparison: Comparison = comparable,
): Metric {
  return { value, available: true, comparison }
}

export function unavailable(note: string): Metric {
  return {
    value: 0,
    available: false,
    note,
    comparison: { comparable: false, note },
  }
}

export const buckets: Array<Bucket> = [
  { start: '2026-09-04T12:00:00Z', end: '2026-09-05T12:00:00Z', value: 3 },
  { start: '2026-09-05T12:00:00Z', end: '2026-09-06T12:00:00Z', value: 5 },
  { start: '2026-09-06T12:00:00Z', end: '2026-09-07T12:00:00Z', value: 2 },
  {
    start: '2026-09-07T12:00:00Z',
    end: '2026-09-08T09:00:00Z',
    value: 7,
    partial: true,
  },
]

const period = {
  key: '7d' as const,
  start: '2026-09-04T12:00:00Z',
  end: '2026-09-11T12:00:00Z',
}
const previous = {
  key: '7d' as const,
  start: '2026-08-28T12:00:00Z',
  end: '2026-09-04T12:00:00Z',
}

export const presence: PresenceLive = {
  generated_at: '2026-09-11T12:00:00Z',
  available: true,
  headline: '12 active users · 9 with ticker(s) · 14 screens',
  staff_excluded: true,
  active_users: 12,
  ticker_users: 9,
  screens: 14,
  sessions: 13,
  session_state: { unlocked: 11, locked: 1, unknown: 1 },
  input_state: { recent: 7, idle: 5, unknown: 1 },
  display_state: { awake: 12, asleep: 0, unknown: 1 },
  ticker_state: { shown: 9, hidden: 3, disabled: 1 },
  screens_per_user: { '0': 3, '1': 7, '2+': 2 },
  os: { windows: 11, macos: 2 },
  app_version: { '1.6.7': 13 },
  check_in_seconds: 30,
  expiry_seconds: 90,
  legacy_recent_presence: {
    value: 21,
    available: true,
    note: 'Customer accounts seen by any desktop build in the last 15 minutes.',
  },
  definition:
    'Active means the desktop app is running and reported within the last 90 seconds.',
  ticker_definition:
    'With ticker(s) means at least one ticker window is shown.',
  coverage:
    'Only desktop builds with the presence reporter (1.6.7 and later) appear here.',
}

export const audience: Audience = {
  generated_at: '2026-09-11T12:00:00Z',
  period,
  previous,
  staff_excluded: true,
  available: true,
  source: 'logto',
  total: 183,
  excluded: 4,
  set_up: 100,
  new: metric(12),
  new_curve: buckets,
  curve_step: '24h0m0s',
  signed_in_in_period: metric(40, notComparable),
  lifetime_registrations: 183,
  known_purged: 6,
  coverage: {
    from: '2026-06-01T00:00:00Z',
    partial: false,
    note: 'Deletion tracking began 1 June 2026.',
  },
  definition: 'Total is Logto user count minus excluded staff and test subs.',
}

export const desktop: DesktopUsage = {
  generated_at: '2026-09-11T12:00:00Z',
  period,
  previous,
  staff_excluded: true,
  coverage: {
    from: '2026-09-10T00:00:00Z',
    partial: true,
    note: 'Presence reporting began 10 September 2026.',
  },
  filters: {
    os: [
      { value: 'windows', count: 30 },
      { value: 'macos', count: 4 },
    ],
    version: [{ value: '1.6.7', count: 34 }],
    plan: [
      { value: 'free', count: 30 },
      { value: 'pro', count: 4 },
    ],
    applied: {},
    note: 'Plan is the current plan, joined at query time.',
  },
  unique_users: metric(34),
  user_hours: metric(412.5, {
    comparable: false,
    note: 'No previous window inside coverage.',
  }),
  ticker_user_hours: metric(301.25),
  screen_hours: metric(356),
  peak: {
    users: 19,
    ticker_users: 15,
    screens: 22,
    at: '2026-09-10T19:04:00Z',
    resolution_seconds: 60,
    available: true,
  },
  screens_per_user: [
    { screens: '1', sessions: 28, users: 26 },
    { screens: '2+', sessions: 6, users: 5 },
  ],
  users_curve: buckets,
  curve_step: '24h0m0s',
  retention: {
    definition:
      'Accounts whose first_seen_day is old enough, returning on exactly that day.',
    d1: { day: 1, eligible: 20, returned: 12, rate: 0.6, available: true },
    d7: {
      day: 7,
      eligible: 0,
      returned: 0,
      rate: 0,
      available: false,
      note: 'No cohort is old enough.',
    },
    d30: {
      day: 30,
      eligible: 0,
      returned: 0,
      rate: 0,
      available: false,
      note: 'No cohort is old enough.',
    },
  },
  widgets: {
    measured_ticker_users: 27,
    rows: [
      {
        widget_type: 'nfl',
        name: 'NFL',
        category: 'sports',
        users: 20,
        share: 0.74,
        user_hours: 210.5,
        screen_hours: 240,
        repeat_users: 15,
        added: 3,
        removed: 1,
        configured: 25,
        enabled: 22,
        comparison: comparable,
      },
      {
        widget_type: 'clock',
        name: 'Clock',
        category: 'utilities',
        users: 9,
        share: 0.33,
        user_hours: 88,
        screen_hours: 91,
        repeat_users: null,
        added: 0,
        removed: 0,
        configured: 0,
        enabled: 0,
        comparison: notComparable,
      },
    ],
    categories: [
      {
        category: 'sports',
        users: 20,
        share: 0.74,
        user_hours: 210.5,
        screen_hours: 240,
        widgets: 1,
      },
    ],
    repeat_note: 'Repeat users need a window of at least 7 days.',
    changes_available: true,
    changes_note: 'Local utilities are not covered by additions and removals.',
    definition: 'Displayed means measured on a screen by the reporter.',
  },
  legacy: {
    generated_at: '2026-09-11T12:00:00Z',
    collection_started_at: '2026-09-01T12:00:00Z',
    days: 7,
    enrolled_accounts: 24,
    activity: {
      dau: 8,
      wau: 17,
      mau: 22,
      curve: [{ day: '2026-09-10', count: 8 }],
    },
    activation: {
      first_observed: 6,
      curve: [{ day: '2026-09-10', count: 2 }],
      definition: 'First observed successful configured ticker use.',
    },
    retention: {
      d1: { day: 1, eligible: 12, returned: 6, rate: 0.5, available: true },
      d7: { day: 7, eligible: 4, returned: 1, rate: 0.25, available: true },
      d30: {
        day: 30,
        eligible: 0,
        returned: 0,
        rate: 0,
        available: false,
        note: 'No cohort is old enough.',
      },
    },
    features: [{ category: 'sports', accounts: 12, share: 0.7 }],
    population_note: 'Opted-in signed-in accounts only.',
    recent_presence: 0,
    recent_presence_note: 'Accounts seen in the last 15 minutes.',
  },
  legacy_note:
    'The legacy series counts 30 continuous seconds of a visible ticker. It is never merged with presence.',
  definition:
    'Unique app-running users is count(DISTINCT logto_sub) over presence_account_hourly.',
}

export const website: Website = {
  generated_at: '2026-09-11T12:00:00Z',
  period,
  previous,
  available: true,
  coverage: {
    from: '2026-09-11T00:00:00Z',
    partial: true,
    note: 'Collection started 11 September 2026.',
  },
  staff_excluded: true,
  visitors: metric(950, notComparable),
  pageviews: metric(4120, notComparable),
  downloads: metric(61, notComparable),
  signups: metric(14, notComparable),
  curve: buckets,
  visitors_curve: [
    { start: '2026-09-04T12:00:00Z', end: '2026-09-05T12:00:00Z', value: 300 },
    { start: '2026-09-05T12:00:00Z', end: '2026-09-06T12:00:00Z', value: 400 },
    { start: '2026-09-06T12:00:00Z', end: '2026-09-07T12:00:00Z', value: 500 },
  ],
  curve_step: '24h0m0s',
  top_paths: [{ key: '/', pageviews: 2000, visitors: 800 }],
  top_referrers: [{ key: 'google.com', pageviews: 900, visitors: 600 }],
  top_campaigns: [{ key: 'fantasy-launch', pageviews: 120, visitors: 90 }],
  downloads_by_os: [{ key: 'windows', pageviews: 50, visitors: 45 }],
  definition: 'Unique visitors are count(DISTINCT person_id) over $pageview.',
  cached: false,
}

export const revenue: Revenue = {
  generated_at: '2026-09-11T12:00:00Z',
  period,
  previous,
  paying_now: {
    available: true,
    paying: 2,
    lifetime: 1,
    trialing: 1,
    past_due: 0,
    canceling: 1,
    canceled: 3,
    free: 181,
    rows: [
      {
        plan: 'pro_monthly',
        tier: 'pro',
        interval: 'monthly',
        status: 'active',
        lifetime: false,
        paying: true,
        count: 1,
      },
      {
        plan: 'ultimate',
        tier: 'ultimate',
        interval: '',
        status: 'active',
        lifetime: true,
        paying: true,
        count: 1,
      },
    ],
    definition:
      'A stripe_customers row with lifetime = true, or plan <> free and status = active.',
  },
  new_paying: {
    available: true,
    // A zero previous window is reported but never compared against.
    in_period: metric(1, {
      previous: 0,
      comparable: false,
      note: 'The previous period was zero, so there is nothing to compare against.',
    }),
    lifetime: 2,
    definition:
      'Customers whose first successful positive charge falls in the window.',
  },
  earnings: {
    available: true,
    currencies: [
      {
        currency: 'usd',
        payments: { count: 3, net: 12345 },
        refunds: { count: 1, net: -999 },
        refund_reversals: { count: 0, net: 0 },
        disputes: { count: 0, net: 0 },
        fees: { count: 0, net: 0 },
        net: 11346,
        gross_fees: 412,
        movements: [{ kind: 'payout', count: 1, amount: -11000 }],
        unclassified: [{ kind: 'topup', count: 1, amount: 500 }],
      },
      {
        currency: 'eur',
        payments: { count: 1, net: 2000 },
        refunds: { count: 0, net: 0 },
        refund_reversals: { count: 0, net: 0 },
        disputes: { count: 0, net: 0 },
        fees: { count: 0, net: 0 },
        net: 2000,
        gross_fees: 70,
        movements: [],
        unclassified: [],
      },
    ],
    primary_currency: 'usd',
    net: metric(11346, {
      previous: 5000,
      delta: 6346,
      delta_pct: 126.9,
      comparable: true,
    }),
    lifetime: [
      {
        currency: 'usd',
        payments: { count: 30, net: 99900 },
        refunds: { count: 2, net: -1998 },
        refund_reversals: { count: 0, net: 0 },
        disputes: { count: 0, net: 0 },
        fees: { count: 0, net: 0 },
        net: 97902,
        gross_fees: 3300,
        movements: [],
        unclassified: [],
      },
    ],
    curve: buckets,
    curve_step: '24h0m0s',
    coverage: {
      from: '2025-11-01T00:00:00Z',
      partial: false,
      note: 'Lifetime coverage starts at the earliest balance transaction.',
    },
    partial: false,
    cached: true,
    fetched_at: '2026-09-11T11:55:00Z',
    definition:
      'sum(net) of payments, refunds, refund reversals, disputes and fees.',
  },
  account_note: 'One Stripe account, live mode.',
}

export const support: SupportSummary = {
  generated_at: '2026-09-11T12:00:00Z',
  period,
  previous,
  needs_attention: { total: 3, paying: 2 },
  waiting_on_customer: { total: 5, paying: 0 },
  completed: { total: 51, paying: 1 },
  completed_closed: 40,
  completed_dismissed: 11,
  total: { total: 59, paying: 3 },
  oldest_needs_attention_hours: { value: 50, available: true },
  oldest_ticket: '104',
  autosend: {
    armed: true,
    paused: false,
    enabled: true,
    hold_minutes: 30,
    note: 'Auto-send is armed; drafts send after a 30 minute hold.',
  },
  paying_note:
    'Paying counts only tickets with a verified account association.',
  definitions: {
    needs_attention: 'pipeline group needs_you',
    waiting_on_customer: 'group waiting',
  },
  created: metric(6),
  completed_in_period: metric(4),
  created_curve: buckets,
  completed_curve: buckets,
  backlog_curve: buckets,
  curve_step: '24h0m0s',
  first_response_median_hours: metric(2.5, {
    previous: 3,
    delta: -0.5,
    delta_pct: -16.7,
    comparable: true,
    note: 'n=4',
  }),
  completion_median_hours: unavailable('No ticket completed in this window.'),
  paying_created: 1,
  cases_with_account: 1,
  cases: 59,
  coverage: { from: '2026-05-01T00:00:00Z', partial: false },
  history_note:
    'Created per day uses opened_at; completed per day uses closed_at.',
}

export const overview: AdminOverview = {
  generated_at: '2026-09-11T12:00:00Z',
  accounts: {
    total: 183,
    set_up: 100,
    source: 'logto',
    new_today: { value: 1, delta: 0, available: true },
    new_7d: { value: 12, delta: 4, available: true },
  },
  active: {
    dau: { value: 31, delta: 1, available: true },
    wau: { value: 64, delta: 1, available: true },
    mau: { value: 90, delta: 1, available: true },
    curve: [],
  },
  plans: { paying: 2, rows: [] },
  connected_now: { count: 8, replicas: 2 },
  ingest: [
    { table: 'games', age_seconds: 90, has_data: true },
    { table: 'trades', age_seconds: 45, has_data: true },
    { table: 'markets', age_seconds: 120, has_data: true },
    { table: 'rss_items', age_seconds: 200, has_data: true },
  ],
  downloads: {
    total: 1234,
    releases: [
      {
        tag: 'v1.6.7',
        name: '1.6.7',
        published_at: '2026-09-09T00:00:00Z',
        downloads: 200,
        prerelease: false,
      },
    ],
    stale: false,
  },
  installs: {
    value: 0,
    available: false,
    note: 'Not measurable. Optional analytics use no install identifier.',
  },
  demand: { catalog_requests: [], business_leads: 0, leads_unreplied: 0 },
}

export const signup: SignupAnalytics = {
  application: 'website',
  window_days: 7,
  generated_at: '2026-09-11T12:00:00Z',
  measurement: 'events',
  stages: { started: { events: 14, errors: 2 } },
  error_reasons: [{ reason: 'verification_code', count: 3 }],
  coverage: {
    status: 'partial',
    requested_from: '2026-09-04T12:00:00Z',
    pages: 1,
    unique_logs: 14,
    retention: 'unknown',
    note: 'Retained logs only.',
  },
  attempt_conversion: { available: false, note: 'Unavailable.' },
}

export const settings: AdminSettings = {
  settings: {
    exclude_staff_from_analytics: {
      value: true,
      default: true,
      updated_at: '2026-09-10T08:00:00Z',
      updated_by: 'brandon@myscrollr.com',
    },
  },
}

// ── Report states ─────────────────────────────────────────────────

export function loaded<T>(data: T): Report<T> {
  return { data, error: null, loading: false }
}

export function loading<T>(): Report<T> {
  return { data: null, error: null, loading: true }
}

export function failed<T>(error: string): Report<T> {
  return { data: null, error, loading: false, retry: () => {} }
}
