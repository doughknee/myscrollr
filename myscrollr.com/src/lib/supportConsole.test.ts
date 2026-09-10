import { describe, expect, it } from 'vitest'
import {
  QUEUE_SECTIONS,
  diagnosticsChips,
  directionLabel,
  dispositionTone,
  fixBadge,
  formatDuration,
  formatWait,
  groupLabel,
  holdCountdown,
  identityLabel,
  isUnchanged,
  lastUserMessage,
  lineDiff,
  personMeta,
  personTitle,
  planBadge,
  planLabel,
  relativeAge,
} from './supportConsole'
import type { AdminHold, QueuePerson } from '@/api/admin'

function person(over: Partial<QueuePerson> = {}): QueuePerson {
  return {
    key: 'r_armstrong@me.com',
    email: 'r_armstrong@me.com',
    name: 'Rachel Armstrong',
    identity_state: 'contact_only',
    account_established: false,
    subscription_present: false,
    paying: false,
    section: 'open',
    tickets: 5,
    needs_you: 1,
    waiting: 2,
    handled: 2,
    waiting_hours: { value: 288, available: true },
    ticket_numbers: ['752473'],
    ...over,
  }
}

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

describe('lineDiff', () => {
  it('marks what a rewrite removed and what it added', () => {
    const got = lineDiff(
      ['Try restarting the app.', 'If that fails, reinstall.'].join('\n'),
      ['Try restarting the app.', 'Update to 1.6.2 first.'].join('\n'),
    )
    expect(got).toEqual([
      { kind: 'kept', text: 'Try restarting the app.' },
      { kind: 'removed', text: 'If that fails, reinstall.' },
      { kind: 'added', text: 'Update to 1.6.2 first.' },
    ])
  })

  it('treats blank lines as formatting, not as changes', () => {
    expect(
      isUnchanged(
        ['one', '', 'two'].join('\n'),
        ['  one  ', 'two', ''].join('\n'),
      ),
    ).toBe(true)
  })

  it('reports a wholly rewritten reply as changed', () => {
    expect(isUnchanged('the draft', 'something else entirely')).toBe(false)
  })
})

// ── REL-266: people, sections and the sort controls ───────────────

describe('QUEUE_SECTIONS', () => {
  // The order is the whole design. Paying customers lead because priority
  // support is something we sold, and no sort a reader picks may move it.
  it('reads paying, open, answered, resolved and nothing else', () => {
    expect(QUEUE_SECTIONS.map((s) => s.key)).toEqual([
      'paying',
      'open',
      'answered',
      'resolved',
    ])
  })
})

describe('planBadge', () => {
  // "Free" and "nobody is behind this ticket" are different facts. #819835
  // arrived anonymously from the marketing site, and badging it Free would
  // invent an account for a stranger.
  it('is nothing at all when there is no account behind the ticket', () => {
    expect(planBadge({ paying: false })).toBeNull()
    expect(planBadge({ plan: '  ', paying: false })).toBeNull()
  })

  it('says which plan, and whether it is a paying one', () => {
    expect(planBadge({ plan: 'free', paying: false })).toEqual({
      label: 'Free',
      paying: false,
    })
    expect(planBadge({ plan: 'uplink_ultimate', paying: true })).toEqual({
      label: 'Uplink Ultimate',
      paying: true,
    })
  })
})

describe('planLabel', () => {
  it('turns a column value into something to show a person', () => {
    expect(planLabel('uplink_ultimate')).toBe('Uplink Ultimate')
    expect(planLabel('uplink')).toBe('Uplink')
    // An unknown plan is title-cased rather than printed raw or dropped.
    expect(planLabel('team_annual')).toBe('Team Annual')
  })
})

describe('personTitle', () => {
  it('prefers the name, falls back to the email', () => {
    expect(
      personTitle({ name: 'Rachel Armstrong', email: 'r@me.com' }),
    ).toEqual({ title: 'Rachel Armstrong', subtitle: 'r@me.com', known: true })
    expect(personTitle({ email: 'r@me.com' })).toEqual({
      title: 'r@me.com',
      subtitle: null,
      known: true,
    })
  })

  // The one that matters: an unknown person must read as an unknown person,
  // never as somebody called "Anonymous".
  it('says the requester is unknown rather than making an account claim', () => {
    const who = personTitle({})
    expect(who.known).toBe(false)
    expect(who.title).toBe('Requester unknown')
    expect(who.title.toLowerCase()).not.toContain('anonymous')
  })
})

describe('identityLabel', () => {
  it('keeps contact, ownership, and missing identity distinct', () => {
    expect(identityLabel('confirmed_account')).toBe('Confirmed account')
    expect(identityLabel('contact_only')).toBe('Contact only')
    expect(identityLabel('ambiguous_association')).toBe(
      'Account association unverified',
    )
    expect(identityLabel('unknown_contact')).toBe('Requester unknown')
  })
})

describe('relativeAge', () => {
  it('is null when there is no timestamp, so never never reads as recent', () => {
    expect(relativeAge(undefined)).toBeNull()
    expect(relativeAge('not a date')).toBeNull()
  })

  it('scales from minutes to months', () => {
    const now = Date.parse('2026-09-09T12:00:00Z')
    expect(relativeAge('2026-09-09T11:56:00Z', now)).toBe('4 minutes ago')
    expect(relativeAge('2026-09-09T08:00:00Z', now)).toBe('4 hours ago')
    expect(relativeAge('2026-09-09T11:00:00Z', now)).toBe('1 hour ago')
    expect(relativeAge('2026-08-27T12:00:00Z', now)).toBe('13 days ago')
    expect(relativeAge('2026-05-29T12:00:00Z', now)).toBe('3 months ago')
  })
})

describe('personMeta', () => {
  it('counts one ticket without an s', () => {
    expect(personMeta(person({ tickets: 1 }))).toContain('1 ticket ')
    expect(personMeta(person({ tickets: 5 }))).toContain('5 tickets')
  })

  it('says nothing about a wait it does not know', () => {
    const line = personMeta(
      person({ waiting_hours: { value: 0, available: false } }),
    )
    expect(line).toContain('never wrote in')
    expect(line).not.toContain('0h')
  })

  // The bug this test exists for: waiting_hours is the LONGEST wait across
  // someone's tickets, which is what the "longest waiting" sort reads. Under a
  // label saying "last wrote", it told a reader that a customer whose open
  // ticket was four hours old had last written forty days ago.
  it('reads "last wrote" from when they last wrote, not from the longest wait', () => {
    const now = Date.parse('2026-09-09T12:00:00Z')
    const line = personMeta(
      person({
        tickets: 2,
        last_user_message_at: '2026-09-09T08:00:00Z',
        waiting_hours: { value: 960, available: true },
      }),
      now,
    )
    expect(line).toContain('last wrote 4 hours ago')
    expect(line).not.toContain('40 days')
  })

  it('notes when everything of theirs is closed', () => {
    expect(
      personMeta(person({ tickets: 3, needs_you: 0, waiting: 0, handled: 3 })),
    ).toContain('all resolved')
  })
})

describe('directionLabel', () => {
  // "Ascending" is a word about arrays. The button says what it will do.
  it('says what the direction means for the field chosen', () => {
    expect(directionLabel('waiting', 'desc')).toBe('Longest waiting first')
    expect(directionLabel('waiting', 'asc')).toBe('Shortest wait first')
    expect(directionLabel('last_wrote', 'desc')).toBe('Newest first')
    expect(directionLabel('name', 'asc')).toBe('A to Z')
    expect(directionLabel('plan', 'desc')).toBe('Paying first')
  })
})

describe('diagnosticsChips', () => {
  it('names what it does not know instead of dropping the chip', () => {
    expect(diagnosticsChips({ version_state: 'unknown' })).toEqual([
      'OS unknown',
      'Version unknown',
    ])
  })

  it('carries the version comparison the server made', () => {
    expect(
      diagnosticsChips({
        os: 'Linux · AppImage',
        app_version: '1.5.0',
        current_version: '1.6.1',
        version_state: 'behind',
      }),
    ).toEqual(['Linux · AppImage', '1.5.0 · behind 1.6.1'])
  })
})

describe('lastUserMessage', () => {
  it('is their most recent words, not ours and not a draft', () => {
    expect(
      lastUserMessage([
        { kind: 'user', body: 'first' },
        { kind: 'sent', body: 'our reply' },
        { kind: 'user', body: 'still broken' },
        { kind: 'ai_draft', body: 'a draft nobody sent' },
      ]),
    ).toBe('still broken')
  })

  it('is null when they are not on record, rather than an empty quote', () => {
    expect(lastUserMessage([])).toBeNull()
    expect(lastUserMessage(null)).toBeNull()
    expect(lastUserMessage([{ kind: 'user', body: '   ' }])).toBeNull()
  })
})
