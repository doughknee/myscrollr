import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import type {
  AnalyticsApplication,
  AnalyticsWindow,
  SignupAnalytics,
} from '@/api/adminAnalytics'
import { loadSignupAnalytics } from '@/api/adminAnalytics'
import { useGetToken } from '@/hooks/useGetToken'

const APPLICATIONS = [
  { value: 'website', label: 'Website' },
  { value: 'desktop', label: 'Desktop app' },
] as const
const WINDOWS = [7, 30] as const
const STAGES = [
  { key: 'started', label: 'Registration started', path: 'Entry' },
  { key: 'identifier_submitted', label: 'Identifier submitted', path: 'Entry' },
  { key: 'email_code_sent', label: 'Email code sent', path: 'Email' },
  { key: 'email_code_verified', label: 'Email code verified', path: 'Email' },
  { key: 'phone_code_sent', label: 'Phone code sent', path: 'Phone' },
  { key: 'phone_code_verified', label: 'Phone code verified', path: 'Phone' },
  { key: 'password_created', label: 'Password created', path: 'Password' },
  { key: 'password_verified', label: 'Password verified', path: 'Password' },
  { key: 'social_started', label: 'Provider opened', path: 'Social' },
  { key: 'social_verified', label: 'Provider verified', path: 'Social' },
  { key: 'passkey_started', label: 'Passkey opened', path: 'Passkey' },
  { key: 'passkey_verified', label: 'Passkey verified', path: 'Passkey' },
  { key: 'profile_updated', label: 'Profile updated', path: 'Finish' },
  { key: 'submitted', label: 'Registration submitted', path: 'Finish' },
] as const

const reasonLabel: Record<string, string> = {
  abuse_protection: 'Abuse protection',
  identifier: 'Identifier',
  password: 'Password',
  provider: 'Social provider',
  unknown: 'Other safe category',
  verification_code: 'Verification code',
}

function Selector<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-lg ring-1 ring-base-300"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`min-h-10 cursor-pointer px-3 text-sm font-medium first:rounded-l-lg last:rounded-r-lg transition-colors ${
            value === option.value
              ? 'bg-base-200 text-base-content'
              : 'text-base-content/60 hover:bg-base-200/60'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const getToken = useGetToken()
  const [application, setApplication] =
    useState<AnalyticsApplication>('website')
  const [days, setDays] = useState<AnalyticsWindow>(7)
  const [data, setData] = useState<SignupAnalytics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const load = useCallback(() => {
    setData(null)
    setError(null)
    setStale(false)
    loadSignupAnalytics(getToken, application, days)
      .then((report) => {
        setData(report)
        setStale(Date.now() - Date.parse(report.generated_at) > 10 * 60_000)
      })
      .catch((err: unknown) =>
        setError(
          err instanceof Error ? err.message : 'Could not load analytics',
        ),
      )
  }, [application, days, getToken])

  useEffect(load, [load])

  const eventTotal = data
    ? Object.values(data.stages).reduce((sum, stage) => sum + stage.events, 0)
    : 0

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Signup analytics
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-base-content/60">
            Registration events and safe error categories from Logto. These are
            not people, accounts, installs, sessions, or evidence that someone
            used Scrollr after signing in.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Selector
            label="Application"
            options={APPLICATIONS}
            value={application}
            onChange={setApplication}
          />
          <Selector
            label="Time window"
            options={WINDOWS.map((value) => ({
              value,
              label: `${value} days`,
            }))}
            value={days}
            onChange={setDays}
          />
        </div>
      </header>

      {error && (
        <div className="rounded-xl bg-error/5 p-4 ring-1 ring-error/20">
          <p className="text-sm font-medium text-error">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-error/30 hover:bg-error/10"
          >
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      )}

      {!data && !error && (
        <div
          className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-base-content/50"
          role="status"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden /> Loading signup
          events
        </div>
      )}

      {data && (
        <>
          <section
            className={`rounded-xl p-4 ring-1 ${
              data.coverage.status !== 'unknown' || stale
                ? 'bg-warning/5 ring-warning/25'
                : 'bg-base-200/40 ring-base-300/60'
            }`}
          >
            <div className="flex items-start gap-3">
              {(data.coverage.status !== 'unknown' || stale) && (
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden
                />
              )}
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  {data.coverage.status === 'partial'
                    ? 'Partial coverage'
                    : 'Coverage limits unknown'}
                  {stale ? ' · stale result' : ''}
                </p>
                <p className="mt-1 text-base-content/60">
                  {data.coverage.note}
                </p>
                <p className="mt-2 text-xs text-base-content/50">
                  Generated {new Date(data.generated_at).toLocaleString()} ·{' '}
                  {data.coverage.pages} page
                  {data.coverage.pages === 1 ? '' : 's'} ·{' '}
                  {data.coverage.unique_logs.toLocaleString()} unique retained
                  logs scanned
                </p>
              </div>
            </div>
          </section>

          {eventTotal === 0 ? (
            <p className="rounded-xl bg-base-200/40 p-5 text-sm text-base-content/70 ring-1 ring-base-300/60">
              No recognized registration events were found for this application
              and window. With limited coverage, this means “not observed,” not
              zero activity.
            </p>
          ) : (
            <section className="overflow-hidden rounded-xl ring-1 ring-base-300/60">
              <div className="bg-base-200/40 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  Events by path and step
                </h2>
                <p className="mt-1 text-xs text-base-content/50">
                  Rows are independent event counts. Optional paths are not a
                  universal sequence, and repeated events can be retries.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-t border-base-300/50 text-left text-xs text-base-content/50">
                      <th className="px-2 py-2 font-medium sm:px-4">Path</th>
                      <th className="px-2 py-2 font-medium sm:px-4">Event</th>
                      <th className="px-2 py-2 text-right font-medium sm:px-4">
                        Count
                      </th>
                      <th className="px-2 py-2 text-right font-medium sm:px-4">
                        Errors
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map((stage) => {
                      const metrics = data.stages[stage.key] ?? {
                        events: 0,
                        errors: 0,
                      }
                      return (
                        <tr
                          key={stage.key}
                          className="border-t border-base-300/50"
                        >
                          <td className="px-2 py-2 text-base-content/50 sm:px-4">
                            {stage.path}
                          </td>
                          <td className="px-2 py-2 font-medium sm:px-4">
                            {stage.label}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums sm:px-4">
                            {metrics.events.toLocaleString()}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-base-content/60 sm:px-4">
                            {metrics.errors.toLocaleString()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
              <h2 className="text-sm font-semibold">Safe error reasons</h2>
              {data.error_reasons.length === 0 ? (
                <p className="mt-3 text-sm text-base-content/60">
                  No recognized registration errors were observed.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-base-300/50">
                  {data.error_reasons.map((reason) => (
                    <li
                      key={reason.reason}
                      className="flex justify-between gap-4 py-2 text-sm"
                    >
                      <span>
                        {reasonLabel[reason.reason] ?? 'Other safe category'}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {reason.count.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-base-content/50">
                Raw errors, emails, IP addresses, user agents, parameters, and
                tokens are discarded before this response is built.
              </p>
            </section>

            <section className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
              <h2 className="text-sm font-semibold">Attempt conversion</h2>
              <p className="mt-3 text-sm text-base-content/60">
                {data.attempt_conversion.note}
              </p>
              <p className="mt-3 text-xs text-base-content/50">
                A missing later event is not proof of abandonment. Completion
                and drop-off stay unavailable until correlation and path
                semantics can support a real denominator.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
