import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadProductAnalytics } from './adminProductAnalytics'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('loadProductAnalytics', () => {
  it('loads only the selected supported window with staff auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ generated_at: '2026-09-10T12:00:00Z', days: 30 }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await loadProductAnalytics(() => Promise.resolve('staff-token'), 30)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/product-analytics\?days=30$/),
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer staff-token' },
      }),
    )
  })

  it('keeps the API error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: 'Product analytics are unavailable.' }),
            { status: 503 },
          ),
        ),
    )

    await expect(
      loadProductAnalytics(() => Promise.resolve(null), 7),
    ).rejects.toThrow('Product analytics are unavailable.')
  })

  it('settles caller cancellation without fetching later', async () => {
    let resolveToken!: (token: string) => void
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve
    })
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = loadProductAnalytics(() => token, 7, controller.signal)
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    resolveToken('late-token')
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out while token acquisition is stalled', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
    const request = loadProductAnalytics(() => new Promise(() => undefined), 30)
    const assertion = expect(request).rejects.toThrow(
      'Product analytics took too long. Please retry.',
    )

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps concurrent section requests independently cancellable', async () => {
    const first = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ generated_at: '2026-09-10T12:00:00Z', days: 30 }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const canceled = loadProductAnalytics(
      () => new Promise(() => undefined),
      7,
      first.signal,
    )
    const current = loadProductAnalytics(() => Promise.resolve(null), 30)
    first.abort()

    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    await expect(current).resolves.toMatchObject({ days: 30 })
  })
})
