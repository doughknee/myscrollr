import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Big,
  Breakdown,
  Card,
  CoverageNote,
  DefinitionDisclosure,
  DeltaBadge,
  LINK,
  Loaded,
  MetricValue,
  PeriodSelector,
  RefreshButton,
  Row,
  Section,
  Sparkline,
  StaffExcludedBadge,
  Stat,
  Unmeasurable,
  num,
  useReport,
} from './ui'
import type { AdminOverview } from '@/api/admin'
import type {
  Audience,
  DesktopUsage,
  Period,
  PresenceLive,
  Revenue,
  SupportSummary,
  Website,
} from '@/api/adminDashboard'
import type { Report } from './ui'
import { loadBoundedAdminReport } from '@/api/adminAnalytics'
import {
  loadAudience,
  loadDesktopUsage,
  loadPresenceLive,
  loadRevenue,
  loadSupportSummary,
  loadWebsite,
} from '@/api/adminDashboard'
import { useGetToken } from '@/hooks/useGetToken'
import {
  DOWNLOADS_CAVEAT,
  connectedCaveat,
  formatAge,
  formatHours,
  formatMinor,
  ingestHealth,
  measuredValue,
  periodLabel,
} from '@/lib/adminFormat'

/**
 * "Everything about Scrollr in one spot." (SCROLLR-210)
 *
 * Four questions, in order: who is using the desktop app right now; how the
 * audience and the website moved in the window; who pays and what came in;
 * what support owes people. Each answer loads on its own, so one slow source
 * never blanks the page, and each is either a number we hold or an explicit
 * admission that we do not.
 *
 * "Current" cards ignore the period selector and say so; period cards carry
 * the window in their label.
 */

/** How often the live strip re-reads presence while the tab is visible. */
const PRESENCE_POLL_MS = 30_000

const SESSION_ORDER = ['unlocked', 'locked', 'unknown'] as const
const INPUT_ORDER = ['recent', 'idle', 'unknown'] as const
const DISPLAY_ORDER = ['awake', 'asleep', 'unknown'] as const
const TICKER_ORDER = ['shown', 'hidden', 'disabled'] as const
const SCREENS_ORDER = ['0', '1', '2+'] as const

/** Hours as "3d 4h" past a day, so a week-old ticket does not read as 170. */
function waitingFor(hours: number): string {
  const whole = Math.max(0, Math.round(hours))
  return whole >= 24 ? `${Math.floor(whole / 24)}d ${whole % 24}h` : `${whole}h`
}

/**
 * Live presence, re-read every 30 s while the page is visible. A poll error
 * keeps the last good reading on screen with the error beside it; the strip
 * only goes blank when it never had one.
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
  const { period } = useSearch({ from: '/admin/' })
  const navigate = useNavigate({ from: '/admin/' })
  const [refresh, setRefresh] = useState(0)

  const presence = usePresenceLive(getToken, refresh)
  const audience = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadAudience(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  const desktop = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadDesktopUsage(getToken, period, {}, signal)
      },
      [getToken, period, refresh],
    ),
  )
  const website = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadWebsite(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  const revenue = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadRevenue(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  const support = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadSupportSummary(getToken, period, signal)
      },
      [getToken, period, refresh],
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
      period={period}
      presence={presence}
      audience={audience}
      desktop={desktop}
      website={website}
      revenue={revenue}
      support={support}
      service={service}
      onPeriodChange={(next) =>
        navigate({ search: { period: next }, replace: true })
      }
      onRefresh={() => setRefresh((n) => n + 1)}
    />
  )
}

export interface OverviewContentProps {
  period: Period
  presence: Report<PresenceLive>
  audience: Report<Audience>
  desktop: Report<DesktopUsage>
  website: Report<Website>
  revenue: Report<Revenue>
  support: Report<SupportSummary>
  service: Report<AdminOverview>
  onPeriodChange?: (period: Period) => void
  onRefresh?: () => void
}

export function OverviewContent({
  period,
  presence,
  audience,
  desktop,
  website,
  revenue,
  support,
  service,
  onPeriodChange = () => {},
  onRefresh,
}: OverviewContentProps) {
  const windowLabel = periodLabel(period)
  const staffExcluded = [presence, audience, desktop, website].some(
    (r) => r.data?.staff_excluded,
  )
  const anyLoading = [
    presence,
    audience,
    desktop,
    website,
    revenue,
    support,
    service,
  ].some((r) => r.loading)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Who is here now, how the window moved, who pays, and what support
            owes.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-base-content/65">
            <span>
              Period cards read <strong>{windowLabel}</strong>. Cards marked
              “Current” ignore the selector.
            </span>
            {staffExcluded && <StaffExcludedBadge />}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <PeriodSelector value={period} onChange={onPeriodChange} />
          <RefreshButton onClick={onRefresh} loading={anyLoading} />
        </div>
      </header>

      <LiveStrip presence={presence} />

      <Section
        id="audience"
        title="Users & website"
        action={
          <Link
            to="/admin/analytics"
            search={{ period, view: 'growth' }}
            className={LINK}
          >
            Growth analytics →
          </Link>
        }
      >
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Loaded report={audience} label="registered accounts">
            {(a) => (
              <Card
                title="Registered accounts"
                label="Current"
                note={a.source === 'local' ? a.note : undefined}
              >
                {a.available ? (
                  <>
                    <Big>{num(a.total)}</Big>
                    <p className="mt-1 text-sm text-base-content/60">
                      {a.source === 'local'
                        ? 'accounts with local data — Logto unreachable'
                        : 'accounts in Logto'}
                      {a.staff_excluded && a.excluded > 0
                        ? ` · ${num(a.excluded)} staff/test excluded`
                        : ''}
                    </p>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row label="Set up the app" value={num(a.set_up)} />
                      <Row
                        label="Never set up"
                        value={
                          <span className="text-warning">
                            {num(Math.max(0, a.total - a.set_up))}
                          </span>
                        }
                      />
                    </div>
                  </>
                ) : (
                  <Unmeasurable note={a.note} />
                )}
              </Card>
            )}
          </Loaded>
          <Loaded report={audience} label="new accounts">
            {(a) => (
              <Card title="New accounts" label={windowLabel}>
                <MetricValue metric={a.new}>
                  <p className="mt-1 text-sm text-base-content/60">
                    <DeltaBadge comparison={a.new.comparison} />
                  </p>
                </MetricValue>
                <div className="mt-3">
                  <Sparkline
                    buckets={a.new_curve}
                    step={a.curve_step}
                    label="New accounts per bucket"
                  />
                </div>
                <CoverageNote coverage={a.coverage} />
              </Card>
            )}
          </Loaded>
          <Loaded report={desktop} label="desktop usage">
            {(d) => (
              <Card
                title="App users"
                label={windowLabel}
                action={
                  <Link
                    to="/admin/analytics"
                    search={{ period, view: 'desktop' }}
                    className={LINK}
                  >
                    Desktop →
                  </Link>
                }
              >
                <MetricValue metric={d.unique_users}>
                  <p className="mt-1 text-sm text-base-content/60">
                    unique app-running users{' '}
                    <DeltaBadge comparison={d.unique_users.comparison} />
                  </p>
                </MetricValue>
                <div className="mt-3 border-t border-base-300/60 pt-2">
                  <Row
                    label="App-running user-hours"
                    value={
                      <MetricValue
                        metric={d.user_hours}
                        format={formatHours}
                        size="inline"
                      />
                    }
                  />
                  <Row
                    label="Ticker-shown user-hours"
                    value={
                      <MetricValue
                        metric={d.ticker_user_hours}
                        format={formatHours}
                        size="inline"
                      />
                    }
                  />
                </div>
                <CoverageNote coverage={d.coverage} />
              </Card>
            )}
          </Loaded>
          <Loaded report={website} label="website analytics">
            {(w) => (
              <Card title="Website" label={windowLabel}>
                {w.available ? (
                  <>
                    <MetricValue metric={w.visitors}>
                      <p className="mt-1 text-sm text-base-content/60">
                        unique visitors{' '}
                        <DeltaBadge comparison={w.visitors.comparison} />
                      </p>
                    </MetricValue>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row
                        label="Pageviews"
                        value={
                          <span className="inline-flex items-baseline gap-2">
                            <MetricValue metric={w.pageviews} size="inline" />
                            <DeltaBadge comparison={w.pageviews.comparison} />
                          </span>
                        }
                      />
                    </div>
                    <CoverageNote coverage={w.coverage} />
                  </>
                ) : (
                  <Unmeasurable note={w.note} />
                )}
              </Card>
            )}
          </Loaded>
        </div>
      </Section>

      <Section
        id="revenue"
        title="Paying customers & earnings"
        action={
          <Link
            to="/admin/analytics"
            search={{ period, view: 'revenue' }}
            className={LINK}
          >
            Revenue analytics →
          </Link>
        }
      >
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Loaded report={revenue} label="paying customers">
            {(r) => (
              <Card
                title="Paying customers"
                label="Current"
                note={r.paying_now.available ? r.paying_now_note : undefined}
              >
                {r.paying_now.available ? (
                  <>
                    <Big>{num(r.paying_now.paying)}</Big>
                    <p className="mt-1 text-sm text-base-content/60">
                      paying · {num(r.paying_now.free)} free
                    </p>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row
                        label="Lifetime"
                        value={num(r.paying_now.lifetime)}
                      />
                      <Row
                        label="Trialing"
                        value={num(r.paying_now.trialing)}
                      />
                      <Row
                        label="Past due"
                        value={num(r.paying_now.past_due)}
                      />
                      <Row
                        label="Canceling"
                        value={num(r.paying_now.canceling)}
                      />
                    </div>
                  </>
                ) : (
                  <Unmeasurable
                    note={
                      r.paying_now_note ??
                      'The customer snapshot could not be read.'
                    }
                  />
                )}
                <DefinitionDisclosure>
                  <p>{r.paying_now.definition}</p>
                </DefinitionDisclosure>
              </Card>
            )}
          </Loaded>
          <Loaded report={revenue} label="new paying customers">
            {(r) => (
              <Card title="New paying customers" label={windowLabel}>
                {r.new_paying.available ? (
                  <>
                    <MetricValue metric={r.new_paying.in_period}>
                      <p className="mt-1 text-sm text-base-content/60">
                        <DeltaBadge
                          comparison={r.new_paying.in_period.comparison}
                        />
                      </p>
                    </MetricValue>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row
                        label="Lifetime"
                        value={num(r.new_paying.lifetime)}
                      />
                    </div>
                  </>
                ) : (
                  <Unmeasurable note={r.new_paying.note} />
                )}
                <DefinitionDisclosure>
                  <p>{r.new_paying.definition}</p>
                </DefinitionDisclosure>
              </Card>
            )}
          </Loaded>
          <Loaded report={revenue} label="earnings">
            {(r) => <EarningsCard revenue={r} windowLabel={windowLabel} />}
          </Loaded>
        </div>
      </Section>

      <Section
        id="support"
        title="Support workload"
        action={
          <span className="flex flex-wrap gap-4">
            <Link to="/admin/support" className={LINK}>
              Open support →
            </Link>
            <Link
              to="/admin/analytics"
              search={{ period, view: 'support' }}
              className={LINK}
            >
              Support analytics →
            </Link>
          </span>
        }
      >
        <Loaded report={support} label="support summary">
          {(s) => (
            <Card title="Queue" label="Current" note={s.paying_note}>
              <div className="grid gap-4 sm:grid-cols-4">
                <Stat
                  label="Needs attention"
                  value={num(s.needs_attention.total)}
                  sub={payingOverlay(s.needs_attention.paying)}
                />
                <Stat
                  label="Waiting on customer"
                  value={num(s.waiting_on_customer.total)}
                  sub={payingOverlay(s.waiting_on_customer.paying)}
                />
                <Stat
                  label="Completed"
                  value={num(s.completed.total)}
                  sub={
                    <>
                      {payingOverlay(s.completed.paying)}
                      {num(s.completed_closed)} closed ·{' '}
                      {num(s.completed_dismissed)} dismissed
                    </>
                  }
                />
                <Stat
                  label="Total"
                  value={num(s.total.total)}
                  sub={payingOverlay(s.total.paying)}
                />
              </div>
              <div className="mt-4 border-t border-base-300/60 pt-2">
                <Row
                  label="Oldest waiting for us"
                  value={
                    <MetricValue
                      metric={s.oldest_needs_attention_hours}
                      format={waitingFor}
                      size="inline"
                    />
                  }
                />
                {s.oldest_ticket && (
                  <p className="text-xs text-base-content/65">
                    Ticket #{s.oldest_ticket}
                  </p>
                )}
                <Row
                  label="Auto-send"
                  value={
                    s.autosend.armed
                      ? `armed · ${s.autosend.hold_minutes} min hold`
                      : s.autosend.paused
                        ? 'paused'
                        : 'off'
                  }
                />
                <p className="text-xs text-base-content/65">
                  {s.autosend.note}
                </p>
              </div>
            </Card>
          )}
        </Loaded>
      </Section>

      <Section
        id="service"
        title="Service & releases"
        lede="Operational readings. Downloads are not installs; connections are not people."
      >
        <Loaded report={service} label="service readings">
          {(o) => <ServiceStrip overview={o} />}
        </Loaded>
      </Section>

      <HowToRead />
    </div>
  )
}

function payingOverlay(paying: number) {
  return paying > 0 ? (
    <span className="mr-1 font-semibold text-base-content">
      {num(paying)} paying ·{' '}
    </span>
  ) : null
}

function LiveStrip({ presence }: { presence: Report<PresenceLive> }) {
  const p = presence.data
  return (
    <section
      aria-labelledby="live-heading"
      className="rounded-xl bg-base-200/40 p-4 ring-1 ring-base-300/70 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="live-heading" className="text-base font-semibold">
          Desktop right now
          <span className="ml-2 rounded bg-base-300/50 px-1.5 py-0.5 text-[10px] font-medium text-base-content/60">
            Current
          </span>
        </h2>
        {p && (
          <p className="text-xs text-base-content/50">
            as of {new Date(p.generated_at).toLocaleTimeString()} · refreshed
            every {PRESENCE_POLL_MS / 1000} s
          </p>
        )}
      </div>
      {!p && presence.error && (
        <div role="alert" className="mt-3 text-sm text-error">
          {presence.error}{' '}
          {presence.retry && (
            <button
              type="button"
              onClick={presence.retry}
              className="cursor-pointer font-semibold underline underline-offset-4"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!p && !presence.error && (
        <p role="status" className="mt-3 text-sm text-base-content/60">
          Reading live presence…
        </p>
      )}
      {p && (
        <>
          {p.available ? (
            <p className="mt-3 text-2xl font-bold tabular-nums sm:text-3xl">
              {p.headline}
            </p>
          ) : (
            <div className="mt-3">
              <Unmeasurable note={p.note} />
            </div>
          )}
          {presence.error && (
            <p role="alert" className="mt-2 text-xs text-error">
              Last refresh failed: {presence.error}. Showing the previous
              reading.
            </p>
          )}
          {p.available && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Breakdown
                title="Sessions"
                values={{ total: p.sessions }}
                order={['total']}
              />
              <Breakdown
                title="Session"
                values={p.session_state}
                order={SESSION_ORDER}
              />
              <Breakdown
                title="Input"
                values={p.input_state}
                order={INPUT_ORDER}
              />
              <Breakdown
                title="Display"
                values={p.display_state}
                order={DISPLAY_ORDER}
              />
              <Breakdown
                title="Ticker"
                values={p.ticker_state}
                order={TICKER_ORDER}
              />
              <Breakdown
                title="Screens per user"
                values={p.screens_per_user}
                order={SCREENS_ORDER}
              />
              {p.os && Object.keys(p.os).length > 0 && (
                <Breakdown title="OS" values={p.os} />
              )}
              {p.app_version && Object.keys(p.app_version).length > 0 && (
                <Breakdown title="Version" values={p.app_version} />
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-base-content/70">
            <span>Recently seen (legacy, 15 min):</span>
            <MetricValue metric={p.legacy_recent_presence} size="inline" />
            {p.legacy_recent_presence.available &&
              p.legacy_recent_presence.note && (
                <span className="text-xs text-base-content/55">
                  {p.legacy_recent_presence.note}
                </span>
              )}
            {p.staff_excluded && <StaffExcludedBadge />}
          </div>
          <DefinitionDisclosure summary="What active, ticker and screens mean">
            <p>{p.definition}</p>
            <p>{p.ticker_definition}</p>
            <p>{p.coverage}</p>
            <p>
              Sessions check in every {p.check_in_seconds} s and expire after{' '}
              {p.expiry_seconds} s without one.
            </p>
          </DefinitionDisclosure>
        </>
      )}
    </section>
  )
}

function EarningsCard({
  revenue,
  windowLabel,
}: {
  revenue: Revenue
  windowLabel: string
}) {
  const e = revenue.earnings
  const money = (minor: number) => formatMinor(minor, e.primary_currency)
  const currencies = e.currencies ?? []
  const lifetime = e.lifetime ?? []
  return (
    <Card
      title="Net earnings"
      label={windowLabel}
      note={
        e.available
          ? [
              e.partial ? 'Stripe returned a partial ledger.' : null,
              e.cached && e.fetched_at
                ? `Cached from Stripe at ${new Date(e.fetched_at).toLocaleString()}.`
                : null,
              revenue.account_note,
            ]
              .filter(Boolean)
              .join(' ')
          : revenue.account_note
      }
    >
      {e.available ? (
        <>
          <MetricValue metric={e.net} format={money}>
            <p className="mt-1 text-sm text-base-content/60">
              net of fees, {e.primary_currency.toUpperCase()}{' '}
              <DeltaBadge comparison={e.net.comparison} format={money} />
            </p>
          </MetricValue>
          {currencies.length > 1 && (
            <div className="mt-3 border-t border-base-300/60 pt-2">
              <p className="text-xs text-base-content/60">
                Per currency — never added together
              </p>
              {currencies.map((c) => (
                <Row
                  key={c.currency}
                  label={c.currency.toUpperCase()}
                  value={formatMinor(c.net, c.currency)}
                />
              ))}
            </div>
          )}
          <div className="mt-3 border-t border-base-300/60 pt-2">
            {lifetime.length === 0 ? (
              <Row label="Lifetime net" value="—" />
            ) : (
              lifetime.map((c) => (
                <Row
                  key={c.currency}
                  label={`Lifetime net (${c.currency.toUpperCase()})`}
                  value={formatMinor(c.net, c.currency)}
                />
              ))
            )}
          </div>
          <CoverageNote coverage={e.coverage} />
        </>
      ) : (
        <Unmeasurable note={e.note} />
      )}
      <DefinitionDisclosure>
        <p>{e.definition}</p>
      </DefinitionDisclosure>
    </Card>
  )
}

function ServiceStrip({ overview }: { overview: AdminOverview }) {
  const ingest = overview.ingest ?? []
  const releases = (overview.downloads.releases ?? []).slice(0, 3)
  const installs = measuredValue(overview.installs)
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Card
        title="Ingest freshness"
        note="Time since each content table was last written. Sports can legitimately sit still overnight."
      >
        {ingest.length === 0 && (
          <p className="text-sm text-base-content/70">
            No ingest readings in this snapshot.
          </p>
        )}
        {ingest.map((row) => {
          const health = ingestHealth(row)
          return (
            <Row
              key={row.table}
              label={
                <span className="inline-flex items-center gap-1">
                  {health !== 'fresh' && (
                    <AlertTriangle size={12} aria-hidden />
                  )}
                  {row.table}
                </span>
              }
              value={
                <span
                  className={
                    health === 'empty'
                      ? 'text-error'
                      : health === 'stale'
                        ? 'text-warning'
                        : 'text-success'
                  }
                >
                  {health === 'empty' ? 'empty' : formatAge(row.age_seconds)}
                </span>
              }
            />
          )
        })}
      </Card>
      <Card
        title="Connected now"
        label="Current"
        note={connectedCaveat(overview.connected_now)}
      >
        <p className="text-2xl font-bold tabular-nums">
          {num(overview.connected_now.count)}
        </p>
        <p className="mt-1 text-sm text-base-content/60">
          open SSE connections
        </p>
      </Card>
      <Card
        title="Downloads"
        note={
          overview.downloads.stale
            ? `${DOWNLOADS_CAVEAT} These figures are cached — GitHub was unreachable on the last refresh.`
            : DOWNLOADS_CAVEAT
        }
      >
        {overview.downloads.error ? (
          <Unmeasurable note={overview.downloads.error} />
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums">
              {num(overview.downloads.total)}
            </p>
            <p className="mt-1 mb-2 text-sm text-base-content/60">
              across all releases
            </p>
            {releases.map((r) => (
              <Row key={r.tag} label={r.tag} value={num(r.downloads)} />
            ))}
          </>
        )}
        <DefinitionDisclosure summary="Why downloads are not active installs">
          <p>{installs.note ?? 'Active installs are not measurable.'}</p>
        </DefinitionDisclosure>
      </Card>
    </div>
  )
}

function HowToRead() {
  return (
    <details className="rounded-xl border border-base-300/60 p-4 text-sm text-base-content/75">
      <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-primary">
        How to read these numbers
      </summary>
      <div className="mt-3 space-y-2 leading-relaxed">
        <p>
          <strong>Time.</strong> One selector — 24h, 7d, 30d, Lifetime — shared
          by every period card. A period is a rolling window ending at the
          moment the report was generated; 24h is the last 24 hours, not today
          since midnight. Finite periods are compared with the equal window
          immediately before them. A comparison is shown only when the previous
          window is fully inside the source's coverage and its value is not
          zero; otherwise the card says why. Cards marked “Current” do not
          depend on the selector.
        </p>
        <p>
          <strong>Missing data</strong> is shown as a note, never as zero.
          Partial history says so and names when measurement began.
        </p>
        <p>
          <strong>Staff exclusion.</strong> With the Settings toggle on
          (default), admin and test accounts are removed from account totals,
          growth, desktop presence and usage, widget analytics, and identified
          website analytics. It never changes payments, earnings, or operational
          support totals. Measurements suppressed before the toggle existed
          cannot be restored.
        </p>
        <p>
          <strong>Desktop right now</strong> is presence, not attention: the app
          is running and reported within 90 seconds. “With ticker(s)” means at
          least one ticker window is shown on an unlocked, awake computer.
          Screens add across computers; users do not. Only builds with the
          presence reporter (1.6.7+) appear; older builds still count in the
          legacy 15-minute figure.
        </p>
        <p>
          <strong>Registered accounts</strong> come from Logto, the system of
          record. “Set up the app” is a local count of who ever saved a
          preference. New accounts are Logto sign-ups in the window. App users
          are distinct accounts with app-running time in the window, never a sum
          of daily counts.
        </p>
        <p>
          <strong>Website</strong> visitors are distinct PostHog persons with a
          pageview in the window; a person is a browser profile, not guaranteed
          to be one human. Collection began 11 September 2026.
        </p>
        <p>
          <strong>Paying</strong> is a Stripe customer with lifetime access or
          an active non-free plan. Trialing, past due and canceling are their
          own rows and are not paying. Net earnings are Stripe balance
          transactions in the window: payments, refunds, refund reversals,
          disputes and fees, net of fees exactly once, grouped by currency and
          never converted. Payouts and transfers are movements, not earnings. A
          new paying customer is a first successful positive charge.
        </p>
        <p>
          <strong>Support</strong> buckets are the whole queue as the pipeline
          classifies it. Paying overlays count only tickets with a verified
          account; email-only contacts are unknown, never inferred. Response and
          completion times use retained timestamps only.
        </p>
        <p>{DOWNLOADS_CAVEAT}</p>
      </div>
    </details>
  )
}
