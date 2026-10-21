// @vitest-environment jsdom

import { act, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Loaded, useReport } from './ui'
import { AdminApiError } from '@/api/adminRequest'

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

function setup(scoped = false, cacheTime = 0, retainSnapshot = false) {
  const calls: Array<ReturnType<typeof deferred<string>>> = []
  let controls: { retry: () => void; cancel: () => void }
  function Probe({ period }: { period: number }) {
    const load = useCallback(() => {
      const d = deferred<string>()
      calls.push(d)
      return d.promise
    }, [period])
    const report = useReport(
      load,
      scoped ? String(period) : undefined,
      cacheTime,
      retainSnapshot,
    )
    controls = report
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
  return {
    calls,
    container,
    render,
    retry: () => act(() => controls.retry()),
    cancel: () => act(() => controls.cancel()),
  }
}

describe('useReport', () => {
  it('retains only a matching read-only snapshot after refresh failure and recovers on retry', async () => {
    const { calls, container, render, retry } = setup(true, 60_000, true)
    await render(1)
    await act(async () => calls[0].resolve('Windows users'))
    const snapshot = container.querySelector('p')
    await retry()
    expect(calls).toHaveLength(2)
    expect(container.querySelector('p')).toBe(snapshot)
    expect(container.querySelector('.opacity-50')).toBeNull()
    await act(async () => calls[1].reject(new Error('Connection lost')))
    expect(container.textContent).toContain('Windows users')
    expect(container.textContent).toContain('Showing the last loaded things')
    await retry()
    await act(async () => calls[2].resolve('Updated Windows users'))
    expect(container.textContent).toBe('Updated Windows users')
    await render(2)
    await act(async () => calls[3].reject(new Error('Unavailable')))
    expect(container.textContent).not.toContain('Windows users')
    expect(container.textContent).not.toContain('Showing the last loaded')
  })

  it('keeps the snapshot when a refresh is canceled and ignores its late result', async () => {
    const { calls, container, render, retry, cancel } = setup(
      true,
      60_000,
      true,
    )
    await render(1)
    await act(async () => calls[0].resolve('Saved'))
    await retry()
    await cancel()
    await act(async () => calls[1].resolve('Late result'))
    expect(container.textContent).toContain('Saved')
    expect(container.textContent).toContain('Loading canceled')
    expect(container.textContent).not.toContain('Late result')
  })

  it.each([401, 403])(
    'clears all snapshots after an access failure (%s)',
    async (status) => {
      const { calls, container, render, retry } = setup(true, 60_000, true)
      await render(1)
      await act(async () => calls[0].resolve('Windows users'))
      await render(2)
      await act(async () => calls[1].resolve('Mac users'))
      await retry()
      await act(async () =>
        calls[2].reject(new AdminApiError('Access denied', status)),
      )
      expect(container.textContent).not.toContain('Mac users')
      await render(1)
      expect(container.textContent).not.toContain('Windows users')
      expect(calls).toHaveLength(4)
    },
  )

  it('reuses only the matching fresh population without another request', async () => {
    const { calls, container, render } = setup(true, 60_000)
    await render(1)
    await act(async () => calls[0].resolve('Windows users'))
    await render(2)
    expect(container.textContent).not.toContain('Windows users')
    await act(async () => calls[1].resolve('Mac users'))
    await render(1)
    expect(container.textContent).toContain('Windows users')
    expect(container.textContent).not.toContain('Mac users')
    expect(container.textContent).not.toContain('Updating things')
    expect(calls).toHaveLength(2)
  })
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
