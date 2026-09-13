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

function rightNowVerdict(presence: VerdictInput['presence']): Verdict {
  if (!presence || !presence.available) {
    return { tone: 'none', label: 'Not reporting yet' }
  }
  return presence.active_users >= 1
    ? { tone: 'good', label: 'Live' }
    : { tone: 'none', label: 'Quiet' }
}

function supportVerdict(support: VerdictInput['support']): Verdict {
  if (!support) return { tone: 'none', label: 'Not reporting yet' }
  return support.open_cases > 0
    ? { tone: 'bad', label: 'Needs you' }
    : { tone: 'good', label: 'Clear' }
}

function moneyVerdict(money: VerdictInput['money']): Verdict {
  if (!money || !money.available) {
    return { tone: 'none', label: 'Not reporting yet' }
  }
  if (money.past_due > 0) return { tone: 'bad', label: 'Payment failed' }
  if (money.new_paying_today > 0 || money.net_today > 0) {
    return { tone: 'good', label: 'New money' }
  }
  return { tone: 'none', label: 'Nothing new' }
}

function growthVerdict(growth: VerdictInput['growth']): Verdict {
  if (!growth || !growth.available) {
    return { tone: 'none', label: 'Not reporting yet' }
  }
  if (!growth.comparable) {
    return { tone: 'none', label: 'Too early to compare' }
  }
  return growth.value >= growth.previous
    ? { tone: 'good', label: 'Growing' }
    : { tone: 'warn', label: 'Slow' }
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
