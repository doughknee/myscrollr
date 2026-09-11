// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { WebsiteAnalyticsGate } from './WebsiteAnalyticsGate'
import { ScrollrAuthProvider } from '@/hooks/useScrollrAuth'

const calls = vi.hoisted(() => ({
  token: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
}))
vi.mock('@logto/react', () => ({
  useLogto: () => {
    const [isLoading, setLoading] = useState(false)
    return {
      isAuthenticated: true,
      isLoading,
      getAccessToken: async () => {
        calls.token()
        setLoading(true)
        await new Promise((resolve) => setTimeout(resolve, 10))
        setLoading(false)
        return 'test-token'
      },
    }
  },
}))
vi.mock('@/api/client', () => ({
  analyticsPolicyApi: { get: () => Promise.resolve({ policy: 'default-on' }) },
  authenticatedFetch: async (
    _path: string,
    _options: unknown,
    getToken: () => Promise<string>,
  ) => {
    await getToken()
    calls.verify()
    return { eligible: true, verified: false }
  },
}))
vi.mock('@/lib/posthog', () => ({
  getWebsiteAnalyticsDecision: () => 'enabled',
  normalizeWebsiteAnalyticsPolicy: (policy: string) => policy,
  setWebsiteAnalyticsPolicy: vi.fn(),
  setWebsiteAnalyticsSuppressed: vi.fn(),
  resetWebsiteAnalyticsIdentity: vi.fn(),
  applyWebsiteAnalyticsContext: () => true,
  captureWebsitePageview: calls.capture,
}))

it.each([false, true])(
  'bounds verification despite SDK loading and failed=%s',
  async (failed) => {
    vi.clearAllMocks()
    calls.verify.mockImplementation(() => {
      if (failed) throw new Error('Rate limited')
    })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    const root = createRoot(document.createElement('div'))
    try {
      await act(() =>
        root.render(
          <ScrollrAuthProvider>
            <WebsiteAnalyticsGate />
          </ScrollrAuthProvider>,
        ),
      )
      for (let i = 0; i < 8; i++)
        await act(() => vi.advanceTimersByTimeAsync(20))
      await act(() =>
        root.render(
          <ScrollrAuthProvider>
            <WebsiteAnalyticsGate />
          </ScrollrAuthProvider>,
        ),
      )
      await act(() => vi.advanceTimersByTimeAsync(3000))
      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(calls.verify).toHaveBeenCalledTimes(failed ? 2 : 1)
      expect(calls.token).toHaveBeenCalledTimes(failed ? 2 : 1)
      expect(calls.capture).toHaveBeenCalledTimes(failed ? 0 : 1)
    } finally {
      await act(() => root.unmount())
      vi.useRealTimers()
    }
  },
)
