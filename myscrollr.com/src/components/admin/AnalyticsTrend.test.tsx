// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalyticsTrend } from './AnalyticsTrend'
import { buckets } from './dashboardFixtures'

const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(() => root.unmount())
  root = createRoot(host)
})

describe('AnalyticsTrend', () => {
  it('draws refunds below zero and preserves money units and partial coverage', async () => {
    const rows = [
      { ...buckets[0], value: 500 },
      { ...buckets[1], value: -250, partial: true },
    ]
    await act(() =>
      root.render(
        <AnalyticsTrend
          buckets={rows}
          step="24h0m0s"
          title="Net earnings"
          unit="USD"
          format={(v) => `$${(v / 100).toFixed(2)}`}
        />,
      ),
    )
    const zero = Number(
      host.querySelector('.analytics-zero')?.getAttribute('y1'),
    )
    const bars = host.querySelectorAll('rect')
    expect(Number(bars[0].getAttribute('y'))).toBeLessThan(zero)
    expect(Number(bars[1].getAttribute('y'))).toBe(zero)
    expect(Number(bars[1].getAttribute('height'))).toBeGreaterThan(0)
    expect(host.querySelector('[aria-live]')?.textContent).toContain('$-2.50')
    expect(host.querySelector('[aria-live]')?.textContent).toContain('partial')
    await act(() => host.querySelector('button')!.focus())
    expect(host.querySelector('[aria-live]')?.textContent).toContain('$5.00')
    expect(host.querySelector('[aria-live]')?.textContent).not.toContain(
      'partial',
    )
  })

  it('keeps a zero observation distinct from missing data, including a single-point line', async () => {
    await act(() =>
      root.render(
        <AnalyticsTrend
          buckets={[]}
          step="24h0m0s"
          title="Users"
          unit="People"
          kind="line"
        />,
      ),
    )
    expect(host.textContent).toContain('No observations in this window.')
    expect(host.querySelector('.analytics-trend-zero')).toBeNull()
    await act(() =>
      root.render(
        <AnalyticsTrend
          buckets={[{ ...buckets[0], value: 0 }]}
          step="24h0m0s"
          title="Users"
          unit="People"
          kind="line"
        />,
      ),
    )
    expect(host.textContent).not.toContain('No observations in this window.')
    expect(host.querySelector('.analytics-trend-zero')?.textContent).toBe(
      'All reported values are zero.',
    )
    expect(host.querySelector('[aria-live] strong')?.textContent).toBe('0')
    expect(host.querySelector('circle')).not.toBeNull()
    expect(host.innerHTML).not.toContain('NaN')
  })

  it('clears a removed selection and exposes the new window through keyboard targets', async () => {
    await act(() =>
      root.render(
        <AnalyticsTrend
          buckets={buckets}
          step="24h0m0s"
          title="Users"
          unit="People"
          kind="line"
        />,
      ),
    )
    await act(() => host.querySelector('button')!.click())
    await act(() =>
      root.render(
        <AnalyticsTrend
          buckets={buckets.slice(1)}
          step="24h0m0s"
          title="Users"
          unit="People"
          kind="line"
        />,
      ),
    )
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(host.querySelector('[aria-live] strong')?.textContent).toBe('7')
    await act(() => host.querySelector('button')!.focus())
    expect(host.querySelector('[aria-live] strong')?.textContent).toBe(
      String(buckets[1].value),
    )
  })
})
