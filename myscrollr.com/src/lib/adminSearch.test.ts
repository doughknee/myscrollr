import { describe, expect, it } from 'vitest'
import {
  parseSupportSearch,
  parseUsersSearch,
  parseVersionDays,
} from './adminSearch'

describe('staff investigation URLs', () => {
  it('rejects malformed accounts and pagination while keeping a valid search', () => {
    expect(
      parseUsersSearch({ q: 'Ada', user: '../../settings', page: -1 }),
    ).toEqual({ q: 'Ada', page: 0, user: undefined })
    expect(parseUsersSearch({ user: 'sub-1', page: '2' })).toEqual({
      q: '',
      page: 2,
      user: 'sub-1',
    })
  })

  it('opens a ticket deep link independently of people grouping', () => {
    expect(parseSupportSearch({ ticket: '752473' })).toMatchObject({
      ticket: '752473',
      rows: 'ticket',
    })
    expect(
      parseSupportSearch({
        person: 'morgan',
        ticket: '752473',
        sort: 'name',
        dir: 'asc',
        resolved: 'true',
      }),
    ).toMatchObject({
      person: 'morgan',
      ticket: '752473',
      rows: 'person',
      sort: 'name',
      dir: 'asc',
      resolved: true,
    })
  })

  it('defaults unsupported sort and windows to existing product defaults', () => {
    expect(
      parseSupportSearch({ sort: 'anything', ticket: '../../' }),
    ).toMatchObject({ sort: 'last_wrote', ticket: undefined })
    expect(parseVersionDays('90')).toBe(90)
    expect(parseVersionDays('7')).toBe(7)
    expect(parseVersionDays('10000')).toBe(30)
  })
})

it('validates support queue views without changing ticket links', () => {
  expect(parseSupportSearch({ inbox: 'waiting', ticket: '123' })).toMatchObject(
    { inbox: 'waiting', ticket: '123', rows: 'ticket' },
  )
  expect(parseSupportSearch({ inbox: 'unexpected' }).inbox).toBe('all')
})
