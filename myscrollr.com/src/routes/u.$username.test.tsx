// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Route } from './u.$username'

const auth = vi.hoisted(() => ({
  v: { isAuthenticated: false, isLoading: true },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (o: object) => ({
    options: o,
    useParams: () => ({ username: 'ann' }),
  }),
  Link: 'a',
}))
vi.mock('@/hooks/useScrollrAuth', () => {
  const signIn = vi.fn()
  const getIdTokenClaims = () => Promise.resolve({ username: 'ann' })
  return {
    useScrollrAuth: () => ({ ...auth.v, signIn, getIdTokenClaims }),
  }
})

const Page = (Route as unknown as { options: { component: () => null } })
  .options.component

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
)

it('does not say "not found" to the owner while auth is still loading', async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement('div')
  const root = createRoot(el)
  act(() => root.render(<Page />))
  expect(el.textContent).not.toContain('Profile Not Found')
  auth.v = { isAuthenticated: true, isLoading: false }
  act(() => root.render(<Page />))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  expect(el.textContent).toContain('@ann')
})
