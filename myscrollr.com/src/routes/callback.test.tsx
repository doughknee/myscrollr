// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { Route } from './callback'

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  hook: {
    isLoading: false,
    isAuthenticated: false,
    error: undefined as unknown,
  },
  onDone: undefined as undefined | (() => void),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (o: object) => ({ options: o }),
  useNavigate: () => m.navigate,
  Link: 'a',
}))
vi.mock('@logto/react', () => ({
  useHandleSignInCallback: (cb: () => void) => {
    m.onDone = cb
    return m.hook
  },
}))
vi.mock('@/hooks/useScrollrAuth', () => ({
  useScrollrAuth: () => ({ signIn: vi.fn() }),
}))

const Callback = (Route as unknown as { options: { component: () => null } })
  .options.component

async function mount() {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Callback />))
  return root
}

beforeEach(() => {
  m.navigate.mockClear()
  m.hook = { isLoading: false, isAuthenticated: false, error: undefined }
  sessionStorage.clear()
})

it('hands off once, to the stored destination, when both callers fire', async () => {
  sessionStorage.setItem('scrollr:returnTo', '/uplink')
  m.hook = { isLoading: false, isAuthenticated: true, error: undefined }
  await mount()
  await act(async () => m.onDone?.())
  expect(m.navigate).toHaveBeenCalledTimes(1)
  expect(m.navigate).toHaveBeenCalledWith({ to: '/uplink' })
})

it('already signed in with nothing stored goes to /account once', async () => {
  m.hook = { isLoading: false, isAuthenticated: true, error: undefined }
  await mount()
  expect(m.navigate).toHaveBeenCalledTimes(1)
  expect(m.navigate).toHaveBeenCalledWith({ to: '/account' })
})
