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
  vi.mocked(adminApi.removeAdmin).mockReset()
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  document.body.innerHTML = ''
})

describe('AdminsPage', () => {
  it('requires explicit confirmation and preserves self-access protections', async () => {
    admins.mockResolvedValue({
      admins: [row(1, 'me@example.com'), row(2, 'other@example.com')],
    })
    const c = await mount()
    expect(c.querySelector('[aria-label="Remove me@example.com"]')).toBeNull()
    await act(() =>
      c
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove other@example.com"]',
        )!
        .click(),
    )
    expect(c.querySelector('dialog')?.open).toBe(true)
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect(adminApi.removeAdmin).not.toHaveBeenCalled()
    await act(() => button(c, 'Cancel').click())
    expect(c.querySelector('dialog')).toBeNull()
    expect(adminApi.removeAdmin).not.toHaveBeenCalled()
  })

  it('keeps failed removal reviewable and prevents repeated submissions', async () => {
    admins.mockResolvedValue({
      admins: [row(1, 'me@example.com'), row(2, 'other@example.com')],
    })
    let reject!: (reason: Error) => void
    vi.mocked(adminApi.removeAdmin).mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    const c = await mount()
    await act(() =>
      c
        .querySelector<HTMLButtonElement>(
          '[aria-label="Remove other@example.com"]',
        )!
        .click(),
    )
    await act(() => button(c, 'Remove access').click())
    expect(button(c, 'Removing').disabled).toBe(true)
    await act(() => reject(new Error('Service unavailable')))
    expect(c.querySelector('dialog [role="alert"]')?.textContent).toContain(
      'Access removal failed',
    )
    expect(c.querySelector('dialog')?.open).toBe(true)
    expect(adminApi.removeAdmin).toHaveBeenCalledTimes(1)
    vi.mocked(adminApi.removeAdmin).mockResolvedValue({ status: 'ok' })
    await act(() => button(c, 'Remove access').click())
    expect(c.querySelector('dialog')).toBeNull()
    expect(adminApi.removeAdmin).toHaveBeenLastCalledWith(
      expect.any(Function),
      2,
    )
  })
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
