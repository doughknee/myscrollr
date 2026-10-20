// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SignupTrend } from './SignupTrend'
import { buckets } from './dashboardFixtures'

const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(() => root.unmount())
  root = createRoot(host)
})

describe('SignupTrend', () => {
  it('exposes counts and partial coverage and updates the readout when a bar is selected', async () => {
    await act(() =>
      root.render(<SignupTrend buckets={buckets} step="24h0m0s" />),
    )
    const buttons = host.querySelectorAll('button')
    expect(buttons).toHaveLength(4)
    expect(buttons[3].getAttribute('aria-label')).toContain(
      '7 registrations, partial bucket',
    )
    expect(buttons[3].getAttribute('aria-pressed')).toBe('true')
    await act(() => buttons[0].click())
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-live]')?.textContent).toContain('3')
    expect(host.querySelector('[aria-live]')?.textContent).toContain(
      '2026-09-04',
    )
    expect(host.querySelector('[aria-live]')?.textContent).not.toContain(
      'partial',
    )
  })

  it('falls back to the latest bucket when the selected period removes the selection', async () => {
    await act(() =>
      root.render(<SignupTrend buckets={buckets} step="24h0m0s" />),
    )
    await act(() => host.querySelector('button')!.focus())
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    await act(() =>
      root.render(<SignupTrend buckets={buckets.slice(1)} step="24h0m0s" />),
    )
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(host.querySelector('[aria-live]')?.textContent).toContain('7')
  })

  it('distinguishes no observations from a reported zero', async () => {
    await act(() => root.render(<SignupTrend buckets={[]} step="24h0m0s" />))
    expect(host.textContent).toContain('No observations in this window.')
    expect(host.querySelector('button')).toBeNull()
    await act(() =>
      root.render(
        <SignupTrend buckets={[{ ...buckets[0], value: 0 }]} step="24h0m0s" />,
      ),
    )
    expect(host.textContent).not.toContain('No observations in this window.')
    expect(host.querySelector('button')?.getAttribute('aria-label')).toContain(
      '0 registrations',
    )
  })
})
