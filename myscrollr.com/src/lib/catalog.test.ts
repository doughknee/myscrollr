import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog'

describe('catalog snapshot', () => {
  it('contains every server catalog widget in server order', () => {
    const server = readFileSync(
      new URL('../../../api/internal/platform/widgets.go', import.meta.url),
      'utf8',
    )
    const serverIds = [...server.matchAll(/\bID:\s*"([^"]+)"/g)].map(
      ([, id]) => id,
    )
    const marketing = readFileSync(
      new URL('./catalog.ts', import.meta.url),
      'utf8',
    )
    const snapshotStart = marketing.indexOf('export const CATALOG_SNAPSHOT')
    const snapshotEnd = marketing.indexOf('export const CATEGORY_ACCENT')
    if (snapshotStart < 0 || snapshotEnd < 0) {
      throw new Error('CATALOG_SNAPSHOT block not found')
    }
    const snapshot = marketing.slice(snapshotStart, snapshotEnd)
    const marketingIds = [...snapshot.matchAll(/\['([^']+)'/g)].map(
      ([, id]) => id,
    )
    expect(marketingIds).toEqual(serverIds)
  })

  it('flags exactly the widgets the server marks FreeSlot', () => {
    const server = readFileSync(
      new URL('../../../api/internal/platform/widgets.go', import.meta.url),
      'utf8',
    )
    const serverFree = [
      ...server.matchAll(/\bID:\s*"([^"]+)"[^\n]*\n[^\n]*FreeSlot:\s*true/g),
    ].map(([, id]) => id)
    expect(serverFree).toEqual(['clock', 'weather'])
    expect(
      CATALOG_SNAPSHOT.filter((w) => w.free_slot).map((w) => w.id),
    ).toEqual(serverFree)
  })
})
