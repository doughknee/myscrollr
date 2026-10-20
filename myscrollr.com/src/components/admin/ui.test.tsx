// @vitest-environment jsdom

import { act, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Loaded, useReport } from './ui'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(scoped = false) {
  const calls: Array<ReturnType<typeof deferred<string>>> = []
  function Probe({ period }: { period: number }) {
    const load = useCallback(() => {
      const d = deferred<string>()
      calls.push(d)
      return d.promise
    }, [period])
    const report = useReport(load, scoped ? String(period) : undefined)
    return (
      <Loaded report={report} label="things">
        {(data) => <p>{data}</p>}
      </Loaded>
    )
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = (period: number) =>
    act(() => root.render(<Probe period={period} />))
  return { calls, container, render }
}

describe('useReport', () => {
  it('clears data for a different population while ignoring a superseded result', async () => {
    const { calls, container, render } = setup(true)
    await render(1)
    await act(async () => calls[0].resolve('Windows users'))
    await render(2)
    expect(container.textContent).not.toContain('Windows users')
    expect(container.textContent).toContain('Loading things')
    await render(3)
    await act(async () => calls[1].resolve('Mac users'))
    expect(container.textContent).not.toContain('Mac users')
    await act(async () => calls[2].resolve('Linux users'))
    expect(container.textContent).toBe('Linux users')
  })
  it('keeps the previous data dimmed during a reload, then replaces it', async () => {
    const { calls, container, render } = setup()
    await render(1)
    expect(container.textContent).toContain('Loading things')
    await act(async () => calls[0].resolve('old'))
    expect(container.textContent).toBe('old')

    await render(2)
    expect(container.textContent).toContain('old')
    expect(container.textContent).toContain('Updating things')
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('.opacity-50')?.textContent).toBe('old')

    await act(async () => calls[1].resolve('new'))
    expect(container.textContent).toBe('new')
    expect(container.querySelector('[aria-busy]')).toBeNull()
  })

  it('replaces the view with the error and Retry when a reload fails', async () => {
    const { calls, container, render } = setup()
    await render(1)
    await act(async () => calls[0].resolve('old'))
    await render(2)
    await act(async () => calls[1].reject(new Error('boom')))
    expect(container.textContent).toContain('boom')
    expect(container.textContent).not.toContain('old')
    const retry = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Retry'),
    )!
    await act(() => {
      retry.click()
    })
    expect(calls).toHaveLength(3)
    await act(async () => calls[2].resolve('again'))
    expect(container.textContent).toBe('again')
  })
})
