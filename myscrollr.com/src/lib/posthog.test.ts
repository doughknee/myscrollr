import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyWebsiteAnalyticsContext,
  beginWebsiteSignupFlow,
  captureWebsiteEvent,
  captureWebsitePageview,
  getWebsiteAnalyticsDecision,
  resetWebsiteAnalyticsIdentity,
  sanitizeWebsiteCapture,
  setWebsiteAnalyticsDecision,
  setWebsiteAnalyticsSuppressed,
} from './posthog'

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
}))

vi.mock('posthog-js/dist/module.slim', () => ({ default: sdk }))

const values = new Map<string, string>()
const sessionValues = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  clear: () => values.clear(),
})
vi.stubGlobal('window', {
  dispatchEvent: vi.fn(),
  location: {
    hostname: 'example.test',
    origin: 'https://example.test',
    pathname: '/',
    search: '',
  },
})
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => sessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => sessionValues.set(key, value),
  removeItem: (key: string) => sessionValues.delete(key),
})
vi.stubGlobal('CustomEvent', class {})

describe('website PostHog privacy boundary', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionValues.clear()
    vi.clearAllMocks()
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_POSTHOG_KEY', 'test-key')
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://example.test')
    window.location.pathname = '/'
    setWebsiteAnalyticsSuppressed(false)
  })

  it('defaults unknown and purges durable identity without capturing on decline', () => {
    expect(getWebsiteAnalyticsDecision()).toBe('unknown')
    setWebsiteAnalyticsDecision('declined')
    expect(getWebsiteAnalyticsDecision()).toBe('declined')
    expect(sdk.init).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        advanced_disable_flags: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
      }),
    )
    expect(sdk.opt_out_capturing).toHaveBeenCalledOnce()
    expect(sdk.reset).toHaveBeenCalledOnce()
    expect(sdk.reset.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.opt_out_capturing.mock.invocationCallOrder[0],
    )
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('excludes private routes and strips query strings', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    captureWebsitePageview('/download?token=secret')
    captureWebsitePageview('/callback?code=secret')
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    })
    expect(sdk.capture).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledWith('$pageview', {
      path: '/download',
      surface: 'website',
      $current_url: 'https://example.test/download',
      $pathname: '/download',
      $host: 'example.test',
    })
  })

  it('captures the fixed download conversion', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    captureWebsiteEvent('download_selected', { platform: 'windows' })
    expect(sdk.capture).toHaveBeenCalledOnce()
  })

  it('captures the current public landing page when consent is enabled', () => {
    window.location.pathname = '/channels'
    setWebsiteAnalyticsDecision('enabled')
    expect(sdk.capture).toHaveBeenCalledWith('$pageview', {
      path: '/channels',
      surface: 'website',
      $current_url: 'https://example.test/channels',
      $pathname: '/channels',
      $host: 'example.test',
    })
  })

  it('strips SDK-added URLs, device details, person properties, and IP data', () => {
    expect(
      sanitizeWebsiteCapture({
        uuid: '00000000-0000-4000-8000-000000000001',
        event: '$pageview',
        properties: {
          token: 'public-key',
          distinct_id: 'anonymous-id',
          surface: 'website',
          path: '/download',
          $current_url: 'https://example.test/callback?code=secret',
          $referrer: 'https://identity.test/?state=secret',
          $browser: 'Browser',
          $ip: '192.0.2.1',
        },
        $set: { email: 'private@example.test' },
      }),
    ).toEqual({
      uuid: '00000000-0000-4000-8000-000000000001',
      event: '$pageview',
      properties: {
        token: 'public-key',
        distinct_id: 'anonymous-id',
        surface: 'website',
        path: '/download',
        $current_url: 'https://example.test/download',
        $pathname: '/download',
        $host: 'example.test',
        $ip: null,
        $geoip_disable: true,
      },
      $set: undefined,
      $set_once: undefined,
    })
  })

  it('drops SDK-generated events and conversions on private routes', () => {
    expect(
      sanitizeWebsiteCapture({
        uuid: '00000000-0000-4000-8000-000000000002',
        event: '$feature_flag_called',
        properties: {},
      }),
    ).toBeNull()
    window.location.pathname = '/admin'
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    captureWebsiteEvent('download_selected')
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('suppresses capture while authentication is loading or present', () => {
    localStorage.setItem('scrollr-analytics-consent-v1', 'enabled')
    setWebsiteAnalyticsSuppressed(true)
    captureWebsitePageview('/download')
    captureWebsiteEvent('download_selected', { platform: 'windows' })
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('stitches the stable anonymous journey to a server pseudonym', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    beginWebsiteSignupFlow()
    const distinctID = 'a'.repeat(64)
    applyWebsiteAnalyticsContext({
      eligible: true,
      verified: true,
      analytics_distinct_id: distinctID,
    })
    expect(sdk.identify).toHaveBeenCalledWith(distinctID)
    expect(sdk.capture).toHaveBeenCalledWith('signup_completed', {
      surface: 'website',
    })
  })

  it('rejects an invalid server pseudonym', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    applyWebsiteAnalyticsContext({
      eligible: true,
      verified: true,
      analytics_distinct_id: 'raw-user-id',
    })
    expect(sdk.identify).not.toHaveBeenCalled()
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('resets an identified user and resumes consented anonymous capture', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    sdk.opt_in_capturing.mockClear()
    resetWebsiteAnalyticsIdentity()
    captureWebsitePageview('/download')
    expect(sdk.reset).toHaveBeenCalled()
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    })
    expect(sdk.capture).toHaveBeenCalledWith(
      '$pageview',
      expect.objectContaining({ path: '/download' }),
    )
  })
})
