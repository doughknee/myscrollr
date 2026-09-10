import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSignupAnalytics } from './adminAnalytics'
import type { SignupAnalytics } from './adminAnalytics'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('loadSignupAnalytics', () => {
  it('sends only the selected application and supported time window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          application: 'desktop',
          window_days: 30,
          generated_at: '2026-09-10T12:00:00Z',
          measurement: 'events',
          stages: {},
          error_reasons: [],
          coverage: {
            status: 'unknown',
            requested_from: '2026-08-11T12:00:00Z',
            pages: 1,
            unique_logs: 0,
            retention: 'unknown',
            note: 'Retained logs only.',
          },
          attempt_conversion: { available: false, note: 'Unavailable.' },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const report = await loadSignupAnalytics(
      () => Promise.resolve('staff-token'),
      'desktop',
      30,
    )

    expect(report.application).toBe('desktop')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/admin\/analytics\?application=desktop&days=30$/),
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer staff-token' },
      }),
    )
  })

  it('keeps the API unavailable message for the page error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: 'Signup analytics are unavailable.' }),
            { status: 503 },
          ),
        ),
    )

    await expect(
      loadSignupAnalytics(() => Promise.resolve(null), 'website', 7),
    ).rejects.toThrow('Signup analytics are unavailable.')
  })

  it('settles a pre-aborted request without fetching', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    controller.abort()
    await expect(
      loadSignupAnalytics(
        () => Promise.resolve(null),
        'website',
        7,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out when token acquisition never settles', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())

    const request = loadSignupAnalytics(
      () => new Promise(() => undefined),
      'website',
      30,
    )
    const assertion = expect(request).rejects.toThrow(
      'Signup analytics took too long. Please retry.',
    )

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetch).not.toHaveBeenCalled()
  })

  it('settles cancellation while token acquisition is stalled and never fetches later', async () => {
    let resolveToken!: (token: string) => void
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve
    })
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = loadSignupAnalytics(
      () => token,
      'desktop',
      7,
      controller.signal,
    )
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    resolveToken('late-token')
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fetch when token resolution and cancellation happen together', async () => {
    let resolveToken!: (token: string) => void
    const token = new Promise<string>((resolve) => {
      resolveToken = resolve
    })
    const controller = new AbortController()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const request = loadSignupAnalytics(
      () => token,
      'website',
      30,
      controller.signal,
    )
    resolveToken('late-token')
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('times out while a successful response body is still stalled', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => new Promise(() => undefined),
      }),
    )

    const request = loadSignupAnalytics(
      () => Promise.resolve(null),
      'website',
      7,
    )
    const assertion = expect(request).rejects.toThrow(
      'Signup analytics took too long. Please retry.',
    )

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('rejects an older body even when it resolves after a newer selection', async () => {
    let resolveOldBody!: (report: SignupAnalytics) => void
    let markOldFetchStarted!: () => void
    const oldBody = new Promise<SignupAnalytics>((resolve) => {
      resolveOldBody = resolve
    })
    const oldFetchStarted = new Promise<void>((resolve) => {
      markOldFetchStarted = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => {
        markOldFetchStarted()
        return Promise.resolve({ ok: true, json: () => oldBody })
      })
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ application: 'desktop', window_days: 30 }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const oldController = new AbortController()

    const oldRequest = loadSignupAnalytics(
      () => Promise.resolve(null),
      'website',
      7,
      oldController.signal,
    )
    const oldAssertion = expect(oldRequest).rejects.toMatchObject({
      name: 'AbortError',
    })
    await oldFetchStarted
    oldController.abort()
    const current = await loadSignupAnalytics(
      () => Promise.resolve(null),
      'desktop',
      30,
    )
    resolveOldBody({
      application: 'website',
      window_days: 7,
    } as SignupAnalytics)

    await oldAssertion
    expect(current).toMatchObject({ application: 'desktop', window_days: 30 })
  })
})
