// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminsPage from './AdminsPage'
import type { AdminRow } from '@/api/admin'
import { adminApi } from '@/api/admin'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/admin', () => ({
  adminApi: { admins: vi.fn(), addAdmin: vi.fn(), removeAdmin: vi.fn() },
}))

const row = (id: number, email: string): AdminRow => ({
  id,
  email,
  note: null,
  claimed: true,
  self: id === 1,
  added_at: '2026-09-01T00:00:00Z',
  added_by: null,
  last_seen_at: null,
})
const admins = vi.mocked(adminApi.admins)
const addAdmin = vi.mocked(adminApi.addAdmin)

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const button = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent.includes(text),
  )!

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  await act(() => createRoot(container).render(<AdminsPage />))
  await wait(10)
  return container
}

beforeEach(() => {
  admins.mockReset()
  addAdmin.mockReset()
  document.body.innerHTML = ''
})

describe('AdminsPage', () => {
  it('shows Retry on a failed load and Retry refetches', async () => {
    admins
      .mockRejectedValueOnce(new Error('admins down'))
      .mockResolvedValue({ admins: [row(1, 'me@example.com')] })
    const c = await mount()
    expect(c.textContent).toContain('admins down')
    await act(() => {
      button(c, 'Retry').click()
    })
    await wait(10)
    expect(c.textContent).toContain('me@example.com')
    expect(admins).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous rows visible while a reload is in flight', async () => {
    admins.mockResolvedValueOnce({ admins: [row(1, 'me@example.com')] })
    const c = await mount()
    let release!: (v: { admins: Array<AdminRow> }) => void
    admins.mockReturnValueOnce(new Promise((r) => (release = r)))
    addAdmin.mockResolvedValue({ status: 'ok', id: 2 })
    const email = c.querySelector('input[type="email"]')!
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(email, 'new@example.com')
      email.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(() => {
      c.querySelector('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })
    await wait(10)
    expect(c.textContent).toContain('me@example.com')
    expect(c.textContent).toContain('Updating admins')
    await act(() =>
      release({
        admins: [row(1, 'me@example.com'), row(2, 'new@example.com')],
      }),
    )
    expect(c.textContent).toContain('new@example.com')
  })
})
