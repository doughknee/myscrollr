import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AdminOverview } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'
import {
  DOWNLOADS_CAVEAT,
  connectedCaveat,
  formatAge,
  ingestHealth,
  measuredValue,
} from '@/lib/adminFormat'

/**
 * "Everything about Scrollr in one spot."
 *
 * Every tile is either a number we hold or an explicit admission that we do
 * not. The Installs tile is the second kind on purpose: Scrollr ships no
 * telemetry, by decision, so active installs cannot be measured and the page
 * says exactly that instead of substituting downloads and hoping nobody
 * notices the difference.
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

  const newAccounts = measuredValue(data.accounts.new_30d)
  const installs = measuredValue(data.installs)
  const releases = (data.downloads.releases ?? []).slice(0, 5)
  const ingest = data.ingest ?? []
  const plans = (data.plans.rows ?? []).filter((r) => r.plan !== 'free')
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
          title="Accounts"
          to="/admin/users"
          caveat={
            data.accounts.untracked > 0
              ? `${data.accounts.untracked.toLocaleString()} accounts predate signup-date tracking, so they are counted in the total but not in "new".`
              : undefined
          }
        >
          <Big>{data.accounts.total.toLocaleString()}</Big>
          <div className="mt-3">
            {newAccounts.display === null ? (
              <Unmeasurable note={newAccounts.note} />
            ) : (
              <p className="text-sm text-base-content/60">
                <span className="font-semibold text-base-content">
                  {newAccounts.display}
                </span>{' '}
                new in the last 30 days
              </p>
            )}
          </div>
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
          title="Plans"
          caveat="From Stripe. Accounts with no Stripe record are counted as free."
        >
          <Big>{data.plans.free.toLocaleString()}</Big>
          <p className="mt-1 mb-2 text-sm text-base-content/60">free</p>
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
