import { expect, it } from 'vitest'
import { overviewLoad } from './overviewLoad'
import type { AdminOverview } from '../api/admin'

it('keeps the last snapshot through refresh failure and clears the error on retry', () => {
  // The reducer treats a snapshot as opaque; no response fields are fabricated.
  const data = { generated_at: '2026-09-10T12:00:00Z' } as AdminOverview
  let state = overviewLoad(undefined, { type: 'start', request: 1 })
  state = overviewLoad(state, { type: 'success', request: 1, data })
  state = overviewLoad(state, { type: 'start', request: 2 })
  expect(state.data).toBe(data)
  expect(state.loading).toBe(true)
  state = overviewLoad(state, { type: 'error', request: 2, error: 'Offline' })
  expect(state.data).toBe(data)
  expect(state.error).toBe('Offline')
  expect(state.loading).toBe(false)
  state = overviewLoad(state, { type: 'start', request: 3 })
  expect(state.error).toBeNull()
  const refreshed = { ...data, generated_at: '2026-09-10T12:05:00Z' }
  state = overviewLoad(state, { type: 'success', request: 3, data: refreshed })
  expect(state.data).toBe(refreshed)
  expect(state.loading).toBe(false)
})

it('recovers from an initial failure and ignores superseded responses', () => {
  let state = overviewLoad(undefined, { type: 'start', request: 1 })
  state = overviewLoad(state, { type: 'error', request: 1, error: 'Offline' })
  expect(state.data).toBeNull()
  expect(state.error).toBe('Offline')
  expect(state.loading).toBe(false)
  state = overviewLoad(state, { type: 'start', request: 2 })
  expect(state.error).toBeNull()
  const data = { generated_at: '2026-09-10T12:05:00Z' } as AdminOverview
  state = overviewLoad(state, { type: 'success', request: 2, data })
  expect(state.data).toBe(data)
  expect(
    overviewLoad(state, { type: 'error', request: 1, error: 'Late' }),
  ).toBe(state)
  expect(
    overviewLoad(state, { type: 'success', request: 1, data: { ...data } }),
  ).toBe(state)
})
