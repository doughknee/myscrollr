// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalyticsConsent from './AnalyticsConsent'
import { setWebsiteAnalyticsPolicy } from '@/lib/posthog'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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

  it('honors a browser privacy signal and disables manual opt-in', async () => {
    setWebsiteAnalyticsPolicy('consent-required')
    vi.stubGlobal('navigator', { globalPrivacyControl: true })
    expect(renderToStaticMarkup(<AnalyticsConsent />)).toBe('')

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(() => root.render(<AnalyticsConsent />))
    await act(() =>
      window.dispatchEvent(new CustomEvent('scrollr:manage-analytics')),
    )

    expect(container.textContent).toContain(
      'Your browser privacy signal keeps analytics off.',
    )
    expect(container.innerHTML).toMatch(
      /<button[^>]*disabled=""[^>]*>Allow<\/button>/,
    )
    await act(() => root.unmount())
  })

  it('does not show a consent banner before policy resolution or for US default-on', () => {
    expect(renderToStaticMarkup(<AnalyticsConsent />)).toBe('')

    setWebsiteAnalyticsPolicy('default-on')

    expect(renderToStaticMarkup(<AnalyticsConsent />)).toBe('')
  })

  it('reacts to delayed policy resolution and manual settings', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(() => root.render(<AnalyticsConsent />))
    expect(container.textContent).toBe('')

    await act(() => setWebsiteAnalyticsPolicy('consent-required'))
    expect(container.textContent).toContain('PostHog counts public-page visits')

    await act(() => setWebsiteAnalyticsPolicy('default-on'))
    expect(container.textContent).toBe('')

    await act(() =>
      window.dispatchEvent(new CustomEvent('scrollr:manage-analytics')),
    )
    expect(container.textContent).toContain('Decline')

    await act(() => root.unmount())
  })
})
