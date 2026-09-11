import posthog from 'posthog-js/dist/module.slim'
import type { CaptureResult } from 'posthog-js'

export type WebsiteAnalyticsDecision = 'unknown' | 'enabled' | 'declined'
export type WebsiteAnalyticsEvent = 'download_selected'
export type WebsiteAnalyticsPolicy =
  | 'unknown'
  | 'default-on'
  | 'consent-required'

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
  '$identify',
  'signup_completed',
  'download_selected',
])
const ALLOWED_PROPERTIES = new Set([
  'token',
  'distinct_id',
  '$anon_distinct_id',
  '$process_person_profile',
  '$session_id',
  '$window_id',
  'surface',
  'path',
  'platform',
  '$current_url',
  '$pathname',
  '$host',
  '$referring_domain',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  '$ip',
  '$geoip_disable',
])
let initialized = false
let suppressed = true
let analyticsPolicy: WebsiteAnalyticsPolicy = 'unknown'
let lastPageview = { path: '', at: 0 }

export function sanitizeWebsiteCapture(
  result: CaptureResult | null,
): CaptureResult | null {
  if (!result || !ALLOWED_EVENTS.has(result.event)) return null
  const properties = Object.fromEntries(
    Object.entries(result.properties).filter(([key]) =>
      ALLOWED_PROPERTIES.has(key),
    ),
  )
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (
      typeof properties[key] !== 'string' ||
      !/^[a-zA-Z0-9._-]{1,64}$/.test(properties[key])
    ) {
      delete properties[key]
    }
  }
  if (
    typeof properties.$referring_domain !== 'string' ||
    !/^[a-zA-Z0-9.-]{1,120}$/.test(properties.$referring_domain)
  ) {
    delete properties.$referring_domain
  }
  const path =
    typeof properties.path === 'string' ? allowedPath(properties.path) : null
  if (path && typeof window !== 'undefined') {
    properties.path = path
    properties.$pathname = path
    properties.$host = window.location.hostname
    properties.$current_url = `${window.location.origin}${path}`
  } else {
    delete properties.$current_url
    delete properties.$pathname
    delete properties.$host
  }
  return {
    ...result,
    properties: {
      ...properties,
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
      advanced_disable_flags: true,
      autocapture: false,
      before_send: sanitizeWebsiteCapture,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: 'identified_only',
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      persistence: 'localStorage',
      respect_dnt: true,
    })
    initialized = true
  }
  return true
}

export function getWebsiteAnalyticsDecision(): WebsiteAnalyticsDecision {
  if (typeof window === 'undefined') return 'unknown'
  if (hasWebsiteAnalyticsOptOutSignal()) return 'declined'
  const value = localStorage.getItem(STORAGE_KEY)
  if (value === 'enabled' || value === 'declined') return value
  return analyticsPolicy === 'default-on' ? 'enabled' : 'unknown'
}

export function getWebsiteAnalyticsPolicy(): WebsiteAnalyticsPolicy {
  return analyticsPolicy
}

export function normalizeWebsiteAnalyticsPolicy(
  policy: unknown,
): Exclude<WebsiteAnalyticsPolicy, 'unknown'> {
  return policy === 'default-on' ? 'default-on' : 'consent-required'
}

export function setWebsiteAnalyticsPolicy(
  policy: WebsiteAnalyticsPolicy,
): void {
  analyticsPolicy = policy
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('scrollr:analytics-consent-changed'))
  }
}

export function hasWebsiteAnalyticsOptOutSignal(): boolean {
  if (typeof navigator === 'undefined') return false
  const globalPrivacyControl = (
    navigator as Navigator & { globalPrivacyControl?: boolean }
  ).globalPrivacyControl
  const doNotTrack =
    navigator.doNotTrack ??
    (typeof window === 'undefined'
      ? null
      : (window as Window & { doNotTrack?: string }).doNotTrack)
  return (
    globalPrivacyControl === true || doNotTrack === '1' || doNotTrack === 'yes'
  )
}

export function setWebsiteAnalyticsDecision(
  decision: Exclude<WebsiteAnalyticsDecision, 'unknown'>,
): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, decision)
  if (decision === 'enabled') {
    if (!hasWebsiteAnalyticsOptOutSignal() && initialize()) {
      posthog.reset()
      posthog.opt_in_capturing({ captureEventName: false })
    }
  } else {
    sessionStorage.removeItem(SIGNUP_FLOW_KEY)
    if (initialize()) {
      posthog.reset()
      posthog.opt_out_capturing()
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
    posthog.opt_in_capturing({ captureEventName: false })
  }
  return true
}

export function setWebsiteAnalyticsSuppressed(next: boolean): void {
  suppressed = next
}

export function captureWebsitePageview(rawPath: string): void {
  const path = allowedPath(rawPath)
  if (!path || !ready()) return
  const now = Date.now()
  if (lastPageview.path === path && now - lastPageview.at < 1000) return
  lastPageview = { path, at: now }
  const properties: Record<string, string> = {
    path,
    surface: 'website',
    $current_url: `${window.location.origin}${path}`,
    $pathname: path,
    $host: window.location.hostname,
  }
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const referrer = new URL(document.referrer)
      if (referrer.hostname !== window.location.hostname) {
        properties.$referring_domain = referrer.hostname.slice(0, 120)
      }
    } catch {
      // Invalid referrers are ignored, never forwarded verbatim.
    }
  }
  if (typeof window !== 'undefined' && window.location.search) {
    const params = new URLSearchParams(window.location.search)
    for (const [query, property] of [
      ['utm_source', 'utm_source'],
      ['utm_medium', 'utm_medium'],
      ['utm_campaign', 'utm_campaign'],
    ] as const) {
      const value = params.get(query)
      if (value && /^[a-zA-Z0-9._-]{1,64}$/.test(value)) {
        properties[property] = value
      }
    }
  }
  posthog.capture('$pageview', properties)
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
  posthog.capture(event, safeProperties)
}

export function beginWebsiteSignupFlow(): void {
  if (
    typeof window === 'undefined' ||
    !allowedPath(window.location.pathname) ||
    !ready()
  )
    return
  sessionStorage.setItem(SIGNUP_FLOW_KEY, 'pending')
}

export function hasPendingWebsiteSignupFlow(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(SIGNUP_FLOW_KEY) === 'pending'
}

export interface WebsiteAnalyticsContext {
  eligible: boolean
  verified: boolean
  analytics_distinct_id?: string
}

export function applyWebsiteAnalyticsContext(
  context: WebsiteAnalyticsContext,
): boolean {
  if (typeof window === 'undefined') return false
  const pending = hasPendingWebsiteSignupFlow()
  const distinctID = context.analytics_distinct_id ?? ''
  sessionStorage.removeItem(SIGNUP_FLOW_KEY)
  if (!initialize()) return false
  const validContext =
    context.eligible &&
    /^[0-9a-f]{64}$/i.test(distinctID) &&
    getWebsiteAnalyticsDecision() === 'enabled'
  const currentID = posthog.get_distinct_id()
  const hasPriorAccountIdentity = /^[0-9a-f]{64}$/i.test(currentID)
  if (hasPriorAccountIdentity && (!validContext || currentID !== distinctID)) {
    posthog.reset()
  }
  if (!validContext) return false
  posthog.opt_in_capturing({ captureEventName: false })
  posthog.identify(distinctID)
  if (pending && context.verified) {
    posthog.capture('signup_completed', { surface: 'website' })
  }
  return true
}

export function resetWebsiteAnalyticsIdentity(): void {
  if (!initialized) return
  posthog.reset()
  if (getWebsiteAnalyticsDecision() === 'enabled') {
    posthog.opt_in_capturing({ captureEventName: false })
  }
}
