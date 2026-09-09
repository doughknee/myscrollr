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

// ── Support console (read-only, REL-263) ──────────────────

export type QueueGroup = 'needs_you' | 'waiting' | 'handled'

/** The pipeline's switch position. Every countdown is meaningless without it. */
export interface AutoSendState {
  armed: boolean
  paused: boolean
  enabled: boolean
  hold_minutes: number
  note: string
}

/**
 * A hold, as the server computed it. `remaining_seconds` is Measured because
 * the number is only a countdown while the pipeline is armed — an unavailable
 * one must render as `note`, never as a time.
 */
export interface AdminHold {
  until: string
  remaining_seconds: Measured
  verb: string
  expired: boolean
  note: string
}

/** The proven-fix answer plus the reasoning that produced it. */
export interface AdminFix {
  issue_key?: string
  proven: boolean
  version?: string
  release_url?: string
  merged_at?: string
  reason: string
}

export interface QueueRow {
  ticket_number: string
  subject: string
  user_email?: string
  category?: string
  priority?: string
  status: string
  summary?: string
  group: QueueGroup
  group_reason: string
  draft_id?: number
  draft_status?: string
  disposition?: string
  disposition_reason?: string
  last_user_message_at?: string
  waiting_hours: Measured
  hold?: AdminHold
  fix?: AdminFix
  opened_at: string
  updated_at: string
}

export interface SupportQueue {
  generated_at: string
  autosend: AutoSendState
  counts: Record<string, number>
  state: string
  rows: Array<QueueRow> | null
}

export interface CaseMessage {
  kind: 'user' | 'ai_draft' | 'sent' | 'note'
  body: string
  superseded: boolean
  draft_id?: number
  created_at: string
}

/** Every field the pipeline wrote about one draft. */
export interface CaseDraft {
  id: number
  status: string
  body: string
  edited_body?: string
  summary?: string
  category?: string
  priority?: string
  confidence?: string
  duplicate_of?: string
  sentiment?: string
  drafter_category?: string
  grounded_in?: string
  unknowns?: string
  ask_user_for?: string
  internal_note?: string
  needs_info: boolean
  should_close: boolean
  disposition?: string
  disposition_reason?: string
  intervened: boolean
  created_at: string
  decided_at?: string
  sent_at?: string
}

export interface CaseContext {
  tier: string
  app_version?: string
  current_version?: string
  version_state: 'unknown' | 'behind' | 'current'
  os?: string
  monitors_attached: number
  monitors_chosen: number
  widgets: Array<{ type: string; on_ticker: boolean }> | null
  has_diagnostics: boolean
  note: string
}

export interface SimilarCase {
  ticket_number: string
  subject: string
  user_wrote: string
  we_sent: string
}

export interface CaseDetail {
  ticket_number: string
  subject: string
  user_email?: string
  logto_sub?: string
  status: string
  category?: string
  priority?: string
  summary?: string
  linear_issue_key?: string
  discord_thread_id?: string
  discord_url?: string
  opened_at: string
  updated_at: string
  closed_at?: string
  group: QueueGroup
  group_reason: string
  messages: Array<CaseMessage> | null
  draft: CaseDraft | null
  draft_note?: string
  context: CaseContext
  fix: AdminFix
  autosend: AutoSendState
  hold?: AdminHold
  stale_days: number
  stale_after: number
  similar: Array<SimilarCase> | null
  known_issues?: string
  evidence_note: string
}

// ── Support console, the verbs (REL-261) ─────────────────────────

/** What filing a bug did. `link_saved: false` is the one that matters. */
export interface FiledBug {
  issue_key: string
  url: string
  already_filed: boolean
  link_saved: boolean
}

export interface FiledBugResult {
  filed: FiledBug
  case: CaseDetail
}

/**
 * One support event off the SSE hub. It names the ticket that moved and what
 * happened to it, and carries no case: the page re-reads from the same
 * handlers it read the first time, so a socket can never disagree with the
 * endpoint about what a case looks like.
 */
export interface SupportEvent {
  type: 'support'
  event:
    | 'drafted'
    | 'decided'
    | 'sent'
    | 'failed'
    | 'skipped'
    | 'held'
    | 'linked'
    | 'unlinked'
    | 'autosend'
  ticket_number?: string
  disposition?: string
  at: string
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

  supportQueue: (getToken: Token, state: string) =>
    adminFetch<SupportQueue>(
      `/admin/support/queue?state=${encodeURIComponent(state)}`,
      getToken,
    ),

  supportCase: (getToken: Token, ticket: string) =>
    adminFetch<CaseDetail>(
      `/admin/support/case/${encodeURIComponent(ticket)}`,
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

  // Every verb answers with the case as it now stands, so nothing below
  // returns a status for the page to interpret — it returns the truth.
  sendDraft: (getToken: Token, draftId: number) =>
    draftAction<CaseDetail>(getToken, draftId, 'send'),

  editAndSend: (getToken: Token, draftId: number, body: string) =>
    draftAction<CaseDetail>(getToken, draftId, 'edit', { body }),

  askUser: (getToken: Token, draftId: number, question: string) =>
    draftAction<CaseDetail>(getToken, draftId, 'ask', { question }),

  skipDraft: (getToken: Token, draftId: number) =>
    draftAction<CaseDetail>(getToken, draftId, 'skip'),

  holdDraft: (getToken: Token, draftId: number) =>
    draftAction<CaseDetail>(getToken, draftId, 'hold'),

  fileAsBug: (getToken: Token, draftId: number) =>
    draftAction<FiledBugResult>(getToken, draftId, 'bug'),

  linkIssue: (getToken: Token, ticket: string, issueKey: string) =>
    adminFetch<CaseDetail>(
      `/admin/support/case/${encodeURIComponent(ticket)}/link`,
      getToken,
      { method: 'POST', body: JSON.stringify({ issue_key: issueKey }) },
    ),

  unlinkIssue: (getToken: Token, ticket: string) =>
    adminFetch<CaseDetail>(
      `/admin/support/case/${encodeURIComponent(ticket)}/link`,
      getToken,
      { method: 'DELETE' },
    ),

  setAutoSendPaused: (getToken: Token, paused: boolean) =>
    adminFetch<AutoSendState>('/admin/support/autosend', getToken, {
      method: 'POST',
      body: JSON.stringify({ paused }),
    }),
}

function draftAction<T>(
  getToken: Token,
  draftId: number,
  verb: string,
  body?: unknown,
): Promise<T> {
  return adminFetch<T>(`/admin/support/draft/${draftId}/${verb}`, getToken, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

/** SSE frames are separated by a blank line; fields by a single one. */
const FRAME_SEPARATOR = '\n\n'
const LINE_SEPARATOR = '\n'

/**
 * Subscribe to the console's SSE stream. Returns a function that closes it.
 *
 * `fetch` rather than `EventSource` for one reason: EventSource cannot send an
 * Authorization header, and the alternative is a JWT in the query string,
 * which puts a credential in every proxy log between here and the API. The
 * body is the same `data: {json}` frames either way, and the parsing below is
 * the whole cost of not doing that.
 *
 * Reconnects with a fixed delay while the caller still wants it. This is a
 * staff page on a fast network; anything cleverer than "try again in three
 * seconds" would be machinery for a case that does not happen.
 */
export function subscribeToSupportEvents(
  getToken: Token,
  onEvent: (event: SupportEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  // The abort signal is the only "should I stop" flag. A second boolean beside
  // it would be written from the returned closure, which control-flow analysis
  // cannot see — so every check of it reads as dead code.
  const controller = new AbortController()
  // A function, not a property read: TypeScript narrows a property to false
  // after the loop condition tests it, which makes every later check read as
  // dead code even though abort() flips it from outside.
  const stopped = () => controller.signal.aborted

  const run = async () => {
    while (!stopped()) {
      try {
        const token = await getToken()
        const response = await fetch(`${API_BASE}/admin/support/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          throw new AdminApiError('stream refused', response.status)
        }
        onStatus?.(true)

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split(FRAME_SEPARATOR)
          // The trailing piece is a frame still arriving, not a frame.
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            for (const line of frame.split(LINE_SEPARATOR)) {
              // Anything that is not a data line — the retry hint, the
              // heartbeat comment — carries nothing for this page.
              if (!line.startsWith('data:')) continue
              try {
                onEvent(JSON.parse(line.slice(5).trim()) as SupportEvent)
              } catch {
                // A frame we cannot parse is a frame we ignore; the page
                // catches up on the next one.
              }
            }
          }
        }
      } catch {
        if (stopped()) return
      }
      onStatus?.(false)
      if (stopped()) return
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  void run()

  return () => controller.abort()
}
