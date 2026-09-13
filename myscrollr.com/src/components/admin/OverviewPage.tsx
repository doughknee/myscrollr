import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown } from 'lucide-react'
import { ErrorPanel, RefreshButton, num, useReport } from './ui'
import type { ReactNode } from 'react'
import type { AdminOverview } from '@/api/admin'
import type {
  DesktopUsage,
  PresenceLive,
  Revenue,
  SupportSummary,
  Website,
} from '@/api/adminDashboard'
import type { Report } from './ui'
import type { Verdict, VerdictTone } from '@/lib/overviewVerdicts'
import { loadBoundedAdminReport } from '@/api/adminAnalytics'
import {
  loadDesktopUsage,
  loadPresenceLive,
  loadRevenue,
  loadSupportSummary,
  loadWebsite,
} from '@/api/adminDashboard'
import { useGetToken } from '@/hooks/useGetToken'
import {
  EXPECTED_REPLICAS,
  formatAgeWords,
  formatHours,
  formatMinor,
  plural,
} from '@/lib/adminFormat'
import { isStale, verdicts } from '@/lib/overviewVerdicts'

/**
 * The Overview, at a glance (SCROLLR-215).
 *
 * Five sentences a person who has never seen this console can read, each with
 * one big number and a verdict, each expanding into the plain-language facts
 * behind it. Everything technical — periods, charts, per-widget usage,
 * presence tables — lives in Analytics, Versions and Support; this page is
 * "now and the last 24 hours" and nothing else.
 *
 * Two promises from SCROLLR-210 carry over unchanged: a row never renders a
 * number it cannot back, and colour means state, never decoration.
 */

/** How often the live strip re-reads presence while the tab is visible. */
const PRESENCE_POLL_MS = 30_000

/** The Overview asks one question of time, so every fetch is pinned to it. */
const WINDOW = '24h' as const

type RowKey = 'right_now' | 'support' | 'money' | 'growth' | 'feeds'

/**
 * Verdict colours as whole class strings.
 *
 * Never built by interpolation: a Tailwind class assembled at runtime is not
 * in the source, so it compiles to nothing and the pill silently loses its
 * colour.
 */
const TONE: Record<
  VerdictTone,
  { dot: string; label: string; number: string }
> = {
  good: { dot: 'bg-primary', label: 'text-primary', number: '' },
  warn: { dot: 'bg-warning', label: 'text-warning', number: 'text-warning' },
  bad: { dot: 'bg-error', label: 'text-error', number: 'text-error' },
  none: { dot: 'bg-base-400', label: 'text-base-content/45', number: '' },
}

/** The four content feeds, in the order the sentence names them. */
const FEEDS: ReadonlyArray<{ table: string; name: string }> = [
  { table: 'games', name: 'Sports scores' },
  { table: 'trades', name: 'Stock prices' },
  { table: 'markets', name: 'Prediction markets' },
  { table: 'rss_items', name: 'News headlines' },
]

/**
 * Live presence, re-read every 30 s while the page is visible. A poll error
 * keeps the last good reading on screen; the row only loses it when it never
 * had one.
 */
function usePresenceLive(
  getToken: () => Promise<string | null>,
  refresh: number,
) {
  const [attempt, setAttempt] = useState(0)
  const [report, setReport] = useState<Report<PresenceLive>>({
    data: null,
    error: null,
    loading: true,
  })
  useEffect(() => {
    void refresh
    let active = true
    let inflight: AbortController | null = null
    const poll = () => {
      if (document.visibilityState !== 'visible') return
      inflight?.abort()
      const controller = new AbortController()
      inflight = controller
      loadPresenceLive(getToken, controller.signal).then(
        (data) => {
          if (active && !controller.signal.aborted) {
            setReport({ data, error: null, loading: false })
          }
        },
        (error: unknown) => {
          if (active && !controller.signal.aborted) {
            setReport((current) => ({
              ...current,
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not read live presence',
              loading: false,
            }))
          }
        },
      )
    }
    poll()
    const timer = window.setInterval(poll, PRESENCE_POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      active = false
      inflight?.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [getToken, attempt, refresh])
  return { ...report, retry: () => setAttempt((n) => n + 1) }
}

export default function OverviewPage() {
  const getToken = useGetToken()
  const [refresh, setRefresh] = useState(0)

  const presence = usePresenceLive(getToken, refresh)
  const desktop = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadDesktopUsage(getToken, WINDOW, {}, signal)
      },
      [getToken, refresh],
    ),
  )
  const website = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadWebsite(getToken, WINDOW, signal)
      },
      [getToken, refresh],
    ),
  )
  const revenue = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadRevenue(getToken, WINDOW, signal)
      },
      [getToken, refresh],
    ),
  )
  const support = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadSupportSummary(getToken, WINDOW, signal)
      },
      [getToken, refresh],
    ),
  )
  const service = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadBoundedAdminReport<AdminOverview>(
          getToken,
          '/admin/overview',
          'Could not load service readings',
          'Service readings took too long. Please retry.',
          signal,
        )
      },
      [getToken, refresh],
    ),
  )

  return (
    <OverviewContent
      presence={presence}
      desktop={desktop}
      website={website}
      revenue={revenue}
      support={support}
      service={service}
      onRefresh={() => setRefresh((n) => n + 1)}
    />
  )
}

export interface OverviewContentProps {
  presence: Report<PresenceLive>
  desktop: Report<DesktopUsage>
  website: Report<Website>
  revenue: Report<Revenue>
  support: Report<SupportSummary>
  service: Report<AdminOverview>
  /** Which row starts open. Tests and the preview harness set it; nothing else. */
  initialOpen?: RowKey
  onRefresh?: () => void
}

export function OverviewContent({
  presence,
  desktop,
  website,
  revenue,
  support,
  service,
  initialOpen,
  onRefresh,
}: OverviewContentProps) {
  const [open, setOpen] = useState<RowKey | null>(initialOpen ?? null)
  const rows = buildRows({ presence, desktop, website, revenue, support, service })
  const anyLoading = [
    presence,
    desktop,
    website,
    revenue,
    support,
    service,
  ].some((r) => r.loading)
  const headline = rows.headline

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <div className="flex items-start justify-between gap-6">
        <h1 className="text-[48px] leading-[1.05] font-extrabold tracking-[-0.035em]">
          {headline[0]}
          <br />
          {headline[1]}
        </h1>
        <RefreshButton onClick={onRefresh} loading={anyLoading} />
      </div>

      <ul className="mt-10 border-t border-base-300/70">
        {rows.rows.map((row) => (
          <OverviewRow
            key={row.key}
            row={row}
            open={open === row.key}
            onToggle={() =>
              setOpen((current) => (current === row.key ? null : row.key))
            }
          />
        ))}
      </ul>

      <p className="mt-6 text-sm text-base-content/45">
        Now and the last 24 hours. Staff and test accounts are left out.
        Anything over a longer period lives in Analytics.
      </p>
    </div>
  )
}

// ── One row ───────────────────────────────────────────────────────

interface Fact {
  label: string
  value: string
}

interface RowSpec {
  key: RowKey
  /** The big number, already formatted. Null when there is none to show. */
  number: string | null
  /** The Feeds row draws a state icon where the others draw a number. */
  icon?: VerdictTone
  main: string
  secondary?: string
  verdict: Verdict
  facts: Array<Fact>
  note: string
  action: ReactNode
  /** Set when the row's own source could not be read at all. */
  problem?: { message: string; retry?: () => void }
  loading?: boolean
}

function OverviewRow({
  row,
  open,
  onToggle,
}: {
  row: RowSpec
  open: boolean
  onToggle: () => void
}) {
  const tone = TONE[row.verdict.tone]
  const panelId = `overview-${row.key}`
  return (
    <li className="border-b border-base-300/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="grid w-full cursor-pointer grid-cols-[120px_1fr_132px_24px] items-center gap-7 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
        style={{ minHeight: '104px' }}
      >
        <span
          className={`flex justify-end text-[56px] leading-none font-extrabold tracking-[-0.04em] tabular-nums ${tone.number}`}
        >
          {row.icon ? (
            row.icon === 'good' ? (
              <Check size={44} className="text-primary" aria-hidden />
            ) : (
              <AlertTriangle
                size={44}
                className={row.icon === 'bad' ? 'text-error' : 'text-warning'}
                aria-hidden
              />
            )
          ) : (
            row.number
          )}
        </span>
        <span className="text-[22px] leading-snug font-semibold">
          {row.main}
          {row.secondary && (
            <span className="font-medium text-base-content/50">
              {' '}
              {row.secondary}
            </span>
          )}
        </span>
        <span className="flex items-center justify-end gap-2">
          <span
            className={`size-2.5 shrink-0 rounded-full ${tone.dot}`}
            aria-hidden
          />
          <span className={`text-[14px] font-bold ${tone.label}`}>
            {row.verdict.label}
          </span>
        </span>
        <ChevronDown
          size={20}
          aria-hidden
          className={
            open
              ? 'rotate-180 text-base-content transition-transform'
              : 'text-base-content/35 transition-transform'
          }
        />
      </button>
      {open && (
        <div id={panelId} style={{ padding: '4px 0 32px 148px' }}>
          {row.problem ? (
            <ErrorPanel
              message={row.problem.message}
              onRetry={row.problem.retry}
            />
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-x-10">
                {row.facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-baseline justify-between gap-4 border-b border-base-200 py-[9px] leading-[1.3]"
                  >
                    <dt className="text-base-content/60">{fact.label}</dt>
                    <dd className="pl-4 text-right font-mono font-medium">
                      {fact.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 max-w-[640px] text-sm text-base-content/55">
                {row.note}
              </p>
              <div className="mt-5">{row.action}</div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

const ACTION =
  'inline-flex min-h-10 items-center rounded-[10px] px-4 text-sm font-semibold ring-1 ring-base-300 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'

const ACTION_FILLED =
  'inline-flex min-h-10 items-center rounded-[10px] bg-error px-4 text-sm font-semibold text-white hover:bg-error/90 focus-visible:outline-2 focus-visible:outline-primary'

// ── Building the rows ─────────────────────────────────────────────

/** A fact whose value could not be read shows a dash, never a zero. */
function fact(label: string, value: string | null | undefined): Fact {
  return { label, value: value ?? '—' }
}

/** The busiest version key, which is the newest build that can report. */
function latestVersion(versions: Record<string, number> | null): string | null {
  const keys = Object.keys(versions ?? {})
  if (keys.length === 0) return null
  return keys.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )[keys.length - 1]
}

function count(values: Record<string, number> | null, ...keys: Array<string>) {
  if (!values) return null
  return keys.reduce((total, key) => total + (values[key] ?? 0), 0)
}

/** A duration without the "ago": "3 hours", for "has not updated for …". */
function duration(seconds: number): string {
  return formatAgeWords(seconds).replace(' ago', '')
}

function problemOf<T>(report: Report<T>) {
  if (report.data) return undefined
  return {
    message: report.error ?? 'Still reading…',
    retry: report.error ? report.retry : undefined,
  }
}

function buildRows({
  presence,
  desktop,
  website,
  revenue,
  support,
  service,
}: Omit<OverviewContentProps, 'initialOpen' | 'onRefresh'>) {
  const p = presence.data
  const svc = service.data
  const rev = revenue.data
  const sup = support.data

  const newToday = svc?.accounts.new_today
  const previousDay = newToday ? newToday.value - newToday.delta : 0
  const netToday = rev?.earnings.available ? rev.earnings.net.value : 0
  const everNet = rev?.earnings.lifetime?.[0]

  const v = verdicts({
    presence: p ? { available: p.available, active_users: p.active_users } : null,
    support: sup ? { open_cases: sup.needs_attention.total } : null,
    money: rev
      ? {
          available: rev.paying_now.available,
          past_due: rev.paying_now.past_due,
          new_paying_today: rev.new_paying.available
            ? rev.new_paying.in_period.value
            : 0,
          net_today: netToday,
        }
      : null,
    growth: newToday
      ? {
          available: newToday.available,
          value: newToday.value,
          previous: previousDay,
          // A previous day of zero is not something to be above (SCROLLR-210).
          comparable: newToday.available && previousDay > 0,
        }
      : null,
    feeds: svc?.ingest ?? null,
  })

  return {
    headline: v.headline,
    rows: [
      rightNowRow(presence, svc, v.right_now),
      supportRow(support, v.support),
      moneyRow(revenue, v.money, netToday, everNet),
      growthRow(service, desktop, website, v.growth, previousDay),
      feedsRow(service, p, v.feeds),
    ],
  }
}

function rightNowRow(
  presence: Report<PresenceLive>,
  svc: AdminOverview | null,
  verdict: Verdict,
): RowSpec {
  const p = presence.data
  const connected = svc?.connected_now.count ?? 0
  const version = latestVersion(p?.app_version ?? null)
  const legacy = p?.legacy_recent_presence
  const extra = p ? Math.max(0, connected - p.active_users) : 0

  const reporting = p?.available === true
  const ticker =
    reporting && p.ticker_users > 0
      ? p.ticker_users === p.active_users
        ? 'with the ticker on screen.'
        : `${num(p.ticker_users)} with the ticker on screen.`
      : undefined
  return {
    key: 'right_now',
    number: reporting ? num(p.active_users) : null,
    main: reporting
      ? `${p.active_users === 1 ? 'person has' : 'people have'} Scrollr open right now${ticker ? ',' : '.'}`
      : 'Nobody is reporting yet.',
    secondary: reporting ? ticker : (p?.note ?? undefined),
    verdict,
    facts: [
      fact('People with the app open', p ? num(p.active_users) : null),
      fact('Ticker visible on their screen', p ? num(p.ticker_users) : null),
      fact('Monitors showing a ticker', p ? num(p.screens) : null),
      fact(
        'Actively using their computer',
        numberOrNull(count(p?.input_state ?? null, 'recent')),
      ),
      fact(
        'Computer locked or screen asleep',
        numberOrNull(
          add(
            count(p?.session_state ?? null, 'locked'),
            count(p?.display_state ?? null, 'asleep'),
          ),
        ),
      ),
      fact(
        'Ticker hidden or turned off',
        numberOrNull(count(p?.ticker_state ?? null, 'hidden', 'disabled')),
      ),
      fact('On Windows', numberOrNull(count(p?.os ?? null, 'windows'))),
      fact(
        'On Mac or Linux',
        numberOrNull(count(p?.os ?? null, 'macos', 'linux')),
      ),
      fact(
        version
          ? `Running the latest version (${version})`
          : 'Running the latest version',
        version ? num(p?.app_version?.[version] ?? 0) : null,
      ),
    ],
    note: [
      version
        ? `Only version ${version} and later can report this.`
        : 'Only recent versions can report this.',
      extra > 0
        ? `${plural(connected, 'app')} are connected to our servers in total; the other ${num(extra)} are older versions, staff, or admin tabs, which is why that number is bigger than the number of people.`
        : `${plural(connected, 'app')} are connected to our servers in total.`,
      legacy?.available
        ? `${plural(legacy.value, 'older-version account')} was seen in the last 15 minutes.`.replace(
            'accounts was',
            'accounts were',
          )
        : null,
    ]
      .filter(Boolean)
      .join(' '),
    action: (
      <Link to="/admin/analytics" className={ACTION}>
        See who is here over time
      </Link>
    ),
    problem: problemOf(presence),
    loading: presence.loading,
  }
}

function supportRow(
  support: Report<SupportSummary>,
  verdict: Verdict,
): RowSpec {
  const s = support.data
  const waiting = s?.needs_attention.total ?? 0
  const oldest = s?.oldest_needs_attention_hours
  const hold = s?.autosend.hold_minutes ?? 0
  const since =
    s && waiting > 0 && oldest?.available ? oldestClause(oldest.value) : undefined

  return {
    key: 'support',
    number: s ? num(waiting) : null,
    main: s
      ? `${waiting === 1 ? 'person is' : 'people are'} waiting for a reply from us${since ? ',' : '.'}`
      : 'Support is not reporting yet.',
    secondary: since,
    verdict,
    facts: [
      fact('Waiting for us to reply', s ? num(s.needs_attention.total) : null),
      fact(
        'Waiting for the customer to reply',
        s ? num(s.waiting_on_customer.total) : null,
      ),
      fact('Finished', s ? num(s.completed.total) : null),
      fact('Finished and answered', s ? num(s.completed_closed) : null),
      fact(
        'Finished without a reply (spam, duplicates)',
        s ? num(s.completed_dismissed) : null,
      ),
      fact('All tickets ever', s ? num(s.total.total) : null),
      fact(
        'Longest wait',
        oldest?.available ? plural(Math.floor(oldest.value / 24), 'day') : null,
      ),
      fact('Ticket waiting the longest', s?.oldest_ticket ? `#${s.oldest_ticket}` : null),
      fact(
        'Auto-replies',
        s
          ? s.autosend.armed
            ? `on, sent after a ${hold} min hold`
            : 'off'
          : null,
      ),
    ],
    note: `A drafted reply goes out by itself after ${hold} minutes unless you stop it, so doing nothing still sends it. Tickets cannot be matched to paying customers yet, because only ${num(s?.cases_with_account ?? 0)} of the ${num(s?.cases ?? 0)} were sent from inside the app while signed in.`,
    action: (
      <Link to="/admin/support" className={ACTION_FILLED}>
        Open the queue
      </Link>
    ),
    problem: problemOf(support),
    loading: support.loading,
  }
}

function moneyRow(
  revenue: Report<Revenue>,
  verdict: Verdict,
  netToday: number,
  everNet: { currency: string; net: number } | undefined,
): RowSpec {
  const r = revenue.data
  const snapshot = r?.paying_now
  const earnings = r?.earnings
  const money = (minor: number, currency?: string) =>
    formatMinor(minor, currency ?? earnings?.primary_currency ?? 'usd')
  const ever = everNet ? money(everNet.net, everNet.currency) : null
  const fetched = earnings?.fetched_at ?? r?.generated_at

  return {
    key: 'money',
    number: snapshot?.available ? num(snapshot.paying) : null,
    main: snapshot?.available
      ? snapshot.paying === 1
        ? 'customer pays.'
        : 'customers pay.'
      : 'The customer snapshot could not be read.',
    secondary: snapshot?.available
      ? [
          netToday > 0 ? `${money(netToday)} came in today.` : 'Nothing came in today.',
          ever ? `${ever} earned ever.` : null,
        ]
          .filter(Boolean)
          .join(' ')
      : r?.paying_now_note,
    verdict,
    facts: [
      fact('Paying customers', snapshot?.available ? num(snapshot.paying) : null),
      fact(
        'Of those on the one-time lifetime plan',
        snapshot?.available ? num(snapshot.lifetime) : null,
      ),
      fact(
        'Accounts on the free plan',
        snapshot?.available ? num(snapshot.free) : null,
      ),
      fact('On a free trial', snapshot?.available ? num(snapshot.trialing) : null),
      fact('Payment failed', snapshot?.available ? num(snapshot.past_due) : null),
      fact('Cancelling', snapshot?.available ? num(snapshot.canceling) : null),
      fact(
        'Became a customer today',
        r?.new_paying.available ? num(r.new_paying.in_period.value) : null,
      ),
      fact(
        'Earned today after Stripe fees',
        earnings?.available ? money(earnings.net.value) : null,
      ),
      fact('Earned ever after Stripe fees', ever),
    ],
    note: `Figures come from Stripe and were last fetched at ${fetched ? new Date(fetched).toLocaleString() : 'an unknown time'}. “Ever” means since the Stripe account was opened.`,
    action: (
      <Link to="/admin/analytics" search={{ view: 'revenue' }} className={ACTION}>
        See revenue over time
      </Link>
    ),
    problem: problemOf(revenue),
    loading: revenue.loading,
  }
}

function growthRow(
  service: Report<AdminOverview>,
  desktop: Report<DesktopUsage>,
  website: Report<Website>,
  verdict: Verdict,
  previousDay: number,
): RowSpec {
  const svc = service.data
  const accounts = svc?.accounts
  const newToday = accounts?.new_today
  const dau = svc?.active.dau
  const hours = desktop.data?.user_hours
  const visitors = website.data?.visitors
  const neverSetUp = accounts ? Math.max(0, accounts.total - accounts.set_up) : 0

  return {
    key: 'growth',
    number: newToday?.available ? num(newToday.value) : null,
    main: newToday?.available
      ? `${newToday.value === 1 ? 'person' : 'people'} signed up in the last 24 hours,`
      : 'Sign-ups are not reporting yet.',
    // DAU is everyone who opened the app today, not a subset of today's
    // sign-ups, so the clause says so rather than calling them "of them".
    secondary: newToday?.available
      ? dau?.available
        ? `${plural(dau.value, 'person', 'people')} opened the app.`
        : undefined
      : newToday?.note,
    verdict,
    facts: [
      fact(
        'Signed up in the last 24 hours',
        newToday?.available ? num(newToday.value) : null,
      ),
      fact(
        'Signed up in the 24 hours before that',
        newToday?.available ? num(previousDay) : null,
      ),
      fact('Accounts in total', accounts ? num(accounts.total) : null),
      fact('Finished setting up the app', accounts ? num(accounts.set_up) : null),
      fact(
        'Signed up but never set up the app',
        accounts ? num(neverSetUp) : null,
      ),
      fact(
        'Opened the app in the last 24 hours',
        dau?.available ? num(dau.value) : null,
      ),
      fact(
        'Hours the app was open, all users added up',
        hours?.available ? formatHours(hours.value) : null,
      ),
      fact(
        'Website visitors in the last 24 hours',
        visitors?.available ? num(visitors.value) : null,
      ),
      fact(
        'Downloads ever (not installs)',
        svc && !svc.downloads.error ? num(svc.downloads.total) : null,
      ),
    ],
    note: `The ${num(neverSetUp)} who never finished setting up are the biggest thing to fix. Most signed up from inside the desktop app, opened it once, and never came back.`,
    action: (
      <Link to="/admin/analytics" className={ACTION}>
        See signups over time
      </Link>
    ),
    problem: problemOf(service),
    loading: service.loading,
  }
}

function feedsRow(
  service: Report<AdminOverview>,
  presence: PresenceLive | null,
  verdict: Verdict,
): RowSpec {
  const svc = service.data
  const ingest = svc?.ingest ?? []
  const reading = (table: string) => ingest.find((row) => row.table === table)
  const broken = FEEDS.find((f) => reading(f.table)?.has_data === false)
  const stale = FEEDS.find((f) => {
    const row = reading(f.table)
    return row ? isStale(row) : false
  })
  const version = latestVersion(presence?.app_version ?? null)

  return {
    key: 'feeds',
    number: null,
    icon: verdict.tone,
    main: broken
      ? `${broken.name} are not reporting any data.`
      : stale
        ? `${stale.name} have not updated for ${duration(reading(stale.table)?.age_seconds ?? 0)}.`
        : 'Scores, prices, markets and news are up to date,',
    secondary: broken || stale ? undefined : 'all within the last few minutes.',
    verdict,
    facts: [
      ...FEEDS.map((feed) => {
        const row = reading(feed.table)
        return fact(
          `${feed.name} last updated`,
          row ? (row.has_data ? formatAgeWords(row.age_seconds) : 'no data yet') : null,
        )
      }),
      fact(
        'Our servers running',
        svc ? `${svc.connected_now.replicas} of ${EXPECTED_REPLICAS}` : null,
      ),
      fact('Latest app version', version),
    ],
    note: 'How long since each feed last received new data. Sports scores can sit for hours overnight when no games are being played, and that is normal.',
    action: (
      <Link to="/admin/versions" className={ACTION}>
        Technical details
      </Link>
    ),
    problem: problemOf(service),
    loading: service.loading,
  }
}

function oldestClause(hours: number): string {
  if (hours < 48) return `the longest for ${plural(hours, 'hour')}.`
  const since = new Date(Date.now() - hours * 3600_000)
  return `one of them since ${since.toLocaleString(undefined, { month: 'long' })}.`
}

function add(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

function numberOrNull(value: number | null): string | null {
  return value === null ? null : num(value)
}
