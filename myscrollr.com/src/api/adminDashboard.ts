/**
 * Admin dashboard reports (SCROLLR-210).
 *
 * Every historical endpoint below shares one time contract
 * (docs/analytics/ADMIN_DASHBOARD.md): a `period` selector of 24h / 7d / 30d /
 * lifetime, a rolling window echoed back as `period`, and the immediately
 * preceding equal-length window as `previous`. The JSON field names are the
 * Go struct tags in api/internal/admin and api/internal/support — snake_case,
 * verbatim.
 *
 * Two promises every reader of these types must keep:
 * - a `Metric` with `available: false` never renders as a number, not even 0;
 * - a `Comparison` with `comparable: false` renders its note, never a delta.
 */

import { loadBoundedAdminReport } from './adminAnalytics'
import type { AutoSendState, Measured } from './admin'
import type { ProductAnalytics, RetentionMetric } from './adminProductAnalytics'

export type Period = '24h' | '7d' | '30d' | 'lifetime'

/** One resolved window, half-open, RFC3339 UTC. `start` is null for lifetime. */
export interface Window {
  key: Period
  start: string | null
  end: string
}

/**
 * A figure's change against the previous window. `comparable: false` means no
 * honest comparison exists (lifetime, coverage too short, zero previous) and
 * `note` says why. `delta_pct` absent means "no percentage" even when
 * comparable — a percentage against zero is a claim, not a change.
 */
export interface Comparison {
  previous?: number
  delta?: number
  delta_pct?: number
  comparable: boolean
  note?: string
}

export interface Metric {
  value: number
  available: boolean
  note?: string
  comparison: Comparison
}

/** One chart bar, clipped to the window; `partial` marks a short edge bucket. */
export interface Bucket {
  start: string
  end: string
  value: number
  partial?: boolean
}

export interface Coverage {
  /** When measurement began, or null when the source is unbounded. */
  from: string | null
  /** The requested window starts before `from`. */
  partial: boolean
  note?: string
}

// ── Live desktop presence ─────────────────────────────────────────

export interface PresenceLive {
  generated_at: string
  available: boolean
  note?: string
  /** Exactly "x active users · y with ticker(s) · z screens". */
  headline: string
  staff_excluded: boolean
  active_users: number
  ticker_users: number
  screens: number
  sessions: number
  session_state: Record<string, number> | null
  input_state: Record<string, number> | null
  display_state: Record<string, number> | null
  ticker_state: Record<string, number> | null
  /** Buckets "0", "1", "2+". */
  screens_per_user: Record<string, number> | null
  os: Record<string, number> | null
  app_version: Record<string, number> | null
  check_in_seconds: number
  expiry_seconds: number
  legacy_recent_presence: Measured
  definition: string
  ticker_definition: string
  coverage: string
}

// ── Desktop usage ─────────────────────────────────────────────────

export interface FilterOption {
  value: string
  count: number
}

export interface DesktopFilters {
  os: Array<FilterOption> | null
  version: Array<FilterOption> | null
  plan: Array<FilterOption> | null
  applied: { os?: string; version?: string; plan?: string }
  note?: string
}

export interface PeakConcurrency {
  users: number
  ticker_users: number
  screens: number
  at?: string
  resolution_seconds: number
  available: boolean
  note?: string
}

export interface ScreensBucket {
  screens: string
  sessions: number
  users: number
}

export interface PresenceRetention {
  definition: string
  d1: RetentionMetric
  d7: RetentionMetric
  d30: RetentionMetric
}

export interface WidgetRow {
  widget_type: string
  name: string
  category: string
  users: number
  /** 0..1 of measured ticker users. */
  share: number
  user_hours: number
  screen_hours: number
  /** Null for windows under 7 days — render as "—", never 0. */
  repeat_users: number | null
  added: number
  removed: number
  configured: number
  enabled: number
  comparison: Comparison
}

export interface CategoryRow {
  category: string
  users: number
  share: number
  user_hours: number
  screen_hours: number
  widgets: number
}

export interface WidgetsReport {
  measured_ticker_users: number
  rows: Array<WidgetRow> | null
  categories: Array<CategoryRow> | null
  repeat_note: string
  /** False under an OS/version filter: add/remove facts carry neither. */
  changes_available: boolean
  changes_note: string
  definition: string
}

export interface DesktopUsage {
  generated_at: string
  period: Window
  previous: Window | null
  staff_excluded: boolean
  coverage: Coverage
  filters: DesktopFilters
  unique_users: Metric
  user_hours: Metric
  ticker_user_hours: Metric
  screen_hours: Metric
  peak: PeakConcurrency
  screens_per_user: Array<ScreensBucket> | null
  users_curve: Array<Bucket> | null
  curve_step: string
  retention: PresenceRetention
  widgets: WidgetsReport
  /** The old 30-second daily series. Never merged with the presence series. */
  legacy: ProductAnalytics | null
  legacy_note: string
  definition: string
}

export interface DesktopFilterQuery {
  os?: string
  version?: string
  plan?: string
}

// ── Audience ──────────────────────────────────────────────────────

export interface Audience {
  generated_at: string
  period: Window
  previous: Window | null
  staff_excluded: boolean
  available: boolean
  note?: string
  source: string
  total: number
  excluded: number
  set_up: number
  new: Metric
  new_curve: Array<Bucket> | null
  curve_step: string
  signed_in_in_period: Metric
  lifetime_registrations: number
  known_purged: number
  coverage: Coverage
  definition: string
}

// ── Website ───────────────────────────────────────────────────────

export interface BreakdownRow {
  key: string
  pageviews: number
  visitors: number
}

export interface Website {
  generated_at: string
  period: Window
  previous: Window | null
  available: boolean
  note?: string
  coverage: Coverage
  staff_excluded: boolean
  visitors: Metric
  pageviews: Metric
  downloads: Metric
  signups: Metric
  curve: Array<Bucket> | null
  /** Visitors per bucket. Uniques do not add: never sum this series. */
  visitors_curve: Array<Bucket> | null
  curve_step: string
  top_paths: Array<BreakdownRow> | null
  top_referrers: Array<BreakdownRow> | null
  top_campaigns: Array<BreakdownRow> | null
  downloads_by_os: Array<BreakdownRow> | null
  /** Set when a breakdown query failed; that table is null, not empty. */
  breakdown_note?: string
  definition: string
  cached: boolean
}

// ── Revenue ───────────────────────────────────────────────────────

/** Amounts are MINOR units (cents) in the line's currency. */
export interface EarningsLine {
  count: number
  net: number
}

export interface LedgerLine {
  kind: string
  count: number
  amount: number
}

/** One currency's ledger. Currencies are never added together. */
export interface Earnings {
  currency: string
  payments: EarningsLine
  refunds: EarningsLine
  refund_reversals: EarningsLine
  disputes: EarningsLine
  fees: EarningsLine
  net: number
  gross_fees: number
  movements: Array<LedgerLine> | null
  unclassified: Array<LedgerLine> | null
}

export interface PlanMixRow {
  plan: string
  tier: string
  interval: string
  status: string
  lifetime: boolean
  paying: boolean
  count: number
}

export interface PayingNow {
  /** False when the customer snapshot could not be read: never render 0. */
  available: boolean
  paying: number
  lifetime: number
  trialing: number
  past_due: number
  canceling: number
  canceled: number
  free: number
  rows: Array<PlanMixRow> | null
  definition: string
}

export interface NewPayingReport {
  available: boolean
  note?: string
  in_period: Metric
  lifetime: number
  definition: string
}

export interface EarningsReport {
  available: boolean
  note?: string
  currencies: Array<Earnings> | null
  primary_currency: string
  /** Minor units of `primary_currency`. */
  net: Metric
  lifetime: Array<Earnings> | null
  curve: Array<Bucket> | null
  curve_step: string
  coverage: Coverage
  partial: boolean
  cached: boolean
  fetched_at?: string
  definition: string
}

export interface Revenue {
  generated_at: string
  period: Window
  previous: Window | null
  paying_now: PayingNow
  paying_now_note?: string
  new_paying: NewPayingReport
  earnings: EarningsReport
  account_note: string
}

// ── Support summary ───────────────────────────────────────────────

export interface BucketCount {
  total: number
  paying: number
}

export interface SupportSummary {
  generated_at: string
  period: Window
  previous: Window | null
  needs_attention: BucketCount
  waiting_on_customer: BucketCount
  completed: BucketCount
  completed_closed: number
  completed_dismissed: number
  total: BucketCount
  oldest_needs_attention_hours: Measured
  oldest_ticket?: string
  autosend: AutoSendState
  paying_note: string
  definitions: Record<string, string> | null
  created: Metric
  completed_in_period: Metric
  created_curve: Array<Bucket> | null
  completed_curve: Array<Bucket> | null
  /** Reconstructed from timestamps — an estimate, labelled as one. */
  backlog_curve: Array<Bucket> | null
  curve_step: string
  /** `comparison.note` carries the sample count, "n=<samples>". */
  first_response_median_hours: Metric
  completion_median_hours: Metric
  paying_created: number
  coverage: Coverage
  history_note: string
}

// ── Loaders ───────────────────────────────────────────────────────

type Token = () => Promise<string | null>

function report<T>(path: string, label: string) {
  return (getToken: Token, signal?: AbortSignal) =>
    loadBoundedAdminReport<T>(
      getToken,
      path,
      `Could not load ${label}`,
      `${label[0].toUpperCase()}${label.slice(1)} took too long. Please retry.`,
      signal,
    )
}

export const loadPresenceLive = report<PresenceLive>(
  '/admin/presence/live',
  'live presence',
)

export function loadDesktopUsage(
  getToken: Token,
  period: Period,
  filters: DesktopFilterQuery = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ period })
  for (const key of ['os', 'version', 'plan'] as const) {
    if (filters[key]) params.set(key, filters[key])
  }
  return report<DesktopUsage>(
    `/admin/desktop-usage?${params.toString()}`,
    'desktop usage',
  )(getToken, signal)
}

export const loadAudience = (
  getToken: Token,
  period: Period,
  signal?: AbortSignal,
) =>
  report<Audience>(`/admin/audience?period=${period}`, 'audience')(
    getToken,
    signal,
  )

export const loadWebsite = (
  getToken: Token,
  period: Period,
  signal?: AbortSignal,
) =>
  report<Website>(`/admin/website?period=${period}`, 'website analytics')(
    getToken,
    signal,
  )

export const loadRevenue = (
  getToken: Token,
  period: Period,
  signal?: AbortSignal,
) =>
  report<Revenue>(`/admin/revenue?period=${period}`, 'revenue')(
    getToken,
    signal,
  )

export const loadSupportSummary = (
  getToken: Token,
  period: Period,
  signal?: AbortSignal,
) =>
  report<SupportSummary>(
    `/admin/support/summary?period=${period}`,
    'support summary',
  )(getToken, signal)
