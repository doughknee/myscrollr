import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { PageFrame } from './ui'
import type { AdminVersions } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'

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
 * one, every time.
 */

const WINDOWS = [7, 30, 90] as const

// A decimal only below 1%, so a real-but-tiny share never rounds to a flat
// “0%” that reads as “nobody”.
const pct = (n: number) => `${(n * 100).toFixed(n === 0 || n >= 0.01 ? 0 : 1)}%`
const num = (n: number) => n.toLocaleString()

/** Anything at or above this is worth a second look rather than a shrug. */
const ERROR_RATE_WARN = 0.02

function Bar({ share, tone }: { share: number; tone: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300/60">
      <div
        className={`h-full rounded-full ${tone}`}
        style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }}
      />
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
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Versions</h1>
            <p className="mt-1 max-w-2xl text-sm text-base-content/60">
              What the fleet is running, and which builds are erroring. Counted
              from the app version and OS every request already carries — never
              from anything on a user's ticker.
            </p>
          </div>
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

        {data && data.desktop_total === 0 && (
          <p className="rounded-xl bg-base-200/40 p-4 text-sm text-base-content/70 ring-1 ring-base-300/60">
            No desktop requests in the last {data.days} days carried a
            recognisable Scrollr user agent
            {data.unrecognized > 0 && (
              <> (though {num(data.unrecognized)} other requests arrived)</>
            )}
            . Installs only start reporting once they have updated to a build
            that sends one — before then this page is correctly empty rather
            than wrong.
          </p>
        )}

        {data && data.desktop_total > 0 && (
          <>
            {/* Adoption. The headline is the share on the newest build seen. */}
            <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">Version adoption</h2>
                <p className="text-xs text-base-content/50">
                  Share of desktop API requests, not of installs — no per-user
                  data is stored.
                </p>
              </div>
              <p className="mt-3 text-3xl font-bold tabular-nums">
                {pct(data.current_share)}
              </p>
              <p className="text-sm text-base-content/60">
                on {data.current_release}, the newest build calling the API
              </p>

              <ul className="mt-5 space-y-3">
                {data.versions.map((v) => (
                  <li key={v.version}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium tabular-nums">
                        {v.version}
                      </span>
                      <span className="text-base-content/50 tabular-nums">
                        {pct(v.share)} · {num(v.requests)} req
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <Bar share={v.share} tone="bg-primary" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Platform mix. */}
              <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
                <h2 className="text-sm font-semibold">Platform mix</h2>
                <ul className="mt-4 space-y-3">
                  {data.platforms.map((p) => (
                    <li key={p.platform}>
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium capitalize">
                          {p.platform}
                        </span>
                        <span className="text-base-content/50 tabular-nums">
                          {pct(p.share)} · {num(p.requests)} req
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Bar share={p.share} tone="bg-secondary" />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Error rate by version — the reason the page exists. */}
              <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    Error rate by version
                  </h2>
                  <p className="text-xs text-base-content/50">4xx + 5xx</p>
                </div>
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
                          <td className="py-2 text-right tabular-nums text-base-content/60">
                            {num(v.client_errors)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-base-content/60">
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
                  on — this is what scopes "some users report X" to a version
                  and an OS.
                </p>
              </section>
            </div>

            <p className="text-xs text-base-content/50">
              {num(data.unrecognized)} request
              {data.unrecognized === 1 ? '' : 's'} in this window came from
              something other than a Scrollr build — the website, the extension,
              uptime probes. Counted separately and excluded from every share
              above. If this number swallows desktop traffic, the app has
              stopped sending its user agent.
            </p>
          </>
        )}
      </div>
    </PageFrame>
  )
}
