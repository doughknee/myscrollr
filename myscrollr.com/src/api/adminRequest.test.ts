// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADMIN_SESSION_EXPIRED,
  AdminApiError,
  boundedAdminRequest,
} from './adminRequest'
import { adminApi, subscribeToSupportEvents } from './admin'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('staff request recovery', () => {
  it('backs off repeated stream failures and cancels a pending reconnect', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Offline'))
    vi.stubGlobal('fetch', fetchMock)
    const stop = subscribeToSupportEvents(() => Promise.resolve(null), vi.fn())
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      for (const [index, delay] of [
        3000, 6000, 12000, 24000, 30000, 30000,
      ].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1)
        expect(fetchMock).toHaveBeenCalledTimes(index + 1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(index + 2)
      }
      stop()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchMock).toHaveBeenCalledTimes(7)
    } finally {
      stop()
    }
  })

  it.each(['60', 'Tue, 20 Oct 2026 08:01:00 GMT'])(
    'honors a stream Retry-After value of %s',
    async (retryAfter) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-20T08:00:00Z'))
      const fetchMock = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { 'Retry-After': retryAfter },
          }),
        ),
      )
      vi.stubGlobal('fetch', fetchMock)
      const stop = subscribeToSupportEvents(
        () => Promise.resolve(null),
        vi.fn(),
      )
      try {
        await vi.advanceTimersByTimeAsync(59_999)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)
      } finally {
        stop()
      }
    },
  )

  it('resets backoff after a stable stream while still delivering events', async () => {
    vi.useFakeTimers()
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller
        },
      }),
    )
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(response)
      .mockRejectedValue(new TypeError('Offline'))
    vi.stubGlobal('fetch', fetchMock)
    const event = vi.fn()
    const stop = subscribeToSupportEvents(() => Promise.resolve(null), event)
    try {
      await vi.advanceTimersByTimeAsync(9000)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      stream.enqueue(
        new TextEncoder().encode('data: {"ticket_number":"sample"}\n\n'),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      expect(event).toHaveBeenCalledWith({ ticket_number: 'sample' })
      stream.close()
      await vi.advanceTimersByTimeAsync(2999)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally {
      stop()
    }
  })

  it('stops on a denied stream even when cancelling its body fails', async () => {
    vi.useFakeTimers()
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error('Transport already closed')
        },
      }),
      { status: 403 },
    )
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const stop = subscribeToSupportEvents(() => Promise.resolve(null), vi.fn())
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      stop()
    }
  })

  it('stops the support stream and offers sign-in on a 401 instead of retrying forever', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    window.addEventListener(ADMIN_SESSION_EXPIRED, listener)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    )
    const status = vi.fn()
    const stop = subscribeToSupportEvents(
      () => Promise.resolve(null),
      vi.fn(),
      status,
    )
    try {
      await vi.advanceTimersByTimeAsync(9000)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(status).toHaveBeenLastCalledWith(false)
    } finally {
      stop()
      window.removeEventListener(ADMIN_SESSION_EXPIRED, listener)
    }
  })

  it('does not open a stream when token acquisition finishes after navigation away', async () => {
    let resolve!: (token: string) => void
    const token = new Promise<string>((done) => {
      resolve = done
    })
    vi.stubGlobal('fetch', vi.fn())
    const stop = subscribeToSupportEvents(() => token, vi.fn())
    stop()
    resolve('late')
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('bounds a stalled staff access token and never sends a late request', async () => {
    vi.useFakeTimers()
    let resolve!: (token: string) => void
    const token = new Promise<string>((done) => {
      resolve = done
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = adminApi.me(() => token)
    const result = expect(request).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    resolve('late')
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not retry a timed-out write and explains its uncertain outcome', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const result = expect(
      adminApi.setAutoSendPaused(() => Promise.resolve('token'), true),
    ).rejects.toThrow('outcome is unknown')
    await vi.advanceTimersByTimeAsync(30_000)
    await result
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]).toBeDefined()
  })

  it('preserves authorization status and notifies the mounted console on expiry', async () => {
    const listener = vi.fn()
    window.addEventListener(ADMIN_SESSION_EXPIRED, listener)
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: 'Session expired' }), {
            status: 401,
          }),
        ),
      )
      const result = boundedAdminRequest(
        () => Promise.resolve(null),
        '/admin/settings',
        'Failed',
        'Timed out',
      )
      await expect(result).rejects.toBeInstanceOf(AdminApiError)
      await expect(result).rejects.toMatchObject({ status: 401 })
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(ADMIN_SESSION_EXPIRED, listener)
    }
  })

  it('accepts empty successful deletion responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    )
    await expect(
      boundedAdminRequest(
        () => Promise.resolve(null),
        '/admin/test',
        'Failed',
        'Timed out',
        { method: 'DELETE' },
      ),
    ).resolves.toBeUndefined()
  })
})
