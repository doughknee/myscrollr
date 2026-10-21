import { useCallback, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  EmptyState,
  Loaded,
  PageFrame,
  RefreshButton,
  VERDICT_TONE,
  VerdictPill,
  useReport,
} from './ui'
import { SystemHealth } from './SystemHealth'
import type { ReactNode } from 'react'
import type { AdminOverview, AdminVersions } from '@/api/admin'
import { loadBoundedAdminReport } from '@/api/adminAnalytics'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'
import { versionsVerdict } from '@/lib/overviewVerdicts'

/**
 * Versions — what the fleet is actually running, and which builds are failing.
 *
 * Built entirely from per-day request counters (REL-271). Until those existed,
 * a report like "the ticker never scrolls, 1.4.0 and 1.5.0, Windows" could not
 * be scoped at all: nobody could say whether anyone was still on those builds,
 * so every follow-up was an email and a week of waiting.
 *
 * The honesty rule from the Overview applies here and is load-bearing. These
 * are REQUESTS, not installs. No user id is stored anywhere in the counters —
 * deliberately, that is the privacy design — so an install headcount does not
 * exist and no label on this page may imply one. Every install polls the
 * dashboard on the same timer, so traffic share tracks adoption closely enough
 * to answer the question that matters; it is a proxy and it is labelled as
 * one, every time. That rule is why the sentence below says "of desktop
 * traffic" rather than naming a number of anybody (SCROLLR-222).
 */

const WINDOWS = [7, 30, 90] as const

// A decimal only below 1%, so a real-but-tiny share never rounds to a flat
// "0%" that reads as "nobody".
const pct = (n: number) =>
  n > 0 && n < 0.0005
    ? '<0.1%'
    : `${(n * 100).toFixed(n === 0 || n >= 0.01 ? 0 : 1)}%`
const num = (n: number) => n.toLocaleString()

/** Anything at or above this is worth a second look rather than a shrug. */
const ERROR_RATE_WARN = 0.02

/**
 * One row's share, drawn as a bar.
 *
 * A single hue across all three charts, following the page's verdict: colour
 * here means state, never which chart you are looking at. `tone` is a whole
 * `text-*` class and the fill is `bg-current`, because a Tailwind class built
 * by interpolation is not in the source and compiles to nothing.
 */
function Bar({ share, tone }: { share: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300/60">
      <div
        className={`h-full rounded-full bg-current ${tone}`}
        style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }}
      />
    </div>
  )
}

/** A chart's heading: the question it answers, in the reader's own words. */
function ChartHeading({
  children,
  note,
}: {
  children: ReactNode
  note?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold">{children}</h2>
      {note && <p className="text-xs text-base-content/50">{note}</p>}
    </div>
  )
}

/** One row's share and raw request count, the same shape in every chart. */
function RowFigure({ share, requests }: { share: number; requests: number }) {
  return (
    <span className="font-mono text-xs text-base-content/55 tabular-nums">
      {pct(share)} · {num(requests)} req
    </span>
  )
}

/**
 * The page's one sentence, and everything under it.
 *
 * Split out from the loading shell so it is a pure function of one report:
 * the fixture harness renders it at both widths, for each verdict, without a
 * token or a server.
 */
export function VersionsReport({ data }: { data: AdminVersions }) {
  const { verdict, erroring } = versionsVerdict(data)
  const tone = VERDICT_TONE[verdict.tone]
  const empty = data.desktop_total === 0

  return (
    <div className="admin-system-traffic space-y-6 [overflow-wrap:anywhere]">
      {!empty && (
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <p className="max-w-[900px] text-2xl leading-[1.35] font-semibold tracking-[-0.015em]">
            <b className={`font-bold ${tone.number}`}>
              {pct(data.current_share)} of desktop traffic
            </b>{' '}
            is on {data.current_release}, the newest build anyone is running.{' '}
            {erroring
              ? `${erroring} is erroring more than usual.`
              : 'Nothing is erroring more than usual.'}
          </p>
          <VerdictPill verdict={verdict} />
        </div>
      )}

      {empty && (
        <EmptyState title="No desktop traffic in this window.">
          <p>
            No desktop request in the last {data.days} days carried a
            recognisable Scrollr user agent
            {data.unrecognized > 0 && (
              <> (though {num(data.unrecognized)} other requests arrived)</>
            )}
            . Try a wider window. A build appears here once it sends a
            recognised user agent.
          </p>
          <VerdictPill verdict={verdict} />
        </EmptyState>
      )}

      {!empty && (
        <div className="admin-versions-panels">
          {/* Adoption. The share itself is the sentence's job now, not a
              second headline; these rows are the breakdown behind it. */}
          <section className="admin-versions-adoption rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
            <ChartHeading note="Share of desktop API requests in the window.">
              Which build desktop traffic comes from
            </ChartHeading>

            <ul className="mt-5 space-y-3">
              {data.versions.map((v) => (
                <li key={v.version}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium tabular-nums">
                      {v.version}
                    </span>
                    <RowFigure share={v.share} requests={v.requests} />
                  </div>
                  <div className="mt-1.5">
                    <Bar share={v.share} tone={tone.chart} />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="admin-versions-secondary">
            <section className="admin-versions-platforms rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
              <ChartHeading>Windows, Mac or Linux</ChartHeading>
              <ul className="mt-4 space-y-3">
                {data.platforms.map((p) => (
                  <li key={p.platform}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium capitalize">
                        {p.platform}
                      </span>
                      <RowFigure share={p.share} requests={p.requests} />
                    </div>
                    <div className="mt-1.5">
                      <Bar share={p.share} tone={tone.chart} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Error rate by build — the reason the page exists. */}
            <section className="admin-versions-errors rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
              <ChartHeading note="4xx + 5xx">
                How often each build gets an error
              </ChartHeading>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-base-content/50">
                    <th className="pb-2 font-medium">Build</th>
                    <th className="pb-2 text-right font-medium">4xx</th>
                    <th className="pb-2 text-right font-medium">5xx</th>
                    <th className="pb-2 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.versions.map((v) => {
                    const hot = v.error_rate >= ERROR_RATE_WARN
                    return (
                      <tr
                        key={v.version}
                        className="border-t border-base-300/50"
                      >
                        <td className="py-2 font-medium tabular-nums">
                          {v.version}
                        </td>
                        <td className="py-2 text-right font-mono text-xs text-base-content/60 tabular-nums">
                          {num(v.client_errors)}
                        </td>
                        <td className="py-2 text-right font-mono text-xs text-base-content/60 tabular-nums">
                          {num(v.server_errors)}
                        </td>
                        <td
                          className={`py-2 text-right font-semibold tabular-nums ${
                            hot ? 'text-error' : 'text-base-content/70'
                          }`}
                        >
                          {hot && (
                            <AlertTriangle
                              size={13}
                              className="mr-1 inline-block align-[-1px]"
                              aria-hidden
                            />
                          )}
                          {pct(v.error_rate)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-base-content/50">
                Compare builds with elevated error rates. 4xx are rejected
                requests; 5xx are server failures. These counters do not measure
                app crashes.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* Unrecognized stays visible even at zero. It is the page's canary: a
          silently empty adoption chart is the failure this page exists to
          catch. */}
      <details className="admin-system-notes">
        <summary>
          Sources and request coverage · {num(data.unrecognized)} unrecognized
        </summary>
        <p>
          <span className="font-medium text-base-content/70">
            Unrecognized:
          </span>{' '}
          {num(data.unrecognized)} request
          {data.unrecognized === 1 ? '' : 's'} in this window came from
          something other than a Scrollr build — the website, the extension,
          uptime probes. Counted separately and excluded from every share above.
          If this number swallows desktop traffic, the app has stopped sending
          its user agent.
        </p>
        <p>
          Every figure above is a share of desktop requests in the window, not a
          count of people. Downloads are on the Releases page and are not
          installs.
        </p>
      </details>
    </div>
  )
}

export default function VersionsPage({
  days: routeDays,
  onDaysChange,
  view: routeView,
  onViewChange,
}: {
  days?: number
  onDaysChange?: (days: number) => void
  view?: 'health' | 'traffic'
  onViewChange?: (view: 'health' | 'traffic') => void
} = {}) {
  const getToken = useGetToken()
  const [localView, setLocalView] = useState<'health' | 'traffic'>('health')
  const view = routeView ?? localView
  const setView = onViewChange ?? setLocalView
  const health = useReport(
    useCallback(
      (signal: AbortSignal) =>
        loadBoundedAdminReport<AdminOverview>(
          getToken,
          '/admin/overview',
          'Could not load service readings',
          'Service readings took too long. Please retry.',
          signal,
        ),
      [getToken],
    ),
  )
  const [localDays, setLocalDays] = useState(30)
  const days = routeDays ?? localDays
  const setDays = onDaysChange ?? setLocalDays
  const report = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return adminApi.versions(getToken, days, signal)
      },
      [getToken, days],
    ),
  )

  return (
    <PageFrame>
      <div className="space-y-8">
        <header className="admin-versions-header flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="admin-page-heading">System</h1>
            <p className="mt-1 text-sm text-base-content/60">
              Check feed freshness, connections and desktop API errors.
            </p>
          </div>
          <RefreshButton
            onClick={view === 'health' ? health.retry : report.retry}
            loading={view === 'health' ? health.loading : report.loading}
          />
        </header>

        <nav className="admin-section-tabs" aria-label="System views">
          <button
            type="button"
            aria-current={view === 'health' ? 'page' : undefined}
            onClick={() => setView('health')}
          >
            Service health
          </button>
          <button
            type="button"
            aria-current={view === 'traffic' ? 'page' : undefined}
            onClick={() => setView('traffic')}
          >
            Desktop API
          </button>
        </nav>
        {view === 'health' ? (
          <Loaded report={health} label="service health">
            {(data) => <SystemHealth data={data} />}
          </Loaded>
        ) : (
          <section className="space-y-6" aria-label="Desktop API traffic">
            <div className="admin-system-section-heading">
              <div>
                <h2>Desktop API traffic</h2>
                <p>
                  Request health by build. Product usage lives in Analytics.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-base-content/60">
                  Time window
                </span>
                <div
                  role="group"
                  aria-label="Versions range"
                  className="flex shrink-0 rounded-lg ring-1 ring-base-300"
                >
                  {WINDOWS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(d)}
                      aria-pressed={days === d}
                      className={`min-h-11 cursor-pointer px-3 text-sm font-medium first:rounded-l-lg last:rounded-r-lg transition-colors ${
                        days === d
                          ? 'bg-base-200 text-base-content'
                          : 'text-base-content/60 hover:bg-base-200/60'
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <Loaded report={report} label="desktop API counters">
              {(data) => <VersionsReport data={data} />}
            </Loaded>
          </section>
        )}
      </div>
    </PageFrame>
  )
}
