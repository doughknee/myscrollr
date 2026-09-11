import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginWebsiteSignupFlow,
  captureWebsiteEvent,
  captureWebsitePageview,
  finishWebsiteSignupFlow,
  getWebsiteAnalyticsDecision,
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
  location: { hostname: 'example.test', pathname: '/', search: '' },
})
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => sessionValues.get(key) ?? null,
  setItem: (key: string, value: string) => sessionValues.set(key, value),
  removeItem: (key: string) => sessionValues.delete(key),
})
vi.stubGlobal('crypto', {
  randomUUID: () => '00000000-0000-4000-8000-000000000009',
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

  it('defaults unknown and never replays on decline', () => {
    expect(getWebsiteAnalyticsDecision()).toBe('unknown')
    setWebsiteAnalyticsDecision('declined')
    expect(getWebsiteAnalyticsDecision()).toBe('declined')
    expect(sdk.opt_out_capturing).not.toHaveBeenCalled()
    expect(sdk.reset).not.toHaveBeenCalled()
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('excludes private routes and strips query strings', () => {
    localStorage.setItem('scrollr-analytics-consent-v1', 'enabled')
    captureWebsitePageview('/download?token=secret')
    captureWebsitePageview('/callback?code=secret')
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    })
    expect(sdk.capture).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledWith('$pageview', {
      distinct_id: '00000000-0000-4000-8000-000000000009',
      path: '/download',
      surface: 'website',
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
      distinct_id: '00000000-0000-4000-8000-000000000009',
      path: '/channels',
      surface: 'website',
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

  it('captures only a server-verified signup', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.capture.mockClear()
    beginWebsiteSignupFlow()
    finishWebsiteSignupFlow(true)
    expect(sdk.capture.mock.calls).toEqual([
      [
        'signup_completed',
        {
          surface: 'website',
          distinct_id: '00000000-0000-4000-8000-000000000009',
        },
      ],
    ])
  })
})
