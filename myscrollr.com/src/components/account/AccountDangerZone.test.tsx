// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import AccountDangerZone from '@/components/account/AccountDangerZone'

vi.mock('@/api/client', () => ({ gdprApi: {} }))
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

async function render(purgeStartedAt: string | null) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(() =>
    root.render(
      <AccountDangerZone
        getToken={async () => 't'}
        deletionStatus="pending"
        purgeAt="2026-12-01T00:00:00Z"
        purgeStartedAt={purgeStartedAt}
      />,
    ),
  )
  return { container, root }
}

it('offers Cancel before the purge starts', async () => {
  const { container, root } = await render(null)
  expect(container.textContent).toContain('Account scheduled for deletion')
  expect(container.textContent).toContain('Cancel deletion')
  await act(() => root.unmount())
})

it('says deletion is in progress, with no Cancel, once it has started', async () => {
  const { container, root } = await render('2026-11-13T00:00:00Z')
  expect(container.textContent).toContain('Deletion in progress')
  expect(container.textContent).toContain('can no longer be stopped')
  expect(container.textContent).not.toContain('Cancel deletion')
  await act(() => root.unmount())
})
