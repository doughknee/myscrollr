import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalyticsContent } from './AnalyticsPage'
import type { AdminOverview, AdminVersions } from '@/api/admin'
import type { SignupAnalytics } from '@/api/adminAnalytics'
import type { ProductAnalytics } from '@/api/adminProductAnalytics'

const trend = { value: 4, delta: 1, available: true }
const overview: AdminOverview = {
  generated_at: '2026-09-10T12:00:00Z',
  accounts: {
    total: 120,
    set_up: 75,
    source: 'logto',
    new_today: trend,
    new_7d: { ...trend, value: 18 },
  },
  active: {
    dau: { ...trend, value: 31 },
    wau: { ...trend, value: 64 },
    mau: { ...trend, value: 90 },
    curve: [],
  },
  plans: {
    paying: 12,
    rows: [{ plan: 'pro', status: 'active', lifetime: false, count: 10 }],
  },
  connected_now: { count: 8, replicas: 2 },
  support: {
    open_cases: 3,
    pending_drafts: 1,
    auto_sent_30d: 4,
    intervened_30d: 1,
    oldest_open_hours: 2,
  },
  ingest: [{ table: 'games', age_seconds: 90, has_data: true }],
  downloads: { total: 0, releases: [], stale: false },
  installs: { value: 0, available: false },
  demand: { catalog_requests: [], business_leads: 0, leads_unreplied: 0 },
}
const product: ProductAnalytics = {
  generated_at: '2026-09-10T12:00:00Z',
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
}
const versions: AdminVersions = {
  generated_at: '2026-09-10T12:00:00Z',
  days: 7,
  current_release: '1.6.3',
  current_share: 0.8,
  desktop_total: 1000,
  unrecognized: 25,
  versions: [
    {
      version: '1.6.3',
      requests: 800,
      share: 0.8,
      client_errors: 4,
      server_errors: 1,
      error_rate: 0.00625,
    },
  ],
  platforms: [{ platform: 'windows', requests: 700, share: 0.7 }],
}
const signup: SignupAnalytics = {
  application: 'website',
  window_days: 7,
  generated_at: '2026-09-10T12:00:00Z',
  measurement: 'events',
  stages: { started: { events: 14, errors: 2 } },
  error_reasons: [{ reason: 'verification_code', count: 3 }],
  coverage: {
    status: 'partial',
    requested_from: '2026-09-03T12:00:00Z',
    pages: 1,
    unique_logs: 14,
    retention: 'unknown',
    note: 'Retained logs only.',
  },
  attempt_conversion: { available: false, note: 'Unavailable.' },
}

function renderContent(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <AnalyticsContent
      overview={overview}
      product={product}
      versions={versions}
      signup={signup}
      days={7}
      application="website"
      {...overrides}
    />,
  )
}

describe('AnalyticsPage', () => {
  it('leads with a truthful product overview and keeps signup logs secondary', () => {
    const html = renderContent()
    expect(html).toContain('Product analytics')
    expect(html).toContain('Growth')
    expect(html).toContain('Usage &amp; retention')
    expect(html).toContain('Features')
    expect(html).toContain('Revenue')
    expect(html).toContain('Reliability')
    expect(html).toContain('Diagnostics')
    expect(html).toContain('120')
    expect(html).toContain('Authenticated activity (Logto)')
    expect(html).toContain('Opted-in signed-in accounts only.')
    expect(html).toContain('50%')
    expect(html).toContain('No cohort is old enough.')
    expect(html).toContain('Paying accounts')
    expect(html).toContain('1.6.3')
    expect(html).toContain('Platform request mix')
    expect(html).toContain('Windows')
    expect(html).toContain('2026-09-10: 8')
    expect(html).toContain('Signup diagnostics')
    expect(html).toContain('Verification code')
    expect(html).toContain('Attempt conversion')
  })

  it('keeps successful sections visible when product analytics fails', () => {
    const html = renderContent({
      product: null,
      productError: 'Measured usage is unavailable',
    })
    expect(html).toContain('120')
    expect(html).toContain('Measured usage is unavailable')
    expect(html).toContain('Registration started')
    expect(html).toContain('Retry')
  })

  it('states when collection has no participating accounts', () => {
    const html = renderContent({
      product: {
        ...product,
        collection_started_at: null,
        enrolled_accounts: 0,
        activity: { dau: 0, wau: 0, mau: 0, curve: [] },
        retention: {
          d1: {
            day: 1,
            eligible: 0,
            returned: 0,
            rate: 0,
            available: false,
            note: 'Collecting history.',
          },
          d7: {
            day: 7,
            eligible: 0,
            returned: 0,
            rate: 0,
            available: false,
            note: 'Collecting history.',
          },
          d30: {
            day: 30,
            eligible: 0,
            returned: 0,
            rate: 0,
            available: false,
            note: 'Collecting history.',
          },
        },
        features: [],
      },
    })
    expect(html).toContain('No participating accounts yet.')
    expect(html.match(/Collecting history\./g)).toHaveLength(3)
  })

  it('keeps a nonempty immature cohort in collecting state', () => {
    const immature = {
      day: 1 as const,
      eligible: 0,
      returned: 0,
      rate: 0,
      available: false,
      note: 'Collecting history.',
    }
    const html = renderContent({
      product: {
        ...product,
        collection_started_at: '2026-09-10T12:00:00Z',
        enrolled_accounts: 5,
        retention: {
          d1: immature,
          d7: { ...immature, day: 7 },
          d30: { ...immature, day: 30 },
        },
      },
    })
    expect(html).toContain('>5<')
    expect(html.match(/Collecting history\./g)).toHaveLength(3)
    expect(html).not.toContain('No participating accounts yet.')
  })

  it('does not render stale product data while a new context loads', () => {
    const html = renderContent({
      product: null,
      days: 30,
      loading: { product: true },
    })
    expect(html).toContain('Loading measured usage')
    expect(html).not.toContain('Measured daily active')
    expect(html).not.toContain('12 · 70%')
  })
})
