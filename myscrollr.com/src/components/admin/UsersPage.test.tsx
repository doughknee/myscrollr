// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UsersPage from './UsersPage'
import type { Root } from 'react-dom/client'
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
const roots: Array<Root> = []

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const button = (c: HTMLElement, text: string) =>
  Array.from(c.querySelectorAll('button')).find((b) =>
    b.textContent.includes(text),
  )!

async function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(() => root.render(<UsersPage />))
  await wait(300)
  return container
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  accounts.mockReset()
  account.mockReset()
  document.body.innerHTML = ''
})

afterEach(async () => {
  await act(() => {
    for (const root of roots.splice(0)) root.unmount()
  })
})

async function search(c: HTMLElement, value: string) {
  const input = c.querySelector('input')!
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('UsersPage', () => {
  it('offers pagination above the list and preserves the query when paging', async () => {
    accounts.mockResolvedValue({ ...page, total: 100 })
    const c = await mount()
    const next = button(c, 'Next')
    expect(
      next.compareDocumentPosition(c.querySelector('table')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await search(c, 'ada')
    await wait(300)
    await act(() => button(c, 'Next').click())
    await wait(300)
    expect(accounts).toHaveBeenLastCalledWith(
      expect.any(Function),
      'ada',
      1,
      expect.any(AbortSignal),
    )
    expect(c.textContent).toContain('Page 2 of 4')
    expect(
      c.querySelector('.admin-user-mobile-summary')?.textContent,
    ).toContain('App activity unknown')
  })
  it('clears an empty search and restores the unfiltered list', async () => {
    accounts
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce({ ...page, accounts: [], total: 0 })
      .mockResolvedValue(page)
    const c = await mount()
    await search(c, 'missing')
    await wait(300)
    expect(c.textContent).toContain('No matching accounts')
    await act(() => button(c, 'Clear search').click())
    expect(c.querySelector('input')?.value).toBe('')
    expect(document.activeElement).toBe(c.querySelector('input'))
    await wait(300)
    expect(accounts).toHaveBeenLastCalledWith(
      expect.any(Function),
      '',
      0,
      expect.any(AbortSignal),
    )
    expect(c.textContent).toContain('ada@example.com')
  })
  it('does not label old rows and totals as a new search, or accept its superseded response', async () => {
    let finishFirst!: (data: AccountsPage) => void
    let finishLatest!: (data: AccountsPage) => void
    accounts
      .mockResolvedValueOnce({ ...page, total: 50 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLatest = resolve
          }),
      )
    const c = await mount()
    expect(c.textContent).toContain('50 accounts')
    await search(c, 'obsolete')
    expect(c.textContent).not.toContain('50 accounts match')
    expect(c.querySelector('[aria-label="View ada@example.com"]')).toBeNull()
    expect(c.querySelector('[aria-label="Loading users"]')).not.toBeNull()
    await wait(300)
    await search(c, 'latest')
    await wait(300)
    await act(() =>
      finishFirst({
        ...page,
        accounts: [{ ...row, email: 'obsolete@example.com' }],
      }),
    )
    expect(c.textContent).not.toContain('obsolete@example.com')
    await act(() =>
      finishLatest({
        ...page,
        accounts: [{ ...row, email: 'latest@example.com' }],
      }),
    )
    expect(c.textContent).toContain('latest@example.com')
    expect(c.textContent).toContain('1 account matches')
  })

  it('does not show the previous page of rows beneath the next page state', async () => {
    let finish!: (data: AccountsPage) => void
    accounts
      .mockResolvedValueOnce({ ...page, total: 50 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const c = await mount()
    await act(() => button(c, 'Next').click())
    expect(c.querySelector('[aria-label="View ada@example.com"]')).toBeNull()
    expect(c.textContent).not.toContain('Page 2 of 2')
    await wait(300)
    expect(accounts).toHaveBeenLastCalledWith(
      expect.any(Function),
      '',
      1,
      expect.any(AbortSignal),
    )
    await act(() =>
      finish({
        ...page,
        total: 50,
        page: 1,
        accounts: [{ ...row, email: 'second@example.com' }],
      }),
    )
    expect(c.textContent).toContain('second@example.com')
    expect(c.textContent).toContain('Page 2 of 2')
  })

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
    Object.defineProperty(window, 'scrollY', {
      value: 1200,
      configurable: true,
    })
    await act(() => view.click())
    await wait(10)
    expect(c.textContent).toContain('Widgets (0)')
    expect(document.activeElement).toBe(button(c, 'All users'))
    await act(() => button(c, 'All users').click())
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 1200,
      behavior: 'instant',
    })
    expect(document.activeElement).toBe(
      c.querySelector('button[aria-label="View ada@example.com"]'),
    )
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
