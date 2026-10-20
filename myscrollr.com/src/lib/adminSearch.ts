import type { QueueDir, QueueRowsMode, QueueSort } from '@/api/admin'

export interface UsersSearch {
  q: string
  page: number
  user?: string
}

export interface SupportSearch {
  q: string
  sort: QueueSort
  dir: QueueDir
  rows: QueueRowsMode
  person?: string
  ticket?: string
  resolved: boolean
}

export function parseSupportSearch(
  search: Record<string, unknown>,
): SupportSearch {
  const ticket =
    typeof search.ticket === 'string' && /^\d{1,20}$/.test(search.ticket)
      ? search.ticket
      : undefined
  return {
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : '',
    sort:
      search.sort === 'waiting' ||
      search.sort === 'tickets' ||
      search.sort === 'plan' ||
      search.sort === 'name'
        ? search.sort
        : 'last_wrote',
    dir: search.dir === 'asc' ? 'asc' : 'desc',
    rows:
      search.rows === 'ticket' || (ticket && !search.person)
        ? 'ticket'
        : 'person',
    person:
      typeof search.person === 'string'
        ? search.person.slice(0, 256)
        : undefined,
    ticket,
    resolved: search.resolved === true || search.resolved === 'true',
  }
}

export function parseVersionDays(value: unknown): 7 | 30 | 90 {
  return Number(value) === 7 ? 7 : Number(value) === 90 ? 90 : 30
}

export function parseUsersSearch(search: Record<string, unknown>): UsersSearch {
  const page = Number(search.page)
  return {
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : '',
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0,
    user:
      typeof search.user === 'string' && /^[\w-]{1,128}$/.test(search.user)
        ? search.user
        : undefined,
  }
}
