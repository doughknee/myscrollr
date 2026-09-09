import { describe, expect, it } from 'vitest'
import {
  EXPECTED_REPLICAS,
  connectedCaveat,
  formatAge,
  ingestHealth,
  measuredValue,
} from './adminFormat'

describe('measuredValue', () => {
  it('renders a real number', () => {
    expect(measuredValue({ value: 1234, available: true }).display).toBe(
      (1234).toLocaleString(),
    )
  })

  // The point of the whole Measured type: an unmeasurable thing must not
  // render as "0". "0 active installs" is a claim; "not measurable" is true.
  it('never renders an unavailable value as a number, not even zero', () => {
    const tile = measuredValue({
      value: 0,
      available: false,
      note: 'Not measurable. Scrollr ships no telemetry.',
    })
    expect(tile.display).toBeNull()
    expect(tile.note).toContain('Not measurable')
  })

  it('treats a missing tile as unmeasurable rather than zero', () => {
    expect(measuredValue(undefined).display).toBeNull()
  })
})

describe('connectedCaveat', () => {
  // The trap this exists for: ClientCount() is per-replica and core-api runs
  // two, so a number sourced from one replica is silently about half.
  it('flags an under-reported fleet instead of showing a halved number bare', () => {
    const caveat = connectedCaveat({ count: 7, replicas: 1 })
    expect(caveat).toContain('1 of 2')
    expect(caveat).toContain('higher')
  })

  it('says how many replicas contributed when all of them did', () => {
    expect(
      connectedCaveat({ count: 14, replicas: EXPECTED_REPLICAS }),
    ).toContain(`${EXPECTED_REPLICAS} replicas`)
  })

  it('calls a zero-replica reading untrustworthy', () => {
    expect(connectedCaveat({ count: 0, replicas: 0 })).toContain(
      'not trustworthy',
    )
  })
})

describe('formatAge', () => {
  it('scales the unit to the age', () => {
    expect(formatAge(5)).toBe('5s ago')
    expect(formatAge(90)).toBe('1m ago')
    expect(formatAge(7200)).toBe('2h ago')
    expect(formatAge(172800)).toBe('2d ago')
  })
})

describe('ingestHealth', () => {
  it('calls an empty table empty, not merely stale', () => {
    expect(
      ingestHealth({ table: 'games', age_seconds: 0, has_data: false }),
    ).toBe('empty')
  })

  it('is fresh within the window and stale past it', () => {
    expect(
      ingestHealth({ table: 'trades', age_seconds: 60, has_data: true }),
    ).toBe('fresh')
    expect(
      ingestHealth({ table: 'trades', age_seconds: 7 * 3600, has_data: true }),
    ).toBe('stale')
  })
})
