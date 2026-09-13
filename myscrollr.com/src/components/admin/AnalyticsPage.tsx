import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import {
  Bars,
  Big,
  Card,
  CoverageNote,
  DefinitionDisclosure,
  DeltaBadge,
  LINK,
  Loaded,
  MetricValue,
  PageFrame,
  PeriodSelector,
  RefreshButton,
  Row,
  Section,
  Selector,
  Sparkline,
  StaffExcludedBadge,
  Stamp,
  Stat,
  Unmeasurable,
  num,
  pct,
  useReport,
} from './ui'
import type { KeyboardEvent, ReactNode } from 'react'
import type {
  AnalyticsApplication,
  SignupAnalytics,
} from '@/api/adminAnalytics'
import type {
  Audience,
  BreakdownRow,
  DesktopFilterQuery,
  DesktopUsage,
  Earnings,
  Period,
  PlanMixRow,
  Revenue,
  SupportSummary,
  Website,
  WidgetRow,
} from '@/api/adminDashboard'
import type {
  DailyProductCount,
  RetentionMetric,
} from '@/api/adminProductAnalytics'
import type { AnalyticsView } from '@/lib/adminFormat'
import type { Report } from './ui'
import { loadSignupAnalytics } from '@/api/adminAnalytics'
import {
  loadAudience,
  loadDesktopUsage,
  loadRevenue,
  loadSupportSummary,
  loadWebsite,
} from '@/api/adminDashboard'
import { useGetToken } from '@/hooks/useGetToken'
import {
  ANALYTICS_VIEWS,
  formatHours,
  formatMinor,
  periodLabel,
} from '@/lib/adminFormat'

/**
 * Analytics (SCROLLR-210): four tabs on one period selector.
 *
 * The tab and the period are URL state, so a link names what is on screen
 * and a card on the Overview can point at exactly the view that explains
 * it. Each tab loads only when it is the one on screen; the others cost
 * nothing until picked.
 */

type Token = () => Promise<string | null>

const APPLICATIONS = [
  { value: 'website', label: 'Website' },
  { value: 'desktop', label: 'Desktop app' },
] as const

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

/** The signup log window that fits the period: a week for 24h/7d, else a month. */
export function signupDays(period: Period): 7 | 30 {
  return period === '24h' || period === '7d' ? 7 : 30
}

// ── Page ──────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const getToken = useGetToken()
  const search = useSearch({ from: '/admin/analytics' })
  const navigate = useNavigate({ from: '/admin/analytics' })
  const [refresh, setRefresh] = useState(0)
  const { period, view } = search

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    })

  return (
    <PageFrame>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="mt-1 max-w-3xl text-sm text-base-content/65">
              Growth, desktop usage, revenue and support on one time window.
              Each card names its source and its limits.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PeriodSelector
              value={period}
              onChange={(next) => setSearch({ period: next })}
            />
            <RefreshButton
              onClick={() => setRefresh((n) => n + 1)}
              label="Refresh"
            />
          </div>
        </header>
        <Tabs view={view} onChange={(next) => setSearch({ view: next })} />
        <div
          role="tabpanel"
          id={`panel-${view}`}
          aria-labelledby={`tab-${view}`}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-primary"
        >
          {view === 'growth' && (
            <GrowthTab getToken={getToken} period={period} refresh={refresh} />
          )}
          {view === 'desktop' && (
            <DesktopTab
              getToken={getToken}
              period={period}
              refresh={refresh}
              filters={{
                os: search.os,
                version: search.version,
                plan: search.plan,
              }}
              onFilterChange={(next) => setSearch(next)}
            />
          )}
          {view === 'revenue' && (
            <RevenueTab getToken={getToken} period={period} refresh={refresh} />
          )}
          {view === 'support' && (
            <SupportTab getToken={getToken} period={period} refresh={refresh} />
          )}
        </div>
      </div>
    </PageFrame>
  )
}

/** A WAI-ARIA tab list: arrow keys move, Home/End jump, focus follows. */
export function Tabs({
  view,
  onChange,
}: {
  view: AnalyticsView
  onChange: (view: AnalyticsView) => void
}) {
  const refs = useRef<Partial<Record<AnalyticsView, HTMLButtonElement>>>({})
  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const count = ANALYTICS_VIEWS.length
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % count
        break
      case 'ArrowLeft':
        next = (index - 1 + count) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }
    event.preventDefault()
    const target = ANALYTICS_VIEWS[next].value
    refs.current[target]?.focus()
    onChange(target)
  }
  return (
    <div
      role="tablist"
      aria-label="Analytics sections"
      className="flex gap-1 overflow-x-auto rounded-xl bg-base-200/30 p-1 ring-1 ring-base-300/60"
    >
      {ANALYTICS_VIEWS.map((tab, index) => {
        const selected = tab.value === view
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[tab.value] = el ?? undefined
            }}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-10 shrink-0 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${
              selected
                ? 'bg-base-200 text-base-content'
                : 'text-base-content/70 hover:bg-base-200/60'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Growth ────────────────────────────────────────────────────────

function GrowthTab({
  getToken,
  period,
  refresh,
}: {
  getToken: Token
  period: Period
  refresh: number
}) {
  const [application, setApplication] =
    useState<AnalyticsApplication>('website')
  const audience = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadAudience(getToken, period, signal)
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
  const signup = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadSignupAnalytics(
          getToken,
          application,
          signupDays(period),
          signal,
        )
      },
      [application, getToken, period, refresh],
    ),
  )
  return (
    <GrowthContent
      period={period}
      audience={audience}
      website={website}
      signup={signup}
      application={application}
      onApplicationChange={setApplication}
    />
  )
}

export interface GrowthContentProps {
  period: Period
  audience: Report<Audience>
  website: Report<Website>
  signup: Report<SignupAnalytics>
  application: AnalyticsApplication
  onApplicationChange?: (application: AnalyticsApplication) => void
}

export function GrowthContent({
  period,
  audience,
  website,
  signup,
  application,
  onApplicationChange = () => {},
}: GrowthContentProps) {
  const windowLabel = periodLabel(period)
  const staffExcluded = [audience, website].some((r) => r.data?.staff_excluded)
  return (
    <div className="space-y-8">
      {staffExcluded && <StaffExcludedBadge />}
      <Section
        id="accounts"
        title="Registered users"
        lede="Logto is the system of record. Authentication is not app usage."
      >
        <Loaded report={audience} label="audience">
          {(a) =>
            a.available ? (
              <div className="space-y-3">
                <Stamp at={a.generated_at} />
                <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Card title="Registered accounts" label="Current">
                    <Big>{num(a.total)}</Big>
                    <p className="mt-1 text-sm text-base-content/60">
                      {a.staff_excluded
                        ? `${num(a.excluded)} staff/test excluded`
                        : 'staff included'}
                    </p>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row label="Set up the app" value={num(a.set_up)} />
                    </div>
                  </Card>
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
                  </Card>
                  <Card
                    title="Signed in"
                    label={windowLabel}
                    note="Accounts whose last sign-in falls in the window. Someone using the app on a token that never expired is not counted; this is authentication, not usage."
                  >
                    <MetricValue metric={a.signed_in_in_period}>
                      <p className="mt-1 text-sm text-base-content/60">
                        <DeltaBadge
                          comparison={a.signed_in_in_period.comparison}
                        />
                      </p>
                    </MetricValue>
                  </Card>
                  <Card
                    title="Lifetime registrations"
                    label="Current"
                    note="Only accounts that still exist. Purged accounts are known since local deletion tracking began; anything before that is unknown."
                  >
                    <Big>{num(a.lifetime_registrations)}</Big>
                    <div className="mt-3 border-t border-base-300/60 pt-2">
                      <Row label="Known purged" value={num(a.known_purged)} />
                    </div>
                    <CoverageNote coverage={a.coverage} />
                  </Card>
                </div>
                <DefinitionDisclosure>
                  <p>{a.definition}</p>
                </DefinitionDisclosure>
              </div>
            ) : (
              <Card title="Registered accounts">
                <Unmeasurable note={a.note} />
              </Card>
            )
          }
        </Loaded>
      </Section>

      <Section
        id="website"
        title="Website"
        lede="PostHog pageviews. A visitor is a browser profile merged on sign-in, not guaranteed to be one human."
      >
        <Loaded report={website} label="website analytics">
          {(w) => <WebsiteBlock website={w} windowLabel={windowLabel} />}
        </Loaded>
      </Section>

      <details className="rounded-xl ring-1 ring-base-300/60">
        <summary className="cursor-pointer p-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-primary">
          Signup diagnostics
          <span className="ml-2 text-xs font-normal text-base-content/60">
            secondary · retained Logto registration events, last{' '}
            {signupDays(period)} days
          </span>
        </summary>
        <div className="space-y-3 border-t border-base-300/60 p-4">
          <p className="text-sm text-base-content/60">
            Troubleshooting data: registration events and safe error categories.
            Counts are events, not people or completed signups.
          </p>
          <Selector
            label="Application"
            options={APPLICATIONS}
            value={application}
            onChange={onApplicationChange}
          />
          <Loaded report={signup} label="signup diagnostics">
            {(s) => <SignupBlock signup={s} />}
          </Loaded>
        </div>
      </details>
    </div>
  )
}

function BreakdownTable({
  title,
  rows,
  keyLabel,
  note,
}: {
  title: string
  rows: Array<BreakdownRow> | null
  keyLabel: string
  /** The API's reason when this table could not be read (rows === null). */
  note?: string
}) {
  const list = rows ?? []
  return (
    <Card title={title}>
      {rows === null ? (
        <Unmeasurable note={note ?? 'This breakdown could not be read.'} />
      ) : list.length === 0 ? (
        <p className="text-sm text-base-content/65">Nothing in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-base-content/55">
                <th className="py-1 pr-3 font-medium">{keyLabel}</th>
                <th className="py-1 pr-3 text-right font-medium">Pageviews</th>
                <th className="py-1 text-right font-medium">Visitors</th>
              </tr>
            </thead>
            <tbody>
              {list.map((row) => (
                <tr key={row.key} className="border-t border-base-300/50">
                  <td className="max-w-[16rem] truncate py-1 pr-3">
                    {row.key || '(none)'}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {num(row.pageviews)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {num(row.visitors)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function WebsiteBlock({
  website: w,
  windowLabel,
}: {
  website: Website
  windowLabel: string
}) {
  if (!w.available) {
    return (
      <Card title="Website">
        <Unmeasurable note={w.note} />
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <Stamp at={w.generated_at}>
        {w.cached ? ' · cached PostHog answer' : ''}
      </Stamp>
      <CoverageNote coverage={w.coverage} />
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['Unique visitors', w.visitors],
            ['Pageviews', w.pageviews],
            ['Downloads', w.downloads],
            ['Signups', w.signups],
          ] as const
        ).map(([title, metric]) => (
          <Card key={title} title={title} label={windowLabel}>
            <MetricValue metric={metric}>
              <p className="mt-1 text-sm text-base-content/60">
                <DeltaBadge comparison={metric.comparison} />
              </p>
            </MetricValue>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pageviews per bucket" label={windowLabel}>
          <Bars buckets={w.curve} step={w.curve_step} label="Pageviews" />
        </Card>
        <Card
          title="Visitors per bucket"
          label={windowLabel}
          note="Unique visitors per bucket. Uniques do not add up across buckets; the period total above is one distinct count."
        >
          <Sparkline
            buckets={w.visitors_curve}
            step={w.curve_step}
            label="Visitors per bucket"
          />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="Top paths"
          rows={w.top_paths}
          keyLabel="Path"
          note={w.breakdown_note}
        />
        <BreakdownTable
          title="Top referrers"
          rows={w.top_referrers}
          keyLabel="Referrer"
          note={w.breakdown_note}
        />
        <BreakdownTable
          title="Top campaigns"
          rows={w.top_campaigns}
          keyLabel="Campaign"
          note={w.breakdown_note}
        />
        <BreakdownTable
          title="Downloads by OS"
          rows={w.downloads_by_os}
          keyLabel="OS"
          note={w.breakdown_note}
        />
      </div>
      <DefinitionDisclosure>
        <p>{w.definition}</p>
      </DefinitionDisclosure>
    </div>
  )
}

function SignupBlock({ signup }: { signup: SignupAnalytics }) {
  const eventTotal = Object.values(signup.stages).reduce(
    (sum, stage) => sum + stage.events,
    0,
  )
  return (
    <>
      <div className="rounded-xl bg-warning/5 p-4 text-sm ring-1 ring-warning/20">
        <p className="font-semibold">
          {signup.coverage.status === 'partial'
            ? 'Partial coverage'
            : 'Coverage limits unknown'}
        </p>
        <p className="mt-1 text-base-content/65">{signup.coverage.note}</p>
        <p className="mt-2 text-xs text-base-content/50">
          {num(signup.coverage.unique_logs)} unique retained logs scanned ·
          generated {new Date(signup.generated_at).toLocaleString()}
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
                <th className="px-4 py-3 text-right font-medium">Count</th>
                <th className="px-4 py-3 text-right font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => {
                const metrics = signup.stages[stage.key] ?? {
                  events: 0,
                  errors: 0,
                }
                return (
                  <tr key={stage.key} className="border-t border-base-300/50">
                    <td className="px-4 py-2 text-base-content/55">
                      {stage.path}
                    </td>
                    <td className="px-4 py-2 font-medium">{stage.label}</td>
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
                  <strong className="tabular-nums">{num(reason.count)}</strong>
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
  )
}

// ── Desktop usage ─────────────────────────────────────────────────

function DesktopTab({
  getToken,
  period,
  refresh,
  filters,
  onFilterChange,
}: {
  getToken: Token
  period: Period
  refresh: number
  filters: DesktopFilterQuery
  onFilterChange: (next: DesktopFilterQuery) => void
}) {
  const { os, version, plan } = filters
  const desktop = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadDesktopUsage(getToken, period, { os, version, plan }, signal)
      },
      [getToken, period, refresh, os, version, plan],
    ),
  )
  return (
    <DesktopContent
      period={period}
      desktop={desktop}
      filters={filters}
      onFilterChange={onFilterChange}
    />
  )
}

export interface DesktopContentProps {
  period: Period
  desktop: Report<DesktopUsage>
  filters: DesktopFilterQuery
  onFilterChange?: (next: DesktopFilterQuery) => void
}

type WidgetSort = 'users' | 'user_hours' | 'screen_hours'

const WIDGET_SORTS: ReadonlyArray<{ value: WidgetSort; label: string }> = [
  { value: 'users', label: 'Users' },
  { value: 'user_hours', label: 'User-hours' },
  { value: 'screen_hours', label: 'Screen-hours' },
]

function FilterSelect({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string
  name: string
  options: Array<{ value: string; count: number }>
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const id = `desktop-filter-${name}`
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <span className="text-base-content/60">{label}</span>
      <select
        id={id}
        name={name}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="min-h-10 rounded-lg bg-base-100 px-2 text-sm ring-1 ring-base-300 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({num(option.count)})
          </option>
        ))}
      </select>
    </label>
  )
}

export function DesktopContent({
  period,
  desktop,
  filters,
  onFilterChange = () => {},
}: DesktopContentProps) {
  const windowLabel = periodLabel(period)
  return (
    <div className="space-y-8">
      <Loaded report={desktop} label="desktop usage">
        {(d) => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Stamp at={d.generated_at} />
              {d.staff_excluded && <StaffExcludedBadge />}
              <Link to="/admin/versions" className={LINK}>
                Version adoption and error rates → Versions
              </Link>
            </div>
            <CoverageNote coverage={d.coverage} />
            {((d.filters.os?.length ?? 0) > 0 ||
              (d.filters.version?.length ?? 0) > 0 ||
              (d.filters.plan?.length ?? 0) > 0) && (
              <div className="flex flex-wrap items-center gap-4 rounded-xl bg-base-200/30 p-3 ring-1 ring-base-300/60">
                {(d.filters.os?.length ?? 0) > 0 && (
                  <FilterSelect
                    label="OS"
                    name="os"
                    options={d.filters.os ?? []}
                    value={filters.os}
                    onChange={(os) => onFilterChange({ ...filters, os })}
                  />
                )}
                {(d.filters.version?.length ?? 0) > 0 && (
                  <FilterSelect
                    label="Version"
                    name="version"
                    options={d.filters.version ?? []}
                    value={filters.version}
                    onChange={(version) =>
                      onFilterChange({ ...filters, version })
                    }
                  />
                )}
                {(d.filters.plan?.length ?? 0) > 0 && (
                  <FilterSelect
                    label="Plan (current)"
                    name="plan"
                    options={d.filters.plan ?? []}
                    value={filters.plan}
                    onChange={(plan) => onFilterChange({ ...filters, plan })}
                  />
                )}
                {d.filters.note && (
                  <p className="text-xs text-base-content/60">
                    {d.filters.note}
                  </p>
                )}
              </div>
            )}

            <Section
              id="presence"
              title="Presence"
              lede="App-running and ticker-shown time from the desktop presence reporter (1.6.7+)."
            >
              <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card title="Unique app users" label={windowLabel}>
                  <MetricValue metric={d.unique_users}>
                    <p className="mt-1 text-sm text-base-content/60">
                      <DeltaBadge comparison={d.unique_users.comparison} />
                    </p>
                  </MetricValue>
                </Card>
                {(
                  [
                    ['App-running user-hours', d.user_hours],
                    ['Ticker-shown user-hours', d.ticker_user_hours],
                    ['Ticker screen-hours', d.screen_hours],
                  ] as const
                ).map(([title, metric]) => (
                  <Card key={title} title={title} label={windowLabel}>
                    <MetricValue metric={metric} format={formatHours}>
                      <p className="mt-1 text-sm text-base-content/60">
                        <DeltaBadge
                          comparison={metric.comparison}
                          format={(v) => `${v > 0 ? '+' : ''}${formatHours(v)}`}
                        />
                      </p>
                    </MetricValue>
                  </Card>
                ))}
              </div>
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <Card
                  title="Peak concurrency"
                  label={windowLabel}
                  note={
                    d.peak.available
                      ? `${d.peak.resolution_seconds}-second samples of the live index; a spike shorter than that is not seen.`
                      : undefined
                  }
                >
                  {d.peak.available ? (
                    <>
                      <Big>{num(d.peak.users)}</Big>
                      <p className="mt-1 text-sm text-base-content/60">
                        users at once
                        {d.peak.at
                          ? ` · ${new Date(d.peak.at).toLocaleString()}`
                          : ''}
                      </p>
                      <div className="mt-3 border-t border-base-300/60 pt-2">
                        <Row
                          label="With ticker(s)"
                          value={num(d.peak.ticker_users)}
                        />
                        <Row label="Screens" value={num(d.peak.screens)} />
                      </div>
                    </>
                  ) : (
                    <Unmeasurable note={d.peak.note} />
                  )}
                </Card>
                <Card
                  title="Screens per session"
                  label={windowLabel}
                  note="Sessions are computers. Two ticker windows on one computer are two screens."
                >
                  {(d.screens_per_user ?? []).length === 0 ? (
                    <p className="text-sm text-base-content/65">
                      No sessions in this window.
                    </p>
                  ) : (
                    (d.screens_per_user ?? []).map((b) => (
                      <Row
                        key={b.screens}
                        label={`${b.screens} screen${b.screens === '1' ? '' : 's'}`}
                        value={`${num(b.sessions)} sessions · ${num(b.users)} users`}
                      />
                    ))
                  )}
                </Card>
                <Card title="Users per bucket" label={windowLabel}>
                  <Sparkline
                    buckets={d.users_curve}
                    step={d.curve_step}
                    label="Distinct app-running users per bucket"
                  />
                </Card>
              </div>
              <DefinitionDisclosure>
                <p>{d.definition}</p>
              </DefinitionDisclosure>
            </Section>

            <Section
              id="retention"
              title="Presence retention"
              lede={d.retention.definition}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <RetentionCard metric={d.retention.d1} />
                <RetentionCard metric={d.retention.d7} />
                <RetentionCard metric={d.retention.d30} />
              </div>
            </Section>

            <Section
              id="widgets"
              title="Widget types"
              lede={`Share is of ${num(d.widgets.measured_ticker_users)} measured ticker users in the window.`}
            >
              <WidgetTable widgets={d.widgets} />
              <DefinitionDisclosure>
                <p>{d.widgets.definition}</p>
                <p>{d.widgets.repeat_note}</p>
                <p>{d.widgets.changes_note}</p>
              </DefinitionDisclosure>
            </Section>

            <Section
              id="legacy"
              title="Legacy measurement"
              lede={d.legacy_note}
            >
              {d.legacy ? (
                <LegacyBlock legacy={d.legacy} />
              ) : (
                <p className="text-sm text-base-content/65">
                  The legacy series is not available for this window.
                </p>
              )}
            </Section>
          </>
        )}
      </Loaded>
    </div>
  )
}

function RetentionCard({ metric }: { metric: RetentionMetric }) {
  return (
    <Card title={`Day ${metric.day} retention`}>
      {metric.available ? (
        <>
          <Big>{pct(metric.rate)}</Big>
          <p className="mt-1 text-sm text-base-content/60">
            {num(metric.returned)} of {num(metric.eligible)} mature accounts
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

function WidgetTable({ widgets }: { widgets: DesktopUsage['widgets'] }) {
  const [sort, setSort] = useState<WidgetSort>('users')
  const rows = [...(widgets.rows ?? [])].sort((a, b) => b[sort] - a[sort])
  const categories = widgets.categories ?? []
  if (rows.length === 0 && categories.length === 0) {
    return (
      <p className="rounded-xl p-4 text-sm text-base-content/65 ring-1 ring-base-300/60">
        No widget was displayed on a measured ticker in this window.
      </p>
    )
  }
  const th = 'px-3 py-2 text-right font-medium whitespace-nowrap'
  const td = 'px-3 py-2 text-right tabular-nums'
  return (
    <div className="space-y-3">
      <Selector
        label="Sort widgets by"
        options={WIDGET_SORTS}
        value={sort}
        onChange={setSort}
      />
      <div className="overflow-x-auto rounded-xl ring-1 ring-base-300/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-base-200/40 text-left text-xs text-base-content/55">
              <th className="px-3 py-2 font-medium">Widget</th>
              <th className={th}>Users</th>
              <th className={th}>Share</th>
              <th className={th}>User-hours</th>
              <th className={th}>Screen-hours</th>
              <th className={th}>Repeat users</th>
              <th className={th}>Added / removed</th>
              <th className={th}>Configured / enabled</th>
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr
                key={`category-${c.category}`}
                className="border-t border-base-300/50 bg-base-200/20 font-semibold"
              >
                <td className="px-3 py-2 capitalize">
                  {c.category}{' '}
                  <span className="text-xs font-normal text-base-content/55">
                    {num(c.widgets)} types
                  </span>
                </td>
                <td className={td}>{num(c.users)}</td>
                <td className={td}>{pct(c.share)}</td>
                <td className={td}>{formatHours(c.user_hours)}</td>
                <td className={td}>{formatHours(c.screen_hours)}</td>
                <td className={td}>—</td>
                <td className={td}>—</td>
                <td className={td}>—</td>
                <td className={td}>—</td>
              </tr>
            ))}
            {rows.map((row) => (
              <WidgetTableRow
                key={row.widget_type}
                row={row}
                changesAvailable={widgets.changes_available}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-base-content/60">
        Share: of {num(widgets.measured_ticker_users)} measured ticker users.
        Repeat users show “—” for windows under 7 days.
      </p>
    </div>
  )
}

function WidgetTableRow({
  row,
  changesAvailable,
}: {
  row: WidgetRow
  changesAvailable: boolean
}) {
  const td = 'px-3 py-2 text-right tabular-nums'
  return (
    <tr className="border-t border-base-300/50">
      <td className="px-3 py-2">
        <span className="font-medium">{row.name || row.widget_type}</span>
        <span className="ml-2 text-xs text-base-content/55 capitalize">
          {row.category}
        </span>
      </td>
      <td className={td}>{num(row.users)}</td>
      <td className={td}>{pct(row.share)}</td>
      <td className={td}>{formatHours(row.user_hours)}</td>
      <td className={td}>{formatHours(row.screen_hours)}</td>
      <td className={td}>
        {row.repeat_users === null ? '—' : num(row.repeat_users)}
      </td>
      <td className={td}>
        {changesAvailable ? (
          <>
            +{num(row.added)} / −{num(row.removed)}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className={td}>
        {num(row.configured)} / {num(row.enabled)}
      </td>
      <td className={td}>
        <DeltaBadge comparison={row.comparison} />
      </td>
    </tr>
  )
}

/** The old daily facts, drawn as buckets so the same chart code serves. */
function dailyBuckets(points: Array<DailyProductCount>) {
  return points.map((p) => ({ start: p.day, end: p.day, value: p.count }))
}

function LegacyBlock({
  legacy,
}: {
  legacy: NonNullable<DesktopUsage['legacy']>
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary/5 p-4 text-sm ring-1 ring-primary/20">
        <p>{legacy.population_note}</p>
        <p className="mt-1 text-xs text-base-content/60">
          {legacy.collection_started_at
            ? `Collection began ${new Date(legacy.collection_started_at).toLocaleDateString()}. No history is backfilled.`
            : 'No participating accounts yet.'}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Participating accounts">
          <Big>{num(legacy.enrolled_accounts)}</Big>
        </Card>
        <Card title="Measured daily active">
          <Big>{num(legacy.activity.dau)}</Big>
        </Card>
        <Card title="Measured 7-day active">
          <Big>{num(legacy.activity.wau)}</Big>
        </Card>
        <Card title="Measured 30-day active">
          <Big>{num(legacy.activity.mau)}</Big>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Measured active accounts by day">
          <Sparkline
            buckets={dailyBuckets(legacy.activity.curve)}
            step="24h0m0s"
            label="Measured active accounts by day"
          />
        </Card>
        <Card
          title="First observed ticker use"
          note={legacy.activation.definition}
        >
          <Sparkline
            buckets={dailyBuckets(legacy.activation.curve)}
            step="24h0m0s"
            label="First observed qualifying use by day"
          />
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <RetentionCard metric={legacy.retention.d1} />
        <RetentionCard metric={legacy.retention.d7} />
        <RetentionCard metric={legacy.retention.d30} />
      </div>
    </div>
  )
}

// ── Revenue ───────────────────────────────────────────────────────

function RevenueTab({
  getToken,
  period,
  refresh,
}: {
  getToken: Token
  period: Period
  refresh: number
}) {
  const revenue = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadRevenue(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  return <RevenueContent period={period} revenue={revenue} />
}

export interface RevenueContentProps {
  period: Period
  revenue: Report<Revenue>
}

export function RevenueContent({ period, revenue }: RevenueContentProps) {
  const windowLabel = periodLabel(period)
  return (
    <div className="space-y-8">
      <Loaded report={revenue} label="revenue">
        {(r) => (
          <>
            <Stamp at={r.generated_at} />
            <p className="text-sm text-base-content/65">{r.account_note}</p>
            <Section
              id="paying"
              title="Paying customers"
              lede={r.paying_now.definition}
            >
              <div className="grid items-start gap-4 lg:grid-cols-3">
                <Card
                  title="Paying now"
                  label="Current"
                  note={r.paying_now.available ? r.paying_now_note : undefined}
                >
                  {r.paying_now.available ? (
                    <>
                      <Big>{num(r.paying_now.paying)}</Big>
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
                        <Row
                          label="Canceled"
                          value={num(r.paying_now.canceled)}
                        />
                        <Row label="Free" value={num(r.paying_now.free)} />
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
                </Card>
                <div className="lg:col-span-2">
                  <Card title="Plan mix" label="Current">
                    <PlanMixTable rows={r.paying_now.rows ?? []} />
                  </Card>
                </div>
              </div>
            </Section>

            <Section
              id="new-paying"
              title="New paying customers"
              lede={r.new_paying.definition}
            >
              <Card title="First payments" label={windowLabel}>
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
              </Card>
            </Section>

            <Section
              id="earnings"
              title="Net earnings"
              lede="Stripe balance transactions by created time. Each currency stands alone; nothing is converted or added across currencies."
            >
              {r.earnings.available ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-base-content/60">
                    {r.earnings.fetched_at && (
                      <span>
                        {r.earnings.cached ? 'Cached from' : 'Fetched from'}{' '}
                        Stripe at{' '}
                        {new Date(r.earnings.fetched_at).toLocaleString()}
                      </span>
                    )}
                    {r.earnings.partial && (
                      <span className="font-semibold text-warning">
                        Stripe returned a partial ledger.
                      </span>
                    )}
                  </div>
                  <CoverageNote coverage={r.earnings.coverage} />
                  <div className="grid items-start gap-4 lg:grid-cols-2">
                    <Card
                      title={`Net (${r.earnings.primary_currency.toUpperCase()})`}
                      label={windowLabel}
                    >
                      <MetricValue
                        metric={r.earnings.net}
                        format={(v) =>
                          formatMinor(v, r.earnings.primary_currency)
                        }
                      >
                        <p className="mt-1 text-sm text-base-content/60">
                          <DeltaBadge
                            comparison={r.earnings.net.comparison}
                            format={(v) =>
                              formatMinor(v, r.earnings.primary_currency)
                            }
                          />
                        </p>
                      </MetricValue>
                    </Card>
                    <Card
                      title={`Per bucket (${r.earnings.primary_currency.toUpperCase()}, minor units)`}
                      label={windowLabel}
                    >
                      <Bars
                        buckets={r.earnings.curve}
                        step={r.earnings.curve_step}
                        label="Net earnings per bucket"
                      />
                    </Card>
                  </div>
                  {(r.earnings.currencies ?? []).map((c) => (
                    <EarningsBlock
                      key={c.currency}
                      earnings={c}
                      label={windowLabel}
                    />
                  ))}
                  {(r.earnings.currencies ?? []).length === 0 && (
                    <p className="text-sm text-base-content/65">
                      No balance transactions in this window.
                    </p>
                  )}
                  <div>
                    <h3 className="text-sm font-semibold text-base-content/70">
                      Lifetime
                    </h3>
                    <div className="mt-2 grid gap-4 lg:grid-cols-2">
                      {(r.earnings.lifetime ?? []).map((c) => (
                        <EarningsBlock
                          key={c.currency}
                          earnings={c}
                          label="Lifetime"
                        />
                      ))}
                    </div>
                  </div>
                  <DefinitionDisclosure>
                    <p>{r.earnings.definition}</p>
                  </DefinitionDisclosure>
                </div>
              ) : (
                <Card title="Net earnings">
                  <Unmeasurable note={r.earnings.note} />
                </Card>
              )}
            </Section>
          </>
        )}
      </Loaded>
    </div>
  )
}

function PlanMixTable({ rows }: { rows: Array<PlanMixRow> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-base-content/65">No Stripe records.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-base-content/55">
            <th className="py-1 pr-3 font-medium">Tier</th>
            <th className="py-1 pr-3 font-medium">Interval</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 pr-3 font-medium">Paying</th>
            <th className="py-1 text-right font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.plan}-${row.status}-${row.lifetime}`}
              className="border-t border-base-300/50"
            >
              <td className="py-1 pr-3 capitalize">{row.tier || row.plan}</td>
              <td className="py-1 pr-3">
                {row.lifetime ? 'lifetime' : row.interval || '—'}
              </td>
              <td className="py-1 pr-3">{row.status}</td>
              <td className="py-1 pr-3">{row.paying ? 'yes' : 'no'}</td>
              <td className="py-1 text-right tabular-nums">{num(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EarningsBlock({
  earnings: e,
  label,
}: {
  earnings: Earnings
  label: string
}) {
  const money = (minor: number) => formatMinor(minor, e.currency)
  const lines = [
    ['Payments', e.payments],
    ['Refunds', e.refunds],
    ['Refund reversals', e.refund_reversals],
    ['Disputes', e.disputes],
    ['Fees', e.fees],
  ] as const
  return (
    <Card title={`Earnings in ${e.currency.toUpperCase()}`} label={label}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-base-content/55">
              <th className="py-1 pr-3 font-medium">Line</th>
              <th className="py-1 pr-3 text-right font-medium">Count</th>
              <th className="py-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(([name, line]) => (
              <tr key={name} className="border-t border-base-300/50">
                <td className="py-1 pr-3">{name}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {num(line.count)}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {money(line.net)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-base-300/50 font-semibold">
              <td className="py-1 pr-3">Net</td>
              <td className="py-1 pr-3" />
              <td className="py-1 text-right tabular-nums">{money(e.net)}</td>
            </tr>
            <tr className="border-t border-base-300/50 text-base-content/70">
              <td className="py-1 pr-3">Gross fees (already subtracted)</td>
              <td className="py-1 pr-3" />
              <td className="py-1 text-right tabular-nums">
                {money(e.gross_fees)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {(e.movements ?? []).length > 0 && (
        <div className="mt-3 border-t border-base-300/60 pt-2">
          <p className="text-xs font-semibold text-base-content/60">
            Movements of funds — excluded from net
          </p>
          {(e.movements ?? []).map((m) => (
            <Row
              key={m.kind}
              label={`${m.kind} × ${num(m.count)}`}
              value={money(m.amount)}
            />
          ))}
        </div>
      )}
      {(e.unclassified ?? []).length > 0 && (
        <div className="mt-3 border-t border-base-300/60 pt-2">
          <p className="text-xs font-semibold text-warning">
            Unclassified — excluded from net, needs a rule
          </p>
          {(e.unclassified ?? []).map((m) => (
            <Row
              key={m.kind}
              label={`${m.kind} × ${num(m.count)}`}
              value={money(m.amount)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

// ── Support ───────────────────────────────────────────────────────

function SupportTab({
  getToken,
  period,
  refresh,
}: {
  getToken: Token
  period: Period
  refresh: number
}) {
  const support = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadSupportSummary(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  return <SupportContent period={period} support={support} />
}

export interface SupportContentProps {
  period: Period
  support: Report<SupportSummary>
}

function paying(count: number): ReactNode {
  return count > 0 ? `${num(count)} paying` : undefined
}

export function SupportContent({ period, support }: SupportContentProps) {
  const windowLabel = periodLabel(period)
  return (
    <div className="space-y-8">
      <Loaded report={support} label="support summary">
        {(s) => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Stamp at={s.generated_at} />
              <Link to="/admin/support" className={LINK}>
                Open support →
              </Link>
            </div>
            <Section
              id="queue"
              title="Queue"
              lede="The whole queue as the pipeline classifies it. Paying counts only tickets with a verified account."
            >
              <Card title="Buckets" label="Current" note={s.paying_note}>
                <div className="grid gap-4 sm:grid-cols-4">
                  <Stat
                    label="Needs attention"
                    value={num(s.needs_attention.total)}
                    sub={paying(s.needs_attention.paying)}
                  />
                  <Stat
                    label="Waiting on customer"
                    value={num(s.waiting_on_customer.total)}
                    sub={paying(s.waiting_on_customer.paying)}
                  />
                  <Stat
                    label="Completed"
                    value={num(s.completed.total)}
                    sub={`${num(s.completed_closed)} closed · ${num(s.completed_dismissed)} dismissed${s.completed.paying > 0 ? ` · ${num(s.completed.paying)} paying` : ''}`}
                  />
                  <Stat
                    label="Total"
                    value={num(s.total.total)}
                    sub={paying(s.total.paying)}
                  />
                </div>
                <div className="mt-4 border-t border-base-300/60 pt-2">
                  <Row
                    label="Oldest waiting for us"
                    value={
                      <MetricValue
                        metric={s.oldest_needs_attention_hours}
                        format={(h) => `${num(Math.round(h))} h`}
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
                {s.definitions && Object.keys(s.definitions).length > 0 && (
                  <DefinitionDisclosure summary="Bucket definitions">
                    {Object.entries(s.definitions).map(([key, text]) => (
                      <p key={key}>
                        <strong>{key.replace(/_/g, ' ')}</strong> — {text}
                      </p>
                    ))}
                  </DefinitionDisclosure>
                )}
              </Card>
            </Section>

            <Section
              id="flow"
              title="Created and completed"
              lede={s.history_note}
            >
              <CoverageNote coverage={s.coverage} />
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <Card title="Created" label={windowLabel}>
                  <MetricValue metric={s.created}>
                    <p className="mt-1 text-sm text-base-content/60">
                      <DeltaBadge
                        comparison={s.created.comparison}
                        goodIsDown
                      />
                      {s.paying_created > 0
                        ? ` · ${num(s.paying_created)} from paying customers`
                        : ''}
                    </p>
                  </MetricValue>
                  <div className="mt-3">
                    <Bars
                      buckets={s.created_curve}
                      step={s.curve_step}
                      label="Tickets created per bucket"
                    />
                  </div>
                </Card>
                <Card title="Completed" label={windowLabel}>
                  <MetricValue metric={s.completed_in_period}>
                    <p className="mt-1 text-sm text-base-content/60">
                      <DeltaBadge
                        comparison={s.completed_in_period.comparison}
                      />
                    </p>
                  </MetricValue>
                  <div className="mt-3">
                    <Bars
                      buckets={s.completed_curve}
                      step={s.curve_step}
                      label="Tickets completed per bucket"
                      tone="text-success"
                    />
                  </div>
                </Card>
              </div>
              <Card
                title="Backlog (estimate)"
                label={windowLabel}
                note="Estimated from opened and closed timestamps only; reopenings are not reconstructable, so a past day's backlog is an estimate."
              >
                <Sparkline
                  buckets={s.backlog_curve}
                  step={s.curve_step}
                  label="Estimated open tickets per bucket"
                />
              </Card>
            </Section>

            <Section
              id="speed"
              title="Response and completion"
              lede="Medians over tickets in the window, from retained timestamps. The sample size travels with each figure."
            >
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <Card title="First response, median" label={windowLabel}>
                  <MetricValue
                    metric={s.first_response_median_hours}
                    format={formatHours}
                  >
                    <p className="mt-1 text-sm text-base-content/60">
                      <DeltaBadge
                        comparison={s.first_response_median_hours.comparison}
                        format={(v) => `${v > 0 ? '+' : ''}${formatHours(v)}`}
                        goodIsDown
                      />
                    </p>
                  </MetricValue>
                </Card>
                <Card title="Completion, median" label={windowLabel}>
                  <MetricValue
                    metric={s.completion_median_hours}
                    format={formatHours}
                  >
                    <p className="mt-1 text-sm text-base-content/60">
                      <DeltaBadge
                        comparison={s.completion_median_hours.comparison}
                        format={(v) => `${v > 0 ? '+' : ''}${formatHours(v)}`}
                        goodIsDown
                      />
                    </p>
                  </MetricValue>
                </Card>
              </div>
            </Section>
          </>
        )}
      </Loaded>
    </div>
  )
}
