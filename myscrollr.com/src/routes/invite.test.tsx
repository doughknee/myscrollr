// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Route } from './invite'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (o: object) => ({
    options: o,
    useSearch: () => ({ token: 't', email: 'a@b.co' }),
  }),
}))
vi.mock('@logto/react', () => ({ useLogto: () => ({ signIn: vi.fn() }) }))
vi.mock('@/api/client', () => ({
  inviteApi: {
    checkUsernameAvailable: () => Promise.reject(new Error('down')),
    completeInvite: vi.fn(),
  },
}))

const Page = (Route as unknown as { options: { component: () => null } })
  .options.component

it('says so when the username check fails, and promises no role', async () => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement('div')
  document.body.append(el)
  await act(async () => createRoot(el).render(<Page />))
  expect(el.textContent).not.toContain('Super User')
  const input = el.querySelector<HTMLInputElement>('#username')!
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!
    set.call(input, 'ann_x')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
  expect(el.textContent).toContain('Could not check this username')
})
