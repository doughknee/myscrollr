import type {
  AutoSendState,
  CaseDetail,
  QueuePerson,
  QueueRow,
  SupportQueue,
} from '@/api/admin'

/**
 * A support queue and its cases, as the server would answer them.
 *
 * Nothing here is derived: every field the page renders is a field the API
 * sends, so a fixture that omits one is a fixture that would hide a bug. The
 * shapes below are the four the page has to survive — a paying customer, a
 * person with five tickets and no account, a ticket that arrived with no
 * signed-in user at all, and a case on a running hold.
 *
 * Used by `SupportPage.test.tsx` and by the throwaway preview route the
 * captures are taken from; the console cannot be signed into from a
 * development machine, so this is the only honest way to render the real page.
 */

const HOUR = 3600_000
const now = Date.parse('2026-09-15T12:00:00Z')
const ago = (hours: number) => new Date(now - hours * HOUR).toISOString()

export const autosendOn: AutoSendState = {
  armed: true,
  paused: false,
  enabled: true,
  hold_minutes: 60,
  note: 'Auto-send is on. A draft nobody touches sends itself when its hold runs out.',
}

export const autosendPaused: AutoSendState = {
  armed: false,
  paused: true,
  enabled: true,
  hold_minutes: 60,
  note: 'Sending is paused, so no countdown on this page is counting down to anything.',
}

const people: Array<QueuePerson> = [
  {
    key: 'dana',
    email: 'dana.whitfield@example.com',
    name: 'Dana Whitfield',
    plan: 'ultimate_annual',
    paying: true,
    identity_state: 'confirmed_account',
    account_established: true,
    subscription_present: true,
    section: 'paying',
    tickets: 2,
    needs_you: 1,
    waiting: 0,
    handled: 1,
    headline: 'Ticker renders but never scrolls',
    headline_ticket: '411001',
    last_user_message_at: ago(4),
    waiting_hours: { value: 4, available: true },
    ticket_numbers: ['411001', '410540'],
  },
  {
    key: 'morgan',
    email: 'morgan.ellis@example.com',
    name: 'Morgan Ellis',
    paying: false,
    identity_state: 'contact_only',
    account_established: false,
    subscription_present: false,
    plan_note: 'No Stripe customer matches this email, so no plan is claimed.',
    section: 'open',
    tickets: 3,
    needs_you: 1,
    waiting: 1,
    handled: 1,
    headline: 'Adding an RSS feed felt risky and confusing',
    headline_ticket: '752473',
    last_user_message_at: ago(24 * 12),
    waiting_hours: { value: 288, available: true },
    ticket_numbers: ['752473', '584802', '613084'],
  },
  {
    key: 'unknown-linux',
    paying: false,
    identity_state: 'unknown_contact',
    account_established: false,
    subscription_present: false,
    section: 'open',
    tickets: 1,
    needs_you: 1,
    waiting: 0,
    handled: 0,
    headline: 'Linux sign-in never opens a browser',
    headline_ticket: '318220',
    waiting_hours: { value: 0, available: false, note: 'nothing on record' },
    ticket_numbers: ['318220'],
  },
  {
    key: 'sam',
    email: 'sam.pryor@example.com',
    name: 'Sam Pryor',
    paying: false,
    identity_state: 'contact_only',
    account_established: false,
    subscription_present: false,
    section: 'answered',
    tickets: 1,
    needs_you: 0,
    waiting: 1,
    handled: 0,
    headline: 'Which version am I running?',
    headline_ticket: '900112',
    provenance: 'bot',
    provenance_label: 'sent by the bot',
    last_user_message_at: ago(24 * 3),
    waiting_hours: { value: 72, available: true },
    ticket_numbers: ['900112'],
  },
]

const row = (over: Partial<QueueRow> & Pick<QueueRow, 'ticket_number'>) =>
  ({
    subject: '(no subject)',
    status: 'open',
    identity_state: 'contact_only',
    account_established: false,
    subscription_present: false,
    paying: false,
    person_key: 'morgan',
    group: 'needs_you',
    group_reason: 'Escalated. It waits for a person.',
    section: 'open',
    waiting_hours: { value: 12, available: true },
    opened_at: ago(24 * 18),
    updated_at: ago(24 * 12),
    ...over,
  }) as QueueRow

const rows: Array<QueueRow> = [
  row({
    ticket_number: '411001',
    subject: 'Ticker renders but never scrolls',
    user_email: 'dana.whitfield@example.com',
    name: 'Dana Whitfield',
    plan: 'ultimate_annual',
    paying: true,
    person_key: 'dana',
    section: 'paying',
    os: 'Windows 11',
    opened_at: ago(6),
    updated_at: ago(4),
  }),
  row({
    ticket_number: '410540',
    subject: 'Ticker across macOS desktops',
    person_key: 'dana',
    section: 'paying',
    group: 'handled',
    group_reason: 'Closed.',
    opened_at: ago(24 * 40),
    updated_at: ago(24 * 30),
  }),
  row({
    ticket_number: '752473',
    subject: 'Adding an RSS feed felt risky and confusing',
    user_email: 'morgan.ellis@example.com',
    name: 'Morgan Ellis',
    os: 'macOS 15',
  }),
  row({
    ticket_number: '584802',
    subject: 'Custom feed cannot be edited or deleted',
    group: 'waiting',
    group_reason: 'We replied. Nothing is due from us until they write back.',
    provenance: 'edited',
    provenance_label: 'you edited it',
    updated_at: ago(24 * 20),
  }),
  row({
    ticket_number: '613084',
    subject: 'My own mistake, this is cool',
    group: 'handled',
    group_reason: 'Closed.',
    updated_at: ago(24 * 35),
  }),
  row({
    ticket_number: '318220',
    subject: 'Linux sign-in never opens a browser',
    person_key: 'unknown-linux',
    identity_state: 'unknown_contact',
    waiting_hours: { value: 0, available: false },
  }),
  row({
    ticket_number: '900112',
    subject: 'Which version am I running?',
    user_email: 'sam.pryor@example.com',
    name: 'Sam Pryor',
    person_key: 'sam',
    section: 'answered',
    group: 'waiting',
    group_reason: 'We replied. Nothing is due from us until they write back.',
    provenance: 'bot',
    provenance_label: 'sent by the bot',
    updated_at: ago(24 * 3),
  }),
]

export const queue: SupportQueue = {
  generated_at: ago(0),
  autosend: autosendOn,
  counts: { needs_you: 3, waiting: 2, handled: 2 },
  sections: { paying: 1, open: 2, answered: 1, resolved: 2 },
  state: 'open',
  sort: 'last_wrote',
  dir: 'desc',
  rows_mode: 'person',
  accounts: {
    paying: 1,
    cases_with_account: 1,
    cases: 7,
    note: 'Only one case on record is joined to an account, so this section can only ever be as complete as that.',
  },
  rows,
  people,
}

/** Morgan's escalated case: the one the captures open on. */
export const morganCase: CaseDetail = {
  ticket_number: '752473',
  subject: 'Adding an RSS feed felt risky and confusing',
  user_email: 'morgan.ellis@example.com',
  user_name: 'Morgan Ellis',
  identity_state: 'contact_only',
  account_established: false,
  subscription_present: false,
  status: 'open',
  category: 'feedback',
  opened_at: ago(24 * 18),
  updated_at: ago(24 * 12),
  group: 'needs_you',
  group_reason: 'Escalated. It waits for a person.',
  paying: false,
  plan_note: 'No Stripe customer matches this email, so no plan is claimed.',
  messages: [
    {
      kind: 'user',
      body: 'I found a version of the feed I wanted but I had to try a few addresses and honestly I do not know what I just did. I doubt most people would put in as much effort as I just did.',
      superseded: false,
      created_at: ago(24 * 18),
    },
    {
      kind: 'note',
      body: 'Classifier: feedback, confidence medium, sentiment frustrated. Grounded in docs › Adding a feed.',
      superseded: false,
      created_at: ago(24 * 18 - 1),
    },
  ],
  draft: {
    id: 9001,
    status: 'pending',
    body: 'You are right, and thank you for pushing through it anyway. Finding a feed’s real address should not be detective work, and the fact that you got there by trial and error is a fair criticism of how we built it.\n\nI have written this up so the next person does not have to do what you did.',
    category: 'feedback',
    drafter_category: 'feedback',
    priority: 'normal',
    confidence: 'medium',
    sentiment: 'frustrated',
    grounded_in: 'docs › Adding a feed',
    unknowns: 'Which reader they copied the address from.',
    ask_user_for: '',
    internal_note: 'Worth a docs pass on feed discovery.',
    needs_info: false,
    should_close: false,
    disposition: 'escalate',
    disposition_reason:
      'Escalated. The reporter sounds frustrated, so this waits for a person. No timer is running and nothing will send it.',
    intervened: false,
    created_at: ago(24 * 18 - 1),
  },
  context: {
    tier: 'free',
    app_version: '1.6.1',
    current_version: '1.6.7',
    version_state: 'behind',
    os: 'macOS 15',
    monitors_attached: 2,
    monitors_chosen: 1,
    widgets: [
      { type: 'news', on_ticker: true },
      { type: 'sports', on_ticker: true },
      { type: 'finance', on_ticker: false },
    ],
    has_diagnostics: true,
    note: 'Read from the diagnostics blob the desktop app attached.',
  },
  fix: {
    proven: false,
    reason:
      'No issue is linked to this ticket, so there is nothing whose ship date could be checked.',
  },
  autosend: autosendOn,
  stale_days: 12,
  stale_after: 7,
  similar: [
    {
      ticket_number: '584802',
      subject: 'Custom feed cannot be edited or deleted',
      user_wrote: 'I added the wrong address and now I cannot get rid of it.',
      we_sent: 'You can remove it from the feed list in Settings › News.',
    },
  ],
  evidence_note:
    'One past case we replied to reads closely enough to be a precedent.',
}

/** The same case with a hold that is counting down. */
export const heldCase: CaseDetail = {
  ...morganCase,
  ticket_number: '900112',
  subject: 'Which version am I running?',
  user_name: 'Sam Pryor',
  user_email: 'sam.pryor@example.com',
  group_reason: 'Answered by the bot, on a hold you can stop.',
  draft: {
    ...morganCase.draft!,
    id: 9002,
    disposition: 'auto_send',
    disposition_reason:
      'The answer is in the docs and nothing about it touches money or an account, so it sends itself unless you stop it.',
  },
  hold: {
    // Relative to the real clock: a deadline in the past renders as 'any
    // moment', which is a different sentence from a running countdown.
    until: new Date(Date.now() + 8 * 60_000 + 8_000).toISOString(),
    remaining_seconds: { value: 488, available: true },
    verb: 'Sends',
    expired: false,
    note: 'Touching the reply box stops the clock.',
  },
}

export const cases: Record<string, CaseDetail> = {
  '752473': morganCase,
  '900112': heldCase,
}
