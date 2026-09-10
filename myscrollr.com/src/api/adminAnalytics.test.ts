import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSignupAnalytics } from './adminAnalytics'

afterEach(() => vi.unstubAllGlobals())

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

  it('forwards cancellation so superseded filter requests cannot win', async () => {
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})
