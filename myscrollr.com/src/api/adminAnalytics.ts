import { API_BASE } from './client'

export type AnalyticsApplication = 'website' | 'desktop'
export type AnalyticsWindow = 7 | 30

export interface SignupStageMetrics {
  events: number
  errors: number
}

export interface SignupAnalytics {
  application: AnalyticsApplication
  window_days: AnalyticsWindow
  generated_at: string
  measurement: 'events'
  stages: Record<string, SignupStageMetrics>
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

const signupAnalyticsTimeout = 30_000

function abortFailure(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortFailure(signal))
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(abortFailure(signal)), {
      once: true,
    })
  })
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
): Promise<Week1ReturnReport> {
  return loadBoundedAdminReport(
    getToken,
    '/admin/week1-return',
    'Could not load week-1 return',
    'Week-1 return took too long. Please retry.',
    signal,
  )
}

export async function loadBoundedAdminReport<T>(
  getToken: () => Promise<string | null>,
  path: string,
  fallbackError: string,
  timeoutError: string,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  let timedOut = false
  const didTimeOut = () => timedOut
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, signupAnalyticsTimeout)
  const aborted = waitForAbort(controller.signal)

  try {
    const token = await Promise.race([getToken(), aborted])
    if (controller.signal.aborted) throw abortFailure(controller.signal)
    const response = await Promise.race([
      fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      }),
      aborted,
    ])
    if (!response.ok) {
      const body = (await Promise.race([
        response.json().catch(() => null),
        aborted,
      ])) as { error?: string } | null
      throw new Error(body?.error ?? fallbackError)
    }
    return (await Promise.race([response.json(), aborted])) as T
  } catch (error) {
    if (didTimeOut()) {
      throw new Error(timeoutError)
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
