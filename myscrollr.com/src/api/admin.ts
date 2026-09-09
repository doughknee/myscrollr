/**
 * Staff console API client (REL-260).
 *
 * Deliberately its own module rather than another section of `client.ts`:
 * `client.ts` is imported by marketing routes, so anything added there ships
 * to every visitor. Nothing here is reachable except from the lazily-loaded
 * `/admin` chunk.
 *
 * The API gate is the real boundary — every endpoint below is behind
 * `LogtoAuth + RequireAdmin` and returns 403 to anyone not on the admin list.
 * Keeping the code out of the public bundle is about not shipping internal UI
 * to visitors, not about security.
 */

import { API_BASE } from '@/api/client'

/** An API error that kept its status code, so 403 can be told from 500. */
export class AdminApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
  }
}

async function adminFetch<T>(
  path: string,
  getToken: () => Promise<string | null>,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken()
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: 'Request failed' }))
    throw new AdminApiError(body.error || 'Request failed', response.status)
  }
  // DELETE returns a body, but guard anyway so a 204 never explodes.
  return response.status === 204 ? (undefined as T) : response.json()
}

// ── Overview ──────────────────────────────────────────────────────

/**
 * A number plus whether it means what its label says. `available: false` is
 * not an error — it is the dashboard admitting the number does not exist.
 */
export interface Measured {
  value: number
  available: boolean
  note?: string
}

export interface DailyCount {
  day: string
  count: number
}

export interface AccountsTile {
  total: number
  new_7d: Measured
  new_30d: Measured
  untracked: number
  tracking_since?: string
  daily: Array<DailyCount> | null
}

export interface PlanRow {
  plan: string
  status: string
  lifetime: boolean
  count: number
}

export interface PlansTile {
  free: number
  rows: Array<PlanRow> | null
}

export interface ReleaseCount {
  tag: string
  name: string
  published_at: string
  downloads: number
  prerelease: boolean
}

export interface DownloadsTile {
  total: number
  releases: Array<ReleaseCount> | null
  stale: boolean
  error?: string
}

export interface ConnectedTile {
  count: number
  /** How many core-api replicas reported. See the tile's own caveat. */
  replicas: number
}

export interface SupportTile {
  open_cases: number
  pending_drafts: number
  auto_sent_30d: number
  intervened_30d: number
  oldest_open_hours: number
  oldest_open_ticket?: string
}

export interface CatalogRequestRow {
  query: string
  people: number
}

export interface DemandTile {
  catalog_requests: Array<CatalogRequestRow> | null
  business_leads: number
  leads_unreplied: number
}

export interface IngestRow {
  table: string
  last_update?: string
  age_seconds: number
  has_data: boolean
}

export interface AdminOverview {
  generated_at: string
  accounts: AccountsTile
  plans: PlansTile
  downloads: DownloadsTile
  installs: Measured
  connected_now: ConnectedTile
  support: SupportTile
  demand: DemandTile
  ingest: Array<IngestRow> | null
}

// ── Accounts (read-only) ──────────────────────────────────────────

export interface AccountRow {
  logto_sub: string
  email: string | null
  plan: string
  status: string
  lifetime: boolean
  widgets: number
  on_ticker: number
  fantasy: boolean
  tickets: number
  created_at: string | null
  updated_at: string
  deletion_state: string | null
}

export interface AccountsPage {
  accounts: Array<AccountRow>
  total: number
  page: number
  page_size: number
}

export interface AccountWidget {
  type: string
  enabled: boolean
  ticker_enabled: boolean
  updated_at: string
}

export interface AccountCase {
  ticket_number: string
  subject: string
  status: string
  category: string | null
  opened_at: string
}

export interface AccountDetail {
  account: AccountRow
  widgets: Array<AccountWidget>
  cases: Array<AccountCase>
}

// ── Admins ────────────────────────────────────────────────────────

export interface AdminRow {
  id: number
  email: string
  /** True once this admin has signed in and their Logto sub was pinned. */
  claimed: boolean
  added_by: string | null
  added_at: string
  last_seen_at: string | null
  note: string | null
  /** True for the row belonging to the signed-in admin. Cannot be removed. */
  self: boolean
}

type Token = () => Promise<string | null>

export const adminApi = {
  /** The gate. Resolves with the acting admin's email, or throws 403. */
  me: (getToken: Token) => adminFetch<{ email: string }>('/admin/me', getToken),

  overview: (getToken: Token) =>
    adminFetch<AdminOverview>('/admin/overview', getToken),

  accounts: (getToken: Token, query: string, page: number) =>
    adminFetch<AccountsPage>(
      `/admin/accounts?q=${encodeURIComponent(query)}&page=${page}`,
      getToken,
    ),

  account: (getToken: Token, sub: string) =>
    adminFetch<AccountDetail>(
      `/admin/accounts/${encodeURIComponent(sub)}`,
      getToken,
    ),

  admins: (getToken: Token) =>
    adminFetch<{ admins: Array<AdminRow> }>('/admin/admins', getToken),

  addAdmin: (getToken: Token, email: string, note: string) =>
    adminFetch<{ status: string; id: number }>('/admin/admins', getToken, {
      method: 'POST',
      body: JSON.stringify({ email, note }),
    }),

  removeAdmin: (getToken: Token, id: number) =>
    adminFetch<{ status: string }>(`/admin/admins/${id}`, getToken, {
      method: 'DELETE',
    }),
}
