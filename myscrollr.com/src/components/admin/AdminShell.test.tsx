// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminShell, { AdminChrome } from './AdminShell'
import type { ReactNode } from 'react'
import { usesSiteChrome } from '@/lib/siteChrome'
import { AdminApiError } from '@/api/admin'

/**
 * The console's shell (SCROLLR-218).
 *
 * Two things are worth a test here. The first is the rule that the site's
 * chrome stops at /admin — a predicate, so it can be asserted without booting
 * the whole root layout. The second is that the new bar still offers every
 * section and the gate still says what it used to say, because those are the
 * two ways a chrome rewrite quietly loses something.
 */

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  token: vi.fn(),
  signIn: vi.fn(),
  authenticated: true,
}))
vi.mock('@/hooks/useScrollrAuth', () => ({
  useScrollrAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
    signIn: mocks.signIn,
    signOut: vi.fn(),
  }),
}))
vi.mock('@/hooks/useGetToken', () => ({ useGetToken: () => mocks.token }))
vi.mock('@/api/admin', async () => {
  const actual = await vi.importActual('@/api/admin')
  return { ...actual, adminApi: { me: mocks.me } }
})

/** Render on the client inside a throwaway memory router, so Links resolve. */
async function render(node: ReactNode, path = '/admin'): Promise<HTMLElement> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const rootRoute = createRootRoute({ component: () => <>{node}</> })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () => {
    createRoot(host).render(<RouterProvider router={router} />)
  })
  return host
}

const SECTION_LABELS = [
  'Overview',
  'Analytics',
  'Support',
  'Versions',
  'Users',
  'Admins',
  'Settings',
]

beforeEach(() => {
  mocks.authenticated = true
  mocks.me.mockReset()
  document.body.innerHTML = ''
})

describe('site chrome', () => {
  it('does not wrap the staff console', () => {
    for (const path of ['/admin', '/admin/', '/admin/support', '/admin/users'])
      expect(usesSiteChrome(path)).toBe(false)
  })

  it('still wraps every public route', () => {
    for (const path of ['/', '/pricing', '/account', '/business', '/u/bob'])
      expect(usesSiteChrome(path)).toBe(true)
  })
})

describe('AdminChrome', () => {
  it('offers all seven sections and a way back to the site', async () => {
    const host = await render(
      <AdminChrome email="staff@myscrollr.com">
        <p>page</p>
      </AdminChrome>,
    )
    // Every section is a link with its full label; two copies of the row
    // exist (the bar, and the scrolling row for phones), so assert presence.
    for (const label of SECTION_LABELS)
      expect(host.textContent).toContain(label)
    expect(host.textContent).toContain('/ admin')
    expect(host.textContent).toContain('staff@myscrollr.com')
    expect(host.textContent).toContain('Back to site')
    expect(host.querySelector('a[href="/admin/support"]')).not.toBeNull()
    expect(host.querySelector('a[href="/"]')).not.toBeNull()
    // No site chrome came along for the ride.
    expect(host.textContent).not.toContain('SIGN IN')
    expect(host.querySelector('footer')).toBeNull()
  })

  it('renders the optional status slot', async () => {
    const host = await render(
      <AdminChrome email="staff@myscrollr.com" status={<b>3 waiting</b>}>
        <p>page</p>
      </AdminChrome>,
    )
    expect(host.textContent).toContain('3 waiting')
  })

  it('leaves the page area full-bleed', async () => {
    const host = await render(
      <AdminChrome email="staff@myscrollr.com">
        <p>page</p>
      </AdminChrome>,
    )
    const main = host.querySelector('main')!
    expect(main.className).toContain('min-h-[calc(100dvh-48px)]')
    expect(main.className).not.toContain('max-w-')
  })
})

describe('the gate', () => {
  it('keeps the signed-out copy', async () => {
    mocks.authenticated = false
    const host = await render(<AdminShell />)
    expect(host.textContent).toContain('Sign in to continue')
    expect(host.textContent).toContain(
      'only available to signed-in staff accounts',
    )
  })

  it('keeps the denied copy', async () => {
    mocks.me.mockRejectedValue(new AdminApiError('forbidden', 403))
    const host = await render(<AdminShell />)
    expect(host.textContent).toContain('Staff only')
    expect(host.textContent).toContain('limited to the Scrollr admin list')
  })

  it('keeps the error copy and the message the API gave', async () => {
    mocks.me.mockRejectedValue(new Error('Could not reach the API'))
    const host = await render(<AdminShell />)
    expect(host.textContent).toContain('Could not check access')
    expect(host.textContent).toContain('Could not reach the API')
    expect(host.textContent).toContain('Retry access check')
  })
})
