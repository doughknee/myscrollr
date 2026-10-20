// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UsersPage from './UsersPage'
import type { AccountDetail, AccountRow, AccountsPage } from '@/api/admin'
import { adminApi } from '@/api/admin'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@/hooks/useGetToken', () => {
  const getToken = () => Promise.resolve('t')
  return { useGetToken: () => getToken }
})
vi.mock('@/api/admin', () => ({
  adminApi: { accounts: vi.fn(), account: vi.fn() },
}))

const row: AccountRow = {
  logto_sub: 'sub-1',
  email: 'ada@example.com',
  name: null,
  plan: 'free',
  status: 'none',
  lifetime: false,
  widgets: 1,
  on_ticker: 0,
  tickets: 0,
  signed_up_at: null,
  last_sign_in_at: null,
  last_used_app: null,
  set_up: true,
  suspended: false,
  deletion_state: null,
}
const page: AccountsPage = {
  accounts: [row],
  total: 1,
  set_up: 1,
  page: 0,
  page_size: 25,
  source: 'logto',
}
const detail: AccountDetail = { account: row, widgets: [], cases: [] }

const accounts = vi.mocked(adminApi.accounts)
const account = vi.mocked(adminApi.account)

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const button = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent.includes(text),
  )!

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  await act(() => createRoot(container).render(<UsersPage />))
  await wait(300)
  return container
}

beforeEach(() => {
  accounts.mockReset()
  account.mockReset()
  document.body.innerHTML = ''
})

describe('UsersPage', () => {
  it('offers a named keyboard-focusable control for account detail', async () => {
    accounts.mockResolvedValue(page)
    account.mockResolvedValue(detail)
    const c = await mount()
    const view = c.querySelector<HTMLButtonElement>(
      'button[aria-label="View ada@example.com"]',
    )!
    expect(view).not.toBeNull()
    view.focus()
    expect(document.activeElement).toBe(view)
    await act(() => view.click())
    await wait(10)
    expect(c.textContent).toContain('Widgets (0)')
  })
  it('clears the error on a new search and shows results', async () => {
    accounts.mockRejectedValueOnce(new Error('logto down'))
    const c = await mount()
    expect(c.textContent).toContain('logto down')
    expect(button(c, 'Retry')).toBeDefined()

    accounts.mockResolvedValue(page)
    const input = c.querySelector('input')!
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'ada')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(c.textContent).not.toContain('logto down')
    expect(c.querySelector('[aria-label="Loading users"]')).not.toBeNull()
    await wait(300)
    expect(c.textContent).toContain('ada@example.com')
  })

  it('retries a failed list load', async () => {
    accounts.mockRejectedValueOnce(new Error('nope')).mockResolvedValue(page)
    const c = await mount()
    await act(() => {
      button(c, 'Retry').click()
    })
    await wait(300)
    expect(c.textContent).toContain('ada@example.com')
    expect(c.textContent).not.toContain('nope')
  })

  it('retries a failed detail load', async () => {
    accounts.mockResolvedValue(page)
    account.mockRejectedValueOnce(new Error('detail broke'))
    account.mockResolvedValue(detail)
    const c = await mount()
    await act(() =>
      c
        .querySelector('tbody tr')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    await wait(10)
    expect(c.textContent).toContain('detail broke')
    await act(() => {
      button(c, 'Retry').click()
    })
    await wait(10)
    expect(c.textContent).not.toContain('detail broke')
    expect(c.textContent).toContain('Widgets (0)')
  })
})
