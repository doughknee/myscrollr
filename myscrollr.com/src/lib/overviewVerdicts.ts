/**
 * The Overview's five verdicts and its headline, decided in one place
 * (SCROLLR-215).
 *
 * A verdict is a colour plus two words, and colour on this page means state —
 * never decoration. The thresholds below are the whole ruleset: nothing else
 * on the page may invent one, and a rule that cannot be evaluated from the
 * data returns `none` (grey) rather than guessing, exactly as an unavailable
 * metric renders its note instead of a zero.
 *
 * The input is primitives rather than the API types on purpose: the rules are
 * the same whichever endpoint a figure arrived from, and a test of them should
 * not have to build a `Revenue`.
 */

export type VerdictTone = 'good' | 'warn' | 'bad' | 'none'

export interface Verdict {
  tone: VerdictTone
  label: string
}

/** One content table's freshness, as the ingest reading reports it. */
export interface FeedReading {
  table: string
  age_seconds: number
  has_data: boolean
}

export interface VerdictInput {
  /** Live desktop presence. Null while it is still loading or failed. */
  presence: { available: boolean; active_users: number } | null
  /** Cases waiting on a reply from us. */
  support: { open_cases: number } | null
  money: {
    available: boolean
    past_due: number
    new_paying_today: number
    /** Net of Stripe fees, in minor units, over the last 24 hours. */
    net_today: number
  } | null
  growth: {
    available: boolean
    /** Sign-ups in the last 24 hours. */
    value: number
    /** Sign-ups in the 24 hours before that. */
    previous: number
    /** False when the previous day cannot honestly be compared against. */
    comparable: boolean
  } | null
  feeds: Array<FeedReading> | null
}

export interface OverviewVerdicts {
  right_now: Verdict
  support: Verdict
  money: Verdict
  growth: Verdict
  feeds: Verdict
  /** The two headline lines, in order. */
  headline: [string, string]
}

/**
 * How long a feed may sit still before it is called stale.
 *
 * Sports scores legitimately go quiet overnight when no games are being
 * played, so they get half a day; everything else is a continuous feed and
 * half an hour of silence is already a stoppage.
 */
const GAMES_STALE_SECONDS = 12 * 60 * 60
const FEED_STALE_SECONDS = 30 * 60

function staleAfter(table: string): number {
  return table === 'games' ? GAMES_STALE_SECONDS : FEED_STALE_SECONDS
}

export function isStale(feed: FeedReading): boolean {
  return feed.has_data && feed.age_seconds > staleAfter(feed.table)
}

const NOT_REPORTING: Verdict = { tone: 'none', label: 'Not reporting yet' }

const TOO_EARLY: Verdict = { tone: 'none', label: 'Too early to compare' }

/**
 * Analytics says "Not measured" where the Overview says "Not reporting yet":
 * the Overview is watching a live system, Analytics is reading a window that
 * may simply predate measurement. Same rule, the reader's own words.
 */
const NOT_MEASURED: Verdict = { tone: 'none', label: 'Not measured' }

function rightNowVerdict(presence: VerdictInput['presence']): Verdict {
  if (!presence || !presence.available) {
    return { tone: 'none', label: 'Not reporting yet' }
  }
  return presence.active_users >= 1
    ? { tone: 'good', label: 'Live' }
    : { tone: 'none', label: 'Quiet' }
}

function supportVerdict(
  support: VerdictInput['support'],
  unmeasured: Verdict = NOT_REPORTING,
): Verdict {
  if (!support) return unmeasured
  return support.open_cases > 0
    ? { tone: 'bad', label: 'Needs you' }
    : { tone: 'good', label: 'Clear' }
}

function moneyVerdict(
  money: VerdictInput['money'],
  unmeasured: Verdict = NOT_REPORTING,
): Verdict {
  if (!money || !money.available) {
    return unmeasured
  }
  if (money.past_due > 0) return { tone: 'bad', label: 'Payment failed' }
  if (money.new_paying_today > 0 || money.net_today > 0) {
    return { tone: 'good', label: 'New money' }
  }
  return { tone: 'none', label: 'Nothing new' }
}

/**
 * The shared trend rule. It states the direction and stops there: at four
 * sign-ups a day, four against five is noise, and a pill that called it amber
 * would be wrong most times it fired — which teaches the reader to discount
 * the red "12 people are waiting" too (SCROLLR-223). The guards stay: a period
 * that cannot honestly be compared is grey, and so, now, is every comparison.
 * The sentence beside the pill spells the comparison out; the pill is quiet.
 */
function trendVerdict(
  input: VerdictInput['growth'],
  unmeasured: Verdict = NOT_REPORTING,
): Verdict {
  if (!input || !input.available) return unmeasured
  if (!input.comparable) return TOO_EARLY
  if (input.value === input.previous) return { tone: 'none', label: 'Level' }
  const direction = input.value > input.previous ? 'Up' : 'Down'
  return { tone: 'none', label: `${direction} from ${round(input.previous)}` }
}

/** User-hours arrive fractional, sign-ups do not; one decimal suits both. */
function round(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString('en-US')
}

function growthVerdict(growth: VerdictInput['growth']): Verdict {
  return trendVerdict(growth)
}

function feedsVerdict(feeds: VerdictInput['feeds']): Verdict {
  if (!feeds || feeds.length === 0) {
    return { tone: 'none', label: 'No readings' }
  }
  if (feeds.some((f) => !f.has_data)) {
    return { tone: 'bad', label: 'A feed is broken' }
  }
  if (feeds.some(isStale)) return { tone: 'warn', label: 'Stale' }
  return { tone: 'good', label: 'All good' }
}

export function verdicts(input: VerdictInput): OverviewVerdicts {
  const feeds = feedsVerdict(input.feeds)
  const support = supportVerdict(input.support)
  const money = moneyVerdict(input.money)

  // Line one is the product: is anything actually broken. Line two is the
  // reader: is anything waiting on them. Grey feeds are neither — claiming
  // "running fine" from readings we do not have would be the page lying.
  const first =
    feeds.tone === 'bad'
      ? 'Something is broken.'
      : feeds.tone === 'none'
        ? 'Nothing to report.'
        : 'Running fine.'
  const second =
    support.tone === 'bad'
      ? 'Support needs you.'
      : money.tone === 'bad'
        ? 'A payment failed.'
        : 'Nothing needs you.'

  return {
    right_now: rightNowVerdict(input.presence),
    support,
    money,
    growth: growthVerdict(input.growth),
    feeds,
    headline: [first, second],
  }
}

// ── Analytics sections (SCROLLR-220) ──────────────────────────────

/**
 * The four Analytics verdicts, each the same rule as its Overview row but
 * evaluated on the selected period rather than on the last 24 hours. They
 * live here because this file is the only place on the console allowed to
 * decide what a number means.
 */

/** Sign-ups in the period against the period before. */
export function analyticsGrowthVerdict(
  growth: VerdictInput['growth'],
): Verdict {
  return trendVerdict(growth, NOT_MEASURED)
}

/** App user-hours in the period against the period before. */
export function analyticsDesktopVerdict(
  usage: VerdictInput['growth'],
): Verdict {
  return trendVerdict(usage, NOT_MEASURED)
}

export function analyticsRevenueVerdict(money: VerdictInput['money']): Verdict {
  return moneyVerdict(money, NOT_MEASURED)
}

export function analyticsSupportVerdict(
  support: VerdictInput['support'],
): Verdict {
  return supportVerdict(support, NOT_MEASURED)
}

// ── Versions (SCROLLR-222) ────────────────────────────────────────

/**
 * The Versions page's single verdict.
 *
 * The input is request counters, never a headcount: no user id is stored, so
 * `share` here is share of desktop traffic in the window and nothing on that
 * page may imply otherwise. The rule reads the same way the page does: is
 * anything erroring. Rollout share is information on the page, not a state —
 * a low share is what every release looks like for its first days, so judging
 * it was wrong nearly every time it fired (SCROLLR-223).
 */
export interface VersionsInput {
  /** Desktop requests in the window. Zero means nothing to judge. */
  desktop_total: number
  versions: Array<{ version: string; share: number; error_rate: number }>
}

export interface VersionsVerdict {
  verdict: Verdict
  /** The build driving a red verdict, so the sentence can name it. */
  erroring: string | null
}

/**
 * A build erroring below this share of traffic is not yet a fleet problem —
 * one machine with a broken proxy can hold a 40% error rate on nine requests.
 */
const ERRORING_MIN_SHARE = 0.05
const ERRORING_RATE = 0.02

export function versionsVerdict(input: VersionsInput): VersionsVerdict {
  if (input.desktop_total === 0) {
    return {
      verdict: { tone: 'none', label: 'Nothing to report' },
      erroring: null,
    }
  }

  // Worst first, so the sentence names the build most worth reproducing on.
  const candidates = input.versions.filter(
    (v) => v.share >= ERRORING_MIN_SHARE && v.error_rate > ERRORING_RATE,
  )
  const erroring = candidates.length
    ? candidates.reduce((worst, v) =>
        v.error_rate > worst.error_rate ? v : worst,
      )
    : null

  if (erroring) {
    return {
      verdict: { tone: 'bad', label: 'Something is erroring' },
      erroring: erroring.version,
    }
  }
  return { verdict: { tone: 'good', label: 'Healthy' }, erroring: null }
}
