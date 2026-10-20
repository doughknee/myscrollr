import { API_BASE } from './client'

export const ADMIN_SESSION_EXPIRED = 'scrollr:admin-session-expired'

export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AdminApiError'
  }
}

/** Bounds authentication, transport and body reads; writes are never retried. */
export async function boundedAdminRequest<T>(
  getToken: () => Promise<string | null>,
  path: string,
  fallbackError: string,
  timeoutError: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController()
  const signal = options.signal
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  let timedOut = false
  const didTimeOut = () => timedOut
  const abortError = () =>
    controller.signal.reason ?? new DOMException('Aborted', 'AbortError')
  const aborted = new Promise<never>((_, reject) => {
    if (controller.signal.aborted) reject(abortError())
    else
      controller.signal.addEventListener('abort', () => reject(abortError()), {
        once: true,
      })
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 30_000)
  try {
    const token = await Promise.race([getToken(), aborted])
    if (controller.signal.aborted) throw abortError()
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string> | undefined) ?? {}),
    }
    if (token) headers.Authorization = `Bearer ${token}`
    if (options.body) headers['Content-Type'] = 'application/json'
    const response = await Promise.race([
      fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal,
      }),
      aborted,
    ])
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED))
    }
    if (!response.ok) {
      const body = (await Promise.race([
        response.json().catch(() => null),
        aborted,
      ])) as { error?: string } | null
      throw new AdminApiError(body?.error || fallbackError, response.status)
    }
    if (response.status === 204) return undefined as T
    return (await Promise.race([response.json(), aborted])) as T
  } catch (error) {
    if (didTimeOut()) throw new Error(timeoutError)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
    controller.abort()
  }
}
