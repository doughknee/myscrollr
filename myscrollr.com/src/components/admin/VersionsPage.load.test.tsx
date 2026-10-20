// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VersionsPage from './VersionsPage'
import type { AdminVersions } from '@/api/admin'
import { adminApi } from '@/api/admin'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/admin', () => ({ adminApi: { versions: vi.fn() } }))

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

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  await act(() => createRoot(container).render(<VersionsPage />))
  await wait(10)
  return container
}

beforeEach(() => {
  versions.mockReset()
  document.body.innerHTML = ''
})

describe('VersionsPage loading', () => {
  it('labels its range as its own, not the shared Period', async () => {
    versions.mockResolvedValue(data(30))
    const c = await mount()
    expect(c.textContent).toContain('Versions range')
    expect(c.textContent).toContain('not the Period')
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
    expect(c.textContent).toContain('Updating the counters')
    expect(c.textContent).toContain('1.6.7')
  })
})
