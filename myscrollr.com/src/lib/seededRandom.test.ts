import { describe, expect, it } from 'vitest'
import { seededRandom } from './seededRandom'

describe('seededRandom', () => {
  it('produces an identical sequence for the same seed (SSR/hydration contract)', () => {
    // This is the whole point of the module: the server prerender and the
    // client hydration must generate byte-identical particle coordinates.
    const server = seededRandom(42)
    const client = seededRandom(42)
    for (let i = 0; i < 100; i++) {
      expect(client()).toBe(server())
    }
  })

  it('produces different sequences for different seeds', () => {
    const a = seededRandom(1)
    const b = seededRandom(2)
    const aSeq = Array.from({ length: 10 }, () => a())
    const bSeq = Array.from({ length: 10 }, () => b())
    expect(aSeq).not.toEqual(bSeq)
  })

  it('stays within [0, 1)', () => {
    const rand = seededRandom(123456789)
    for (let i = 0; i < 1000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('handles seed 0 and negative seeds without degenerating', () => {
    for (const seed of [0, -1, -123456]) {
      const rand = seededRandom(seed)
      const values = new Set(Array.from({ length: 50 }, () => rand()))
      // A broken generator collapses to a constant; a healthy one gives
      // 50 distinct values.
      expect(values.size).toBe(50)
    }
  })
})
