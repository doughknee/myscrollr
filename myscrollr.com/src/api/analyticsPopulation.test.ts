import { describe, expect, it } from 'vitest'
import { populationQuery, verifyPopulation } from './analyticsPopulation'

describe('analytics account population', () => {
  it('encodes all three dimensions and rejects an API that ignores them', () => {
    const selected = { os: 'windows', version: 'v1+beta', plan: 'monthly' }
    const params = new URLSearchParams(populationQuery(selected))
    expect(Object.fromEntries(params)).toEqual(selected)
    expect(() => verifyPopulation({ total: 100 }, selected)).toThrow(
      'has not applied',
    )
    expect(() =>
      verifyPopulation({ population: { ...selected, plan: '' } }, selected),
    ).toThrow('has not applied')
    const filtered = { total: 2, population: selected }
    expect(verifyPopulation(filtered, selected)).toBe(filtered)
  })

  it('accepts the unfiltered API and normalizes empty dimensions', () => {
    expect(verifyPopulation({ total: 100 })).toEqual({ total: 100 })
    expect(
      verifyPopulation(
        { population: { os: 'windows', version: '', plan: '' } },
        { os: 'windows' },
      ),
    ).toBeTruthy()
  })
})
