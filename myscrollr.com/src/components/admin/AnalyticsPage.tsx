import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AdminOverview, AdminVersions, DailyCount } from '@/api/admin'
import type {
  AnalyticsApplication,
  AnalyticsWindow,
  SignupAnalytics,
} from '@/api/adminAnalytics'
import type {
  ProductAnalytics,
  ProductAnalyticsWindow,
  RetentionMetric,
} from '@/api/adminProductAnalytics'
import {
  loadBoundedAdminReport,
  loadSignupAnalytics,
} from '@/api/adminAnalytics'
import { loadProductAnalytics } from '@/api/adminProductAnalytics'
import { useGetToken } from '@/hooks/useGetToken'
import { formatAge, ingestHealth, sparkline } from '@/lib/adminFormat'

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
const platformLabel: Record<string, string> = {
  linux: 'Linux',
  macos: 'macOS',
  windows: 'Windows',
}

interface ReportState<T> {
  data: T | null
  error: string | null
  loading: boolean
  slow: boolean
}

function useReport<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReportState<T>>({
    data: null,
    error: null,
    loading: true,
    slow: false,
  })
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setState({
      data: null,
      error: null,
      loading: true,
      slow: false,
    })
    const slowTimer = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        setState((current) => ({ ...current, slow: true }))
      }
    }, 3_000)
    load(controller.signal).then(
      (data) => {
        window.clearTimeout(slowTimer)
        if (!controller.signal.aborted) {
          setState({ data, error: null, loading: false, slow: false })
        }
      },
      (error: unknown) => {
        window.clearTimeout(slowTimer)
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...current,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load this section',
            loading: false,
            slow: false,
          }))
        }
      },
    )
    return () => {
      window.clearTimeout(slowTimer)
      controller.abort()
    }
  }, [attempt, load])

  return {
    ...state,
    retry: () => setAttempt((value) => value + 1),
    cancel: () => {
      request.current?.abort()
      setState((current) => ({
        ...current,
        error: 'Loading canceled. You can retry.',
        loading: false,
        slow: false,
      }))
    },
  }
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
          className={`min-h-10 cursor-pointer px-3 text-sm font-medium first:rounded-l-lg last:rounded-r-lg ${
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

function Card({
  title,
  children,
  note,
}: {
  title: string
  children: ReactNode
  note?: string
}) {
  return (
    <div className="rounded-xl bg-base-200/40 p-4 ring-1 ring-base-300/60 sm:p-5">
      <h3 className="text-sm font-semibold text-base-content/70">{title}</h3>
      <div className="mt-3">{children}</div>
      {note && (
        <p className="mt-3 text-xs leading-relaxed text-base-content/60">
          {note}
        </p>
      )}
    </div>
  )
}

function Big({ children }: { children: ReactNode }) {
  return <p className="text-3xl font-bold tabular-nums">{children}</p>
}

function SourceStamp({ generatedAt }: { generatedAt: string }) {
  return (
    <p className="text-xs text-base-content/50">
      Snapshot generated {new Date(generatedAt).toLocaleString()}
    </p>
  )
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-error/5 p-4 ring-1 ring-error/25"
    >
      <p className="text-sm font-medium text-error">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-error/30 hover:bg-error/10"
      >
        <RefreshCw size={14} aria-hidden /> Retry
      </button>
    </div>
  )
}

function Loading({
  label,
  slow,
  onCancel,
}: {
  label: string
  slow?: boolean
  onCancel?: () => void
}) {
  return (
    <div
      role="status"
      className="rounded-xl bg-base-200/30 p-5 text-sm text-base-content/60 ring-1 ring-base-300/50"
    >
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading {label}
      </span>
      {slow && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 min-h-10 rounded-lg px-3 font-semibold ring-1 ring-base-300"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

const pct = (value: number) => `${Math.round(value * 100)}%`
const num = (value: number) => value.toLocaleString()

function Curve({
  points,
  label,
}: {
  points: Array<DailyCount>
  label: string
}) {
  const chart = sparkline(points, 240, 64, 4)
  if (!chart || points.length === 0) {
    return (
      <p className="text-sm text-base-content/60">
        No observations in this window.
      </p>
    )
  }
  return (
    <figure>
      <svg
        viewBox="0 0 240 64"
        preserveAspectRatio="none"
        className="h-16 w-full text-primary"
        aria-hidden="true"
      >
        <path d={chart.area} fill="currentColor" opacity={0.12} />
        <path
          d={chart.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-base-content/50">
        <span>{points[0].day}</span>
        <span>peak {num(chart.peak)}</span>
        <span>{points[points.length - 1].day}</span>
        <span className="sr-only">
          {label}:{' '}
          {points.map((point) => `${point.day}: ${point.count}`).join(', ')}
        </span>
      </figcaption>
    </figure>
  )
}

function RetentionCard({ metric }: { metric: RetentionMetric }) {
  return (
    <Card title={`Day ${metric.day} retention`}>
      {metric.available ? (
        <>
          <Big>{pct(metric.rate)}</Big>
          <p className="mt-1 text-sm text-base-content/60">
            {num(metric.returned)} of {num(metric.eligible)} mature participants
            returned on exactly day {metric.day}
          </p>
        </>
      ) : (
        <p className="text-sm text-base-content/70">
          {metric.note ?? 'Collecting history.'}
        </p>
      )}
    </Card>
  )
}

export interface AnalyticsContentProps {
  overview: AdminOverview | null
  product: ProductAnalytics | null
  versions: AdminVersions | null
  signup: SignupAnalytics | null
  days: ProductAnalyticsWindow
  application: AnalyticsApplication
  overviewError?: string | null
  productError?: string | null
  versionsError?: string | null
  signupError?: string | null
  loading?: Partial<
    Record<'overview' | 'product' | 'versions' | 'signup', boolean>
  >
  slow?: Partial<
    Record<'overview' | 'product' | 'versions' | 'signup', boolean>
  >
  onRetryOverview?: () => void
  onRetryProduct?: () => void
  onRetryVersions?: () => void
  onRetrySignup?: () => void
  onCancelOverview?: () => void
  onCancelProduct?: () => void
  onCancelVersions?: () => void
  onCancelSignup?: () => void
  onDaysChange?: (days: ProductAnalyticsWindow) => void
  onApplicationChange?: (application: AnalyticsApplication) => void
  onRefresh?: () => void
}

export function AnalyticsContent({
  overview,
  product,
  versions,
  signup,
  days,
  application,
  overviewError,
  productError,
  versionsError,
  signupError,
  loading = {},
  slow = {},
  onRetryOverview,
  onRetryProduct,
  onRetryVersions,
  onRetrySignup,
  onCancelOverview,
  onCancelProduct,
  onCancelVersions,
  onCancelSignup,
  onDaysChange = () => {},
  onApplicationChange = () => {},
  onRefresh,
}: AnalyticsContentProps) {
  const paidPlans =
    overview?.plans.rows?.filter((row) => row.plan !== 'free') ?? []
  const eventTotal = signup
    ? Object.values(signup.stages).reduce((sum, stage) => sum + stage.events, 0)
    : 0
  const hasFeatureUse = product?.features.some(
    (feature) => feature.accounts > 0,
  )

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Product analytics
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-base-content/65">
            Account growth, measured ticker use, current plans, and operating
            health. Each section names its source and limits.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Selector
            label="Time window"
            options={WINDOWS.map((value) => ({
              value,
              label: `${value} days`,
            }))}
            value={days}
            onChange={onDaysChange}
          />
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-base-300 hover:bg-base-200"
          >
            <RefreshCw size={14} aria-hidden /> Refresh all
          </button>
        </div>
      </header>

      <nav
        aria-label="Analytics sections"
        className="flex gap-1 overflow-x-auto rounded-xl bg-base-200/30 p-1 ring-1 ring-base-300/60"
      >
        {[
          ['growth', 'Growth'],
          ['usage', 'Usage & retention'],
          ['features', 'Features'],
          ['revenue', 'Revenue'],
          ['reliability', 'Reliability'],
          ['diagnostics', 'Diagnostics'],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="min-h-10 shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-base-content/70 hover:bg-base-200"
          >
            {label}
          </a>
        ))}
      </nav>

      <section
        id="growth"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="growth-heading"
      >
        <div>
          <h2 id="growth-heading" className="text-lg font-semibold">
            Growth
          </h2>
          <p className="text-sm text-base-content/60">
            Account totals and authentication activity from Logto.
            Authentication is not ticker use.
          </p>
        </div>
        {overviewError && !overview && (
          <ErrorPanel message={overviewError} onRetry={onRetryOverview} />
        )}
        {loading.overview && !overview && (
          <Loading
            label="growth"
            slow={slow.overview}
            onCancel={onCancelOverview}
          />
        )}
        {overview && (
          <div className="space-y-3">
            <SourceStamp generatedAt={overview.generated_at} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card
                title={
                  overview.accounts.source === 'logto'
                    ? 'Accounts'
                    : 'Accounts (local fallback)'
                }
                note={overview.accounts.note}
              >
                <Big>{num(overview.accounts.total)}</Big>
                <p className="mt-1 text-sm text-base-content/60">
                  {num(overview.accounts.set_up)} have saved app preferences
                </p>
              </Card>
              <Card
                title="New today"
                note="Compared with the previous UTC day, from Logto."
              >
                <Big>
                  {overview.accounts.new_today.available
                    ? num(overview.accounts.new_today.value)
                    : '—'}
                </Big>
                {overview.accounts.new_today.available && (
                  <p className="mt-1 text-sm text-base-content/60">
                    {overview.accounts.new_today.delta >= 0 ? '+' : ''}
                    {num(overview.accounts.new_today.delta)} vs previous day
                  </p>
                )}
              </Card>
              <Card
                title="New in 7 days"
                note="Compared with the previous equivalent 7-day period, from Logto."
              >
                <Big>
                  {overview.accounts.new_7d.available
                    ? num(overview.accounts.new_7d.value)
                    : '—'}
                </Big>
                {overview.accounts.new_7d.available && (
                  <p className="mt-1 text-sm text-base-content/60">
                    {overview.accounts.new_7d.delta >= 0 ? '+' : ''}
                    {num(overview.accounts.new_7d.delta)} vs prior 7 days
                  </p>
                )}
              </Card>
              <Card
                title="Authenticated activity (Logto)"
                note="Accounts that authenticated in each window; this does not prove the ticker was visible."
              >
                <p className="text-sm">
                  <strong className="text-xl tabular-nums">
                    {overview.active.dau.available
                      ? num(overview.active.dau.value)
                      : '—'}
                  </strong>{' '}
                  today
                </p>
                <p className="mt-2 text-sm text-base-content/65">
                  {overview.active.wau.available
                    ? num(overview.active.wau.value)
                    : '—'}{' '}
                  in 7 days ·{' '}
                  {overview.active.mau.available
                    ? num(overview.active.mau.value)
                    : '—'}{' '}
                  in 30 days
                </p>
              </Card>
            </div>
          </div>
        )}
      </section>

      <section
        id="usage"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="usage-heading"
      >
        <div>
          <h2 id="usage-heading" className="text-lg font-semibold">
            Usage &amp; retention
          </h2>
          <p className="text-sm text-base-content/60">
            Measured qualifying ticker use from participating accounts only.
          </p>
        </div>
        {productError && !product && (
          <ErrorPanel message={productError} onRetry={onRetryProduct} />
        )}
        {loading.product && !product && (
          <Loading
            label="measured usage"
            slow={slow.product}
            onCancel={onCancelProduct}
          />
        )}
        {product && (
          <>
            <div className="rounded-xl bg-primary/5 p-4 text-sm ring-1 ring-primary/20">
              <p>{product.population_note}</p>
              <p className="mt-1 text-xs text-base-content/60">
                {product.collection_started_at
                  ? `Collection began ${new Date(product.collection_started_at).toLocaleDateString()}. No history is backfilled.`
                  : 'No participating accounts yet.'}
              </p>
            </div>
            <SourceStamp generatedAt={product.generated_at} />
            <div className="flex flex-wrap items-center gap-3">
              <Card title="Recently seen" note={product.recent_presence_note}>
                <Big>{num(product.recent_presence)}</Big>
              </Card>
              <a
                href="https://us.posthog.com/project/603918/dashboard/2087325"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Open product analytics in PostHog
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card title="Participating accounts">
                <Big>{num(product.enrolled_accounts)}</Big>
              </Card>
              <Card title="Measured daily active">
                <Big>{num(product.activity.dau)}</Big>
              </Card>
              <Card title="Measured 7-day active">
                <Big>{num(product.activity.wau)}</Big>
              </Card>
              <Card title="Measured 30-day active">
                <Big>{num(product.activity.mau)}</Big>
              </Card>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Measured active accounts">
                <Curve
                  points={product.activity.curve}
                  label="Measured active accounts by day"
                />
              </Card>
              <Card
                title="First observed ticker use"
                note={product.activation.definition}
              >
                <Curve
                  points={product.activation.curve}
                  label="First observed qualifying use by day"
                />
              </Card>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <RetentionCard metric={product.retention.d1} />
              <RetentionCard metric={product.retention.d7} />
              <RetentionCard metric={product.retention.d30} />
            </div>
          </>
        )}
      </section>

      <section
        id="features"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="features-heading"
      >
        <div>
          <h2 id="features-heading" className="text-lg font-semibold">
            Features
          </h2>
          <p className="text-sm text-base-content/60">
            Share of measured active accounts with each coarse ticker category
            in this {days}-day window. Categories overlap.
          </p>
        </div>
        {productError && !product && (
          <ErrorPanel message={productError} onRetry={onRetryProduct} />
        )}
        {product && !hasFeatureUse && (
          <p className="rounded-xl p-4 text-sm text-base-content/65 ring-1 ring-base-300/60">
            No measured feature use in this window.
          </p>
        )}
        {product && hasFeatureUse && (
          <div className="rounded-xl bg-base-200/40 p-4 ring-1 ring-base-300/60 sm:p-5">
            <ul className="space-y-4">
              {product.features.map((feature) => (
                <li key={feature.category}>
                  <div className="flex justify-between gap-4 text-sm">
                    <span className="font-medium capitalize">
                      {feature.category}
                    </span>
                    <span className="tabular-nums text-base-content/65">
                      {num(feature.accounts)} · {pct(feature.share)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-base-300/60">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${feature.share * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section
        id="revenue"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="revenue-heading"
      >
        <div>
          <h2 id="revenue-heading" className="text-lg font-semibold">
            Revenue
          </h2>
          <p className="text-sm text-base-content/60">
            Current Stripe plan records. Revenue dollars are not shown because
            no normalized amount, currency, and interval source exists.
          </p>
        </div>
        {overviewError && !overview && (
          <ErrorPanel message={overviewError} onRetry={onRetryOverview} />
        )}
        {overview && (
          <div className="space-y-3">
            <SourceStamp generatedAt={overview.generated_at} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                title="Paying accounts"
                note="Paid Stripe records, excluding the free plan."
              >
                <Big>{num(overview.plans.paying)}</Big>
              </Card>
              <Card title="Current paid plan mix">
                {paidPlans.length === 0 ? (
                  <p className="text-sm text-base-content/65">
                    No paid subscriptions.
                  </p>
                ) : (
                  paidPlans.map((row) => (
                    <div
                      key={`${row.plan}-${row.status}-${row.lifetime}`}
                      className="flex justify-between gap-4 border-t border-base-300/50 py-2 first:border-0"
                    >
                      <span className="text-sm">
                        {row.plan}
                        {row.lifetime ? ' · lifetime' : ''} · {row.status}
                      </span>
                      <strong className="tabular-nums">{num(row.count)}</strong>
                    </div>
                  ))
                )}
              </Card>
            </div>
          </div>
        )}
      </section>

      <section
        id="reliability"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="reliability-heading"
      >
        <div>
          <h2 id="reliability-heading" className="text-lg font-semibold">
            Reliability
          </h2>
          <p className="text-sm text-base-content/60">
            Request-based version signals and current service readings. Requests
            are a traffic proxy, not users or installs.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            {versionsError && !versions && (
              <ErrorPanel message={versionsError} onRetry={onRetryVersions} />
            )}
            {loading.versions && !versions && (
              <Loading
                label="version reliability"
                slow={slow.versions}
                onCancel={onCancelVersions}
              />
            )}
            {versions && (
              <div className="space-y-3">
                <SourceStamp generatedAt={versions.generated_at} />
                <Card
                  title="Desktop request mix"
                  note={`${num(versions.unrecognized)} unrecognized requests are excluded from version shares.`}
                >
                  {versions.desktop_total === 0 ? (
                    <p className="text-sm text-base-content/65">
                      No recognized desktop requests in this window.
                    </p>
                  ) : (
                    <>
                      <Big>{pct(versions.current_share)}</Big>
                      <p className="mt-1 text-sm text-base-content/60">
                        of recognized desktop requests came from{' '}
                        {versions.current_release}
                      </p>
                      <div className="mt-3 space-y-2">
                        {versions.versions.slice(0, 5).map((row) => (
                          <p
                            key={row.version}
                            className="flex justify-between gap-3 text-sm"
                          >
                            <span>{row.version}</span>
                            <span className="tabular-nums">
                              {pct(row.error_rate)} errors · {num(row.requests)}{' '}
                              req
                            </span>
                          </p>
                        ))}
                      </div>
                      {versions.platforms.length > 0 && (
                        <div className="mt-4 border-t border-base-300/50 pt-3">
                          <p className="text-xs font-semibold text-base-content/55">
                            Platform request mix
                          </p>
                          {versions.platforms.map((row) => (
                            <p
                              key={row.platform}
                              className="mt-2 flex justify-between gap-3 text-sm"
                            >
                              <span>
                                {platformLabel[row.platform] ?? row.platform}
                              </span>
                              <span className="tabular-nums">
                                {pct(row.share)} · {num(row.requests)} req
                              </span>
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </div>
            )}
          </div>
          <div className="space-y-3">
            {overviewError && !overview && (
              <ErrorPanel message={overviewError} onRetry={onRetryOverview} />
            )}
            {overview && (
              <div className="space-y-3">
                <SourceStamp generatedAt={overview.generated_at} />
                <Card
                  title="Current service readings"
                  note={`${num(overview.connected_now.count)} open SSE connections across ${overview.connected_now.replicas} reporting replicas. Connections are not people.`}
                >
                  {(overview.ingest ?? []).map((row) => {
                    const health = ingestHealth(row)
                    return (
                      <p
                        key={row.table}
                        className="flex justify-between py-1 text-sm"
                      >
                        <span>{row.table}</span>
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
                      </p>
                    )
                  })}
                  <p className="mt-3 border-t border-base-300/50 pt-3 text-sm text-base-content/65">
                    {num(overview.support.open_cases)} open support cases ·{' '}
                    {num(overview.support.pending_drafts)} drafts waiting
                  </p>
                </Card>
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        id="diagnostics"
        className="scroll-mt-6 space-y-3"
        aria-labelledby="diagnostics-heading"
      >
        <div>
          <h2 id="diagnostics-heading" className="text-lg font-semibold">
            Signup diagnostics
          </h2>
          <p className="text-sm text-base-content/60">
            Secondary troubleshooting data: retained Logto registration events
            and safe error categories. Counts are events, not people or
            completed signups.
          </p>
        </div>
        <Selector
          label="Application"
          options={APPLICATIONS}
          value={application}
          onChange={onApplicationChange}
        />
        {signupError && !signup && (
          <ErrorPanel message={signupError} onRetry={onRetrySignup} />
        )}
        {loading.signup && !signup && (
          <Loading
            label="signup diagnostics"
            slow={slow.signup}
            onCancel={onCancelSignup}
          />
        )}
        {signup && (
          <>
            <div className="rounded-xl bg-warning/5 p-4 text-sm ring-1 ring-warning/20">
              <p className="font-semibold">
                {signup.coverage.status === 'partial'
                  ? 'Partial coverage'
                  : 'Coverage limits unknown'}
              </p>
              <p className="mt-1 text-base-content/65">
                {signup.coverage.note}
              </p>
              <p className="mt-2 text-xs text-base-content/50">
                {num(signup.coverage.unique_logs)} unique retained logs scanned
                · generated {new Date(signup.generated_at).toLocaleString()}
              </p>
            </div>
            {eventTotal === 0 ? (
              <p className="rounded-xl p-4 text-sm text-base-content/65 ring-1 ring-base-300/60">
                No recognized registration events were observed. With limited
                coverage, this is not proof of zero activity.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl ring-1 ring-base-300/60">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-base-200/40 text-left text-xs text-base-content/55">
                      <th className="px-4 py-3 font-medium">Path</th>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Count
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Errors
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map((stage) => {
                      const metrics = signup.stages[stage.key] ?? {
                        events: 0,
                        errors: 0,
                      }
                      return (
                        <tr
                          key={stage.key}
                          className="border-t border-base-300/50"
                        >
                          <td className="px-4 py-2 text-base-content/55">
                            {stage.path}
                          </td>
                          <td className="px-4 py-2 font-medium">
                            {stage.label}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {num(metrics.events)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-base-content/60">
                            {num(metrics.errors)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                title="Safe error reasons"
                note="Raw errors, emails, IP addresses, user agents, parameters, and tokens are discarded before this response is built."
              >
                {signup.error_reasons.length === 0 ? (
                  <p className="text-sm text-base-content/65">
                    No recognized registration errors were observed.
                  </p>
                ) : (
                  <ul className="divide-y divide-base-300/50">
                    {signup.error_reasons.map((reason) => (
                      <li
                        key={reason.reason}
                        className="flex justify-between gap-4 py-2 text-sm"
                      >
                        <span>
                          {reasonLabel[reason.reason] ?? 'Other safe category'}
                        </span>
                        <strong className="tabular-nums">
                          {num(reason.count)}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card
                title="Attempt conversion"
                note="A missing later event is not proof of abandonment. Completion and drop-off stay unavailable until correlation and path semantics provide a real denominator."
              >
                <p className="text-sm text-base-content/65">
                  {signup.attempt_conversion.note}
                </p>
              </Card>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default function AnalyticsPage() {
  const getToken = useGetToken()
  const [days, setDays] = useState<ProductAnalyticsWindow>(7)
  const [application, setApplication] =
    useState<AnalyticsApplication>('website')
  const [refresh, setRefresh] = useState(0)

  const overviewLoad = useCallback(
    (signal: AbortSignal) => {
      void refresh
      return loadBoundedAdminReport<AdminOverview>(
        getToken,
        '/admin/overview',
        'Could not load product overview',
        'Product overview took too long. Please retry.',
        signal,
      )
    },
    [getToken, refresh],
  )
  const productLoad = useCallback(
    (signal: AbortSignal) => {
      void refresh
      return loadProductAnalytics(getToken, days, signal)
    },
    [days, getToken, refresh],
  )
  const versionsLoad = useCallback(
    (signal: AbortSignal) => {
      void refresh
      return loadBoundedAdminReport<AdminVersions>(
        getToken,
        `/admin/versions?days=${days}`,
        'Could not load version reliability',
        'Version reliability took too long. Please retry.',
        signal,
      )
    },
    [days, getToken, refresh],
  )
  const signupLoad = useCallback(
    (signal: AbortSignal) => {
      void refresh
      return loadSignupAnalytics(
        getToken,
        application,
        days as AnalyticsWindow,
        signal,
      )
    },
    [application, days, getToken, refresh],
  )

  const overview = useReport(overviewLoad)
  const product = useReport(productLoad)
  const versions = useReport(versionsLoad)
  const signup = useReport(signupLoad)

  return (
    <AnalyticsContent
      overview={overview.data}
      product={product.data}
      versions={versions.data}
      signup={signup.data}
      days={days}
      application={application}
      overviewError={overview.error}
      productError={product.error}
      versionsError={versions.error}
      signupError={signup.error}
      loading={{
        overview: overview.loading,
        product: product.loading,
        versions: versions.loading,
        signup: signup.loading,
      }}
      slow={{
        overview: overview.slow,
        product: product.slow,
        versions: versions.slow,
        signup: signup.slow,
      }}
      onRetryOverview={overview.retry}
      onRetryProduct={product.retry}
      onRetryVersions={versions.retry}
      onRetrySignup={signup.retry}
      onCancelOverview={overview.cancel}
      onCancelProduct={product.cancel}
      onCancelVersions={versions.cancel}
      onCancelSignup={signup.cancel}
      onDaysChange={setDays}
      onApplicationChange={setApplication}
      onRefresh={() => setRefresh((value) => value + 1)}
    />
  )
}
