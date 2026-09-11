import posthog from 'posthog-js/dist/module.slim'
import type { CaptureResult } from 'posthog-js'

export type WebsiteAnalyticsDecision = 'unknown' | 'enabled' | 'declined'
export type WebsiteAnalyticsEvent = 'download_selected'

const STORAGE_KEY = 'scrollr-analytics-consent-v1'
const SIGNUP_FLOW_KEY = 'scrollr-analytics-signup-flow-v1'
const PRIVATE_PATHS = [
  '/account',
  '/admin',
  '/callback',
  '/invite',
  '/support',
  '/u/',
]
const ALLOWED_PLATFORMS = new Set(['windows', 'macos', 'linux'])
const ALLOWED_EVENTS = new Set([
  '$pageview',
  'signup_completed',
  'download_selected',
])
const ALLOWED_PROPERTIES = new Set([
  'token',
  'distinct_id',
  'surface',
  'path',
  'platform',
  'referrer_domain',
  'campaign_source',
  'campaign_medium',
  'campaign_name',
  '$ip',
  '$geoip_disable',
])
let initialized = false
let suppressed = true
let lastPageview = { path: '', at: 0 }

export function sanitizeWebsiteCapture(
  result: CaptureResult | null,
): CaptureResult | null {
  if (!result || !ALLOWED_EVENTS.has(result.event)) return null
  return {
    ...result,
    properties: {
      ...Object.fromEntries(
        Object.entries(result.properties).filter(([key]) =>
          ALLOWED_PROPERTIES.has(key),
        ),
      ),
      $ip: null,
      $geoip_disable: true,
    },
    $set: undefined,
    $set_once: undefined,
  }
}

function configured(): boolean {
  return Boolean(
    import.meta.env.PROD &&
      import.meta.env.VITE_POSTHOG_KEY &&
      import.meta.env.VITE_POSTHOG_HOST?.startsWith('https://'),
  )
}

function initialize(): boolean {
  if (!configured()) return false
  if (!initialized) {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
      api_host: import.meta.env.VITE_POSTHOG_HOST,
      autocapture: false,
      before_send: sanitizeWebsiteCapture,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: 'never',
      opt_out_capturing_by_default: true,
      persistence: 'memory',
      respect_dnt: true,
    })
    initialized = true
  }
  return true
}

export function getWebsiteAnalyticsDecision(): WebsiteAnalyticsDecision {
  if (typeof window === 'undefined') return 'unknown'
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'enabled' || value === 'declined' ? value : 'unknown'
}

export function setWebsiteAnalyticsDecision(
  decision: Exclude<WebsiteAnalyticsDecision, 'unknown'>,
): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, decision)
  if (decision === 'enabled') {
    if (initialize()) {
      posthog.reset()
      posthog.opt_in_capturing({ captureEventName: false })
      captureWebsitePageview(window.location.pathname)
    }
  } else {
    sessionStorage.removeItem(SIGNUP_FLOW_KEY)
    if (initialized) {
      posthog.opt_out_capturing()
      posthog.reset()
    }
  }
  window.dispatchEvent(new CustomEvent('scrollr:analytics-consent-changed'))
}

function allowedPath(rawPath: string): string | null {
  const path = rawPath.split(/[?#]/, 1)[0] || '/'
  return PRIVATE_PATHS.some(
    (privatePath) => path === privatePath || path.startsWith(privatePath),
  )
    ? null
    : path
}

function ready(): boolean {
  if (suppressed) return false
  if (getWebsiteAnalyticsDecision() !== 'enabled') return false
  const needsOptIn = !initialized
  if (!initialize()) return false
  if (needsOptIn) {
    posthog.reset()
    posthog.opt_in_capturing({ captureEventName: false })
  }
  return true
}

export function setWebsiteAnalyticsSuppressed(next: boolean): void {
  suppressed = next
}

function eventID(): string {
  return crypto.randomUUID()
}

export function captureWebsitePageview(rawPath: string): void {
  const path = allowedPath(rawPath)
  if (!path || !ready()) return
  const now = Date.now()
  if (lastPageview.path === path && now - lastPageview.at < 1000) return
  lastPageview = { path, at: now }
  const properties: Record<string, string> = { path, surface: 'website' }
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const referrer = new URL(document.referrer)
      if (referrer.hostname !== window.location.hostname) {
        properties.referrer_domain = referrer.hostname.slice(0, 120)
      }
    } catch {
      // Invalid referrers are ignored, never forwarded verbatim.
    }
  }
  if (typeof window !== 'undefined' && window.location.search) {
    const params = new URLSearchParams(window.location.search)
    for (const [query, property] of [
      ['utm_source', 'campaign_source'],
      ['utm_medium', 'campaign_medium'],
      ['utm_campaign', 'campaign_name'],
    ] as const) {
      const value = params.get(query)
      if (value && /^[a-zA-Z0-9._-]{1,64}$/.test(value)) {
        properties[property] = value
      }
    }
  }
  posthog.capture('$pageview', { ...properties, distinct_id: eventID() })
}

export function captureWebsiteEvent(
  event: WebsiteAnalyticsEvent,
  properties: { platform?: string } = {},
): void {
  if (typeof window === 'undefined' || !allowedPath(window.location.pathname))
    return
  if (!ready()) return
  const safeProperties: Record<string, string> = { surface: 'website' }
  if (properties.platform && ALLOWED_PLATFORMS.has(properties.platform)) {
    safeProperties.platform = properties.platform
  }
  posthog.capture(event, { ...safeProperties, distinct_id: eventID() })
}

export function beginWebsiteSignupFlow(): void {
  if (
    typeof window === 'undefined' ||
    !allowedPath(window.location.pathname) ||
    !ready()
  )
    return
  const flowID = eventID()
  sessionStorage.setItem(SIGNUP_FLOW_KEY, flowID)
}

export function hasPendingWebsiteSignupFlow(): boolean {
  if (typeof window === 'undefined') return false
  return /^[0-9a-f-]{36}$/i.test(sessionStorage.getItem(SIGNUP_FLOW_KEY) ?? '')
}

export function finishWebsiteSignupFlow(verified: boolean): void {
  if (typeof window === 'undefined') return
  const flowID = sessionStorage.getItem(SIGNUP_FLOW_KEY)
  sessionStorage.removeItem(SIGNUP_FLOW_KEY)
  if (
    !verified ||
    !flowID ||
    !/^[0-9a-f-]{36}$/i.test(flowID) ||
    getWebsiteAnalyticsDecision() !== 'enabled' ||
    !initialize()
  )
    return
  posthog.capture('signup_completed', {
    surface: 'website',
    distinct_id: flowID,
  })
}
