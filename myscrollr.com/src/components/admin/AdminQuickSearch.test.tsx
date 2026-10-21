// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  useBlocker,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminQuickSearch } from './AdminQuickSearch'
import { queue } from './supportFixtures'
import type { Root } from 'react-dom/client'
import type { AccountsPage, TicketSearchPage } from '@/api/admin'
import { adminApi } from '@/api/admin'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.mock('@/hooks/useGetToken', () => {
  const token = () => Promise.resolve('token')
  return { useGetToken: () => token }
})
vi.mock('@/api/admin', () => ({
  adminApi: { accounts: vi.fn(), searchTickets: vi.fn() },
}))
const accounts = vi.mocked(adminApi.accounts)
const tickets = vi.mocked(adminApi.searchTickets)
const ticketPage: TicketSearchPage = {
  rows: (queue.rows ?? []).map((row) => ({
    ticket_number: row.ticket_number,
    subject: row.subject,
    name: row.name ?? '',
    user_email: row.user_email ?? '',
    status: row.status,
    console_status: '',
    updated_at: row.updated_at,
    legacy: false,
  })),
}
const users: AccountsPage = {
  accounts: [
    {
      logto_sub: 'ada-1',
      name: 'Ada',
      email: 'ada@example.com',
      plan: 'free',
      status: 'none',
      lifetime: false,
      widgets: 0,
      on_ticker: 0,
      tickets: 0,
      signed_up_at: null,
      last_sign_in_at: null,
      last_used_app: null,
      set_up: true,
      suspended: false,
      deletion_state: null,
    },
  ],
  total: 1,
  set_up: 1,
  page: 0,
  page_size: 25,
  source: 'logto',
}
const roots: Array<Root> = []
const tick = () => act(() => vi.advanceTimersByTimeAsync(300))

async function mount(block = false) {
  function Shell() {
    useBlocker({
      shouldBlockFn: () => block && !window.confirm('Discard unsent reply?'),
      enableBeforeUnload: false,
    })
    return (
      <StrictMode>
        <AdminQuickSearch />
      </StrictMode>
    )
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Shell }),
    history: createMemoryHistory({ initialEntries: ['/admin/support'] }),
  })
  await router.load()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(() => root.render(<RouterProvider router={router} />))
  return { host, router }
}
async function open(host: HTMLElement) {
  const button = host.querySelector<HTMLButtonElement>('.admin-search-trigger')!
  button.focus()
  await act(() => button.click())
  // Native close events are queued; StrictMode closes and reopens the dialog.
  await act(() => vi.advanceTimersByTimeAsync(0))
}
async function search(host: HTMLElement, text: string) {
  await act(() => {
    const input = host.querySelector('input')!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  accounts.mockReset().mockResolvedValue(users)
  tickets.mockReset().mockResolvedValue(ticketPage)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    if (!this.open) return
    this.open = false
    setTimeout(() => this.dispatchEvent(new Event('close')), 0)
  }
})
afterEach(async () => {
  await act(() => roots.splice(0).forEach((root) => root.unmount()))
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('global staff quick search', () => {
  it('opens with the shortcut, focuses the input and waits for a meaningful debounced query', async () => {
    const { host } = await mount()
    await tick()
    expect(accounts).not.toHaveBeenCalled()
    await act(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    )
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(host.querySelector('dialog')?.open).toBe(true)
    expect(document.activeElement).toBe(host.querySelector('input'))
    await search(host, 'a')
    await tick()
    expect(accounts).not.toHaveBeenCalled()
    await search(host, 'ad')
    await search(host, 'ada')
    await tick()
    expect(accounts).toHaveBeenCalledTimes(1)
    expect(accounts).toHaveBeenCalledWith(
      expect.any(Function),
      'ada',
      0,
      expect.any(AbortSignal),
    )
    expect(tickets).toHaveBeenCalledWith(
      expect.any(Function),
      'ada',
      '',
      expect.any(AbortSignal),
    )
    expect(host.textContent).toContain('Ada')
    const shortcut = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(() => document.dispatchEvent(shortcut))
    expect(shortcut.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(host.querySelector('input'))
    await act(() =>
      host
        .querySelector('input')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
        ),
    )
    expect(document.activeElement?.textContent).toContain('Ada')
  })

  it('ignores stale responses even when the transport does not honor cancellation', async () => {
    let resolve!: (value: AccountsPage) => void
    accounts.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const { host } = await mount()
    await open(host)
    await search(host, 'old')
    await tick()
    const signal = accounts.mock.calls[0][3]!
    await search(host, 'new')
    expect(signal.aborted).toBe(true)
    expect(host.textContent).not.toContain('Ada')
    await tick()
    await act(() =>
      resolve({
        ...users,
        accounts: [{ ...users.accounts[0], name: 'Stale result' }],
      }),
    )
    expect(host.textContent).toContain('Ada')
    expect(host.textContent).not.toContain('Stale result')
    await act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Close search"]')!
        .click(),
    )
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(accounts.mock.calls[1][3]?.aborted).toBe(true)
    await open(host)
    expect(host.querySelector('input')?.value).toBe('')
    expect(host.textContent).not.toContain('Ada')
  })

  it('keeps ticket results usable when users fail, and retries with truthful empty and local-only states', async () => {
    accounts.mockRejectedValueOnce(new Error('failed'))
    const { host } = await mount()
    await open(host)
    await search(host, 'ada')
    await tick()
    expect(host.textContent).toContain('User search couldn’t load')
    expect(host.textContent).not.toContain('No matching users')
    expect(host.querySelector('a[href*="ticket="]')).not.toBeNull()
    accounts.mockResolvedValueOnce({ ...users, source: 'local', accounts: [] })
    tickets.mockResolvedValueOnce({ rows: [] })
    await act(() =>
      host.querySelector<HTMLButtonElement>('.admin-search-retry')!.click(),
    )
    await tick()
    expect(host.textContent).toContain('Showing local accounts only')
    expect(host.textContent).toContain('No matching users')
    expect(host.textContent).toContain('No matching tickets')
  })

  it('supports exact older ticket links and arrow navigation without a queue match', async () => {
    tickets.mockResolvedValue({ rows: [] })
    const { host } = await mount()
    await open(host)
    await search(host, '#12345')
    await tick()
    const input = host.querySelector('input')!
    await act(() =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    )
    const link = document.activeElement as HTMLAnchorElement
    expect(link.textContent).toContain('Open ticket #12345')
    expect(JSON.parse(new URL(link.href).searchParams.get('ticket')!)).toBe(
      '12345',
    )
    expect(link.href).toContain('resolved=true')
    await act(() =>
      link.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
      ),
    )
    expect(document.activeElement).toBe(input)
  })

  it('respects the router blocker and only closes after successful navigation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { host, router } = await mount(true)
    await open(host)
    await search(host, 'ada')
    await tick()
    const link = host.querySelector<HTMLAnchorElement>('a[href*="user=ada-1"]')!
    await act(() => link.click())
    await tick()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/support')
    expect(host.querySelector('dialog')?.open).toBe(true)
    confirm.mockReturnValue(true)
    await act(() => link.click())
    await tick()
    expect(router.state.location.pathname).toBe('/admin/users')
    expect(host.querySelector('dialog')).toBeNull()
  })

  it('loads more history without reloading users and keeps results on a pagination error', async () => {
    tickets.mockResolvedValueOnce({ ...ticketPage, next_cursor: 'page-2' })
    const { host } = await mount()
    await open(host)
    await search(host, 'archive')
    await tick()
    const before = host.querySelectorAll('.admin-search-result').length
    tickets.mockRejectedValueOnce(new Error('offline'))
    await act(() =>
      host.querySelector<HTMLButtonElement>('.admin-search-more')!.click(),
    )
    expect(host.textContent).toContain('Your results are still here')
    expect(host.querySelectorAll('.admin-search-result')).toHaveLength(before)
    tickets.mockResolvedValueOnce({
      rows: [
        {
          ...ticketPage.rows[0],
          ticket_number: '11111',
          subject: 'Older archived ticket',
          legacy: true,
        },
      ],
    })
    await act(() =>
      host.querySelector<HTMLButtonElement>('.admin-search-more')!.click(),
    )
    expect(accounts).toHaveBeenCalledTimes(1)
    expect(tickets).toHaveBeenLastCalledWith(
      expect.any(Function),
      'archive',
      'page-2',
      expect.any(AbortSignal),
    )
    expect(host.textContent).toContain('Older archived ticket')
    expect(host.textContent).toContain('Legacy')
    expect(host.querySelector('.admin-search-more')).toBeNull()
    expect(host.textContent).not.toContain('latest 500')
  })

  it('does not append obsolete pages after the query changes', async () => {
    tickets.mockResolvedValueOnce({ ...ticketPage, next_cursor: 'page-2' })
    const { host } = await mount()
    await open(host)
    await search(host, 'first')
    await tick()
    let resolve!: (value: TicketSearchPage) => void
    tickets.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    await act(() =>
      host.querySelector<HTMLButtonElement>('.admin-search-more')!.click(),
    )
    const signal = tickets.mock.calls[1][3]!
    await search(host, 'second')
    expect(signal.aborted).toBe(true)
    tickets.mockResolvedValueOnce({ rows: [] })
    await tick()
    await act(() =>
      resolve({ rows: [{ ...ticketPage.rows[0], subject: 'Obsolete page' }] }),
    )
    expect(host.textContent).not.toContain('Obsolete page')
    expect(host.textContent).toContain('No matching tickets')
  })
})
