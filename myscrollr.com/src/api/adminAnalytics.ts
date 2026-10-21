import { populationQuery, verifyPopulation } from './analyticsPopulation'
import { boundedAdminRequest } from './adminRequest'
import type { AnalyticsPopulation } from './analyticsPopulation'

export type AnalyticsApplication = 'website' | 'desktop'
export type AnalyticsWindow = 7 | 30

export interface SignupStageMetrics {
  events: number
  errors: number
}

export interface SignupAnalytics {
  /** false = the scan could not finish; `reason` says why, all else is empty. */
  available: boolean
  stale?: boolean
  refreshing?: boolean
  reason?: string
  application: AnalyticsApplication
  window_days: AnalyticsWindow
  generated_at: string
  measurement: 'events'
  stages: Partial<Record<string, SignupStageMetrics>>
  error_reasons: Array<{ reason: string; count: number }>
  coverage: {
    status: 'partial' | 'unknown'
    requested_from: string
    observed_from?: string
    observed_to?: string
    pages: number
    unique_logs: number
    retention: 'unknown'
    note: string
  }
  attempt_conversion: { available: false; note: string }
}

export async function loadSignupAnalytics(
  getToken: () => Promise<string | null>,
  application: AnalyticsApplication,
  days: AnalyticsWindow,
  signal?: AbortSignal,
): Promise<SignupAnalytics> {
  return loadBoundedAdminReport(
    getToken,
    `/admin/analytics?application=${application}&days=${days}`,
    'Could not load signup analytics',
    'Signup analytics took too long. Please retry.',
    signal,
  )
}

// ── Week-1 return of new desktop signups (SCROLLR-247) ─────────────
//
// The News + first run phase's exit metric. One row per Monday-Sunday UTC
// weekly cohort, oldest first. `mature: false` means the cohort's day 7
// has not fully passed yet: `returned`/`rate_pct` are absent then, never 0.

export interface Week1ReturnCohort {
  week_start: string
  week_end: string
  mature: boolean
  signups: number
  returned?: number
  rate_pct?: number
}

export interface Week1ReturnReport {
  generated_at: string
  definition: string
  cohorts: Array<Week1ReturnCohort>
}

export async function loadWeek1Return(
  getToken: () => Promise<string | null>,
  signal?: AbortSignal,
  filters: AnalyticsPopulation = {},
): Promise<Week1ReturnReport> {
  return loadBoundedAdminReport<Week1ReturnReport>(
    getToken,
    `/admin/week1-return${populationQuery(filters) ? `?${populationQuery(filters)}` : ''}`,
    'Could not load week-1 return',
    'Week-1 return took too long. Please retry.',
    signal,
  ).then((value) => verifyPopulation(value, filters))
}

export async function loadBoundedAdminReport<T>(
  getToken: () => Promise<string | null>,
  path: string,
  fallbackError: string,
  timeoutError: string,
  signal?: AbortSignal,
): Promise<T> {
  const data = await boundedAdminRequest<unknown>(
    getToken,
    path,
    fallbackError,
    timeoutError,
    { signal },
  )
  // Every report endpoint returns an object. A null/primitive success must
  // become a retryable error rather than an endless "Loading" state.
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      'This report returned an unexpected response. Please retry.',
    )
  }
  return data as T
}
