import { describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import { initSentry } from './sentry'
import type { ErrorEvent } from '@sentry/react'

vi.mock('@sentry/react', () => ({ init: vi.fn() }))

describe('error report privacy', () => {
  it('removes auth URLs and breadcrumbs and disables unsanitized tracing', () => {
    vi.stubGlobal('__APP_VERSION__', 'test')
    vi.stubGlobal('window', {})
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@example.test/1')
    initSentry()
    const options = vi.mocked(Sentry.init).mock.calls[0][0]
    for (const url of [
      '/callback?code=secret#token',
      'not a url?code=secret',
    ]) {
      const event: ErrorEvent = {
        type: undefined,
        request: { url, headers: { Authorization: 'secret' } },
        breadcrumbs: [
          { category: 'navigation', data: { from: url, to: '/account' } },
        ],
      }
      expect(options.beforeSend!(event, {})).toBe(event)
      expect(JSON.stringify(event)).not.toContain('secret')
      expect(event.request).toBeUndefined()
      expect(event.breadcrumbs).toBeUndefined()
    }
    expect(options.maxBreadcrumbs).toBe(0)
    expect(options.beforeBreadcrumb!({ category: 'navigation' }, {})).toBeNull()
    expect(options.tracesSampleRate).toBe(0)
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})
