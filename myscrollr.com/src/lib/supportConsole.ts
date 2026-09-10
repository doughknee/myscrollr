/**
 * Presentation rules for the staff Support console (REL-263).
 *
 * Same reason adminFormat.ts exists: these encode the page's promises, and a
 * promise is worth a test that does not need a DOM.
 *
 * The promise here is narrower than the Overview's and sharper. This page
 * shows a countdown that, when it runs out, sends a real reply to a real
 * person. So the countdown may only appear when something is actually going
 * to collect it — the server says so with `available` on the Measured, and
 * nothing in this file is allowed to second-guess that. Disposition, hold
 * expiry and the proven-fix answer are all computed on the server; the browser
 * formats them and never recomputes them.
 */

import type {
  AdminHold,
  Measured,
  QueueDir,
  QueueGroup,
  QueuePerson,
  QueueSection,
  QueueSort,
} from '@/api/admin'

/** The three columns, in the order a person should read them. */
export const QUEUE_GROUPS: Array<{
  key: QueueGroup
  label: string
  blurb: string
}> = [
  {
    key: 'needs_you',
    label: 'Needs you',
    blurb:
      'Nothing here moves on its own, or it moves on a clock you can stop.',
  },
  {
    key: 'waiting',
    label: 'Waiting on the user',
    blurb:
      'We answered or asked. Nothing is due from us until they write back.',
  },
  {
    key: 'handled',
    label: 'Handled',
    blurb: 'Closed, or someone decided it needed no reply.',
  },
]

export function groupLabel(group: string): string {
  return QUEUE_GROUPS.find((g) => g.key === group)?.label ?? group
}

/**
 * The four sections, in the order a person reads them (REL-266).
 *
 * The order is fixed here and never derived from a sort. Paying customers lead
 * because priority support is a thing we sold; letting a sort key move that
 * section would sell it back.
 */
export const QUEUE_SECTIONS: Array<{
  key: QueueSection
  label: string
  empty: string
}> = [
  {
    key: 'paying',
    label: 'Paying customers',
    empty: 'No paying customer has written in.',
  },
  { key: 'open', label: 'Open', empty: 'Nothing is waiting on you.' },
  {
    key: 'answered',
    label: 'Answered, waiting on them',
    empty: 'Nobody owes us a reply.',
  },
  { key: 'resolved', label: 'Resolved', empty: 'Nothing has been closed yet.' },
]

/** The sort fields, with the words the menu shows for them. */
export const SORT_FIELDS: Array<{ key: QueueSort; label: string }> = [
  { key: 'last_wrote', label: 'Last wrote' },
  { key: 'waiting', label: 'Longest waiting' },
  { key: 'tickets', label: 'Most tickets' },
  { key: 'plan', label: 'Plan' },
  { key: 'name', label: 'Name' },
]

/**
 * What the direction button means for the field currently chosen.
 *
 * "Ascending" is a word about arrays, not about people. Every field gets the
 * sentence a reader would actually say, so the button can be labelled with
 * what it will do rather than with a compass direction.
 */
export function directionLabel(sort: QueueSort, dir: QueueDir): string {
  const words: Record<QueueSort, [string, string]> = {
    last_wrote: ['Oldest first', 'Newest first'],
    waiting: ['Shortest wait first', 'Longest waiting first'],
    tickets: ['Fewest tickets first', 'Most tickets first'],
    plan: ['Free first', 'Paying first'],
    name: ['A to Z', 'Z to A'],
  }
  return words[sort][dir === 'asc' ? 0 : 1]
}

/**
 * One line under a person's name: how many tickets, and when they last wrote.
 *
 * Deliberately says "1 ticket" rather than "1 tickets", and says nothing at
 * all about a wait it does not know — the server marks that unavailable and a
 * person with no message on record has not been waiting no time.
 */
export function personMeta(
  person: QueuePerson,
  now: number = Date.now(),
): string {
  const parts = [
    person.tickets === 1 ? '1 ticket' : `${person.tickets} tickets`,
  ]
  // From the timestamp, not from `waiting_hours`. The wait is the LONGEST any
  // of their tickets has waited, which is what "longest waiting" sorts on; it
  // is not when they last wrote, and printing one under the other's label
  // told a reader Dana last wrote 40 days ago while her open ticket was four
  // hours old.
  const wrote = relativeAge(person.last_user_message_at, now)
  if (wrote) parts.push(`last wrote ${wrote}`)
  else parts.push('never wrote in')
  if (person.needs_you === 0 && person.handled === person.tickets) {
    parts.push('all resolved')
  }
  return parts.join(' · ')
}

/**
 * "4 hours ago" / "13 days ago" / "just now". Null when there is no timestamp,
 * because "never" and "a moment ago" must not render the same.
 */
export function relativeAge(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const mins = Math.round((now - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  const months = Math.round(days / 30)
  return `${months} ${months === 1 ? 'month' : 'months'} ago`
}

/**
 * The plan badge, or nothing.
 *
 * Returns null rather than "Free" when there is no account behind the ticket,
 * because "this person is on the free plan" and "nobody is behind this ticket"
 * are different facts and a badge that conflates them invents an account.
 */
export function planBadge(person: {
  plan?: string
  paying: boolean
}): { label: string; paying: boolean } | null {
  const plan = person.plan?.trim()
  if (!plan) return null
  return { label: planLabel(plan), paying: person.paying }
}

/** `uplink_ultimate` is a column value, not something to show a person. */
export function planLabel(plan: string): string {
  const known: Record<string, string> = {
    free: 'Free',
    uplink: 'Uplink',
    uplink_pro: 'Uplink Pro',
    uplink_ultimate: 'Uplink Ultimate',
  }
  const key = plan.trim().toLowerCase()
  return (
    known[key] ??
    key
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  )
}

/**
 * How to name someone we may not know the name of.
 *
 * #819835 arrived from the marketing site with no account behind it. It has to
 * read as exactly that, and never as a person called "Anonymous User".
 */
export function personTitle(person: { name?: string; email?: string }): {
  title: string
  subtitle: string | null
  known: boolean
} {
  const name = person.name?.trim()
  const email = person.email?.trim()
  if (name) return { title: name, subtitle: email ?? null, known: true }
  if (email) return { title: email, subtitle: null, known: true }
  return {
    title: 'Requester unknown',
    subtitle: 'no requester name or email was stored',
    known: false,
  }
}

export function identityLabel(state: string): string {
  const labels: Record<string, string> = {
    confirmed_account: 'Confirmed account',
    contact_only: 'Contact only',
    ambiguous_association: 'Account association unverified',
    unknown_contact: 'Requester unknown',
  }
  return labels[state] ?? 'Requester identity unknown'
}

/**
 * The countdown, or the sentence that replaces it.
 *
 * `display` is null whenever the server said the number is not a measurement
 * of anything — which is what a hold looks like while autonomous sending is
 * off or paused. Rendering "sends in 12 minutes" then would tell an admin a
 * reply is about to go out when none is, and that is the one mistake this page
 * cannot make.
 */
export function holdCountdown(
  hold: AdminHold | null | undefined,
  now: number = Date.now(),
): {
  display: string | null
  note: string
} {
  if (!hold) return { display: null, note: '' }
  // `available` is the server's word on whether this is a countdown at all,
  // and is never second-guessed here.
  if (!hold.remaining_seconds.available) {
    return { display: null, note: hold.note }
  }
  // The remaining time is derived from `until` — the deadline the sweeper
  // itself reads — rather than from the seconds the server happened to
  // compute when the response was built. Those seconds go stale the moment
  // the page sits still, and a queue that says "sends in 13m" ten minutes
  // later is the same lie as one that counts down against a paused pipeline.
  const left = Math.round((new Date(hold.until).getTime() - now) / 1000)
  if (hold.expired || left <= 0) {
    return { display: 'any moment', note: hold.note }
  }
  return { display: formatDuration(left), note: hold.note }
}

/** "1h 04m" / "12m 03s" / "44s". Seconds only appear under an hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/**
 * How long the user has been waiting, from a Measured in hours.
 *
 * A case with no user message on record is not a wait of zero. The server
 * marks it unavailable and this returns null, so the column reads as unknown
 * rather than as the freshest ticket in the queue.
 */
export function formatWait(hours: Measured): string | null {
  if (!hours.available) return null
  const h = hours.value
  if (h < 1) return 'under an hour'
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  return days === 1 ? '1 day' : `${days} days`
}

/** The tone a disposition should carry in the UI. */
export type DispositionTone = 'stop' | 'clock' | 'ask' | 'done' | 'none'

export function dispositionTone(
  disposition: string | undefined,
  draftStatus: string | undefined,
): DispositionTone {
  if (draftStatus && draftStatus !== 'pending') return 'done'
  switch (disposition) {
    case 'escalate':
      return 'stop'
    case 'auto_send':
    case 'auto_close':
      return 'clock'
    case 'auto_ask':
      return 'ask'
    default:
      return 'none'
  }
}

/**
 * The one-line version of the proven-fix rule, for a queue row. The full
 * reasoning is a sentence the server writes and the case view prints whole;
 * this is only the badge next to a linked issue.
 */
export function fixBadge(
  fix: { issue_key?: string; proven: boolean; version?: string } | null,
): string | null {
  if (!fix?.issue_key) return null
  if (!fix.proven) return `${fix.issue_key} · not shipped`
  return `${fix.issue_key} · shipped in ${fix.version}`
}

/** One line of a rendered diff. */
export interface DiffLine {
  kind: 'kept' | 'removed' | 'added'
  text: string
}

/**
 * A line-level diff of the draft against the edit, for the panel that opens
 * before Send.
 *
 * This is the point of editing here rather than in a Discord modal: the modal
 * was one text box and you sent whatever was in it, and half of every actioned
 * draft in the May–September audit was rewritten with nothing left recording
 * what had been wrong with it. Seeing what you changed, immediately before the
 * click that reaches a person, is the cheapest version of that record — and
 * the same diff is posted into the thread afterwards.
 *
 * Standard LCS over lines, matching what the server posts to Discord. Support
 * replies are tens of lines, so the O(n·m) table is the right machinery.
 */
export function lineDiff(before: string, after: string): Array<DiffLine> {
  const a = splitMeaningfulLines(before)
  const b = splitMeaningfulLines(after)

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: Array<Array<number>> = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: Array<DiffLine> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'kept', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i] })
      i++
    } else {
      out.push({ kind: 'added', text: b[j] })
      j++
    }
  }
  for (; i < a.length; i++) out.push({ kind: 'removed', text: a[i] })
  for (; j < b.length; j++) out.push({ kind: 'added', text: b[j] })
  return out
}

/** Splits on newlines, dropping blanks so a reflowed paragraph is not a wall. */
function splitMeaningfulLines(s: string): Array<string> {
  return s
    .trim()
    .split(NEWLINE)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

const NEWLINE = '\n'

/** True when the edit changed nothing worth showing. */
export function isUnchanged(before: string, after: string): boolean {
  return lineDiff(before, after).every((l) => l.kind === 'kept')
}

/**
 * The reporter's most recent words — what an answer has to answer.
 *
 * This is the top of the case view now (REL-266). The old page opened with the
 * whole conversation, the whole pipeline and a diagnostics blob taller than
 * the sentence a person actually wrote; their words come first because they
 * are the only part nobody can regenerate.
 */
export function lastUserMessage(
  messages: Array<{ kind: string; body: string }> | null | undefined,
): string | null {
  const all = messages ?? []
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].kind === 'user' && all[i].body.trim() !== '') return all[i].body
  }
  return null
}

/**
 * The three chips that replace the diagnostics blob.
 *
 * Everything they summarise is still one click away under "Full diagnostics" —
 * moved down a level, never deleted. Each chip says "unknown" out loud rather
 * than disappearing, because a missing OS is itself a thing to know about a
 * bug report.
 */
export function diagnosticsChips(ctx: {
  os?: string
  app_version?: string
  current_version?: string
  version_state: 'unknown' | 'behind' | 'current'
}): Array<string> {
  const version =
    ctx.app_version && ctx.app_version.trim() !== ''
      ? ctx.version_state === 'behind' && ctx.current_version
        ? `${ctx.app_version} · behind ${ctx.current_version}`
        : ctx.version_state === 'current'
          ? `${ctx.app_version} · current`
          : ctx.app_version
      : 'Version unknown'
  return [ctx.os?.trim() || 'OS unknown', version]
}
