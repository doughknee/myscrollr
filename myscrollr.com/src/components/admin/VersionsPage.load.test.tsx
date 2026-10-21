// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VersionsPage from './VersionsPage'
import { overview } from './dashboardFixtures'
import type { AdminVersions } from '@/api/admin'
import type { ReactNode } from 'react'
import { adminApi } from '@/api/admin'
import { loadBoundedAdminReport } from '@/api/adminAnalytics'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/admin', () => ({ adminApi: { versions: vi.fn() } }))
vi.mock('@/api/adminAnalytics', () => ({ loadBoundedAdminReport: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))

const data = (days: number): AdminVersions => ({
  generated_at: '2026-09-18T12:00:00Z',
  days,
  current_release: '1.6.7',
  current_share: 0.84,
  desktop_total: 48210,
  unrecognized: 3907,
  versions: [
    {
      version: '1.6.7',
      share: 0.84,
      requests: 40496,
      client_errors: 0,
      server_errors: 0,
      error_rate: 0.003,
    },
  ],
  platforms: [{ platform: 'windows', share: 1, requests: 48210 }],
})
const versions = vi.mocked(adminApi.versions)
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const button = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent.includes(text),
  )!

async function mount(view: 'health' | 'traffic' = 'traffic') {
  const container = document.createElement('div')
  document.body.append(container)
  await act(() => createRoot(container).render(<VersionsPage />))
  await wait(10)
  if (view === 'traffic')
    await act(() => button(container, 'Desktop API').click())
  return container
}

beforeEach(() => {
  versions.mockReset()
  vi.mocked(loadBoundedAdminReport).mockReset().mockResolvedValue(overview)
  document.body.innerHTML = ''
})

describe('VersionsPage loading', () => {
  it('labels its own range without a wide explanatory sentence', async () => {
    versions.mockResolvedValue(data(30))
    const c = await mount()
    expect(c.textContent).toContain('Time window')
    expect(
      c.querySelector('[role="group"][aria-label="Versions range"]'),
    ).not.toBeNull()
  })

  it('shows Retry on a failed load and Retry refetches', async () => {
    versions.mockRejectedValueOnce(new Error('counters down'))
    versions.mockResolvedValue(data(30))
    const c = await mount()
    expect(c.textContent).toContain('counters down')
    await act(() => {
      button(c, 'Retry').click()
    })
    await wait(10)
    expect(c.textContent).toContain('1.6.7')
    expect(versions).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous report visible while a new range loads', async () => {
    versions.mockResolvedValueOnce(data(30))
    const c = await mount()
    versions.mockReturnValueOnce(new Promise(() => {}))
    await act(() => {
      button(c, '7d').click()
    })
    expect(c.textContent).toContain('Updating desktop API counters')
    expect(c.textContent).toContain('1.6.7')
  })
})

it('separates current health from date-filtered traffic and reuses reports when switching views', async () => {
  versions.mockResolvedValue(data(30))
  const c = await mount('health')
  expect(c.textContent).toContain('Data feeds')
  expect(c.textContent).not.toContain('Time window')
  await act(() => button(c, 'Desktop API').click())
  expect(c.textContent).toContain('Time window')
  expect(c.textContent).not.toContain('Data feeds')
  await act(() => button(c, 'Service health').click())
  expect(c.textContent).toContain('Data feeds')
  expect(versions).toHaveBeenCalledTimes(1)
  expect(loadBoundedAdminReport).toHaveBeenCalledTimes(1)
})

it('keeps desktop traffic accessible when service health fails', async () => {
  versions.mockResolvedValue(data(30))
  vi.mocked(loadBoundedAdminReport).mockRejectedValueOnce(
    new Error('Health unavailable'),
  )
  const c = await mount('health')
  expect(c.textContent).toContain('Health unavailable')
  await act(() => button(c, 'Desktop API').click())
  expect(c.textContent).toContain('1.6.7')
})
