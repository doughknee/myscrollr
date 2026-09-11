// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import {
  captureWebsitePageview,
  setWebsiteAnalyticsDecision,
  setWebsiteAnalyticsPolicy,
  setWebsiteAnalyticsSuppressed,
} from './posthog'

const send = vi.hoisted(() => {
  Object.defineProperties(navigator, {
    globalPrivacyControl: { configurable: true, value: true },
    doNotTrack: { configurable: true, value: '1' },
  })
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36',
  )
  const fetch = vi.fn((_url: string | URL | Request, _options?: RequestInit) =>
    Promise.resolve(new Response('{}', { status: 200 })),
  )
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('CompressionStream', undefined)
  return fetch
})

it('sends real SDK events with browser signals through nginx and stops on explicit decline', async () => {
  vi.useFakeTimers()
  vi.stubEnv('PROD', true)
  vi.stubEnv('VITE_POSTHOG_KEY', 'test-key')
  try {
    localStorage.clear()
    setWebsiteAnalyticsPolicy('default-on')
    setWebsiteAnalyticsSuppressed(false)
    captureWebsitePageview('/download')
    await vi.advanceTimersByTimeAsync(4000)
    expect(send).toHaveBeenCalled()
    expect(
      send.mock.calls.map(
        ([url]) => new URL(String(url), window.location.origin).pathname,
      ),
    ).toEqual(['/ingest/e/'])
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'location = /ingest/e/ {',
    )

    setWebsiteAnalyticsDecision('declined')
    send.mockClear()
    captureWebsitePageview('/widgets')
    await vi.advanceTimersByTimeAsync(4000)
    expect(send).not.toHaveBeenCalled()
  } finally {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})
