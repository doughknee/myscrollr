// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './AnalyticsPage'
import {
  audience,
  desktop,
  revenue,
  signup,
  support,
  website,
} from './dashboardFixtures'
import type { Root } from 'react-dom/client'
import { parseFilter, parsePeriod, parseView } from '@/lib/adminFormat'
import * as reports from '@/api/adminDashboard'
import * as analytics from '@/api/adminAnalytics'

vi.mock('@/hooks/useGetToken', () => {
  const token = () => Promise.resolve(null)
  return { useGetToken: () => token }
})
vi.mock('@/api/adminDashboard', () => ({
  loadAudience: vi.fn(),
  loadDesktopUsage: vi.fn(),
  loadRevenue: vi.fn(),
  loadWebsite: vi.fn(),
  loadSupportSummary: vi.fn(),
}))
vi.mock('@/api/adminAnalytics', () => ({
  loadWeek1Return: vi.fn(),
  loadSignupAnalytics: vi.fn(),
}))

let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(reports.loadAudience).mockResolvedValue(audience)
  vi.mocked(reports.loadDesktopUsage).mockResolvedValue(desktop)
  vi.mocked(reports.loadRevenue).mockResolvedValue(revenue)
  vi.mocked(reports.loadWebsite).mockResolvedValue(website)
  vi.mocked(reports.loadSupportSummary).mockResolvedValue(support)
  vi.mocked(analytics.loadWeek1Return).mockResolvedValue({
    generated_at: '2026-10-20T00:00:00Z',
    definition: 'Sample weekly cohorts.',
    cohorts: [],
  })
  vi.mocked(analytics.loadSignupAnalytics).mockResolvedValue(signup)
})
afterEach(async () => {
  await act(() => root.unmount())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

async function mount() {
  const rootRoute = createRootRoute({ component: Outlet })
  const admin = createRoute({
    getParentRoute: () => rootRoute,
    path: 'admin',
    component: Outlet,
  })
  const route = createRoute({
    getParentRoute: () => admin,
    path: 'analytics',
    validateSearch: (s: Record<string, unknown>) => ({
      period: parsePeriod(s.period),
      view: parseView(s.view),
      os: parseFilter(s.os),
      version: parseFilter(s.version),
      plan: parseFilter(s.plan),
    }),
    component: AnalyticsPage,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([admin.addChildren([route])]),
    history: createMemoryHistory({
      initialEntries: ['/admin/analytics?period=7d&view=growth'],
    }),
  })
  await router.load()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(() => root.render(<RouterProvider router={router} />))
  return host
}

describe('Analytics report isolation', () => {
  it('keeps a failed refresh readable, announces the saved result and retries only the failed report', async () => {
    const host = await mount()
    const chart = host.querySelector('#growth .analytics-chart')
    vi.mocked(reports.loadAudience).mockRejectedValueOnce(
      new Error('Connection lost'),
    )
    const refresh = Array.from(
      host.querySelectorAll<HTMLButtonElement>('nav button'),
    ).find((b) => b.textContent === 'Refresh')!
    await act(() => refresh.click())
    expect(host.querySelector('#growth .analytics-chart')).toBe(chart)
    const notice = host.querySelector('.analytics-refresh-notice')!
    expect(notice.textContent).toContain('Saved results')
    expect(
      notice.querySelector('button')?.getAttribute('aria-label'),
    ).toContain("Accounts couldn't refresh")
    await act(() => notice.querySelector('button')!.click())
    expect(document.activeElement).toBe(host.querySelector('#growth-heading'))
    expect(host.querySelector('.analytics-refresh-notice')).toBeNull()
    expect(reports.loadAudience).toHaveBeenCalledTimes(3)
    expect(reports.loadWebsite).toHaveBeenCalledTimes(2)
    expect(reports.loadRevenue).toHaveBeenCalledTimes(1)
  })

  it('keeps population controls on every tab and passes all dimensions to account reports', async () => {
    const host = await mount()
    const select = host.querySelector<HTMLSelectElement>(
      '.analytics-population-controls select[name="os"]',
    )!
    await act(() => {
      select.value = 'windows'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    for (const load of [
      reports.loadAudience,
      reports.loadRevenue,
      reports.loadSupportSummary,
    ]) {
      expect(load).toHaveBeenLastCalledWith(
        expect.any(Function),
        '7d',
        expect.any(AbortSignal),
        { os: 'windows', version: undefined, plan: undefined },
      )
    }
    expect(analytics.loadWeek1Return).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(AbortSignal),
      { os: 'windows', version: undefined, plan: undefined },
    )
    for (const label of ['Revenue', 'Support', 'Desktop usage', 'Growth']) {
      const button = Array.from(host.querySelectorAll('nav button')).find(
        (b) => b.getAttribute('aria-label') === label,
      ) as HTMLButtonElement
      await act(() => button.click())
      expect(select.closest('[hidden]')).toBeNull()
      expect(select.value).toBe('windows')
    }
    // View changes reuse reports for the selected population.
    expect(reports.loadRevenue).toHaveBeenCalledTimes(2)
    expect(reports.loadWebsite).toHaveBeenCalledTimes(1)
  })

  it('defaults to desktop and restores its cached result while ignoring a superseded website scan', async () => {
    let finishWebsite!: (value: analytics.SignupAnalytics) => void
    vi.mocked(analytics.loadSignupAnalytics)
      .mockResolvedValueOnce({
        ...signup,
        coverage: { ...signup.coverage, note: 'Desktop result' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishWebsite = resolve
          }),
      )
    const host = await mount()
    expect(analytics.loadSignupAnalytics).not.toHaveBeenCalled()
    const health = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((el) => el.textContent === 'Signup health')!
    await act(() => health.click())
    expect(analytics.loadSignupAnalytics).toHaveBeenLastCalledWith(
      expect.any(Function),
      'desktop',
      7,
      expect.any(AbortSignal),
    )
    expect(host.textContent).toContain('Desktop result')
    const application = host.querySelector('[aria-label="Application"]')!
    const button = (label: string) =>
      Array.from(application.querySelectorAll('button')).find(
        (el) => el.textContent === label,
      )!
    await act(() => button('Website').click())
    expect(host.textContent).not.toContain('Desktop result')
    expect(host.textContent).toContain('Loading signup diagnostics')
    await act(() => button('Desktop app').click())
    expect(host.textContent).toContain('Desktop result')
    expect(analytics.loadSignupAnalytics).toHaveBeenCalledTimes(2)
    await act(() =>
      finishWebsite({
        ...signup,
        coverage: { ...signup.coverage, note: 'Superseded website result' },
      }),
    )
    expect(host.textContent).not.toContain('Superseded website result')
    expect(host.textContent).toContain('Desktop result')
  })

  it('keeps other views usable when a hidden report and its verdict throw, then retries only that report', async () => {
    vi.mocked(reports.loadRevenue).mockResolvedValueOnce({} as typeof revenue)
    const host = await mount()
    expect(host.textContent).toContain('New accounts over time')
    expect(host.textContent).toContain('Do new users come back?')
    const failure = host.querySelector('[aria-label="Revenue unavailable"]')!
    expect(failure).not.toBeNull()
    const nav = host.querySelector('nav')!
    const revenueButton = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent === 'Revenue',
    )!
    await act(() => revenueButton.click())
    expect(failure.closest('[hidden]')).toBeNull()
    await act(() => failure.querySelector('button')!.click())
    expect(host.querySelector('[aria-label="Revenue unavailable"]')).toBeNull()
    expect(host.textContent).toContain('Net earnings over time')
    expect(reports.loadRevenue).toHaveBeenCalledTimes(2)
    expect(reports.loadAudience).toHaveBeenCalledTimes(1)
  })

  it('clears diagnostics when the effective signup window changes', async () => {
    let finish!: (value: analytics.SignupAnalytics) => void
    vi.mocked(analytics.loadSignupAnalytics)
      .mockResolvedValueOnce({
        ...signup,
        coverage: { ...signup.coverage, note: 'Seven-day signup result' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const host = await mount()
    const health = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((el) => el.textContent === 'Signup health')!
    await act(() => health.click())
    expect(host.textContent).toContain('Seven-day signup result')
    const period = Array.from(
      host.querySelectorAll('[aria-label="Time window"] button'),
    ).find((button) => button.textContent === '30d') as HTMLButtonElement
    await act(() => period.click())
    expect(host.textContent).not.toContain('Seven-day signup result')
    expect(host.textContent).toContain('Loading signup diagnostics')
    expect(analytics.loadSignupAnalytics).toHaveBeenLastCalledWith(
      expect.any(Function),
      'desktop',
      30,
      expect.any(AbortSignal),
    )
    await act(() =>
      finish({
        ...signup,
        window_days: 30,
        coverage: { ...signup.coverage, note: 'Thirty-day signup result' },
      }),
    )
    expect(host.textContent).toContain('Thirty-day signup result')
  })

  it('preserves the open diagnostic snapshot on toolbar refresh and replaces it in place', async () => {
    let finish!: (value: analytics.SignupAnalytics) => void
    vi.mocked(analytics.loadSignupAnalytics)
      .mockResolvedValueOnce({
        ...signup,
        coverage: { ...signup.coverage, note: 'Existing diagnosis' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const host = await mount()
    const health = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((el) => el.textContent === 'Signup health')!
    await act(() => health.click())
    const refresh = Array.from(
      host.querySelectorAll<HTMLButtonElement>('nav button'),
    ).find((el) => el.textContent === 'Refresh')!
    await act(() => refresh.click())
    expect(analytics.loadSignupAnalytics).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Existing diagnosis')
    expect(host.textContent).not.toContain('Loading signup diagnostics')
    await act(() =>
      finish({
        ...signup,
        coverage: { ...signup.coverage, note: 'Refreshed diagnosis' },
      }),
    )
    expect(host.textContent).toContain('Refreshed diagnosis')
    expect(host.textContent).not.toContain('Existing diagnosis')
  })

  it('isolates malformed cohorts from the growth report', async () => {
    vi.mocked(analytics.loadWeek1Return).mockResolvedValueOnce({
      generated_at: '2026-10-20T00:00:00Z',
      definition: '',
      cohorts: 'invalid',
    } as unknown as analytics.Week1ReturnReport)
    const host = await mount()
    expect(host.textContent).toContain('New accounts over time')
    const failure = host.querySelector(
      '[aria-label="Week-1 return unavailable"]',
    )!
    expect(failure).not.toBeNull()
    await act(() => failure.querySelector('button')!.click())
    expect(
      host.querySelector('[aria-label="Week-1 return unavailable"]'),
    ).toBeNull()
    expect(host.textContent).toContain('No weekly cohort has matured yet')
  })
})
