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

export async function loadSignupAnalytics(
  getToken: () => Promise<string | null>,
  application: AnalyticsApplication,
  days: AnalyticsWindow,
): Promise<SignupAnalytics> {
  const token = await getToken()
  const response = await fetch(
    `${API_BASE}/admin/analytics?application=${application}&days=${days}`,
    {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  )
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? 'Could not load signup analytics')
  }
  return response.json() as Promise<SignupAnalytics>
}
