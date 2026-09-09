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

import type { AdminHold, Measured, QueueGroup } from '@/api/admin'

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
