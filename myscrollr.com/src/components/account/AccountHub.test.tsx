// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AccountHub } from '@/routes/account'

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  token: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  authenticated: true,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/hooks/useScrollrAuth', () => ({
  useScrollrAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
    signIn: mocks.signIn,
    signOut: mocks.signOut,
  }),
}))
vi.mock('@/hooks/useGetToken', () => ({ useGetToken: () => mocks.token }))
vi.mock('@/api/client', () => ({ userApi: { overview: mocks.overview } }))
vi.mock('@/components/billing/SubscriptionStatus', () => ({
  default: () => <p>Subscription details</p>,
}))
vi.mock('@/components/account/AccountDangerZone', () => ({
  default: () => <p>Your data controls</p>,
}))

it('recovers account loading errors and provides a real signed-out entry point', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mocks.overview
    .mockRejectedValueOnce(new Error('Request failed'))
    .mockResolvedValue({
      identity: {
        name: 'Test customer',
        username: 'test',
        email: 'test@example.test',
      },
      tier: { current: 'free' },
      links: { logto_account: 'https://example.test/security' },
      gdpr: { deletion_status: 'none', purge_at: null },
    })
  const container = document.createElement('div'),
    root = createRoot(container)
  try {
    await act(() => root.render(<AccountHub />))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load your account',
    )
    expect(container.textContent).not.toContain('Profile & security')
    const retry = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Try again',
    )!
    await act(() => retry.click())
    expect(mocks.overview).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Profile & security')
    expect(container.textContent).toContain('Plan & billing')
    mocks.authenticated = false
    await act(() => root.render(<AccountHub />))
    expect(container.textContent).not.toContain('Test customer')
    const signIn = container.querySelector('button')!
    await act(() => signIn.click())
    expect(mocks.signIn).toHaveBeenCalledWith('/account')
  } finally {
    await act(() => root.unmount())
  }
})
