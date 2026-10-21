// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupDiagnosticsSection } from './AnalyticsPage'
import { signup } from './dashboardFixtures'
import { loadSignupAnalytics } from '@/api/adminAnalytics'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/adminAnalytics', () => ({
  loadSignupAnalytics: vi.fn(),
  loadWeek1Return: vi.fn(),
}))

describe('SignupDiagnosticsSection', () => {
  beforeEach(() => {
    vi.mocked(loadSignupAnalytics).mockReset()
    vi.mocked(loadSignupAnalytics).mockResolvedValue(signup)
  })

  it('automatically replaces a fast pending response with the finished report', async () => {
    vi.useFakeTimers()
    vi.mocked(loadSignupAnalytics)
      .mockResolvedValueOnce({ ...signup, available: false, refreshing: true })
      .mockResolvedValueOnce(signup)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<SignupDiagnosticsSection period="7d" expanded />)
      })
      expect(host.textContent).toContain('Preparing signup health')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(loadSignupAnalytics).toHaveBeenCalledTimes(2)
      expect(host.textContent).not.toContain('Preparing signup health')
      expect(host.textContent).toContain('Registration started')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(loadSignupAnalytics).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      vi.useRealTimers()
    }
  })

  it('requests nothing on mount and one report when opened', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<SignupDiagnosticsSection period="7d" />)
    })
    expect(loadSignupAnalytics).not.toHaveBeenCalled()

    const details = host.querySelector('details')!
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(loadSignupAnalytics).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Registration started')

    // Closing and reopening keeps the result and does not ask again.
    await act(async () => {
      host.querySelector('details')!.open = false
      host.querySelector('details')!.dispatchEvent(new Event('toggle'))
    })
    expect(loadSignupAnalytics).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('says unavailable, with the reason, for a scan that timed out', async () => {
    vi.mocked(loadSignupAnalytics).mockResolvedValue({
      ...signup,
      available: false,
      reason: 'Logto did not answer in time.',
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<SignupDiagnosticsSection period="7d" />)
    })
    const details = host.querySelector('details')!
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(host.textContent).toContain('unavailable')
    expect(host.textContent).toContain('Logto did not answer in time.')
    expect(host.textContent).not.toContain('Registration started')
    await act(async () => root.unmount())
  })
})
