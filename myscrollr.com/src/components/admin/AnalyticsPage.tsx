import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { SignupTrend } from './SignupTrend'
import { AnalyticsTrend } from './AnalyticsTrend'
import { ReportBoundary } from './ReportBoundary'
import { AnalyticsDetails } from './AnalyticsDetails'
import { AnalyticsStage } from './AnalyticsStage'
import { AnalyticsPanels } from './AnalyticsPanels'
import { AnalyticsWidgetTable } from './AnalyticsWidgetTable'
import './analytics.css'
import {
  Bars,
  Big,
  Card,
  CoverageNote,
  DefinitionDisclosure,
  DeltaBadge,
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
  VERDICT_TONE,
  VerdictPill,
  num,
  pct,
  useReport,
} from './ui'
import type { ReactNode } from 'react'
import type {
  AnalyticsApplication,
  SignupAnalytics,
  Week1ReturnReport,
} from '@/api/adminAnalytics'
import type {
  Audience,
  BreakdownRow,
  DesktopFilterQuery,
  DesktopUsage,
  Earnings,
  Metric,
  Period,
  PlanMixRow,
  Revenue,
  ScreensBucket,
  SupportSummary,
  Website,
} from '@/api/adminDashboard'
import type { RetentionMetric } from '@/api/adminProductAnalytics'
import type { AnalyticsView } from '@/lib/adminFormat'
import type { Verdict } from '@/lib/overviewVerdicts'
import type { Report } from './ui'
import { loadSignupAnalytics, loadWeek1Return } from '@/api/adminAnalytics'
import {
  loadAudience,
  loadDesktopUsage,
  loadRevenue,
  loadSupportSummary,
  loadWebsite,
} from '@/api/adminDashboard'
import { useGetToken } from '@/hooks/useGetToken'
import { planLabel } from '@/lib/supportConsole'
import {
  ANALYTICS_VIEWS,
  formatDuration,
  formatHours,
  formatMinor,
  formatWait,
  periodLabel,
  periodPhrase,
  plural,
  previousPhrase,
} from '@/lib/adminFormat'
import {
  analyticsDesktopVerdict,
  analyticsGrowthVerdict,
  analyticsRevenueVerdict,
  analyticsSupportVerdict,
} from '@/lib/overviewVerdicts'

/**
 * Analytics: four focused views with their own evidence and controls.
 *
 * Each section answers its heading's question in one sentence, with the
 * number that answers it in bold, a chart of the same figure over the period,
 * and the facts that qualify it. Everything the page used to show is still
 * here, one click away under `More detail` — nothing was deleted, it was
 * demoted.
 *
 * The three rules the Overview locked in (SCROLLR-215) hold here too: a
 * number is never rendered when `available` is false, a comparison clause is
 * never written when `comparable` is false, and every verdict comes from
 * `overviewVerdicts.ts` and nowhere else.
 *
 * `?view=` selects the visible workspace. Hidden views retain their controls,
 * while deep links from Overview continue to select the same named view.
 */

const APPLICATIONS = [
  { value: 'website', label: 'Website' },
  { value: 'desktop', label: 'Desktop app' },
] as const

const RefreshStatusContext = createContext<{
  view: AnalyticsView
  message: string
  retry: () => void
} | null>(null)

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
  unknown: 'Unclassified errors',
  verification_code: 'Verification code',
}

/** The signup log window that fits the period: a week for 24h/7d, else a month. */
export function signupDays(period: Period): 7 | 30 {
  return period === '24h' || period === '7d' ? 7 : 30
}
// ── Page ──────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  return <AnalyticsWorkspace />
}

function AnalyticsWorkspace() {
  const getToken = useGetToken()
  const search = useSearch({ from: '/admin/analytics' })
  const navigate = useNavigate({ from: '/admin/analytics' })
  const [refresh, setRefresh] = useState(0)
  const { os, period, plan, version, view } = search
  const populationKey = `${period}:${os ?? ''}:${version ?? ''}:${plan ?? ''}`
  const filtered = Boolean(os || version || plan)

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    })

  const audience = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadAudience(getToken, period, signal, { os, version, plan })
      },
      [getToken, os, period, plan, version],
    ),
    populationKey,
    60_000,
    true,
  )
  const website = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadWebsite(getToken, period, signal)
      },
      [getToken, period],
    ),
    period,
    60_000,
    true,
  )
  const desktop = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadDesktopUsage(getToken, period, { os, version, plan }, signal)
      },
      [getToken, os, period, plan, version],
    ),
    `${period}:${os ?? ''}:${version ?? ''}:${plan ?? ''}`,
    60_000,
    true,
  )
  const [filterOptions, setFilterOptions] = useState<DesktopUsage | null>(null)
  useEffect(() => {
    if (desktop.data) setFilterOptions(desktop.data)
  }, [desktop.data])
  const revenue = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadRevenue(getToken, period, signal, { os, version, plan })
      },
      [getToken, os, period, plan, version],
    ),
    populationKey,
    60_000,
    true,
  )
  const support = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadSupportSummary(getToken, period, signal, {
          os,
          version,
          plan,
        })
      },
      [getToken, os, period, plan, version],
    ),
    populationKey,
    60_000,
    true,
  )
  const week1Return = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadWeek1Return(getToken, signal, { os, version, plan })
      },
      [getToken, os, version, plan],
    ),
    `${os ?? ''}:${version ?? ''}:${plan ?? ''}`,
    60_000,
    true,
  )

  const visibleReports =
    view === 'growth'
      ? [
          { label: 'Accounts', report: audience },
          ...(!filtered ? [{ label: 'Website', report: website }] : []),
          { label: 'Return visits', report: week1Return },
        ]
      : [
          {
            label: {
              desktop: 'Desktop usage',
              revenue: 'Revenue',
              support: 'Support',
            }[view],
            report: { desktop, revenue, support }[view],
          },
        ]
  const retainedReports = visibleReports.filter(
    ({ report }) => report.data && report.error,
  )

  const sectionVerdicts: Record<AnalyticsView, Verdict> = {
    growth: reportVerdict(() => growthVerdict(audience.data)),
    desktop: reportVerdict(() => desktopVerdict(desktop.data)),
    revenue: reportVerdict(() => revenueVerdict(revenue.data)),
    support: reportVerdict(() => supportVerdict(support.data)),
  }

  return (
    <PageFrame>
      <div className="analytics-report">
        <header className="analytics-header">
          <div>
            <h1>Analytics</h1>
            <p>How Scrollr is growing, and how people use it.</p>
          </div>
        </header>
        <div className="analytics-command-bar">
          <SectionNav
            view={view}
            period={period}
            verdicts={sectionVerdicts}
            populationControls={
              <div className="analytics-population-controls">
                <DesktopFilters
                  data={desktop.data ?? filterOptions}
                  filters={{ os, version, plan }}
                  onChange={(next) => void setSearch(next)}
                />
              </div>
            }
            mobilePopulationControls={
              <details
                className="analytics-mobile-filters"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.currentTarget.open = false
                    event.currentTarget.querySelector('summary')?.focus()
                  }
                }}
              >
                <summary>Filters{os || version || plan ? ' •' : ''}</summary>
                <div className="analytics-mobile-filter-panel">
                  <DesktopFilters
                    data={desktop.data ?? filterOptions}
                    filters={{ os, version, plan }}
                    onChange={(next) => void setSearch(next)}
                  />
                </div>
              </details>
            }
            refreshing={
              view === 'growth'
                ? [audience, website, desktop, week1Return].some(
                    (r) => r.loading,
                  )
                : { desktop, revenue, support }[view].loading
            }
            onView={(next) => {
              void setSearch({ view: next })
            }}
            onPeriod={(next) => setSearch({ period: next })}
            onRefresh={() => {
              if (view === 'growth') {
                audience.retry()
                website.retry()
                desktop.retry()
                week1Return.retry()
                setRefresh((n) => n + 1)
              } else if (view === 'desktop') desktop.retry()
              else if (view === 'revenue') revenue.retry()
              else support.retry()
            }}
          />
        </div>
        <RefreshStatusContext.Provider
          value={
            retainedReports.length
              ? {
                  view,
                  message: `Showing saved results. ${retainedReports.map(({ label }) => label).join(', ')} couldn't refresh.`,
                  retry: () =>
                    retainedReports.forEach(({ report }) => report.retry()),
                }
              : null
          }
        >
          <AnalyticsStage
            transitionKey={`${view}:${period}:${os}:${version}:${plan}`}
          >
            <div
              hidden={view !== 'growth'}
              inert={view !== 'growth'}
              aria-hidden={view !== 'growth'}
            >
              <ReportBoundary
                label="Growth"
                resetKeys={[audience.data, website.data, desktop.data]}
                onRetry={() => {
                  audience.retry()
                  website.retry()
                  desktop.retry()
                }}
              >
                <GrowthContent
                  period={period}
                  verdict={sectionVerdicts.growth}
                  audience={audience}
                  website={website}
                  populationFiltered={filtered}
                  desktop={desktop}
                  investigations={
                    <>
                      <ReportBoundary
                        label="Week-1 return"
                        resetKeys={[week1Return.data]}
                        onRetry={week1Return.retry}
                      >
                        <Week1ReturnContent report={week1Return} />
                      </ReportBoundary>
                    </>
                  }
                  diagnostics={
                    <SignupDiagnosticsSection
                      period={period}
                      refresh={refresh}
                      expanded
                    />
                  }
                />
              </ReportBoundary>
            </div>
            <div
              hidden={view !== 'desktop'}
              inert={view !== 'desktop'}
              aria-hidden={view !== 'desktop'}
            >
              <ReportBoundary
                label="Desktop usage"
                resetKeys={[desktop.data]}
                onRetry={desktop.retry}
              >
                <DesktopContent
                  period={period}
                  verdict={sectionVerdicts.desktop}
                  desktop={desktop}
                  filters={{ os, version, plan }}
                  onFilterChange={(next) => setSearch(next)}
                  showFilters={false}
                />
              </ReportBoundary>
            </div>
            <div
              hidden={view !== 'revenue'}
              inert={view !== 'revenue'}
              aria-hidden={view !== 'revenue'}
            >
              <ReportBoundary
                label="Revenue"
                resetKeys={[revenue.data]}
                onRetry={revenue.retry}
              >
                <RevenueContent
                  period={period}
                  verdict={sectionVerdicts.revenue}
                  revenue={revenue}
                />
              </ReportBoundary>
            </div>
            <div
              hidden={view !== 'support'}
              inert={view !== 'support'}
              aria-hidden={view !== 'support'}
            >
              <ReportBoundary
                label="Support"
                resetKeys={[support.data]}
                onRetry={support.retry}
              >
                <SupportContent
                  period={period}
                  verdict={sectionVerdicts.support}
                  support={support}
                />
              </ReportBoundary>
            </div>
          </AnalyticsStage>
        </RefreshStatusContext.Provider>
      </div>
    </PageFrame>
  )
}

/**
 * Week-1 return (SCROLLR-247): the News + first run phase's exit metric, on
 * beside the growth report, with its own time window and data source.
 *
 * No verdict here: `overviewVerdicts.ts` is untouched by design. A cohort
 * younger than 7 days never renders a rate or a returned count, only its
 * (already known) signup count — "not yet available", never 0.
 */
export function Week1ReturnContent({
  report,
}: {
  report: Report<Week1ReturnReport>
}) {
  return (
    <section
      id="week1-return"
      className="analytics-retention"
      aria-labelledby="week1-return-heading"
    >
      <div className="analytics-retention-intro">
        <span className="analytics-scope">
          Weekly signup cohorts · independent of time window
        </span>
        <h2 id="week1-return-heading">Do new users come back?</h2>
        <p>
          Week-1 return tracks new desktop signups who came back on their own in
          the following week.
        </p>
      </div>
      <Loaded report={report} label="week-1 return">
        {(data) => {
          // The API's integer omitempty omits a measured zero return count.
          // Only an explicit zero rate establishes zero; absent data stays unknown.
          const cohorts = data.cohorts.map((cohort) => ({
            ...cohort,
            returned:
              cohort.returned ??
              (cohort.mature && cohort.rate_pct === 0 ? 0 : undefined),
          }))
          const matured = [...cohorts].reverse().find((c) => c.mature)
          return (
            <div className="analytics-retention-data">
              <div className="analytics-retention-summary">
                <div>
                  <p className="analytics-scope">
                    Most recently matured cohort
                  </p>
                  <strong className="analytics-return-rate">
                    {matured?.rate_pct !== undefined
                      ? `${Math.round(matured.rate_pct)}%`
                      : '—'}
                  </strong>
                  <p>
                    {matured
                      ? `${matured.returned === undefined ? 'Unknown' : num(matured.returned)} of ${num(matured.signups)} returned`
                      : 'No weekly cohort has matured yet.'}
                  </p>
                  {matured && (
                    <p className="analytics-scope">
                      Week of {matured.week_start}
                    </p>
                  )}
                </div>
                <div
                  className="analytics-cohort-bars"
                  aria-label="Weekly cohort return rates"
                >
                  {cohorts.map((cohort) => (
                    <div key={cohort.week_start}>
                      <span>
                        {cohort.mature && cohort.rate_pct !== undefined
                          ? `${Math.round(cohort.rate_pct)}%`
                          : cohort.mature
                            ? 'Unavailable'
                            : 'Pending'}
                      </span>
                      <div
                        className="analytics-cohort-track"
                        aria-hidden="true"
                      >
                        <span
                          style={{
                            height:
                              cohort.mature && cohort.rate_pct !== undefined
                                ? `${cohort.rate_pct}%`
                                : '0%',
                          }}
                        />
                      </div>
                      <span>
                        {cohort.week_start.slice(5).replace('-', '/')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <details className="analytics-cohort-detail">
                <summary>Explore weekly cohorts</summary>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th scope="col">Week (UTC)</th>
                        <th scope="col">Signups</th>
                        <th scope="col">Returned</th>
                        <th scope="col">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohorts.map((cohort) => (
                        <tr key={cohort.week_start}>
                          <th scope="row">
                            {cohort.week_start} – {cohort.week_end}
                          </th>
                          <td>{num(cohort.signups)}</td>
                          <td>
                            {cohort.mature && cohort.returned !== undefined
                              ? num(cohort.returned)
                              : '—'}
                          </td>
                          <td>
                            {cohort.mature && cohort.rate_pct !== undefined
                              ? `${Math.round(cohort.rate_pct)}%`
                              : cohort.mature
                                ? 'Unavailable'
                                : 'Not yet available'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <DefinitionDisclosure>{data.definition}</DefinitionDisclosure>
              </details>
              <Stamp at={data.generated_at} />
            </div>
          )
        }}
      </Loaded>
    </section>
  )
}

/**
 * Compact section navigation and period controls. Inactive sections stay
 * mounted but hidden, retaining their local investigation state.
 */
export function SectionNav({
  view,
  period,
  verdicts,
  onView,
  onPeriod,
  onRefresh,
  refreshing = false,
  populationControls,
  mobilePopulationControls,
}: {
  view: AnalyticsView
  period: Period
  verdicts: Record<AnalyticsView, Verdict>
  onView: (view: AnalyticsView) => void
  onPeriod: (period: Period) => void
  onRefresh?: () => void
  refreshing?: boolean
  populationControls?: ReactNode
  mobilePopulationControls?: ReactNode
}) {
  return (
    <nav aria-label="Analytics sections" className="analytics-nav">
      <div className="analytics-nav-links">
        {ANALYTICS_VIEWS.map((section) => {
          const current = section.value === view
          const tone = VERDICT_TONE[verdicts[section.value].tone]
          return (
            <button
              key={section.value}
              type="button"
              onClick={() => onView(section.value)}
              aria-label={section.label}
              aria-current={current ? 'true' : undefined}
              className={
                current
                  ? 'flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-base-200 px-2.5 py-2 text-left text-[13px] font-semibold text-base-content focus-visible:outline-2 focus-visible:outline-primary'
                  : 'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-base-content/60 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary'
              }
            >
              <span className="truncate">
                {section.value === 'desktop' ? (
                  <>
                    <span className="analytics-tab-long">Desktop usage</span>
                    <span className="analytics-tab-short" aria-hidden>
                      Desktop
                    </span>
                  </>
                ) : (
                  section.label
                )}
              </span>
              <span
                className={`size-2 shrink-0 rounded-full ${tone.dot}`}
                aria-hidden
              />
            </button>
          )
        })}
      </div>
      <div className="analytics-nav-controls">
        <div className="analytics-control-scroll">
          <div className="analytics-period-buttons">
            <PeriodSelector value={period} onChange={onPeriod} />
          </div>
          <select
            className="analytics-mobile-period"
            aria-label="Time window"
            value={period}
            onChange={(event) => onPeriod(event.target.value as Period)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="lifetime">Lifetime</option>
          </select>
          {populationControls}
          {mobilePopulationControls}
        </div>
        {onRefresh && (
          <RefreshButton
            onClick={onRefresh}
            loading={refreshing}
            label="Refresh"
          />
        )}
      </div>
    </nav>
  )
}

// ── Verdict inputs ────────────────────────────────────────────────

/**
 * Each section's verdict is the Overview's own rule read on the selected
 * period, so all these do is name which figure the rule is about. A report
 * that has not arrived, or a metric the API marked unavailable, is `null` —
 * `overviewVerdicts` then returns grey rather than judging a number it does
 * not have.
 */

function reportVerdict(read: () => Verdict): Verdict {
  try {
    return read()
  } catch {
    // ReportBoundary supplies recovery in that view. A hidden malformed
    // report must not throw here before its boundary can isolate it.
    return { tone: 'none', label: 'Unavailable' }
  }
}

function trendInput(metric: Metric | undefined) {
  if (!metric || !metric.available) return null
  return {
    available: true,
    value: metric.value,
    previous: metric.comparison.previous ?? 0,
    comparable: metric.comparison.comparable,
  }
}

function growthVerdict(audience: Audience | null): Verdict {
  return analyticsGrowthVerdict(
    audience && audience.available ? trendInput(audience.new) : null,
  )
}

/** Desktop usage is judged on app user-hours, not on head count. */
function desktopVerdict(desktop: DesktopUsage | null): Verdict {
  return analyticsDesktopVerdict(
    desktop ? trendInput(desktop.user_hours) : null,
  )
}

function revenueVerdict(revenue: Revenue | null): Verdict {
  if (!revenue) return analyticsRevenueVerdict(null)
  const { earnings, new_paying, paying_now } = revenue
  return analyticsRevenueVerdict({
    available: earnings.available && earnings.net.available,
    past_due: paying_now.available ? paying_now.past_due : 0,
    new_paying_today: new_paying.in_period.available
      ? new_paying.in_period.value
      : 0,
    net_today: earnings.net.available ? earnings.net.value : 0,
  })
}

function supportVerdict(support: SupportSummary | null): Verdict {
  return analyticsSupportVerdict(
    support ? { open_cases: support.needs_attention.total } : null,
  )
}

// ── One section, one question ─────────────────────────────────────

/**
 * A row in a section's fact list. `value: null` is the honest-failure case —
 * it renders "unknown", never a zero — and the section's note is where the
 * reason is spelled out.
 */
export interface Fact {
  label: string
  value: string | null
}

/** Keep the reported value intact while giving its unit a quieter visual weight. */
function MetricText({ value }: { value: string | null }) {
  const parts = value?.match(/^(.*) ([A-Z]{3}|h)$/)
  return parts ? (
    <>
      {parts[1]}
      <span className="analytics-metric-unit"> {parts[2]}</span>
    </>
  ) : (
    <>{value ?? 'unknown'}</>
  )
}

/**
 * A section: the question, the verdict, one sentence with the number that
 * answers it, one chart, the facts, and a note about what the numbers do and
 * do not cover. `children` is everything the tab used to show, folded away.
 */
function Question({
  id,
  title,
  question,
  verdict,
  sentence,
  chart,
  facts,
  note,
  updatedAt,
  children,
  toolbar,
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  sentence: ReactNode
  chart: ReactNode
  facts: Array<Fact>
  note: string
  updatedAt?: string
  toolbar?: ReactNode
  children?: ReactNode
}) {
  return (
    <QuestionShell
      id={id}
      title={title}
      question={question}
      verdict={verdict}
      info={
        <AnalyticsDetails compact title={`${title}: measurements`}>
          <section>
            <p className="analytics-method">{note}</p>
            {updatedAt && <Stamp at={updatedAt} />}
          </section>
        </AnalyticsDetails>
      }
    >
      {toolbar}
      <div className="analytics-overview">
        <div className="analytics-key-numbers">
          <dl>
            {facts.slice(0, 3).map((fact, index) => (
              <div
                key={fact.label}
                className={
                  index === 0
                    ? 'analytics-primary-number'
                    : 'analytics-support-number'
                }
              >
                <dt>{fact.label}</dt>
                <dd>
                  <MetricText value={fact.value} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="sr-only">{sentence}</p>
        </div>
        <div className="analytics-chart">{chart}</div>
      </div>

      {facts.length > 3 && (
        <dl className="analytics-signals">
          {facts.slice(3, 6).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value ?? 'unknown'}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </QuestionShell>
  )
}

/** The question and the verdict, with anything at all under them. */
function QuestionShell({
  id,
  title,
  question,
  verdict,
  children,
  info,
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  info?: ReactNode
  children: ReactNode
}) {
  const refreshStatus = useContext(RefreshStatusContext)
  const saved = refreshStatus?.view === id ? refreshStatus : null
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="analytics-question"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2
          ref={heading}
          tabIndex={-1}
          id={`${id}-heading`}
          className="analytics-question-heading"
        >
          {title}
          <span>{question}</span>
        </h2>
        <div className="analytics-heading-actions">
          {id === 'desktop' && (
            <span className="analytics-verdict-context">App hours</span>
          )}
          {saved ? (
            <span role="status" className="analytics-refresh-notice">
              <button
                type="button"
                onClick={() => {
                  heading.current?.focus({ preventScroll: true })
                  saved.retry()
                }}
                title={saved.message}
                aria-label={`${saved.message} Retry`}
              >
                Saved results · Retry
              </button>
            </span>
          ) : (
            <VerdictPill verdict={verdict} />
          )}
          {info}
        </div>
      </div>
      {children}
    </section>
  )
}

/**
 * A section whose headline number cannot be shown: the question and the
 * verdict still stand, the sentence says so, and the source's own reason is
 * the only thing under it. A report that has not arrived yet shows its
 * loading or error state instead — "we cannot say" is a measurement, not a
 * spinner.
 */
function CannotSay({
  id,
  title,
  question,
  verdict,
  report,
  label,
  note,
  toolbar,
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  report: Report<unknown>
  label: string
  note?: string
  toolbar?: ReactNode
}) {
  return (
    <QuestionShell id={id} title={title} question={question} verdict={verdict}>
      {toolbar}
      {report.data ? (
        <>
          <p className="max-w-[900px] text-2xl leading-[1.3] font-semibold tracking-[-0.015em]">
            {CANNOT_SAY}
          </p>
          {note && (
            <p className="max-w-[900px] text-[13px] text-base-content/45">
              {note}
            </p>
          )}
        </>
      ) : (
        <Loaded report={report} label={label}>
          {() => null}
        </Loaded>
      )}
    </QuestionShell>
  )
}

/** The headline number inside a sentence. Coloured only when it is a warning. */
function Headline({
  verdict,
  children,
}: {
  verdict: Verdict
  children: ReactNode
}) {
  return (
    <b className={`font-bold ${VERDICT_TONE[verdict.tone].number}`}>
      {children}
    </b>
  )
}

/** What a section says instead of a number it does not have. */
export const CANNOT_SAY = 'We cannot say yet.'

function FactList({ facts }: { facts: Array<Fact> }) {
  return (
    <dl className="analytics-facts">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex items-baseline justify-between gap-4 border-t border-base-300/50 py-2 text-[13px]"
        >
          <dt className="min-w-0 text-base-content/65">{fact.label}</dt>
          <dd
            className={
              fact.value === null
                ? 'shrink-0 text-base-content/40'
                : 'shrink-0 font-mono font-medium tabular-nums'
            }
          >
            {fact.value ?? 'unknown'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Everything a section used to show, one click away and closed by default. */
function MoreDetail({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return <AnalyticsDetails title={title}>{children}</AnalyticsDetails>
}

/** A Metric as a fact value: a formatted number, or null when unavailable. */
function factOf(
  metric: Metric | undefined,
  format: (value: number) => string = num,
): string | null {
  return metric && metric.available ? format(metric.value) : null
}

/** The previous window's figure, and only when the API says it compares. */
function previousFact(
  period: Period,
  metric: Metric | undefined,
  format: (value: number) => string = num,
): Array<Fact> {
  const previous = previousPhrase(period)
  const comparison = metric?.comparison
  if (
    !previous ||
    !comparison?.comparable ||
    comparison.previous === undefined
  ) {
    return []
  }
  return [
    {
      label: `${previous[0].toUpperCase()}${previous.slice(1)}`,
      value: format(comparison.previous),
    },
  ]
}

/** ", down from 31 the week before" — dropped entirely when not comparable. */
function comparisonClause(
  period: Period,
  metric: Metric | undefined,
  format: (value: number) => string = num,
): string {
  const previous = previousPhrase(period)
  const comparison = metric?.comparison
  if (
    !metric ||
    !previous ||
    !comparison?.comparable ||
    comparison.previous === undefined
  ) {
    return ''
  }
  if (metric.value === comparison.previous) {
    return `, the same as ${previous}`
  }
  const direction = metric.value < comparison.previous ? 'down' : 'up'
  return `, ${direction} from ${format(comparison.previous)} ${previous}`
}

// ── Growth ────────────────────────────────────────────────────────

export interface GrowthContentProps {
  period: Period
  verdict: Verdict
  audience: Report<Audience>
  website: Report<Website>
  desktop: Report<DesktopUsage>
  investigations?: ReactNode
  diagnostics?: ReactNode
  populationFiltered?: boolean
}

const GROWTH_QUESTION = 'Are new people showing up, and do they stick?'

/**
 * "Signed up from the desktop app" reads Logto's own applicationId, so it is a
 * fact about the same population as the total rather than a PostHog count
 * subtracted from a Logto count. Return visits have their own cohort report.
 */
const GROWTH_NOTE =
  'Sign-ups are counted from Logto. Each report states whether staff are excluded. "Finished setting up" means the account saved at least one widget. "Signed up from the desktop app" is the Logto application the account registered through; accounts with none recorded are neither. Sign-ups on the website are PostHog events on the site, a different count from Logto accounts.'

export function GrowthContent(props: GrowthContentProps) {
  const { audience, website, period, investigations, diagnostics } = props
  return (
    <>
      <GrowthOverview {...props} />
      <MoreDetail title="Acquisition details">
        <AnalyticsPanels
          panels={[
            {
              label: 'Accounts',
              content: (
                <Loaded report={audience} label="registered accounts">
                  {(a) =>
                    a.available ? (
                      <Section id="accounts" title="From signup to setup">
                        <FactList
                          facts={[
                            {
                              label: 'Current accounts',
                              value: num(a.total),
                            },
                            {
                              label: 'Finished setting up the app',
                              value: num(a.set_up),
                            },
                            {
                              label: 'Never finished setting up',
                              value: num(Math.max(a.total - a.set_up, 0)),
                            },
                            {
                              label: `New accounts ${periodPhrase(period)}`,
                              value: factOf(a.new),
                            },
                            {
                              label: 'Signed up from the desktop app',
                              value: a.signup_source.available
                                ? num(a.signup_source.desktop)
                                : null,
                            },
                            {
                              label: `Signed in ${periodPhrase(period)}`,
                              value: factOf(a.signed_in_in_period),
                            },
                            {
                              label: 'Lifetime registrations',
                              value: num(a.lifetime_registrations),
                            },
                            {
                              label: 'Known deleted accounts',
                              value:
                                a.population &&
                                Object.values(a.population).some(Boolean)
                                  ? null
                                  : num(a.known_purged),
                            },
                          ]}
                        />
                        <DefinitionDisclosure summary="Sources and counting rules">
                          <p>{GROWTH_NOTE}</p>
                          <p>{a.definition}</p>
                          <DeltaBadge comparison={a.new.comparison} />
                          <CoverageNote coverage={a.coverage} />
                          <p>
                            Sign-ins measure authentication, not usage. A
                            running app with a valid token does not need to sign
                            in again.
                          </p>
                          {a.staff_excluded && <StaffExcludedBadge />}
                        </DefinitionDisclosure>
                        <Stamp at={a.generated_at} />
                      </Section>
                    ) : (
                      <Unmeasurable note={a.note ?? GROWTH_NOTE} />
                    )
                  }
                </Loaded>
              ),
            },
            {
              label: 'Website',
              content: props.populationFiltered ? (
                <Unmeasurable note="Website visits are anonymous and cannot be linked to this account population. Clear filters to inspect website acquisition." />
              ) : (
                <Section id="website" title="Website acquisition">
                  <FactList
                    facts={[
                      {
                        label: 'Signed up on the website',
                        value: website.data?.available
                          ? factOf(website.data.signups)
                          : null,
                      },
                    ]}
                  />
                  <Loaded report={website} label="website analytics">
                    {(w) => (
                      <WebsiteBlock
                        website={w}
                        windowLabel={periodLabel(period)}
                      />
                    )}
                  </Loaded>
                </Section>
              ),
            },
            ...(investigations
              ? [{ label: 'Return visits', content: investigations }]
              : []),
            ...(diagnostics
              ? [{ label: 'Signup health', content: diagnostics, lazy: true }]
              : []),
          ]}
        />
      </MoreDetail>
    </>
  )
}

function GrowthOverview({
  period,
  verdict,
  audience,
  website,
}: GrowthContentProps) {
  const a = audience.data
  const w = website.data

  if (!a || !a.available || !a.new.available) {
    return (
      <CannotSay
        id="growth"
        title="Growth"
        question={GROWTH_QUESTION}
        verdict={verdict}
        report={audience}
        label="audience"
        note={a?.note ?? a?.new.note ?? GROWTH_NOTE}
      />
    )
  }

  const sentence = (
    <>
      <Headline verdict={verdict}>
        {plural(a.new.value, 'person', 'people')}
      </Headline>{' '}
      signed up {periodPhrase(period)}
      {comparisonClause(period, a.new)}. {num(a.set_up)} of {num(a.total)}{' '}
      accounts have finished setting up.
    </>
  )

  const facts: Array<Fact> = [
    {
      label: `Signed up ${periodPhrase(period)}`,
      value: factOf(a.new),
    },
    ...previousFact(period, a.new),
    { label: 'Accounts in total', value: num(a.total) },
    { label: 'Finished setting up · current accounts', value: num(a.set_up) },
    {
      label: 'Never finished setting up · current accounts',
      value: num(Math.max(a.total - a.set_up, 0)),
    },
    {
      label: 'Signed up from the desktop app',
      value: a.signup_source.available ? num(a.signup_source.desktop) : null,
    },
    {
      label: 'Signed up on the website',
      value: w && w.available ? factOf(w.signups) : null,
    },
    {
      label: 'Deleted their account',
      value:
        a.population && Object.values(a.population).some(Boolean)
          ? null
          : num(a.known_purged),
    },
  ]

  return (
    <Question
      id="growth"
      title="Growth"
      question={GROWTH_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={<SignupTrend buckets={a.new_curve} step={a.curve_step} />}
      facts={facts}
      note={[GROWTH_NOTE, a.definition].filter(Boolean).join(' ')}
      updatedAt={a.generated_at}
    />
  )
}

/**
 * The signup diagnostics, secondary and folded, at the foot of the page. The
 * report is the slowest on the page and the least visited (SCROLLR-329), so
 * nothing is requested until the disclosure is opened; once opened, the
 * report stays mounted and keeps its result for the session.
 */
export function SignupDiagnosticsSection({
  period,
  refresh = 0,
  expanded = false,
}: {
  period: Period
  refresh?: number
  expanded?: boolean
}) {
  const [opened, setOpened] = useState(expanded)
  const [application, setApplication] =
    useState<AnalyticsApplication>('desktop')
  return opened ? (
    <OpenedSignupDiagnostics
      period={period}
      refresh={refresh}
      application={application}
      onApplicationChange={setApplication}
      embedded={expanded}
    />
  ) : (
    <SignupDiagnostics
      period={period}
      signup={null}
      application={application}
      onApplicationChange={setApplication}
      onOpen={() => setOpened(true)}
    />
  )
}

function OpenedSignupDiagnostics({
  period,
  refresh,
  application,
  onApplicationChange,
  embedded,
}: {
  period: Period
  embedded?: boolean
  refresh: number
  application: AnalyticsApplication
  onApplicationChange: (application: AnalyticsApplication) => void
}) {
  const getToken = useGetToken()
  const days = signupDays(period)
  const signup = useReport(
    useCallback(
      (signal: AbortSignal) => {
        return loadSignupAnalytics(getToken, application, days, signal)
      },
      [application, getToken, days],
    ),
    `${application}:${days}`,
    5 * 60_000,
    true,
  )
  const retryRef = useRef(signup.retry)
  retryRef.current = signup.retry
  const lastRefresh = useRef(refresh)
  useEffect(() => {
    if (lastRefresh.current === refresh) return
    lastRefresh.current = refresh
    retryRef.current()
  }, [refresh])
  const pollStarted = useRef(0)
  const [pollExpired, setPollExpired] = useState(false)
  useEffect(() => {
    pollStarted.current = Date.now()
    setPollExpired(false)
  }, [application, period, refresh])
  useEffect(() => {
    if (!signup.data?.refreshing || signup.loading) return
    if (Date.now() - pollStarted.current > 45_000) {
      setPollExpired(true)
      return
    }
    const timer = window.setTimeout(() => retryRef.current(), 2_000)
    return () => window.clearTimeout(timer)
  }, [signup.data, signup.loading])
  return (
    <ReportBoundary
      label="Signup diagnostics"
      resetKeys={[signup.data]}
      onRetry={signup.retry}
    >
      <SignupDiagnostics
        open
        period={period}
        signup={{
          ...signup,
          retry: () => {
            pollStarted.current = Date.now()
            setPollExpired(false)
            signup.retry()
          },
          data:
            signup.data && pollExpired
              ? {
                  ...signup.data,
                  refreshing: false,
                  reason:
                    'The first scan is still being prepared. Retry to check for its result.',
                }
              : signup.data,
        }}
        application={application}
        onApplicationChange={onApplicationChange}
        embedded={embedded}
      />
    </ReportBoundary>
  )
}

export function SignupDiagnostics({
  period,
  signup,
  application,
  onApplicationChange = () => {},
  open,
  onOpen,
  embedded = false,
}: {
  period: Period
  /** null until the disclosure has been opened: nothing is fetched before. */
  signup: Report<SignupAnalytics> | null
  application: AnalyticsApplication
  onApplicationChange?: (application: AnalyticsApplication) => void
  open?: boolean
  onOpen?: () => void
  embedded?: boolean
}) {
  const body = (
    <div
      className={
        embedded
          ? 'mt-5 space-y-4'
          : 'space-y-3 border-t border-base-300/60 p-4'
      }
    >
      <p className="analytics-detail-caption">
        Registration events, not people or completed signups. OS, version and
        plan filters do not apply to these pre-account logs.
      </p>
      <div className="analytics-diagnostic-controls">
        <Selector
          label="Application"
          options={APPLICATIONS}
          value={application}
          onChange={onApplicationChange}
        />
        {signup?.retry && (
          <RefreshButton
            label="Refresh diagnostics"
            onClick={signup.retry}
            loading={signup.loading}
          />
        )}
      </div>
      {signup && (
        <Loaded report={signup} label="signup diagnostics">
          {(s) => (
            <>
              {s.stale && (
                <p role="status" className="mb-3 text-xs text-base-content/60">
                  Showing the last successful read <Stamp at={s.generated_at} />
                  {s.refreshing
                    ? ' · Updating in the background'
                    : ' · Latest refresh unavailable; retry to check again'}
                </p>
              )}
              <SignupBlock signup={s} />
            </>
          )}
        </Loaded>
      )}
    </div>
  )
  if (embedded)
    return (
      <section aria-label="Signup diagnostics">
        <h3 className="text-lg font-semibold">Signup health</h3>
        <p className="mt-1 text-xs text-base-content/60">
          Authentication logs · last {signupDays(period)} days
        </p>
        {body}
      </section>
    )
  return (
    <details
      className="rounded-xl ring-1 ring-base-300/60"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.()
      }}
    >
      <summary className="cursor-pointer p-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-primary">
        Signup diagnostics{' '}
        <span className="ml-2 text-xs font-normal text-base-content/60">
          Troubleshoot registration · last {signupDays(period)} days
        </span>
      </summary>
      {body}
    </details>
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
          <table className="analytics-breakdown-table w-full text-sm">
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
                  <td className="py-1 pr-3" title={row.key || '(none)'}>
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
      {w.coverage.partial && <CoverageNote coverage={w.coverage} />}
      <p className="analytics-detail-caption">{windowLabel}</p>
      <div className="analytics-stat-grid">
        {(
          [
            ['Unique visitors', w.visitors],
            ['Pageviews', w.pageviews],
            ['Downloads', w.downloads],
            ['Signups', w.signups],
          ] as const
        ).map(([title, metric]) => (
          <Card key={title} title={title}>
            <MetricValue
              metric={
                metric.available ? { ...metric, note: undefined } : metric
              }
            >
              <p className="mt-1 text-sm text-base-content/60">
                {metric.comparison.comparable ? (
                  <DeltaBadge comparison={metric.comparison} />
                ) : (
                  <span className="text-xs">No comparable period</span>
                )}
              </p>
            </MetricValue>
          </Card>
        ))}
      </div>
      <p className="analytics-detail-caption">
        Downloads count button clicks, not installs. Signups are website events
        reported to PostHog.
      </p>
      <DefinitionDisclosure summary="Metric definitions and coverage">
        <p>{w.definition}</p>
        <CoverageNote coverage={w.coverage} />
        {(
          [
            ['Unique visitors', w.visitors],
            ['Pageviews', w.pageviews],
            ['Downloads', w.downloads],
            ['Signups', w.signups],
          ] as const
        ).map(
          ([title, metric]) =>
            (metric.note || metric.comparison.note) && (
              <p key={title}>
                <strong>{title}:</strong>{' '}
                {[metric.note, metric.comparison.note]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            ),
        )}
      </DefinitionDisclosure>
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
    </div>
  )
}

function SignupBlock({ signup }: { signup: SignupAnalytics }) {
  if (!signup.available && signup.refreshing)
    return (
      <p role="status" className="py-6 text-sm text-base-content/60">
        Preparing signup health… Results appear here automatically. You can keep
        using Analytics.
      </p>
    )
  if (!signup.available) {
    return (
      <Unmeasurable
        note={`Signup diagnostics are unavailable right now. ${signup.reason ?? ''}`.trim()}
      />
    )
  }
  const eventTotal = Object.values(signup.stages).reduce(
    (sum, stage) => sum + (stage?.events ?? 0),
    0,
  )
  return (
    <>
      <div className="analytics-diagnostic-summary">
        <h3>
          {eventTotal === 0
            ? 'No registration events found'
            : signup.error_reasons.length ||
                Object.values(signup.stages).some(
                  (stage) => (stage?.errors ?? 0) > 0,
                )
              ? 'Registration errors need a look'
              : 'No registration errors found'}
        </h3>
        <p className="analytics-diagnostic-total">
          <strong>{num(eventTotal)}</strong> observed registration events
        </p>
        <p className="text-sm text-base-content/60">
          Coverage is limited; missing events do not establish zero signups or a
          completion rate.
        </p>
      </div>
      {eventTotal === 0 ? (
        <p className="rounded-xl p-4 text-sm text-base-content/65 ring-1 ring-base-300/60">
          No recognized registration events were observed. With limited
          coverage, this is not proof of zero activity.
        </p>
      ) : (
        <details className="analytics-diagnostic-events">
          <summary>Inspect recorded steps</summary>
          <div className="overflow-x-auto">
            <table className="analytics-steps-table w-full text-sm">
              <thead>
                <tr className="bg-base-200/40 text-left text-xs text-base-content/55">
                  <th className="px-4 py-3 font-medium">Event</th>
                  <th className="px-4 py-3 text-right font-medium">Count</th>
                  <th className="px-4 py-3 text-right font-medium">Errors</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.filter(
                  (stage) =>
                    (signup.stages[stage.key]?.events ?? 0) > 0 ||
                    (signup.stages[stage.key]?.errors ?? 0) > 0,
                ).map((stage) => {
                  const metrics = signup.stages[stage.key] ?? {
                    events: 0,
                    errors: 0,
                  }
                  return (
                    <tr key={stage.key} className="border-t border-base-300/50">
                      <td className="px-4 py-2 font-medium">
                        {stage.label}
                        <span className="analytics-table-secondary">
                          {stage.path}
                        </span>
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
        </details>
      )}
      <div className="space-y-4">
        <Card title="Recorded errors">
          <p className="mb-3 text-sm text-base-content/60">
            Counts are error events, not affected people. Repeated attempts can
            appear more than once.
          </p>
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
                    {reasonLabel[reason.reason] ?? 'Unclassified errors'}
                  </span>
                  <strong className="tabular-nums">
                    {num(reason.count)} events
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <DefinitionDisclosure summary="Coverage and counting rules">
        <p>{signup.coverage.note}</p>
        <p>{signup.attempt_conversion.note}</p>
        <p>
          Unclassified errors have no recognized safe category. Sensitive error
          details are excluded from this report.
        </p>
        <p>{num(signup.coverage.unique_logs)} unique logs scanned.</p>
      </DefinitionDisclosure>
      <Stamp at={signup.generated_at} />
    </>
  )
}

// ── Desktop usage ─────────────────────────────────────────────────

export interface DesktopContentProps {
  period: Period
  verdict: Verdict
  desktop: Report<DesktopUsage>
  filters: DesktopFilterQuery
  onFilterChange?: (filters: DesktopFilterQuery) => void
  showFilters?: boolean
}

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
  const filterId = useId()
  const id = `desktop-filter-${name}-${filterId}`
  const optionLabel = (key: string) =>
    name === 'plan'
      ? planLabel(key)
      : name === 'os'
        ? ({ windows: 'Windows', macos: 'macOS', linux: 'Linux' }[key] ?? key)
        : key
  return (
    <label htmlFor={id} className={`analytics-filter analytics-filter-${name}`}>
      <span className="text-base-content/60">{label}</span>
      <select
        id={id}
        name={name}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="min-h-10 rounded-lg bg-base-100 px-2 text-sm ring-1 ring-base-300 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <option value="">
          All{' '}
          {name === 'os'
            ? 'systems'
            : name === 'version'
              ? 'versions'
              : 'plans'}
        </option>
        {value && !options.some((option) => option.value === value) && (
          <option value={value}>{optionLabel(value)}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {optionLabel(option.value)} ({num(option.count)})
          </option>
        ))}
      </select>
    </label>
  )
}

function DesktopFilters({
  data,
  filters,
  onChange,
}: {
  data: DesktopUsage | null
  filters: DesktopFilterQuery
  onChange: (filters: DesktopFilterQuery) => void
}) {
  const active = Boolean(filters.os || filters.version || filters.plan)
  const fields = [
    ['os', 'OS'],
    ['version', 'Version'],
    ['plan', 'Plan'],
  ] as const
  return (
    <div className="analytics-filters">
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-base-200/30 p-3 ring-1 ring-base-300/60">
        {fields.map(([key, label]) => (
          <FilterSelect
            key={key}
            label={label}
            name={key}
            options={data?.filters[key] ?? []}
            value={filters[key]}
            onChange={(value) => onChange({ ...filters, [key]: value })}
          />
        ))}
        <button
          type="button"
          disabled={!active}
          aria-label="Reset filters"
          className="min-h-10 rounded-lg px-3 text-sm text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() =>
            onChange({ os: undefined, version: undefined, plan: undefined })
          }
        >
          Reset
        </button>
      </div>
    </div>
  )
}

const DESKTOP_QUESTION = 'Who is actually using the app, and how much?'

const DESKTOP_NOTE =
  'Measured by Scrollr while usage sharing is enabled. Hours are added across everyone: two people for one hour each is two hours. OS and version filters count each computer separately.'

/**
 * Additions and removals carry no OS or version, so under a per-computer
 * filter the API refuses them and the fact reads "unknown" rather than a
 * total that quietly ignores the filter.
 */
function widgetChanges(
  widgets: DesktopUsage['widgets'],
  field: 'added' | 'removed',
): string | null {
  if (!widgets.changes_available) return null
  const rows = widgets.rows ?? []
  return num(rows.reduce((total, row) => total + row[field], 0))
}

/** Accounts running the app on two or more screens at once. */
function multiScreenUsers(buckets: Array<ScreensBucket> | null): string | null {
  if (!buckets) return null
  return num(
    buckets
      .filter((b) => b.screens !== '0' && b.screens !== '1')
      .reduce((total, b) => total + b.users, 0),
  )
}

export function DesktopContent({
  period,
  verdict,
  desktop,
  filters,
  onFilterChange = () => {},
  showFilters = true,
}: DesktopContentProps) {
  const d = desktop.data
  const coverage = d && {
    ...d.coverage,
    note: d.coverage.note?.replace(
      'Older builds still count in the legacy recently-seen figure. ',
      '',
    ),
  }
  const toolbar = showFilters && (
    <DesktopFilters data={d} filters={filters} onChange={onFilterChange} />
  )

  if (!d || !d.unique_users.available) {
    return (
      <CannotSay
        id="desktop"
        title="Desktop usage"
        question={DESKTOP_QUESTION}
        verdict={verdict}
        report={desktop}
        label="desktop usage"
        note={d?.unique_users.note ?? DESKTOP_NOTE}
        toolbar={toolbar}
      />
    )
  }

  const sentence = (
    <>
      <Headline verdict={verdict}>
        {plural(d.unique_users.value, 'person', 'people')}
      </Headline>{' '}
      ran the app {periodPhrase(period)}
      {d.user_hours.available
        ? `, for ${formatHours(d.user_hours.value)} between them`
        : ''}
      .
      {d.ticker_user_hours.available
        ? ` The ticker was on screen for ${formatHours(d.ticker_user_hours.value)} of that.`
        : ''}
    </>
  )

  const facts: Array<Fact> = [
    { label: 'People who ran the app', value: factOf(d.unique_users) },
    {
      label: 'App hours · all users',
      value: factOf(d.user_hours, formatHours),
    },
    {
      label: 'Ticker hours · all users',
      value: factOf(d.ticker_user_hours, formatHours),
    },
    {
      label: 'Using two or more monitors',
      value: multiScreenUsers(d.screens_per_user),
    },
    {
      label: 'Peak simultaneous users',
      value: d.peak.available ? num(d.peak.users) : null,
    },
  ]

  return (
    <Question
      id="desktop"
      title="Desktop usage"
      question={DESKTOP_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={
        <AnalyticsTrend
          kind="line"
          buckets={d.users_curve}
          step={d.curve_step}
          title="People using Scrollr"
          unit="Distinct app users per bucket"
        />
      }
      facts={facts}
      toolbar={toolbar}
      note={[coverage?.note, DESKTOP_NOTE].filter(Boolean).join(' ')}
      updatedAt={d.generated_at}
    >
      <MoreDetail title="Usage details">
        <div className="flex flex-wrap items-center gap-3">
          {d.staff_excluded && <StaffExcludedBadge />}
          <Link
            to="/admin/versions"
            search={{ view: 'traffic' }}
            className="analytics-drawer-utility"
            title="Version adoption and error rates"
          >
            System <span aria-hidden>↗</span>
          </Link>
        </div>
        <AnalyticsPanels
          panels={[
            {
              label: 'Time & screens',
              content: (
                <>
                  {' '}
                  <Section id="presence" title="Time spent with Scrollr">
                    <p className="analytics-detail-caption">
                      {periodLabel(period)} · totals across the selected users
                    </p>
                    <div className="analytics-presence-metrics">
                      <FactList
                        facts={[
                          {
                            label: 'App open - total hours',
                            value: factOf(d.user_hours, formatHours),
                          },
                          {
                            label: 'Ticker visible - total hours',
                            value: factOf(d.ticker_user_hours, formatHours),
                          },
                          {
                            label:
                              'Ticker screen-hours - includes multiple screens',
                            value: factOf(d.screen_hours, formatHours),
                          },
                          {
                            label: 'Peak simultaneous users',
                            value: d.peak.available ? num(d.peak.users) : null,
                          },
                        ]}
                      />
                    </div>
                    <DefinitionDisclosure>
                      <p>{d.definition}</p>
                      <CoverageNote coverage={coverage!} />
                      <p>
                        {d.peak.available
                          ? `Peak uses ${d.peak.resolution_seconds}-second samples.`
                          : d.peak.note}
                      </p>
                      {d.filters.note && <p>{d.filters.note}</p>}
                    </DefinitionDisclosure>
                  </Section>
                </>
              ),
            },
            {
              label: 'Return visits',
              content: (
                <>
                  {' '}
                  <Section
                    id="retention"
                    title="Do people return?"
                    lede={
                      d.population
                        ? 'Mature cohorts in the selected population · independent of the chart time window.'
                        : 'All mature cohorts · independent of time, OS, version and plan filters.'
                    }
                  >
                    <div className="analytics-return-rates">
                      <RetentionCard metric={d.retention.d1} />
                      <RetentionCard metric={d.retention.d7} />
                      <RetentionCard metric={d.retention.d30} />
                    </div>
                    <DefinitionDisclosure>
                      <p>{d.retention.definition}</p>
                    </DefinitionDisclosure>
                  </Section>
                </>
              ),
            },
            {
              label: 'Widgets',
              content: (
                <>
                  {' '}
                  <Section
                    id="widgets"
                    title="Widget types"
                    lede={`Share is of ${num(d.widgets.measured_ticker_users)} measured ticker users in the window.`}
                  >
                    <WidgetRanking widgets={d.widgets} />
                    <FactList
                      facts={[
                        {
                          label: `Widgets added ${periodPhrase(period)}`,
                          value: widgetChanges(d.widgets, 'added'),
                        },
                        {
                          label: `Widgets removed ${periodPhrase(period)}`,
                          value: widgetChanges(d.widgets, 'removed'),
                        },
                      ]}
                    />
                    <AnalyticsWidgetTable widgets={d.widgets} />
                    <DefinitionDisclosure>
                      <p>{d.widgets.definition}</p>
                      <p>{d.widgets.repeat_note}</p>
                      <p>{d.widgets.changes_note}</p>
                    </DefinitionDisclosure>
                  </Section>
                </>
              ),
            },
          ]}
        />
      </MoreDetail>
    </Question>
  )
}

function WidgetRanking({ widgets }: { widgets: DesktopUsage['widgets'] }) {
  const rows = [...(widgets.rows ?? [])]
    .sort((a, b) => b.user_hours - a.user_hours)
    .slice(0, 5)
  const max = Math.max(1, ...rows.map((row) => row.user_hours))
  return (
    <section
      className="analytics-widget-ranking"
      aria-label="Most watched widgets"
    >
      <header>
        <h3>What stays on screen</h3>
        <p>Ticker user-hours · top five widgets</p>
      </header>
      {rows.length ? (
        <ol>
          {rows.map((row) => (
            <li key={row.widget_type}>
              <div>
                <span>{row.name || row.widget_type}</span>
                <strong>{formatHours(row.user_hours)}</strong>
              </div>
              <div className="analytics-widget-track" aria-hidden="true">
                <span style={{ width: `${(row.user_hours / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p>No widget observations in this window.</p>
      )}
    </section>
  )
}

function RetentionCard({ metric }: { metric: RetentionMetric }) {
  return (
    <section className="analytics-retention-row">
      <header>
        <h3>{`Day ${metric.day} retention`}</h3>
        {metric.available && <strong>{pct(metric.rate)}</strong>}
      </header>
      {metric.available ? (
        <>
          <div className="analytics-return-track" aria-hidden="true">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, metric.rate * 100))}%`,
              }}
            />
          </div>
          <p>
            {num(metric.returned)} of {num(metric.eligible)} mature accounts
            returned on exactly day {metric.day}.
          </p>
        </>
      ) : (
        <p className="text-sm text-base-content/70">
          {metric.note ?? 'Collecting history.'}
        </p>
      )}
    </section>
  )
}

export interface RevenueContentProps {
  period: Period
  verdict: Verdict
  revenue: Report<Revenue>
}

const REVENUE_QUESTION = 'Is money coming in?'

const REVENUE_NOTE =
  'From Stripe balance transactions: payments minus refunds minus fees, by the time each happened. Payouts are not income and are left out. Currencies are never added together, so these figures are the primary currency only.'

/** One currency's line out of the ledger, in minor units. */
function ledgerOf(
  lines: Array<Earnings> | null,
  currency: string,
  pick: (line: Earnings) => number,
): number | null {
  const line = (lines ?? []).find((c) => c.currency === currency)
  return line ? pick(line) : null
}

export function RevenueContent({
  period,
  verdict,
  revenue,
}: RevenueContentProps) {
  const windowLabel = periodLabel(period)
  const r = revenue.data

  if (!r || !r.earnings.available || !r.earnings.net.available) {
    return (
      <CannotSay
        id="revenue"
        title="Revenue"
        question={REVENUE_QUESTION}
        verdict={verdict}
        report={revenue}
        label="revenue"
        note={r?.earnings.note ?? r?.earnings.net.note ?? REVENUE_NOTE}
      />
    )
  }

  const currency = r.earnings.primary_currency
  const money = (minor: number) => formatMinor(minor, currency)
  const net = r.earnings.net.value
  const lifetimeNet = ledgerOf(r.earnings.lifetime, currency, (c) => c.net)
  const refunds = ledgerOf(r.earnings.currencies, currency, (c) =>
    Math.abs(c.refunds.net),
  )
  const now = r.paying_now

  const sentence = (
    <>
      <Headline verdict={verdict}>{net > 0 ? money(net) : 'Nothing'}</Headline>{' '}
      came in {periodPhrase(period)}
      {comparisonClause(period, r.earnings.net, money)}.
      {now.available
        ? ` ${plural(now.paying, 'customer')} ${now.paying === 1 ? 'pays' : 'pay'}, ${num(now.lifetime)} on the lifetime plan.`
        : ''}
      {lifetimeNet === null ? '' : ` ${money(lifetimeNet)} earned ever.`}
    </>
  )

  const facts: Array<Fact> = [
    {
      label: `${r.population && Object.values(r.population).some(Boolean) ? 'Attributed net' : 'Earned'} ${periodPhrase(period)}, after Stripe fees`,
      value: factOf(r.earnings.net, money),
    },
    ...previousFact(period, r.earnings.net, money),
    {
      label: 'Earned ever',
      value: lifetimeNet === null ? null : money(lifetimeNet),
    },
    {
      label: 'Paying customers',
      value: now.available ? num(now.paying) : null,
    },
    {
      label: 'On the lifetime plan',
      value: now.available ? num(now.lifetime) : null,
    },
    {
      label: 'On a free trial',
      value: now.available ? num(now.trialing) : null,
    },
    {
      label: 'Payment failed',
      value: now.available ? num(now.past_due) : null,
    },
    { label: 'Cancelling', value: now.available ? num(now.canceling) : null },
    {
      label: `Refunds ${periodPhrase(period)}`,
      value: refunds === null ? null : money(refunds),
    },
  ]

  return (
    <Question
      id="revenue"
      title="Revenue"
      question={REVENUE_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={
        <AnalyticsTrend
          kind="bars"
          buckets={r.earnings.curve}
          step={r.earnings.curve_step}
          title="Net earnings over time"
          zeroLabel="Net earnings are zero throughout this window."
          unit={currency.toUpperCase()}
          format={money}
        />
      }
      facts={facts}
      note={[REVENUE_NOTE, r.account_note, r.earnings.note]
        .filter(Boolean)
        .join(' ')}
      updatedAt={r.generated_at}
    >
      <MoreDetail title="Revenue details">
        <Stamp at={r.generated_at} />
        <AnalyticsPanels
          panels={[
            {
              label: 'Customers & plans',
              content: (
                <>
                  <Section id="paying" title="Paying customers">
                    <div className="analytics-plan-summary">
                      <Card
                        title="Paying now"
                        label="Current"
                        note={
                          r.paying_now.available ? r.paying_now_note : undefined
                        }
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
                                label="Payment failed"
                                value={num(r.paying_now.past_due)}
                              />
                              <Row
                                label="Cancelling"
                                value={num(r.paying_now.canceling)}
                              />
                              <Row
                                label="Canceled"
                                value={num(r.paying_now.canceled)}
                              />
                              <Row
                                label="Free"
                                value={num(r.paying_now.free)}
                              />
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
                      <div className="min-w-0">
                        <Card title="Plan mix" label="Current">
                          <PlanMixTable rows={r.paying_now.rows ?? []} />
                        </Card>
                      </div>
                    </div>
                    <DefinitionDisclosure summary="Customer counting rules">
                      <p>{r.paying_now.definition}</p>
                    </DefinitionDisclosure>
                  </Section>
                </>
              ),
            },
            {
              label: 'First payments',
              content: (
                <>
                  {' '}
                  <Section id="new-paying" title="New paying customers">
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
                    <DefinitionDisclosure summary="What counts as a first payment">
                      <p>{r.new_paying.definition}</p>
                    </DefinitionDisclosure>
                  </Section>
                </>
              ),
            },
            {
              label: 'Earnings',
              content: (
                <>
                  {' '}
                  <Section
                    id="earnings"
                    title="Net earnings"
                    lede="After refunds and fees. Currencies are reported separately."
                  >
                    <FactList facts={facts.slice(-1)} />
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
                      {r.earnings.coverage.partial && (
                        <CoverageNote coverage={r.earnings.coverage} />
                      )}
                      <div className="analytics-earnings-summary">
                        <Card
                          title={`Net (${r.earnings.primary_currency.toUpperCase()})`}
                          label={windowLabel}
                        >
                          <Big>
                            <MetricText
                              value={formatMinor(
                                r.earnings.net.value,
                                r.earnings.primary_currency,
                              )}
                            />
                          </Big>
                          <p className="mt-1 text-sm text-base-content/60">
                            <DeltaBadge
                              comparison={r.earnings.net.comparison}
                              format={(v) =>
                                formatMinor(v, r.earnings.primary_currency)
                              }
                            />
                          </p>
                        </Card>
                        <div className="analytics-detail-chart">
                          <AnalyticsTrend
                            buckets={r.earnings.curve}
                            step={r.earnings.curve_step}
                            title="Net earnings per bucket"
                            unit={r.earnings.primary_currency.toUpperCase()}
                            format={(value) =>
                              formatMinor(value, r.earnings.primary_currency)
                            }
                            zeroLabel="No net earnings in this window."
                          />
                        </div>
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
                        <div className="analytics-currency-grid mt-2">
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
                        <p>
                          Stripe balance transactions by created time. Each
                          currency stands alone; nothing is converted or added
                          across currencies.
                        </p>
                        <CoverageNote coverage={r.earnings.coverage} />
                        {r.earnings.net.note && <p>{r.earnings.net.note}</p>}
                      </DefinitionDisclosure>
                    </div>
                  </Section>
                </>
              ),
            },
          ]}
        />
      </MoreDetail>
    </Question>
  )
}

function PlanMixTable({ rows }: { rows: Array<PlanMixRow> }) {
  if (rows.length === 0) {
    return <p className="text-sm text-base-content/65">No Stripe records.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="analytics-plan-table w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-base-content/55">
            <th className="py-1 pr-3 font-medium">Plan</th>
            <th className="py-1 pr-3 font-medium">Status</th>
            <th className="py-1 text-right font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.plan}-${row.status}-${row.lifetime}`}
              className="border-t border-base-300/50"
            >
              <td className="py-1 pr-3">
                {planLabel(row.tier || row.plan)}
                <span className="analytics-table-secondary">
                  {row.lifetime
                    ? 'Lifetime'
                    : row.interval
                      ? planLabel(row.interval)
                      : '—'}
                </span>
              </td>
              <td className="py-1 pr-3">
                {planLabel(row.status)}
                <span className="analytics-table-secondary">
                  {row.paying ? 'Paying' : 'Not paying'}
                </span>
              </td>
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
        <table className="analytics-ledger-table w-full text-sm">
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
                  <MetricText value={money(line.net)} />
                </td>
              </tr>
            ))}
            <tr className="border-t border-base-300/50 font-semibold">
              <td className="py-1 pr-3">Net</td>
              <td className="py-1 pr-3" />
              <td className="py-1 text-right tabular-nums">
                <MetricText value={money(e.net)} />
              </td>
            </tr>
            <tr className="border-t border-base-300/50 text-base-content/70">
              <td className="py-1 pr-3">Gross fees (already subtracted)</td>
              <td className="py-1 pr-3" />
              <td className="py-1 text-right tabular-nums">
                <MetricText value={money(e.gross_fees)} />
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

export interface SupportContentProps {
  period: Period
  verdict: Verdict
  support: Report<SupportSummary>
}

function paying(count: number): ReactNode {
  return count > 0 ? `${num(count)} paying` : undefined
}

const SUPPORT_QUESTION = 'What needs attention, and how quickly do we respond?'

/**
 * Who answered is the queue's own classification counted up over the window —
 * the same rule the queue renders per row, so the two can never disagree.
 * "From paying customers" is the one fact still without a source: support
 * cases carry no account to join a subscription to (SCROLLR-267).
 */
const SUPPORT_NOTE =
  'Reply times only count tickets that kept their timestamps. Who answered is counted over drafts acted on in the window, by the same rule the queue shows on each row; a draft can be escalated and then answered by a person, so escalations are not a slice of the replies. Support cases carry no account, so nothing can say which came from paying customers.'

export function SupportContent({
  period,
  verdict,
  support,
}: SupportContentProps) {
  const windowLabel = periodLabel(period)
  const s = support.data

  if (!s) {
    return (
      <CannotSay
        id="support"
        title="Support"
        question={SUPPORT_QUESTION}
        verdict={verdict}
        report={support}
        label="support summary"
      />
    )
  }

  const waiting = s.needs_attention.total
  const sentence = (
    <>
      <Headline verdict={verdict}>
        {plural(waiting, 'person', 'people')}
      </Headline>{' '}
      {waiting === 1 ? 'is' : 'are'} waiting on us.
      {s.completed_in_period.available
        ? ` ${plural(s.completed_in_period.value, 'ticket')} finished ${periodPhrase(period)}.`
        : ''}
    </>
  )

  const facts: Array<Fact> = [
    { label: 'Waiting for us', value: num(waiting) },
    {
      label: 'Waiting for the customer',
      value: num(s.waiting_on_customer.total),
    },
    {
      label: `Finished ${periodPhrase(period)}`,
      value: factOf(s.completed_in_period),
    },
    { label: 'Answered by the bot alone', value: num(s.replied_by_bot) },
    {
      label: 'Answered after you edited the draft',
      value: num(s.replied_after_edit),
    },
    {
      label: 'Longest wait',
      value: s.oldest_needs_attention_hours.available
        ? formatWait(s.oldest_needs_attention_hours.value)
        : null,
    },
    {
      label: 'Typical first reply',
      value: factOf(s.first_response_median_hours, formatDuration),
    },
    { label: 'From paying customers', value: null },
    { label: 'Escalated to a person', value: num(s.escalated) },
  ]

  return (
    <Question
      id="support"
      title="Support"
      question={SUPPORT_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={
        <AnalyticsTrend
          kind="bars"
          buckets={s.completed_curve}
          step={s.curve_step}
          title="Tickets finished over time"
          zeroLabel="No tickets completed in this window."
          unit="Completed tickets per bucket"
        />
      }
      facts={facts}
      note={[s.paying_note, SUPPORT_NOTE, s.definitions?.population]
        .filter(Boolean)
        .join(' ')}
      updatedAt={s.generated_at}
    >
      <div className="analytics-support-explore">
        <Link to="/admin/support" className="analytics-queue-link">
          Manage tickets <span aria-hidden>→</span>
        </Link>
        <MoreDetail title="Support performance">
          <div className="flex flex-wrap items-center gap-3">
            <Stamp at={s.generated_at} />
            <Link to="/admin/support" className="analytics-drawer-utility">
              Tickets <span aria-hidden>↗</span>
            </Link>
          </div>
          <AnalyticsPanels
            panels={[
              {
                label: 'Queue',
                content: (
                  <>
                    {' '}
                    <Section
                      id="queue"
                      title="Queue"
                      lede="Current tickets by status."
                    >
                      <Card title="Queue status" label="Current">
                        <div className="analytics-queue-stats">
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
                        <FactList facts={facts.slice(7)} />
                        {(s.paying_note ||
                          Object.keys(s.definitions ?? {}).length > 0) && (
                          <DefinitionDisclosure summary="Bucket definitions">
                            <p>
                              The whole queue as the pipeline classifies it.
                              Paying counts only tickets with a verified
                              account.
                            </p>
                            {s.paying_note && <p>{s.paying_note}</p>}
                            {Object.entries(s.definitions ?? {}).map(
                              ([key, text]) => (
                                <p key={key}>
                                  <strong>{key.replace(/_/g, ' ')}</strong> —{' '}
                                  {text}
                                </p>
                              ),
                            )}
                          </DefinitionDisclosure>
                        )}
                      </Card>
                    </Section>
                  </>
                ),
              },
              {
                label: 'Ticket history',
                content: (
                  <>
                    {' '}
                    <Section id="flow" title="Created and completed">
                      {s.coverage.partial && (
                        <CoverageNote coverage={s.coverage} />
                      )}
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
                      <DefinitionDisclosure summary="History and coverage">
                        <p>{s.history_note}</p>
                        <CoverageNote coverage={s.coverage} />
                      </DefinitionDisclosure>
                    </Section>
                  </>
                ),
              },
              {
                label: 'Response times',
                content: (
                  <>
                    <Section
                      id="speed"
                      title="Response and completion"
                      lede="Median times for tickets in this window, with sample counts."
                    >
                      <div className="grid items-start gap-4 lg:grid-cols-2">
                        <Card title="Typical first reply" label={windowLabel}>
                          <MetricValue
                            metric={s.first_response_median_hours}
                            format={formatDuration}
                          >
                            <p className="mt-1 text-sm text-base-content/60">
                              <DeltaBadge
                                comparison={
                                  s.first_response_median_hours.comparison
                                }
                                format={(v) =>
                                  `${v > 0 ? '+' : ''}${formatHours(v)}`
                                }
                                goodIsDown
                              />
                            </p>
                          </MetricValue>
                        </Card>
                        <Card title="Typical completion" label={windowLabel}>
                          <MetricValue
                            metric={s.completion_median_hours}
                            format={formatDuration}
                          >
                            <p className="mt-1 text-sm text-base-content/60">
                              <DeltaBadge
                                comparison={
                                  s.completion_median_hours.comparison
                                }
                                format={(v) =>
                                  `${v > 0 ? '+' : ''}${formatHours(v)}`
                                }
                                goodIsDown
                              />
                            </p>
                          </MetricValue>
                        </Card>
                      </div>
                    </Section>
                  </>
                ),
              },
            ]}
          />
        </MoreDetail>
      </div>
    </Question>
  )
}
