import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalyticsConsent from './AnalyticsConsent'
import { setWebsiteAnalyticsPolicy } from '@/lib/posthog'

describe('AnalyticsConsent', () => {
  afterEach(() => {
    setWebsiteAnalyticsPolicy('unknown')
    vi.unstubAllGlobals()
  })

  it('offers equal Allow and Decline choices without blocking the page', () => {
    setWebsiteAnalyticsPolicy('consent-required')
    const html = renderToStaticMarkup(<AnalyticsConsent />)
    expect(html).toContain('Usage analytics help us improve Scrollr.')
    expect(html).toContain(
      'PostHog counts public-page visits, signups, and downloads',
    )
    expect(html).toContain('href="/legal?doc=privacy"')
    expect(html).toContain('>Decline</button>')
    expect(html).toContain('>Allow</button>')
    expect(html).toContain('aria-label="Analytics privacy choice"')
    expect(html).not.toContain('role="dialog"')
  })

  it('keeps Allow disabled when a browser privacy signal is active', () => {
    setWebsiteAnalyticsPolicy('consent-required')
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    const html = renderToStaticMarkup(<AnalyticsConsent />)
    expect(html).toContain('Your browser privacy signal keeps analytics off.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Allow<\/button>/)
  })

  it('does not show a consent banner before policy resolution or for US default-on', () => {
    expect(renderToStaticMarkup(<AnalyticsConsent />)).toBe('')

    setWebsiteAnalyticsPolicy('default-on')

    expect(renderToStaticMarkup(<AnalyticsConsent />)).toBe('')
  })
})
