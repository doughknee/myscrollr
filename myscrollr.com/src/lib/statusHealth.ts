/**
 * Reads core's GET /health body for the /status page.
 *
 * Core answers 503 with the full report whenever anything is degraded
 * (api/core/server.go, sendHealthCached), so the HTTP status says nothing
 * about whether the report is usable: only the body does. Anything that is
 * not a report is "unreachable"; everything inside a report is optional.
 */

export interface HealthData {
  status: string
  database: string
  redis: string
  services: Record<string, string>
}

export type ServiceState = 'healthy' | 'unhealthy' | 'down' | 'unknown'

/** Returns the report, or null when the body is not one. */
export function parseHealth(body: unknown): HealthData | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.status !== 'string') return null
  const services: Record<string, string> = {}
  if (typeof b.services === 'object' && b.services !== null) {
    for (const [name, value] of Object.entries(b.services)) {
      if (typeof value === 'string') services[name] = value
    }
  }
  return {
    status: b.status,
    database: typeof b.database === 'string' ? b.database : 'unknown',
    redis: typeof b.redis === 'string' ? b.redis : 'unknown',
    services,
  }
}

/**
 * Maps a state string from the API onto a style. A state this page has not
 * heard of (core sends "idle" in keyless dev) is neutral and shows its own
 * word instead of crashing or pretending to be healthy.
 */
export function classifyState(raw: string | undefined): {
  state: ServiceState
  label?: string
} {
  switch (raw) {
    case 'healthy':
      return { state: 'healthy' }
    case 'down':
      return { state: 'down' }
    case 'unhealthy':
    case 'degraded':
    case 'error':
      return { state: 'unhealthy' }
    case undefined:
    case '':
      return { state: 'unknown' }
    default:
      return { state: 'unknown', label: raw.slice(0, 24).toUpperCase() }
  }
}
