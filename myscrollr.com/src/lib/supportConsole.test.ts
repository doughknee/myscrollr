import { describe, expect, it } from 'vitest'
import {
  dispositionTone,
  fixBadge,
  formatDuration,
  formatWait,
  groupLabel,
  holdCountdown,
} from './supportConsole'
import type { AdminHold } from '@/api/admin'

const NOW = Date.parse('2026-09-09T12:18:00Z')

function hold(over: Partial<AdminHold> = {}): AdminHold {
  return {
    until: '2026-09-09T12:30:00Z', // twelve minutes after NOW
    remaining_seconds: { value: 720, available: true },
    verb: 'Sending',
    expired: false,
    note: 'Doing nothing sends it.',
    ...over,
  }
}

describe('holdCountdown', () => {
  it('shows the remaining time while the pipeline is armed', () => {
    expect(holdCountdown(hold(), NOW).display).toBe('12m 00s')
  })

  // The seconds in the response were right when it was built and wrong a
  // minute later. The deadline is the thing the sweeper actually reads, so a
  // page left open must count down against that, not against a stale number.
  it('counts down from the deadline, not from the seconds in the response', () => {
    const stale = hold({ remaining_seconds: { value: 720, available: true } })
    expect(holdCountdown(stale, NOW + 10 * 60 * 1000).display).toBe('2m 00s')
    expect(holdCountdown(stale, NOW + 20 * 60 * 1000).display).toBe(
      'any moment',
    )
  })

  // The one mistake this page cannot make. hold_until keeps ticking whether or
  // not anything is going to collect it, so with autonomous sending off the
  // number is not a countdown and must not render as one — "sends in 12
  // minutes" would tell an admin a reply is about to go out when none is.
  it('refuses to render a countdown the server marked unavailable', () => {
    const off = holdCountdown(
      hold({
        remaining_seconds: {
          value: 720,
          available: false,
          note: 'Autonomous sending is off or paused.',
        },
        note: 'Autonomous sending is off or paused.',
      }),
      NOW,
    )
    expect(off.display).toBeNull()
    expect(off.note).toContain('off or paused')
  })

  it('says an expired hold is going any moment rather than showing 0s', () => {
    expect(holdCountdown(hold({ expired: true }), NOW).display).toBe(
      'any moment',
    )
  })

  it('renders nothing for a draft with no hold at all', () => {
    expect(holdCountdown(null).display).toBeNull()
    expect(holdCountdown(undefined).display).toBeNull()
  })
})

describe('formatDuration', () => {
  it('drops seconds past an hour and keeps them under one', () => {
    expect(formatDuration(3900)).toBe('1h 05m')
    expect(formatDuration(125)).toBe('2m 05s')
    expect(formatDuration(44)).toBe('44s')
  })

  it('never renders a negative remainder', () => {
    expect(formatDuration(-30)).toBe('0s')
  })
})

describe('formatWait', () => {
  it('scales the unit to the wait', () => {
    expect(formatWait({ value: 0, available: true })).toBe('under an hour')
    expect(formatWait({ value: 5, available: true })).toBe('5h')
    expect(formatWait({ value: 24, available: true })).toBe('1 day')
    expect(formatWait({ value: 100, available: true })).toBe('4 days')
  })

  // A case with no user message on record is not a wait of zero hours. Showing
  // it as one would sort a months-old backfilled ticket in with the freshest.
  it('returns null rather than zero when the wait is not measurable', () => {
    expect(
      formatWait({ value: 0, available: false, note: 'no user message' }),
    ).toBeNull()
  })
})

describe('dispositionTone', () => {
  it('reads a pending escalation as a stop and a pending hold as a clock', () => {
    expect(dispositionTone('escalate', 'pending')).toBe('stop')
    expect(dispositionTone('auto_send', 'pending')).toBe('clock')
    expect(dispositionTone('auto_close', 'pending')).toBe('clock')
    expect(dispositionTone('auto_ask', 'pending')).toBe('ask')
  })

  // Once a draft is decided, its disposition is history. A sent reply must not
  // still look like a running timer.
  it('reads any decided draft as done whatever its disposition said', () => {
    expect(dispositionTone('auto_send', 'sent')).toBe('done')
    expect(dispositionTone('escalate', 'skipped')).toBe('done')
  })

  it('has a neutral tone for a draft with no disposition', () => {
    expect(dispositionTone(undefined, 'pending')).toBe('none')
  })
})

describe('fixBadge', () => {
  it('names the version only when the fix is proven', () => {
    expect(
      fixBadge({ issue_key: 'REL-234', proven: true, version: '1.6.1' }),
    ).toBe('REL-234 · shipped in 1.6.1')
    expect(fixBadge({ issue_key: 'REL-234', proven: false })).toBe(
      'REL-234 · not shipped',
    )
  })

  it('shows nothing when no issue is linked', () => {
    expect(fixBadge(null)).toBeNull()
    expect(fixBadge({ proven: false })).toBeNull()
  })
})

describe('groupLabel', () => {
  it('names the three columns and passes an unknown one through', () => {
    expect(groupLabel('needs_you')).toBe('Needs you')
    expect(groupLabel('waiting')).toBe('Waiting on the user')
    expect(groupLabel('handled')).toBe('Handled')
    expect(groupLabel('something_else')).toBe('something_else')
  })
})
