import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
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
} from '@/api/adminAnalytics'
import type {
  Audience,
  BreakdownRow,
  Bucket,
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
  WidgetRow,
} from '@/api/adminDashboard'
import type {
  DailyProductCount,
  RetentionMetric,
} from '@/api/adminProductAnalytics'
import type { AnalyticsView } from '@/lib/adminFormat'
import type { Verdict } from '@/lib/overviewVerdicts'
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
  formatDuration,
  formatHours,
  formatMinor,
  formatWait,
  periodFootnote,
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
 * Analytics (SCROLLR-220): four questions on one long page.
 *
 * Each section answers the question in its eyebrow in one sentence, with the
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
 * `?view=` used to pick a panel; it now names a section to scroll to, so the
 * Overview's links keep working.
 */

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
  const [application, setApplication] =
    useState<AnalyticsApplication>('website')
  const { os, period, plan, version, view } = search

  const setSearch = (patch: Partial<typeof search>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    })

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
  const desktop = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadDesktopUsage(getToken, period, { os, version, plan }, signal)
      },
      [getToken, os, period, plan, refresh, version],
    ),
  )
  const revenue = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadRevenue(getToken, period, signal)
      },
      [getToken, period, refresh],
    ),
  )
  const support = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void refresh
        return loadSupportSummary(getToken, period, signal)
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

  // `?view=` names a place on the page now rather than a panel to swap in, so
  // the Overview's deep links keep landing where they always did.
  useEffect(() => {
    document.getElementById(view)?.scrollIntoView({ block: 'start' })
  }, [view])

  const sectionVerdicts: Record<AnalyticsView, Verdict> = {
    growth: growthVerdict(audience.data),
    desktop: desktopVerdict(desktop.data),
    revenue: revenueVerdict(revenue.data),
    support: supportVerdict(support.data),
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
        <SectionNav
          view={view}
          period={period}
          verdicts={sectionVerdicts}
          onView={(next) => setSearch({ view: next })}
          onPeriod={(next) => setSearch({ period: next })}
          onRefresh={() => setRefresh((n) => n + 1)}
        />
        <div className="flex min-w-0 grow flex-col gap-14">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-[32px] leading-none font-extrabold tracking-[-0.03em]">
              Analytics
            </h1>
            <PageStamp />
          </header>
          <GrowthContent
            period={period}
            verdict={sectionVerdicts.growth}
            audience={audience}
            website={website}
          />
          <DesktopContent
            period={period}
            verdict={sectionVerdicts.desktop}
            desktop={desktop}
            filters={{ os, version, plan }}
            onFilterChange={(next) => setSearch(next)}
          />
          <RevenueContent
            period={period}
            verdict={sectionVerdicts.revenue}
            revenue={revenue}
          />
          <SupportContent
            period={period}
            verdict={sectionVerdicts.support}
            support={support}
          />
          <SignupDiagnostics
            period={period}
            signup={signup}
            application={application}
            onApplicationChange={setApplication}
          />
        </div>
      </div>
    </PageFrame>
  )
}

/** The page's own "as of", which is the moment it was drawn. */
function PageStamp() {
  return (
    <p className="text-sm text-base-content/50">
      {new Date().toLocaleString()}
    </p>
  )
}

/**
 * The left column: the four sections with their verdicts, the period, and
 * what the period means. It replaces the tab strip — every section is on the
 * page now, so this is a table of contents rather than a switch.
 */
export function SectionNav({
  view,
  period,
  verdicts,
  onView,
  onPeriod,
  onRefresh,
}: {
  view: AnalyticsView
  period: Period
  verdicts: Record<AnalyticsView, Verdict>
  onView: (view: AnalyticsView) => void
  onPeriod: (period: Period) => void
  onRefresh?: () => void
}) {
  return (
    <nav
      aria-label="Analytics sections"
      className="flex shrink-0 flex-col gap-1 lg:sticky lg:top-16 lg:w-[180px] lg:self-start"
    >
      <span className="px-2.5 pb-2 text-[11px] font-bold tracking-[0.08em] text-base-content/45 uppercase">
        Sections
      </span>
      {ANALYTICS_VIEWS.map((section) => {
        const current = section.value === view
        const tone = VERDICT_TONE[verdicts[section.value].tone]
        return (
          <button
            key={section.value}
            type="button"
            onClick={() => onView(section.value)}
            aria-current={current ? 'true' : undefined}
            className={
              current
                ? 'flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-base-200 px-2.5 py-2 text-left text-[13px] font-semibold text-base-content focus-visible:outline-2 focus-visible:outline-primary'
                : 'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-base-content/60 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary'
            }
          >
            <span className="truncate">{section.label}</span>
            <span
              className={`size-2 shrink-0 rounded-full ${tone.dot}`}
              aria-hidden
            />
          </button>
        )
      })}
      <div className="mt-4 flex flex-wrap gap-3 px-2.5">
        <PeriodSelector value={period} onChange={onPeriod} />
        {onRefresh && <RefreshButton onClick={onRefresh} label="Refresh" />}
      </div>
      <p className="px-2.5 pt-3 text-xs text-base-content/45">
        {periodFootnote(period)}
      </p>
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
  children,
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  sentence: ReactNode
  chart: ReactNode
  facts: Array<Fact>
  note: string
  children?: ReactNode
}) {
  return (
    <QuestionShell id={id} title={title} question={question} verdict={verdict}>
      <p className="max-w-[900px] text-2xl leading-[1.3] font-semibold tracking-[-0.015em]">
        {sentence}
      </p>
      <div className="grid items-start gap-10 xl:grid-cols-[480px_1fr]">
        <div className="min-w-0">{chart}</div>
        <FactList facts={facts} />
      </div>
      <p className="max-w-[900px] text-[13px] text-base-content/45">{note}</p>
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
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="flex scroll-mt-16 flex-col gap-[18px]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2
          id={`${id}-heading`}
          className="text-[11px] font-bold tracking-[0.08em] text-base-content/45 uppercase"
        >
          {title} · {question}
        </h2>
        <VerdictPill verdict={verdict} />
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
}: {
  id: AnalyticsView
  title: string
  question: string
  verdict: Verdict
  report: Report<unknown>
  label: string
  note?: string
}) {
  return (
    <QuestionShell id={id} title={title} question={question} verdict={verdict}>
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
    <dl className="grid min-w-0 gap-x-7 sm:grid-cols-2">
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
function MoreDetail({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-xl ring-1 ring-base-300/60">
      <summary className="cursor-pointer p-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary">
        More detail
      </summary>
      <div className="space-y-8 border-t border-base-300/60 p-4">
        {children}
      </div>
    </details>
  )
}

/** A chart at the size this page draws them, tinted by the verdict. */
function Figure({
  verdict,
  kind,
  buckets,
  step,
  label,
}: {
  verdict: Verdict
  kind: 'bars' | 'line'
  buckets: Array<Bucket> | null | undefined
  step: string
  label: string
}) {
  const tone = VERDICT_TONE[verdict.tone].chart
  return kind === 'bars' ? (
    <Bars
      buckets={buckets}
      step={step}
      label={label}
      tone={tone}
      className="h-[120px]"
    />
  ) : (
    <Sparkline
      buckets={buckets}
      step={step}
      label={label}
      tone={tone}
      className="h-[120px]"
    />
  )
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
}

const GROWTH_QUESTION = 'Are new people showing up, and do they stick?'

/**
 * Two of the nine facts have no source: nothing records which application an
 * account signed up through, and nothing records whether a new account came
 * back on a second day. They render "unknown" rather than a derived number —
 * subtracting the website's PostHog sign-up events from Logto's account count
 * would be a different population subtracted from a population, not a fact.
 */
const GROWTH_NOTE =
  'Sign-ups are counted from Logto with staff excluded. "Finished setting up" means the account saved at least one widget. Sign-ups on the website are PostHog events on the site, a different count from Logto accounts; nothing records which application the other accounts registered through, or whether a new account came back on a second day, so those two read "unknown".'

export function GrowthContent({
  period,
  verdict,
  audience,
  website,
}: GrowthContentProps) {
  const windowLabel = periodLabel(period)
  const a = audience.data
  const w = website.data
  const staffExcluded = [audience, website].some((r) => r.data?.staff_excluded)

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
    { label: 'Finished setting up', value: num(a.set_up) },
    {
      label: 'Never finished setting up',
      value: num(Math.max(a.total - a.set_up, 0)),
    },
    { label: 'Deleted their account', value: num(a.known_purged) },
    { label: 'Signed up from the desktop app', value: null },
    {
      label: 'Signed up on the website',
      value: w && w.available ? factOf(w.signups) : null,
    },
    { label: 'Came back a second day', value: null },
  ]

  return (
    <Question
      id="growth"
      title="Growth"
      question={GROWTH_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={
        <Figure
          verdict={verdict}
          kind="bars"
          buckets={a.new_curve}
          step={a.curve_step}
          label="Sign-ups per bucket"
        />
      }
      facts={facts}
      note={GROWTH_NOTE}
    >
      <MoreDetail>
        {staffExcluded && <StaffExcludedBadge />}
        <Section
          id="accounts"
          title="Registered users"
          lede="Logto is the system of record. Authentication is not app usage."
        >
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
                    <DeltaBadge comparison={a.signed_in_in_period.comparison} />
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
        </Section>

        <Section
          id="website"
          title="Website"
          lede="PostHog pageviews. A visitor is a browser profile merged on sign-in, not guaranteed to be one human."
        >
          <Loaded report={website} label="website analytics">
            {(loadedWebsite) => (
              <WebsiteBlock website={loadedWebsite} windowLabel={windowLabel} />
            )}
          </Loaded>
        </Section>
      </MoreDetail>
    </Question>
  )
}

/** The signup diagnostics, secondary and folded, at the foot of the page. */
export function SignupDiagnostics({
  period,
  signup,
  application,
  onApplicationChange = () => {},
}: {
  period: Period
  signup: Report<SignupAnalytics>
  application: AnalyticsApplication
  onApplicationChange?: (application: AnalyticsApplication) => void
}) {
  return (
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

export interface DesktopContentProps {
  period: Period
  verdict: Verdict
  desktop: Report<DesktopUsage>
  filters: DesktopFilterQuery
  onFilterChange?: (filters: DesktopFilterQuery) => void
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

const DESKTOP_QUESTION = 'Who is actually using the app, and how much?'

const DESKTOP_NOTE =
  'Hours are added across everyone: two people for one hour each is two hours. Legacy 30-second ticker facts from older versions are kept separate and never mixed in.'

/** The widget with the most screen time, as "NFL · 210.5 h". */
function mostShownWidget(widgets: DesktopUsage['widgets']): string | null {
  const rows = widgets.rows ?? []
  if (rows.length === 0) return null
  const top = rows.reduce((best, row) =>
    row.user_hours > best.user_hours ? row : best,
  )
  return `${top.name} · ${formatHours(top.user_hours)}`
}

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
}: DesktopContentProps) {
  const windowLabel = periodLabel(period)
  const d = desktop.data

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
      />
    )
  }

  const d1 = d.retention.d1
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
      label: 'Hours the app was open, everyone added up',
      value: factOf(d.user_hours, formatHours),
    },
    {
      label: 'Hours the ticker was visible',
      value: factOf(d.ticker_user_hours, formatHours),
    },
    {
      label: 'Most people online at once',
      value: d.peak.available ? num(d.peak.users) : null,
    },
    {
      label: 'Using two or more monitors',
      value: multiScreenUsers(d.screens_per_user),
    },
    {
      label: 'Came back the next day',
      value: d1.available ? `${num(d1.returned)} of ${num(d1.eligible)}` : null,
    },
    { label: 'Most-shown widget', value: mostShownWidget(d.widgets) },
    {
      label: `Widgets added ${periodPhrase(period)}`,
      value: widgetChanges(d.widgets, 'added'),
    },
    {
      label: `Widgets removed ${periodPhrase(period)}`,
      value: widgetChanges(d.widgets, 'removed'),
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
        <Figure
          verdict={verdict}
          kind="line"
          buckets={d.users_curve}
          step={d.curve_step}
          label="App users per bucket"
        />
      }
      facts={facts}
      note={[d.coverage.note, DESKTOP_NOTE].filter(Boolean).join(' ')}
    >
      <MoreDetail>
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
                onChange={(version) => onFilterChange({ ...filters, version })}
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
              <p className="text-xs text-base-content/60">{d.filters.note}</p>
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

        <Section id="legacy" title="Legacy measurement" lede={d.legacy_note}>
          {d.legacy ? (
            <LegacyBlock legacy={d.legacy} />
          ) : (
            <p className="text-sm text-base-content/65">
              The legacy series is not available for this window.
            </p>
          )}
        </Section>
      </MoreDetail>
    </Question>
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
      label: `Earned ${periodPhrase(period)}, after Stripe fees`,
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
        <Figure
          verdict={verdict}
          kind="bars"
          buckets={r.earnings.curve}
          step={r.earnings.curve_step}
          label={`Net earnings per bucket (${currency.toUpperCase()}, minor units)`}
        />
      }
      facts={facts}
      note={REVENUE_NOTE}
    >
      <MoreDetail>
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
                    <Row label="Lifetime" value={num(r.paying_now.lifetime)} />
                    <Row label="Trialing" value={num(r.paying_now.trialing)} />
                    <Row label="Past due" value={num(r.paying_now.past_due)} />
                    <Row
                      label="Canceling"
                      value={num(r.paying_now.canceling)}
                    />
                    <Row label="Canceled" value={num(r.paying_now.canceled)} />
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
                  <Row label="Lifetime" value={num(r.new_paying.lifetime)} />
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
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-base-content/60">
              {r.earnings.fetched_at && (
                <span>
                  {r.earnings.cached ? 'Cached from' : 'Fetched from'} Stripe at{' '}
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
                  format={(v) => formatMinor(v, r.earnings.primary_currency)}
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
        </Section>
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

export interface SupportContentProps {
  period: Period
  verdict: Verdict
  support: Report<SupportSummary>
}

function paying(count: number): ReactNode {
  return count > 0 ? `${num(count)} paying` : undefined
}

const SUPPORT_QUESTION =
  'How much are we owing people, and how fast do we pay it back?'

/**
 * Three of the nine facts have no source. The summary endpoint counts
 * tickets by queue bucket; it does not record who or what wrote the reply,
 * so "answered by the bot alone", "answered after you edited the draft" and
 * "escalated to a person" read "unknown" rather than a guess.
 */
const SUPPORT_NOTE =
  'Reply times only count tickets that kept their timestamps. Nothing records whether a reply was sent by the bot, edited first, or escalated, so those three read "unknown".'

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
    { label: 'Answered by the bot alone', value: null },
    { label: 'Answered after you edited the draft', value: null },
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
    { label: 'Escalated to a person', value: null },
  ]

  return (
    <Question
      id="support"
      title="Support"
      question={SUPPORT_QUESTION}
      verdict={verdict}
      sentence={sentence}
      chart={
        <Figure
          verdict={verdict}
          kind="bars"
          buckets={s.completed_curve}
          step={s.curve_step}
          label="Tickets finished per bucket"
        />
      }
      facts={facts}
      note={[s.paying_note, SUPPORT_NOTE].filter(Boolean).join(' ')}
    >
      <MoreDetail>
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
              <p className="text-xs text-base-content/65">{s.autosend.note}</p>
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

        <Section id="flow" title="Created and completed" lede={s.history_note}>
          <CoverageNote coverage={s.coverage} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Card title="Created" label={windowLabel}>
              <MetricValue metric={s.created}>
                <p className="mt-1 text-sm text-base-content/60">
                  <DeltaBadge comparison={s.created.comparison} goodIsDown />
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
                  <DeltaBadge comparison={s.completed_in_period.comparison} />
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
      </MoreDetail>
    </Question>
  )
}
