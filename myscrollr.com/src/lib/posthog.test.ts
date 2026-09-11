import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyWebsiteAnalyticsContext,
  beginWebsiteSignupFlow,
  captureWebsiteEvent,
  captureWebsitePageview,
  getWebsiteAnalyticsDecision,
  normalizeWebsiteAnalyticsPolicy,
  resetWebsiteAnalyticsIdentity,
  sanitizeWebsiteCapture,
  setWebsiteAnalyticsDecision,
  setWebsiteAnalyticsPolicy,
  setWebsiteAnalyticsSuppressed,
} from './posthog'

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
  identify: vi.fn(),
  get_distinct_id: vi.fn(() => 'anonymous-id'),
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
const browserPrivacy: {
  doNotTrack: string | null
  globalPrivacyControl?: boolean
} = { doNotTrack: null }
vi.stubGlobal('navigator', browserPrivacy)

describe('website PostHog privacy boundary', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionValues.clear()
    vi.clearAllMocks()
    sdk.get_distinct_id.mockReturnValue('anonymous-id')
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_POSTHOG_KEY', 'test-key')
    window.location.pathname = '/'
    browserPrivacy.doNotTrack = null
    delete browserPrivacy.globalPrivacyControl
    setWebsiteAnalyticsPolicy('unknown')
    setWebsiteAnalyticsSuppressed(false)
  })

  it('defaults unknown and purges durable identity without capturing on decline', () => {
    expect(getWebsiteAnalyticsDecision()).toBe('unknown')
    setWebsiteAnalyticsDecision('declined')
    expect(getWebsiteAnalyticsDecision()).toBe('declined')
    expect(sdk.init).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        api_host: '/ingest',
        ui_host: 'https://us.posthog.com',
        advanced_disable_flags: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        respect_dnt: false,
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

  it('waits for the authentication gate before capturing after consent', () => {
    window.location.pathname = '/channels'
    setWebsiteAnalyticsDecision('enabled')
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('uses regional consent and explicit choices with GPC or DNT enabled', () => {
    for (const signal of ['gpc', 'dnt'] as const) {
      localStorage.clear()
      vi.clearAllMocks()
      if (signal === 'gpc') {
        browserPrivacy.globalPrivacyControl = true
      } else {
        browserPrivacy.doNotTrack = '1'
      }

      for (const policy of ['unknown', 'consent-required'] as const) {
        setWebsiteAnalyticsPolicy(policy)
        expect(getWebsiteAnalyticsDecision()).toBe('unknown')
        captureWebsiteEvent('download_selected')
        expect(sdk.capture).not.toHaveBeenCalled()
      }

      setWebsiteAnalyticsPolicy('default-on')
      expect(getWebsiteAnalyticsDecision()).toBe('enabled')
      expect(localStorage.getItem('scrollr-analytics-consent-v1')).toBeNull()
      captureWebsiteEvent('download_selected')
      expect(sdk.capture).toHaveBeenCalledOnce()

      setWebsiteAnalyticsDecision('declined')
      sdk.capture.mockClear()
      captureWebsiteEvent('download_selected')
      expect(getWebsiteAnalyticsDecision()).toBe('declined')
      expect(sdk.identify).not.toHaveBeenCalled()
      expect(sdk.capture).not.toHaveBeenCalled()

      setWebsiteAnalyticsPolicy('consent-required')
      expect(getWebsiteAnalyticsDecision()).toBe('declined')
      setWebsiteAnalyticsDecision('enabled')
      expect(getWebsiteAnalyticsDecision()).toBe('enabled')
      captureWebsiteEvent('download_selected')
      expect(sdk.capture).toHaveBeenCalledOnce()

      browserPrivacy.doNotTrack = null
      delete browserPrivacy.globalPrivacyControl
    }
  })

  it('uses a US policy default without recording fabricated consent', () => {
    setWebsiteAnalyticsPolicy('default-on')

    expect(getWebsiteAnalyticsDecision()).toBe('enabled')
    expect(localStorage.getItem('scrollr-analytics-consent-v1')).toBeNull()
  })

  it('keeps unknown and consent-required locations consent-first', () => {
    expect(getWebsiteAnalyticsDecision()).toBe('unknown')

    setWebsiteAnalyticsPolicy('consent-required')

    expect(getWebsiteAnalyticsDecision()).toBe('unknown')
  })

  it('fails malformed policy responses closed', () => {
    expect(normalizeWebsiteAnalyticsPolicy('default-on')).toBe('default-on')
    expect(normalizeWebsiteAnalyticsPolicy('US')).toBe('consent-required')
    expect(normalizeWebsiteAnalyticsPolicy(undefined)).toBe('consent-required')
  })

  it('preserves an explicit decline across policy and region changes', () => {
    setWebsiteAnalyticsDecision('declined')
    setWebsiteAnalyticsPolicy('default-on')
    expect(getWebsiteAnalyticsDecision()).toBe('declined')

    setWebsiteAnalyticsPolicy('consent-required')
    expect(getWebsiteAnalyticsDecision()).toBe('declined')
  })

  it('returns to consent-first when a default-on visitor changes region', () => {
    setWebsiteAnalyticsPolicy('default-on')
    expect(getWebsiteAnalyticsDecision()).toBe('enabled')

    setWebsiteAnalyticsPolicy('consent-required')
    expect(getWebsiteAnalyticsDecision()).toBe('unknown')
  })

  it('resets any prior account identity before applying a verified account', () => {
    setWebsiteAnalyticsDecision('enabled')
    sdk.get_distinct_id.mockReturnValue('a'.repeat(64))
    sdk.reset.mockClear()
    sdk.opt_in_capturing.mockClear()
    sdk.identify.mockClear()

    expect(
      applyWebsiteAnalyticsContext({
        eligible: true,
        verified: false,
        analytics_distinct_id: 'b'.repeat(64),
      }),
    ).toBe(true)
    expect(sdk.reset).toHaveBeenCalledOnce()
    expect(sdk.reset.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.opt_in_capturing.mock.invocationCallOrder[0],
    )
    expect(sdk.opt_in_capturing.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.identify.mock.invocationCallOrder[0],
    )
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
    sdk.reset.mockClear()
    sdk.capture.mockClear()
    beginWebsiteSignupFlow()
    const distinctID = 'a'.repeat(64)
    applyWebsiteAnalyticsContext({
      eligible: true,
      verified: true,
      analytics_distinct_id: distinctID,
    })
    expect(sdk.reset).not.toHaveBeenCalled()
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
    captureWebsitePageview('/business')
    expect(sdk.reset).toHaveBeenCalled()
    expect(sdk.opt_in_capturing).toHaveBeenCalledWith({
      captureEventName: false,
    })
    expect(sdk.capture).toHaveBeenCalledWith(
      '$pageview',
      expect.objectContaining({ path: '/business' }),
    )
  })
})
