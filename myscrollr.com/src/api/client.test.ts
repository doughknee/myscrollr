import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessApi, parseCatalog, parseTierLimits } from './client'
import { FALLBACK_LIMITS } from '@/lib/fallbackTierLimits'
import { CATALOG_SNAPSHOT } from '@/lib/catalog'

afterEach(() => vi.unstubAllGlobals())

const payload = {
  name: 'A',
  email: 'a@b.co',
  company: 'C',
  use_case: 'news' as const,
  message: 'hello there friend',
}

describe('form errors say what to do', () => {
  it('turns a transport failure into a sentence', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    await expect(businessApi.submit(payload)).rejects.toThrow(
      'Could not reach Scrollr',
    )
  })

  it('does not echo a raw 429 or 5xx body', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{"error":"rate limit exceeded"}', { status: 429 }),
      ),
    )
    await expect(businessApi.submit(payload)).rejects.toThrow(
      'Wait a few minutes',
    )
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{"error":"pq: db.internal"}', { status: 500 }),
      ),
    )
    await expect(businessApi.submit(payload)).rejects.toThrow('on our side')
  })

  it('keeps the server sentence for a validation error', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{"error":"Email is invalid"}', { status: 400 }),
      ),
    )
    await expect(businessApi.submit(payload)).rejects.toThrow(
      'Email is invalid',
    )
  })
})

describe('API shape guards fall back instead of crashing a page', () => {
  it('rejects tier limits missing a tier', () => {
    expect(() => parseTierLimits({})).toThrow()
    expect(() => parseTierLimits({ tiers: { free: {} } })).toThrow()
    expect(parseTierLimits(FALLBACK_LIMITS)).toBe(FALLBACK_LIMITS)
  })

  it('rejects a catalog with a malformed entry', () => {
    expect(() => parseCatalog({ widgets: [{ id: 'x' }] })).toThrow()
    expect(() => parseCatalog(null)).toThrow()
    const ok = { version: '1', widgets: CATALOG_SNAPSHOT }
    expect(parseCatalog(ok)).toBe(ok)
  })
})

describe('a hung API ends in an error, not a spinner', () => {
  it('gives up at the deadline with a plain sentence', async () => {
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal)
    vi.stubGlobal(
      'fetch',
      (_u: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    )
    const result = expect(businessApi.submit(payload)).rejects.toThrow(
      'taking too long',
    )
    deadline.abort()
    await result
    expect(timeout).toHaveBeenCalledWith(30_000)
    timeout.mockRestore()
  })
})
