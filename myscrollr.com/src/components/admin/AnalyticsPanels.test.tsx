// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { AnalyticsPanels } from './AnalyticsPanels'

it('supports keyboard chapters and retains an opened lazy panel without loading it early', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(() =>
    root.render(
      <AnalyticsPanels
        panels={[
          { label: 'Accounts', content: <p>Account totals</p> },
          {
            label: 'Signup health',
            lazy: true,
            content: <input aria-label="Investigation note" defaultValue="" />,
          },
        ]}
      />,
    ),
  )
  try {
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    expect(host.querySelector('input')).toBeNull()
    tabs[0].focus()
    await act(() =>
      tabs[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      ),
    )
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    const note = host.querySelector('input')!
    note.value = 'Keep this investigation'
    await act(() =>
      tabs[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      ),
    )
    expect(note.closest('[hidden]')).not.toBeNull()
    await act(() =>
      tabs[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      ),
    )
    expect(host.querySelector('input')).toBe(note)
    expect(note.value).toBe('Keep this investigation')
    expect(note.closest('[hidden]')).toBeNull()
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
