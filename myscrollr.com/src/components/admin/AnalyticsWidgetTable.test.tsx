// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { AnalyticsWidgetTable } from './AnalyticsWidgetTable'
import { desktop } from './dashboardFixtures'

const host = document.createElement('div')
document.body.append(host)
let root = createRoot(host)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  await act(() => root.unmount())
  root = createRoot(host)
})
const table = () => host.querySelector('.analytics-widget-table')!
async function view(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  )!
  await act(() => button.click())
}

describe('widget measurement views', () => {
  it('keeps changes and current configuration distinct and sorts by the chosen measurement', async () => {
    await act(() =>
      root.render(
        <AnalyticsWidgetTable
          widgets={{
            ...desktop.widgets,
            rows: desktop.widgets.rows!.map((row) =>
              row.widget_type === 'clock' ? { ...row, screen_hours: 999 } : row,
            ),
          }}
        />,
      ),
    )
    await view('Configuration')
    expect(
      [...table().querySelector('tbody tr')!.querySelectorAll('td')].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(['+3', '−1', '22of 25 total'])
    const select = host.querySelector('select')!
    await act(() => {
      select.value = 'screen_hours'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(table().querySelector('tbody th')?.textContent).toBe(
      'Clockutilities',
    )
    await view('Time on screen')
    expect(table().querySelector('tbody tr')?.textContent).toContain('999 h')
  })
  it('retains exact metrics and unavailable values across focused views', async () => {
    await act(() =>
      root.render(
        <AnalyticsWidgetTable
          widgets={{
            ...desktop.widgets,
            changes_available: false,
            changes_note: 'Not attributable to this OS.',
          }}
        />,
      ),
    )
    const rows = () => [...table().querySelectorAll('tbody tr')]
    expect(rows()[0].textContent).toContain('74%')
    expect(rows()[1].querySelector('td:last-child')?.textContent).toBe('—')
    await view('Time on screen')
    expect(rows()[0].textContent).toContain('210.5 h')
    expect(rows()[0].textContent).toContain('240 h')
    await view('Configuration')
    expect(
      [...rows()[0].querySelectorAll('td')].map((cell) => cell.textContent),
    ).toEqual(['—', '—', '22of 25 total'])
    expect(host.textContent).toContain('Not attributable to this OS.')
    expect(
      host.querySelector('.analytics-category-table')?.textContent,
    ).toContain('210.5 h')
  })

  it('searches names and categories without altering population totals, then clears', async () => {
    await act(() =>
      root.render(<AnalyticsWidgetTable widgets={desktop.widgets} />),
    )
    const input = host.querySelector('input')!
    const enter = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await enter('SPORTS')
    expect(table().querySelectorAll('tbody tr')).toHaveLength(1)
    expect(table().textContent).toContain('NFL')
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      '1 of 2 widgets · 27 measured ticker users',
    )
    await enter('missing')
    expect(table().querySelectorAll('tbody tr')).toHaveLength(0)
    expect(host.textContent).toContain('No widgets match')
    await act(() =>
      (
        host.querySelector(
          '[aria-label="Clear widget search"]',
        ) as HTMLButtonElement
      ).click(),
    )
    expect(table().querySelectorAll('tbody tr')).toHaveLength(2)
    await view('Time on screen')
    expect(input.value).toBe('')
  })
})
