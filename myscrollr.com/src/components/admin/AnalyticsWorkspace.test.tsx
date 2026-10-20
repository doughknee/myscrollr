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
  it('clears signup diagnostics when the application changes and ignores superseded responses', async () => {
    let finishDesktop!: (value: analytics.SignupAnalytics) => void
    let finishWebsite!: (value: analytics.SignupAnalytics) => void
    vi.mocked(analytics.loadSignupAnalytics)
      .mockResolvedValueOnce({
        ...signup,
        coverage: { ...signup.coverage, note: 'Original website result' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishDesktop = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishWebsite = resolve
          }),
      )
    const host = await mount()
    expect(analytics.loadSignupAnalytics).not.toHaveBeenCalled()
    const disclosure = Array.from(host.querySelectorAll('details')).find((el) =>
      el.querySelector('summary')?.textContent.includes('Signup diagnostics'),
    )!
    await act(() => {
      disclosure.open = true
      disclosure.dispatchEvent(new Event('toggle'))
    })
    expect(host.textContent).toContain('Original website result')
    const application = host.querySelector('[aria-label="Application"]')!
    const applicationButton = (label: string) =>
      Array.from(application.querySelectorAll('button')).find(
        (button) => button.textContent === label,
      )!
    await act(() => applicationButton('Desktop app').click())
    expect(host.textContent).not.toContain('Original website result')
    expect(host.textContent).toContain('Loading signup diagnostics')
    expect(analytics.loadSignupAnalytics).toHaveBeenLastCalledWith(
      expect.any(Function),
      'desktop',
      7,
      expect.any(AbortSignal),
    )
    await act(() => applicationButton('Website').click())
    await act(() =>
      finishDesktop({
        ...signup,
        application: 'desktop',
        coverage: { ...signup.coverage, note: 'Superseded desktop result' },
      }),
    )
    expect(host.textContent).not.toContain('Superseded desktop result')
    expect(host.textContent).toContain('Loading signup diagnostics')
    await act(() =>
      finishWebsite({
        ...signup,
        coverage: { ...signup.coverage, note: 'Current website result' },
      }),
    )
    expect(host.textContent).toContain('Current website result')
    expect(reports.loadAudience).toHaveBeenCalledTimes(1)
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
    const disclosure = Array.from(host.querySelectorAll('details')).find((el) =>
      el.querySelector('summary')?.textContent.includes('Signup diagnostics'),
    )!
    await act(() => {
      disclosure.open = true
      disclosure.dispatchEvent(new Event('toggle'))
    })
    expect(host.textContent).toContain('Seven-day signup result')
    const period = Array.from(
      host.querySelectorAll('[aria-label="Time window"] button'),
    ).find((button) => button.textContent === '30d') as HTMLButtonElement
    await act(() => period.click())
    expect(host.textContent).not.toContain('Seven-day signup result')
    expect(host.textContent).toContain('Loading signup diagnostics')
    expect(analytics.loadSignupAnalytics).toHaveBeenLastCalledWith(
      expect.any(Function),
      'website',
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
