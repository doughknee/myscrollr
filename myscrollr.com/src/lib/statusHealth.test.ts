import { describe, expect, it } from 'vitest'
import { classifyState, parseHealth } from './statusHealth'

describe('parseHealth', () => {
  it('accepts a degraded report', () => {
    expect(
      parseHealth({
        status: 'degraded',
        database: 'healthy',
        redis: 'unhealthy',
        services: { finance: 'down' },
      }),
    ).toEqual({
      status: 'degraded',
      database: 'healthy',
      redis: 'unhealthy',
      services: { finance: 'down' },
    })
  })

  it('defaults a report with no services', () => {
    expect(parseHealth({ status: 'degraded' })).toEqual({
      status: 'degraded',
      database: 'unknown',
      redis: 'unknown',
      services: {},
    })
  })

  it('rejects bodies that are not a report', () => {
    for (const body of [null, 'x', 5, [], {}, { error: 'bad gateway' }]) {
      expect(parseHealth(body)).toBeNull()
    }
  })
})

describe('classifyState', () => {
  it('keeps unknown states neutral and visible', () => {
    expect(classifyState('idle')).toEqual({ state: 'unknown', label: 'IDLE' })
    expect(classifyState(undefined)).toEqual({ state: 'unknown' })
    expect(classifyState('error')).toEqual({ state: 'unhealthy' })
  })
})
