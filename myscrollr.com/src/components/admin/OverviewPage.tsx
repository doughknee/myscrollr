import { Link } from '@tanstack/react-router'
import { useEffect, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AdminOverview, DailyCount, Trend } from '@/api/admin'
import type { TrendDisplay } from '@/lib/adminFormat'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'
import { overviewLoad } from '@/lib/overviewLoad'
import {
  DOWNLOADS_CAVEAT,
  connectedCaveat,
  formatAge,
  ingestHealth,
  measuredValue,
  sparkline,
  trendValue,
} from '@/lib/adminFormat'

/**
 * "Everything about Scrollr in one spot."
 *
 * Every tile is either a number we hold or an explicit admission that we do
 * not. The install measurement note explains why Scrollr ships no
 * install identifier, by decision, so active installs cannot be measured and
 * the page says exactly that instead of substituting downloads and hoping
 * nobody notices the difference.
 */

function Tile({
  title,
  caveat,
  to,
  children,
}: {
  title: string
  caveat?: string
  to?: string
  children: ReactNode
}) {
  const body = (
    <div className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
      <h3 className="text-xs font-semibold tracking-wide text-base-content/65 uppercase">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
      {caveat && (
        <p className="mt-4 text-xs leading-relaxed text-base-content/65">
          {caveat}
        </p>
      )}
    </div>
  )
  return to ? (
    <Link
      to={to}
      className="block rounded-xl text-base-content transition-colors hover:bg-base-200/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    >
      {body}
    </Link>
  ) : (
    body
  )
}

function Big({ children }: { children: ReactNode }) {
  return <p className="text-3xl font-bold tabular-nums">{children}</p>
}

/** The house style for "we do not have this number." */
function Unmeasurable({ note }: { note?: string }) {
  return (
    <div className="flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
      <p className="text-sm leading-relaxed text-base-content/70">
        {note ?? 'Not measurable.'}
      </p>
    </div>
  )
}

/**
 * A change against the previous period, with the direction readable without
 * reading the number. Up is coloured as good because every figure that carries
 * one here (signups, daily/weekly/monthly actives) is one where up is good —
 * a fall is a dip, not a decoration, so it gets the warning colour and its own
 * arrow rather than a smaller green number.
 */
function Delta({ trend }: { trend: TrendDisplay }) {
  if (trend.delta === null) {
    return <span className="text-xs text-base-content/65">no change</span>
  }
  const up = trend.direction === 'up'
  return (
    <span
      title="Change against the previous period, from Logto"
      className={`inline-flex items-center gap-0.5 font-mono text-xs font-semibold tabular-nums ${
        up ? 'text-success' : 'text-warning'
      }`}
    >
      {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {trend.delta}
    </span>
  )
}

/** A figure and its delta on one line, or a plain admission it is missing. */
function TrendRow({ label, trend }: { label: string; trend: Trend }) {
  const t = trendValue(trend)
  return (
    <Row
      label={label}
      value={
        t.value === null ? (
          <span className="text-xs font-normal text-base-content/65">
            unavailable
          </span>
        ) : (
          <span className="inline-flex items-baseline gap-2">
            {t.value}
            <Delta trend={t} />
          </span>
        )
      }
    />
  )
}

/**
 * Logto's daily-active curve, drawn as two SVG paths. No charting library:
 * the site ships none, and thirty points do not justify the first one.
 *
 * `preserveAspectRatio="none"` lets the box stretch to whatever width the tile
 * gives it; `vector-effect` then keeps the stroke a hairline instead of
 * stretching with it, and the marker is a tick rather than a dot for the same
 * reason.
 */
const SPARK_W = 160
const SPARK_H = 44

function Sparkline({ points }: { points: Array<DailyCount> | null }) {
  const chart = sparkline(points, SPARK_W, SPARK_H)
  if (!chart || !points || points.length === 0) return null

  const from = points[0].day
  const to = points[points.length - 1].day

  return (
    <figure className="min-w-0 flex-1">
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="h-11 w-full text-primary"
        role="img"
        aria-label={`Daily active users from ${from} to ${to}, peak ${chart.peak}`}
      >
        <path d={chart.area} fill="currentColor" opacity={0.15} />
        <path
          d={chart.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* Today, marked. The helper's padding is what keeps it on screen. */}
        <line
          x1={chart.last.x}
          y1={chart.last.y}
          x2={chart.last.x}
          y2={SPARK_H - 3}
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-base-content/65">
        <span>{from}</span>
        <span>peak {chart.peak.toLocaleString()}</span>
        <span>{to}</span>
      </figcaption>
    </figure>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="truncate text-base-content/60">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export default function OverviewPage() {
  const getToken = useGetToken()
  const [reload, setReload] = useState(0)
  const requestId = useRef(0)
  const [{ data, error, loading }, dispatch] = useReducer(
    overviewLoad,
    undefined,
    () => overviewLoad(undefined, { type: 'start', request: 0 }),
  )
  useEffect(() => {
    let current = true
    const request = ++requestId.current
    dispatch({ type: 'start', request })
    adminApi.overview(getToken).then(
      (snapshot) => {
        if (current) dispatch({ type: 'success', request, data: snapshot })
      },
      (err: unknown) => {
        if (current)
          dispatch({
            type: 'error',
            request,
            error:
              err instanceof Error
                ? err.message
                : 'Could not load the overview',
          })
      },
    )
    return () => {
      current = false
    }
  }, [getToken, reload])
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Your next actions, growth, and service health.
          </p>
          <p role="status" className="mt-2 text-xs text-base-content/65">
            {loading
              ? data
                ? 'Refreshing snapshot…'
                : 'Loading overview…'
              : data
                ? `Last updated ${new Date(data.generated_at).toLocaleString()}`
                : 'No snapshot loaded.'}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload((n) => n + 1)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold ring-1 ring-base-300 transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw size={16} aria-hidden />
          )}
          {loading ? 'Refreshing…' : error ? 'Retry' : 'Refresh'}
        </button>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-error/5 p-4 text-sm text-error ring-1 ring-error/30"
        >
          <p className="font-semibold">
            {data
              ? 'Refresh failed — showing an older snapshot.'
              : 'Could not load the overview.'}
          </p>
          <p className="mt-1">{error}</p>
        </div>
      )}
      {data && <OverviewContent data={data} />}
    </div>
  )
}

export function OverviewContent({ data }: { data: AdminOverview }) {
  const installs = measuredValue(data.installs)
  const dau = trendValue(data.active.dau)
  const releases = (data.downloads.releases ?? []).slice(0, 5)
  const ingest = data.ingest ?? []
  const plans = (data.plans.rows ?? []).filter((r) => r.plan !== 'free')
  // The gap is the point of this page: accounts that exist but never got far
  // enough into the product to save a preference.
  const neverSetUp = Math.max(0, data.accounts.total - data.accounts.set_up)
  const free = Math.max(0, data.accounts.total - data.plans.paying)
  const requests = (data.demand.catalog_requests ?? []).slice(0, 5)

  return (
    <div className="space-y-8">
      <section
        aria-labelledby="attention-heading"
        className="rounded-xl bg-base-200/40 p-4 ring-1 ring-base-300/70 sm:p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention-heading" className="text-base font-semibold">
            Attention
          </h2>
          <Link
            to="/admin/support"
            className="rounded text-sm font-semibold text-base-content underline decoration-base-content/30 underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Open support →
          </Link>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-base-content/70">Drafts waiting</p>
            <Big>{data.support.pending_drafts.toLocaleString()}</Big>
            <p className="mt-1 text-xs text-base-content/65">
              Open the queue to check their status.
            </p>
          </div>
          <div>
            <p className="text-sm text-base-content/70">Oldest open case</p>
            <p className="text-2xl font-bold tabular-nums">
              {data.support.oldest_open_ticket
                ? `${Math.floor(data.support.oldest_open_hours / 24).toLocaleString()}d ${data.support.oldest_open_hours % 24}h`
                : '—'}
            </p>
            <p className="mt-1 text-xs text-base-content/65">
              {data.support.oldest_open_ticket
                ? `Ticket #${data.support.oldest_open_ticket}`
                : 'No oldest-ticket detail in this snapshot.'}
            </p>
          </div>
          <div>
            <p className="text-sm text-base-content/70">
              Unreplied business leads
            </p>
            <Big>{data.demand.leads_unreplied.toLocaleString()}</Big>
            <p className="mt-1 text-xs text-base-content/65">
              Business enquiries awaiting a reply.
            </p>
          </div>
        </div>
        <div className="mt-4 border-t border-base-300/60 pt-3 text-sm">
          {ingest
            .filter((row) => ingestHealth(row) !== 'fresh')
            .map((row) => (
              <p key={row.table} className="mb-1 text-base-content/80">
                <AlertTriangle size={14} className="mr-1 inline" aria-hidden />
                {row.table}:{' '}
                {row.has_data
                  ? `last write ${formatAge(row.age_seconds)} — check freshness`
                  : 'no data in this table'}
              </p>
            ))}
          <a
            href="#service-health"
            className="inline-block rounded text-base-content/75 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Review service readings ↓
          </a>
        </div>
      </section>
      <section
        id="growth"
        aria-labelledby="growth-heading"
        className="scroll-mt-6 space-y-3"
      >
        <h2 id="growth-heading" className="text-base font-semibold">
          Accounts & growth
        </h2>
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {' '}
          <Tile
            title={
              data.accounts.source === 'local'
                ? 'Accounts (local count)'
                : 'Accounts'
            }
            to="/admin/users"
            caveat={
              data.accounts.note ??
              'Accounts come from Logto. "Set up the app" is a local count of who ever saved a preference.'
            }
          >
            <Big>{data.accounts.total.toLocaleString()}</Big>
            <p className="mt-1 text-sm text-base-content/60">
              {data.accounts.source === 'local'
                ? 'accounts with local data — Logto unreachable'
                : 'accounts'}
            </p>
            {data.accounts.source === 'logto' && (
              <p className="mt-3 text-sm text-base-content/60">
                <span className="font-semibold text-base-content">
                  {data.accounts.set_up.toLocaleString()}
                </span>{' '}
                have set up the app —{' '}
                <span className="font-semibold text-warning">
                  {neverSetUp.toLocaleString()}
                </span>{' '}
                never did
              </p>
            )}
            <div className="mt-3 border-t border-base-300/60 pt-2">
              <TrendRow label="New today" trend={data.accounts.new_today} />
              <TrendRow label="New this week" trend={data.accounts.new_7d} />
            </div>
          </Tile>
          <Tile
            title="Active users"
            caveat="Authenticated accounts, not everyone currently using the app."
          >
            {dau.value === null ? (
              <Unmeasurable note={data.active.note} />
            ) : (
              <>
                <div className="flex items-end gap-4">
                  <div className="shrink-0">
                    <Big>{dau.value}</Big>
                    <p className="mt-1 flex items-baseline gap-2 text-sm text-base-content/60">
                      today
                      <Delta trend={dau} />
                    </p>
                  </div>
                  <Sparkline points={data.active.curve} />
                </div>
                <div className="mt-3 border-t border-base-300/60 pt-2">
                  <TrendRow label="This week" trend={data.active.wau} />
                  <TrendRow label="This month" trend={data.active.mau} />
                </div>
              </>
            )}
          </Tile>
          <Tile
            title="Paying"
            caveat="Paid Stripe records, excluding the free plan. See measurement notes below."
          >
            <Big>{data.plans.paying.toLocaleString()}</Big>
            <p className="mt-1 mb-2 text-sm text-base-content/60">
              paying · {free.toLocaleString()} free
            </p>
            {plans.length === 0 ? (
              <p className="text-sm text-base-content/65">
                No paid subscriptions.
              </p>
            ) : (
              plans.map((r) => (
                <Row
                  key={`${r.plan}-${r.status}-${r.lifetime}`}
                  label={`${r.plan}${r.lifetime ? ' (lifetime)' : ''} · ${r.status}`}
                  value={r.count.toLocaleString()}
                />
              ))
            )}
          </Tile>
        </div>
      </section>
      <section
        id="support"
        aria-labelledby="support-heading"
        className="scroll-mt-6 space-y-3"
      >
        <h2 id="support-heading" className="text-base font-semibold">
          Support & demand
        </h2>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {' '}
          <Tile
            title="Support"
            to="/admin/support"
            caveat={
              data.support.oldest_open_ticket
                ? `Oldest open ticket ${data.support.oldest_open_ticket}, ${data.support.oldest_open_hours}h old.`
                : 'No oldest-ticket detail in this snapshot.'
            }
          >
            <Big>{data.support.open_cases.toLocaleString()}</Big>
            <p className="mt-1 mb-2 text-sm text-base-content/60">open cases</p>
            <Row label="Drafts waiting" value={data.support.pending_drafts} />
            <Row label="Auto-sent (30d)" value={data.support.auto_sent_30d} />
            <Row
              label="Needed a person (30d)"
              value={data.support.intervened_30d}
            />
          </Tile>
          <Tile
            title="Demand"
            caveat="What people asked for and did not find, plus business enquiries."
          >
            <Row
              label="Business leads"
              value={`${data.demand.business_leads} (${data.demand.leads_unreplied} unreplied)`}
            />
            <div className="mt-2 border-t border-base-300/60 pt-2">
              {requests.length === 0 ? (
                <p className="text-sm text-base-content/65">
                  No widget requests yet.
                </p>
              ) : (
                requests.map((r) => (
                  <Row key={r.query} label={r.query} value={r.people} />
                ))
              )}
            </div>
          </Tile>
        </div>
      </section>
      <section
        id="service-health"
        aria-labelledby="service-health-heading"
        className="scroll-mt-6 space-y-3"
      >
        <h2 id="service-health-heading" className="text-base font-semibold">
          Service health & releases
        </h2>
        <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {' '}
          <Tile
            title="Ingest freshness"
            caveat="How long ago each content table was last written. Sports can legitimately sit still overnight."
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
                  label={row.table}
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
                      {health === 'empty'
                        ? 'empty'
                        : formatAge(row.age_seconds)}
                    </span>
                  }
                />
              )
            })}
          </Tile>
          <Tile
            title="Connected now"
            caveat={connectedCaveat(data.connected_now)}
          >
            <Big>{data.connected_now.count.toLocaleString()}</Big>
            <p className="mt-2 text-sm text-base-content/60">
              open SSE connections
            </p>
          </Tile>
          <Tile
            title="Downloads"
            caveat={
              data.downloads.stale
                ? `${DOWNLOADS_CAVEAT} These figures are cached — GitHub was unreachable on the last refresh.`
                : DOWNLOADS_CAVEAT
            }
          >
            {data.downloads.error ? (
              <Unmeasurable note={data.downloads.error} />
            ) : (
              <>
                <Big>{data.downloads.total.toLocaleString()}</Big>
                <p className="mt-1 mb-2 text-sm text-base-content/60">
                  across all releases
                </p>
                {releases.map((r) => (
                  <Row
                    key={r.tag}
                    label={r.tag}
                    value={r.downloads.toLocaleString()}
                  />
                ))}
              </>
            )}
            <details className="mt-4 border-t border-base-300/60 pt-3 text-xs text-base-content/70">
              <summary className="cursor-pointer py-1 font-semibold focus-visible:outline-2 focus-visible:outline-primary">
                Why downloads are not active installs
              </summary>
              <p className="mt-2 leading-relaxed">
                {installs.note ?? 'Active installs are not measurable.'}
              </p>
            </details>
          </Tile>
        </div>
      </section>
      <details className="rounded-xl border border-base-300/60 p-4 text-sm text-base-content/75">
        <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-primary">
          How to read these numbers
        </summary>
        <div className="mt-3 space-y-2 leading-relaxed">
          <p>
            Each section uses its own source and time window. Refresh reads a
            new snapshot; some upstream figures remain cached.
          </p>
          <p>
            Accounts come from Logto. App setup means a locally saved
            preference, not a measured signup conversion funnel. Active users
            are accounts that authenticated during the window; someone using the
            app without signing in again is not counted.
          </p>
          <p>
            Paying counts paid Stripe records, excluding the free plan. Free is
            the account total minus that count. Connections are open SSE
            connections, not a count of people or installs.
          </p>
          <p>{DOWNLOADS_CAVEAT}</p>
          <p>
            Support and lead totals describe the current snapshot. A zero count
            is not an all-clear for the service. Ingest age is time since the
            last table write; sports can legitimately sit still overnight.
          </p>
        </div>
      </details>
    </div>
  )
}
