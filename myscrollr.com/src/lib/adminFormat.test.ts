import { describe, expect, it } from 'vitest'
import {
  EXPECTED_REPLICAS,
  connectedCaveat,
  formatAge,
  ingestHealth,
  measuredValue,
  sparkline,
  trendValue,
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

describe('trendValue', () => {
  it('keeps the sign and the direction of a fall', () => {
    const t = trendValue({ value: 2, delta: -10, available: true })
    expect(t.value).toBe('2')
    expect(t.delta).toBe('-10')
    expect(t.direction).toBe('down')
  })

  it('marks a rise', () => {
    const t = trendValue({ value: 85, delta: 50, available: true })
    expect(t.delta).toBe('+50')
    expect(t.direction).toBe('up')
  })

  // A count of 0 that fell by 2 is a reading, not a missing number: the tile
  // has to show "0" and "-2", not fall through to "not measurable".
  it('renders a real zero with its delta', () => {
    const t = trendValue({ value: 0, delta: -2, available: true })
    expect(t.value).toBe('0')
    expect(t.delta).toBe('-2')
    expect(t.direction).toBe('down')
  })

  it('shows no delta when nothing moved', () => {
    expect(
      trendValue({ value: 31, delta: 0, available: true }).delta,
    ).toBeNull()
  })

  // Same promise as measuredValue: unavailable never renders as a number, and
  // that includes the delta.
  it('hides both numbers when Logto is unreachable', () => {
    const t = trendValue({
      value: 0,
      delta: 0,
      available: false,
      note: 'Logto is unreachable.',
    })
    expect(t.value).toBeNull()
    expect(t.delta).toBeNull()
    expect(t.note).toContain('unreachable')
  })
})

describe('sparkline', () => {
  const month = Array.from({ length: 30 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, '0')}`,
    count: i,
  }))

  // The bug this guards: the newest point is the one everybody reads, and at
  // x = width it loses half its stroke and all of its dot to the viewBox edge.
  it('keeps the final point inside the box', () => {
    const s = sparkline(month, 120, 36)!
    expect(s.last.x).toBe(120 - 3)
    expect(s.last.y).toBeGreaterThanOrEqual(3)
    expect(s.last.y).toBeLessThanOrEqual(36 - 3)
  })

  it('puts the peak at the top and the trough at the baseline', () => {
    const s = sparkline(
      [
        { day: 'a', count: 0 },
        { day: 'b', count: 10 },
      ],
      100,
      40,
    )!
    expect(s.peak).toBe(10)
    expect(s.line).toContain('M3,37')
    expect(s.last.y).toBe(3)
  })

  // A month where nobody was active is a fact. It must draw flat along the
  // baseline rather than divide by a peak of zero.
  it('draws an all-zero month flat instead of dividing by zero', () => {
    const s = sparkline(
      [
        { day: 'a', count: 0 },
        { day: 'b', count: 0 },
      ],
      100,
      40,
    )!
    expect(s.peak).toBe(0)
    expect(s.last.y).toBe(37)
    expect(s.line).not.toContain('NaN')
  })

  it('has nothing to draw with no points', () => {
    expect(sparkline([], 100, 40)).toBeNull()
    expect(sparkline(null, 100, 40)).toBeNull()
  })
})
