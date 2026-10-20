// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './SettingsPage'
import type { AdminSettings } from '@/api/admin'
import { EXCLUDE_STAFF_SETTING, adminApi } from '@/api/admin'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/admin', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  adminApi: { settings: vi.fn(), saveSettings: vi.fn() },
}))

const data: AdminSettings = {
  settings: { [EXCLUDE_STAFF_SETTING]: { value: true, default: true } },
}
const settings = vi.mocked(adminApi.settings)
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  await act(() => createRoot(container).render(<SettingsPage />))
  await wait(10)
  return container
}
const retry = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent.includes('Retry'),
  )!

beforeEach(() => {
  settings.mockReset()
  document.body.innerHTML = ''
})

describe('SettingsPage loading', () => {
  it('shows Retry on a failed load and Retry refetches', async () => {
    settings.mockRejectedValueOnce(new Error('settings down'))
    settings.mockResolvedValue(data)
    const c = await mount()
    expect(c.textContent).toContain('settings down')
    await act(() => {
      retry(c).click()
    })
    await wait(10)
    expect(c.querySelector('[role="switch"]')).not.toBeNull()
    expect(settings).toHaveBeenCalledTimes(2)
  })
})
