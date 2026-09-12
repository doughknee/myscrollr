import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Loader2,
  RefreshCw,
  UserX,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Measured } from '@/api/admin'
import type { Bucket, Comparison, Coverage, Period } from '@/api/adminDashboard'
import {
  PERIODS,
  bucketLabel,
  bucketPoints,
  comparisonDisplay,
  measuredValue,
  periodShort,
  sparkline,
} from '@/lib/adminFormat'

/**
 * The staff dashboard's shared primitives (SCROLLR-210).
 *
 * Everything here encodes one promise: a card shows a real number or says it
 * cannot. `MetricValue` and `DeltaBadge` are where that promise lives —
 * unavailable never renders as a number, not comparable never renders as a
 * delta. Pages compose these; they do not re-decide the rule.
 */

// ── Loading a report ──────────────────────────────────────────────

export interface Report<T> {
  data: T | null
  error: string | null
  loading: boolean
  slow?: boolean
  retry?: () => void
  cancel?: () => void
}

/**
 * One bounded load per `load` identity. Changing the period (or the refresh
 * counter) is a new `load`, which aborts the old request and starts over
 * with no stale data on screen.
 */
export function useReport<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<Report<T>>({
    data: null,
    error: null,
    loading: true,
    slow: false,
  })
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setState({ data: null, error: null, loading: true, slow: false })
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
          setState({
            data: null,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load this section',
            loading: false,
            slow: false,
          })
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
      setState({
        data: null,
        error: 'Loading canceled. You can retry.',
        loading: false,
        slow: false,
      })
    },
  }
}

/** The three states of a section, decided once. */
export function Loaded<T>({
  report,
  label,
  children,
}: {
  report: Report<T>
  label: string
  children: (data: T) => ReactNode
}) {
  if (report.data) return <>{children(report.data)}</>
  if (report.error) {
    return <ErrorPanel message={report.error} onRetry={report.retry} />
  }
  return <Loading label={label} slow={report.slow} onCancel={report.cancel} />
}

export function ErrorPanel({
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
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-error/30 hover:bg-error/10 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <RefreshCw size={14} aria-hidden /> Retry
        </button>
      )}
    </div>
  )
}

export function Loading({
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
      {slow && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 min-h-10 cursor-pointer rounded-lg px-3 font-semibold ring-1 ring-base-300 focus-visible:outline-2 focus-visible:outline-primary"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────

export const LINK =
  'rounded text-sm font-semibold text-base-content underline decoration-base-content/30 underline-offset-4 hover:decoration-base-content focus-visible:outline-2 focus-visible:outline-primary'

/**
 * A card. `label` is the window the numbers describe — "Current" for a now
 * figure, "Last 7 days" for a period one — so a reader never has to guess
 * which of the two a number is.
 */
export function Card({
  title,
  label,
  note,
  action,
  children,
}: {
  title: string
  label?: string
  note?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-base-content/65 uppercase">
          {title}
          {label && (
            <span className="ml-2 rounded bg-base-300/50 px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-base-content/60 normal-case">
              {label}
            </span>
          )}
        </h3>
        {action}
      </div>
      <div className="mt-3">{children}</div>
      {note && (
        <p className="mt-4 text-xs leading-relaxed text-base-content/65">
          {note}
        </p>
      )}
    </div>
  )
}

export function Section({
  id,
  title,
  lede,
  action,
  children,
}: {
  id: string
  title: string
  lede?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-6 space-y-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {title}
          </h2>
          {lede && <p className="text-sm text-base-content/60">{lede}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Big({ children }: { children: ReactNode }) {
  return <p className="text-3xl font-bold tabular-nums">{children}</p>
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="truncate text-base-content/60">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** A labelled figure inside a card, for the four-up support buckets. */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div>
      <p className="text-sm text-base-content/70">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-base-content/65">{sub}</p>}
    </div>
  )
}

/** The house style for "we do not have this number." */
export function Unmeasurable({ note }: { note?: string }) {
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
 * A Measured or Metric as the big number — or its note. `available: false`
 * is never a number here, not even zero.
 */
export function MetricValue({
  metric,
  format,
  size = 'big',
  children,
}: {
  metric: Measured | undefined
  format?: (value: number) => string
  size?: 'big' | 'inline'
  /** Rendered under the number, only when there is one. */
  children?: ReactNode
}) {
  const value = measuredValue(metric, format)
  if (value.display === null) return <Unmeasurable note={value.note} />
  if (size === 'inline') {
    return <span className="font-semibold tabular-nums">{value.display}</span>
  }
  return (
    <>
      <Big>{value.display}</Big>
      {children}
      {value.note && (
        <p className="mt-1 text-xs text-base-content/60">{value.note}</p>
      )}
    </>
  )
}

/**
 * A change against the previous window, rendered honestly: a delta only when
 * the API said it is comparable, a percentage only when it sent one, and the
 * reason in every other case. Up is coloured as good; every figure that
 * carries one today is one where up is good.
 */
export function DeltaBadge({
  comparison,
  format,
  goodIsDown = false,
}: {
  comparison: Comparison | undefined
  format?: (value: number) => string
  goodIsDown?: boolean
}) {
  const c = comparisonDisplay(comparison, format)
  if (c.delta === null) {
    return <span className="text-xs text-base-content/65">{c.note}</span>
  }
  const good = goodIsDown ? c.direction === 'down' : c.direction === 'up'
  const tone =
    c.direction === 'flat'
      ? 'text-base-content/65'
      : good
        ? 'text-success'
        : 'text-warning'
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums ${tone}`}
      title="Change against the previous equal-length window"
    >
      {c.direction === 'up' ? (
        <ArrowUp size={12} aria-hidden />
      ) : c.direction === 'down' ? (
        <ArrowDown size={12} aria-hidden />
      ) : null}
      {c.delta}
      {c.pct && <span className="font-normal">({c.pct})</span>}
      <span className="sr-only">versus the previous period</span>
      {c.note && (
        <span className="font-mono text-[10px] font-normal text-base-content/55">
          {c.note}
        </span>
      )}
    </span>
  )
}

// ── Charts ────────────────────────────────────────────────────────

const SPARK_W = 240
const SPARK_H = 56

/** Buckets as an area sparkline. Nothing is summed here — it draws. */
export function Sparkline({
  buckets,
  step,
  label,
  className = 'h-14',
}: {
  buckets: Array<Bucket> | null | undefined
  step: string
  label: string
  className?: string
}) {
  const points = bucketPoints(buckets, step)
  const chart = sparkline(points, SPARK_W, SPARK_H, 4)
  if (!chart || points.length === 0) {
    return (
      <p className="text-sm text-base-content/60">
        No observations in this window.
      </p>
    )
  }
  const partial = (buckets ?? []).some((b) => b.partial)
  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={`w-full text-primary ${className}`}
        role="img"
        aria-label={`${label}: ${points.map((p) => `${p.day} ${p.count}`).join(', ')}`}
      >
        <path d={chart.area} fill="currentColor" opacity={0.12} />
        <path
          d={chart.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={chart.last.x}
          y1={chart.last.y}
          x2={chart.last.x}
          y2={SPARK_H - 4}
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-base-content/65">
        <span>{points[0].day}</span>
        <span>
          peak {chart.peak.toLocaleString()}
          {partial ? ' · edge buckets partial' : ''}
        </span>
        <span>{points[points.length - 1].day}</span>
      </figcaption>
    </figure>
  )
}

/** Buckets as bars — for counts per bucket, where a bar is the honest shape. */
export function Bars({
  buckets,
  step,
  label,
  tone = 'text-primary',
}: {
  buckets: Array<Bucket> | null | undefined
  step: string
  label: string
  tone?: string
}) {
  const rows = buckets ?? []
  if (rows.length === 0) {
    return (
      <p className="text-sm text-base-content/60">
        No observations in this window.
      </p>
    )
  }
  // A real zero baseline: net earnings can be negative in a bucket (a
  // refund-heavy day), and a bar with a negative height is simply not drawn,
  // which would make that day look like nothing happened.
  const peak = Math.max(...rows.map((b) => b.value), 0)
  const min = Math.min(...rows.map((b) => b.value), 0)
  const range = peak - min || 1
  const yOf = (v: number) => SPARK_H - 2 - ((v - min) / range) * (SPARK_H - 4)
  const y0 = yOf(0)
  const partial = rows.some((b) => b.partial)
  const gap = 1
  const w = (SPARK_W - gap * (rows.length - 1)) / rows.length
  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className={`h-14 w-full ${tone}`}
        role="img"
        aria-label={`${label}: ${rows.map((b) => `${bucketLabel(b.start, step)} ${b.value}`).join(', ')}`}
      >
        {rows.map((b, i) => {
          const y1 = yOf(b.value)
          return (
            <rect
              key={b.start}
              x={i * (w + gap)}
              y={Math.min(y0, y1)}
              width={w}
              height={Math.abs(y1 - y0)}
              fill="currentColor"
              className={b.value < 0 ? 'text-warning' : undefined}
              opacity={b.partial ? 0.45 : 0.85}
              data-negative={b.value < 0 ? '' : undefined}
            />
          )
        })}
        {min < 0 && (
          <line
            x1={0}
            x2={SPARK_W}
            y1={y0}
            y2={y0}
            stroke="currentColor"
            strokeWidth={0.5}
            opacity={0.6}
          />
        )}
      </svg>
      <figcaption className="mt-1 flex justify-between gap-2 font-mono text-[10px] text-base-content/65">
        <span>{bucketLabel(rows[0].start, step)}</span>
        <span>
          peak {peak.toLocaleString()}
          {min < 0 ? ` · low ${min.toLocaleString()}` : ''}
          {partial ? ' · edge buckets partial' : ''}
        </span>
        <span>{bucketLabel(rows[rows.length - 1].start, step)}</span>
      </figcaption>
    </figure>
  )
}

// ── Controls ──────────────────────────────────────────────────────

export function Selector<T extends string | number>({
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
          className={`min-h-10 cursor-pointer px-3 text-sm font-medium first:rounded-l-lg last:rounded-r-lg focus-visible:outline-2 focus-visible:outline-primary ${
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

/** The one selector every historical card reads. "Now" cards ignore it. */
export function PeriodSelector({
  value,
  onChange,
}: {
  value: Period
  onChange: (period: Period) => void
}) {
  return (
    <Selector
      label="Time window"
      options={PERIODS.map((p) => ({ value: p, label: periodShort(p) }))}
      value={value}
      onChange={onChange}
    />
  )
}

export function RefreshButton({
  onClick,
  loading,
  label = 'Refresh',
}: {
  onClick?: () => void
  loading?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold ring-1 ring-base-300 transition-colors hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw size={14} aria-hidden />
      )}
      {label}
    </button>
  )
}

// ── Disclosure and badges ─────────────────────────────────────────

/** A definition, a source, a coverage note — folded away, one click from view. */
export function DefinitionDisclosure({
  summary = 'Definition',
  children,
}: {
  summary?: string
  children: ReactNode
}) {
  return (
    <details className="mt-3 border-t border-base-300/60 pt-2 text-xs text-base-content/70">
      <summary className="cursor-pointer py-1 font-semibold focus-visible:outline-2 focus-visible:outline-primary">
        {summary}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </details>
  )
}

/** Coverage, only when it has something to say. */
export function CoverageNote({ coverage }: { coverage: Coverage | undefined }) {
  if (!coverage) return null
  const from = coverage.from
    ? `Measured since ${coverage.from.slice(0, 10)}.`
    : null
  if (!coverage.partial && !coverage.note && !from) return null
  return (
    <p className="text-xs leading-relaxed text-base-content/65">
      {coverage.partial && (
        <span className="mr-1 font-semibold text-warning">
          Partial history —
        </span>
      )}
      {[coverage.note, from].filter(Boolean).join(' ')}
    </p>
  )
}

export function StaffExcludedBadge() {
  return (
    <Link
      to="/admin/settings"
      className="inline-flex items-center gap-1.5 rounded-full bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content/70 ring-1 ring-base-300/60 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      title="Staff and test accounts are excluded from audience and usage figures. Change this in Settings."
    >
      <UserX size={12} aria-hidden /> Staff excluded
    </Link>
  )
}

export function Stamp({ at, children }: { at: string; children?: ReactNode }) {
  return (
    <p className="text-xs text-base-content/50">
      As of {new Date(at).toLocaleString()}
      {children}
    </p>
  )
}

/** "locked 2 · unlocked 5 · unknown 0", for the presence strip. */
export function Breakdown({
  title,
  values,
  order,
}: {
  title: string
  values: Record<string, number> | null | undefined
  order?: ReadonlyArray<string>
}) {
  const keys = order ?? Object.keys(values ?? {}).sort()
  return (
    <div className="rounded-lg bg-base-200/60 px-2.5 py-1.5 text-xs">
      <span className="font-semibold text-base-content/70">{title}</span>{' '}
      <span className="tabular-nums text-base-content/80">
        {keys
          .map((key) => `${key} ${(values?.[key] ?? 0).toLocaleString()}`)
          .join(' · ')}
      </span>
    </div>
  )
}

export const num = (value: number) => value.toLocaleString()
export const pct = (value: number) => `${Math.round(value * 100)}%`
