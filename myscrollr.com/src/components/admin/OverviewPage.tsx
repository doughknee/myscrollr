import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AdminOverview, DailyCount, Trend } from '@/api/admin'
import type { TrendDisplay } from '@/lib/adminFormat'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'
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
 * not. The Installs tile is the second kind on purpose: Scrollr ships no
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
    <div className="flex h-full flex-col rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60 transition-colors hover:bg-base-200/70">
      <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
        {title}
      </h2>
      <div className="mt-3 flex-1">{children}</div>
      {caveat && (
        <p className="mt-4 text-xs leading-relaxed text-base-content/45">
          {caveat}
        </p>
      )}
    </div>
  )
  return to ? (
    <Link to={to} className="block h-full">
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
    return <span className="text-xs text-base-content/40">no change</span>
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
          <span className="text-xs font-normal text-base-content/50">
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
      <figcaption className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-base-content/45">
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
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    adminApi
      .overview(getToken)
      .then((res) => !cancelled && setData(res))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setError(
            err instanceof Error ? err.message : 'Could not load the overview',
          ),
      )
    return () => {
      cancelled = true
    }
  }, [getToken])

  if (error) {
    return (
      <p className="rounded-xl bg-error/5 p-5 text-sm text-error ring-1 ring-error/20">
        {error}
      </p>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-base-content/40" />
      </div>
    )
  }

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
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Generated {new Date(data.generated_at).toLocaleString()}. Every tile
          below is a direct read — where a number does not exist, the tile says
          so rather than guessing.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          caveat="From Logto: accounts that actually authenticated in the window. Someone using Scrollr without signing in again does not appear here, so these are floors, not ceilings."
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
          title="Active installs"
          caveat="Use downloads per release instead — it is the closest real number."
        >
          <Unmeasurable note={installs.note} />
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
          title="Paying"
          caveat="From Stripe, excluding rows on the free plan — one active Stripe record is a free-plan row and is not a customer. Free is every account that is not paying."
        >
          <Big>{data.plans.paying.toLocaleString()}</Big>
          <p className="mt-1 mb-2 text-sm text-base-content/60">
            paying · {free.toLocaleString()} free
          </p>
          {plans.length === 0 ? (
            <p className="text-sm text-base-content/50">
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
        </Tile>

        <Tile
          title="Support"
          to="/admin/support"
          caveat={
            data.support.oldest_open_ticket
              ? `Oldest open ticket ${data.support.oldest_open_ticket}, ${data.support.oldest_open_hours}h old.`
              : 'Nothing open.'
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
              <p className="text-sm text-base-content/50">
                No widget requests yet.
              </p>
            ) : (
              requests.map((r) => (
                <Row key={r.query} label={r.query} value={r.people} />
              ))
            )}
          </div>
        </Tile>

        <Tile
          title="Ingest freshness"
          caveat="How long ago each content table was last written. Sports can legitimately sit still overnight."
        >
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
                    {health === 'empty' ? 'empty' : formatAge(row.age_seconds)}
                  </span>
                }
              />
            )
          })}
        </Tile>
      </div>
    </div>
  )
}
