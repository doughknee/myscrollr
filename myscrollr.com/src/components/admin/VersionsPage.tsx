import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { PageFrame, VERDICT_TONE, VerdictPill } from './ui'
import type { ReactNode } from 'react'
import type { AdminVersions } from '@/api/admin'
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
const pct = (n: number) => `${(n * 100).toFixed(n === 0 || n >= 0.01 ? 0 : 1)}%`
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="max-w-[900px] text-2xl leading-[1.35] font-semibold tracking-[-0.015em]">
          {empty ? (
            'No desktop traffic in this window.'
          ) : (
            <>
              <b className={`font-bold ${tone.number}`}>
                {pct(data.current_share)} of desktop traffic
              </b>{' '}
              is on {data.current_release}, the newest build anyone is running.{' '}
              {erroring
                ? `${erroring} is erroring more than usual.`
                : 'Nothing is erroring more than usual.'}
            </>
          )}
        </p>
        <VerdictPill verdict={verdict} />
      </div>

      {empty && (
        <p className="rounded-xl bg-base-200/40 p-4 text-sm text-base-content/70 ring-1 ring-base-300/60">
          No desktop request in the last {data.days} days carried a recognisable
          Scrollr user agent
          {data.unrecognized > 0 && (
            <> (though {num(data.unrecognized)} other requests arrived)</>
          )}
          . A build only starts reporting once it sends one — before then this
          page is correctly empty rather than wrong.
        </p>
      )}

      {!empty && (
        <>
          {/* Adoption. The share itself is the sentence's job now, not a
              second headline; these rows are the breakdown behind it. */}
          <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
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

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
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
            <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
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
                A build erroring well above the others is a build to reproduce
                on — this is what scopes "some reports of X" to a version and an
                OS.
              </p>
            </section>
          </div>
        </>
      )}

      {/* Unrecognized stays visible even at zero. It is the page's canary: a
          silently empty adoption chart is the failure this page exists to
          catch. */}
      <div className="space-y-2 border-t border-base-300/60 pt-4 text-xs text-base-content/50">
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
      </div>
    </div>
  )
}

export default function VersionsPage() {
  const getToken = useGetToken()
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<AdminVersions | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setData(null)
    setError(null)
    adminApi
      .versions(getToken, days)
      .then(setData)
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : 'Could not load the counters',
        ),
      )
  }, [getToken, days])

  useEffect(load, [load])

  return (
    <PageFrame>
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[32px] leading-none font-extrabold tracking-[-0.03em]">
            Versions
          </h1>
          <div
            role="group"
            aria-label="Time window"
            className="flex shrink-0 rounded-lg ring-1 ring-base-300"
          >
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`min-h-9 cursor-pointer px-3 text-sm font-medium first:rounded-l-lg last:rounded-r-lg transition-colors ${
                  days === d
                    ? 'bg-base-200 text-base-content'
                    : 'text-base-content/60 hover:bg-base-200/60'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </header>

        {error && (
          <p className="rounded-lg bg-error/5 p-3 text-sm text-error ring-1 ring-error/20">
            {error}
          </p>
        )}

        {!data && !error && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="size-6 animate-spin text-base-content/40" />
          </div>
        )}

        {data && <VersionsReport data={data} />}
      </div>
    </PageFrame>
  )
}
