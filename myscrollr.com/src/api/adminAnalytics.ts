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
      fetch(
        `${API_BASE}/admin/analytics?application=${application}&days=${days}`,
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        },
      ),
      aborted,
    ])
    if (!response.ok) {
      const body = (await Promise.race([
        response.json().catch(() => null),
        aborted,
      ])) as { error?: string } | null
      throw new Error(body?.error ?? 'Could not load signup analytics')
    }
    return (await Promise.race([response.json(), aborted])) as SignupAnalytics
  } catch (error) {
    if (didTimeOut()) {
      throw new Error('Signup analytics took too long. Please retry.')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
