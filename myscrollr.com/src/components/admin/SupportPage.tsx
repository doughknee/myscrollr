import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  HelpCircle,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Radio,
  Search,
  Star,
} from 'lucide-react'
import { useAdminStatus } from './AdminShell'
import type {
  AdminFix,
  AdminHold,
  AutoSendState,
  CaseDetail,
  QueueDir,
  QueuePerson,
  QueueRow,
  QueueRowsMode,
  QueueSection,
  QueueSort,
  SupportQueue,
} from '@/api/admin'
import { adminApi, subscribeToSupportEvents } from '@/api/admin'
import CaseActions from '@/components/admin/CaseActions'
import {
  QUEUE_SECTIONS,
  SORT_FIELDS,
  diagnosticsChips,
  directionLabel,
  dispositionTone,
  fixBadge,
  formatWait,
  holdCountdown,
  identityLabel,
  personMeta,
  personTitle,
  planBadge,
  relativeAge,
} from '@/lib/supportConsole'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * The Support section, rebuilt around people (REL-266).
 *
 * REL-263 built this page as a debugging view, because that is what its brief
 * asked for: the whole triage pipeline under every case, sixty tickets at
 * equal weight, eight all-caps sections expanded at once. The bot does the
 * triage now. This page is for the exceptions, and it is built on three rules.
 *
 * A ROW IS A PERSON. Rachel Armstrong wrote five times in one afternoon; you
 * answer a human, not a queue. The grouping is the server's — the browser
 * never re-derives who is who from an email.
 *
 * PAYING CUSTOMERS ARE A SECTION. Priority support is something we sold, so no
 * sort a reader picks can push one below anybody else. The sections are fixed
 * and the sort works inside them.
 *
 * NOTHING IS RECOMPUTED HERE. Disposition, hold expiry, the proven-fix answer,
 * who sent the last reply, and which section a person belongs in all arrive
 * decided. The browser formats them. The sort and the search are query
 * parameters for the same reason: one queue read is capped at 500 cases, and a
 * browser sorting whatever fitted would present a sorted page as a sorted
 * queue.
 *
 * The case view stops dumping. Above the fold: their words, one sentence on
 * why it stopped, the draft where it can be edited, and the actions.
 * Everything else moved one level down behind "Why it decided this" — moved,
 * not deleted, because the whole point of REL-263 was that this data had never
 * been readable anywhere.
 *
 * SCROLLR-219 laid the same page out as a workbench. Nothing about what any
 * button does changed; what changed is where the three things a reader is
 * doing at once now sit. The queue, the conversation and the reply are three
 * panes that scroll independently inside the console shell, so the window
 * never scrolls and none of the three pushes the others off screen. The two
 * stacked status banners became two pills in the shell's bar, because the
 * live stream and the auto-send switch are facts about the console, not about
 * the ticket you happen to have open. The per-case countdown stayed on the
 * case for exactly that reason.
 */

// ── small shared pieces ───────────────────────────────────────────

function Field({
  label,
  value,
  empty,
  mono,
}: {
  label: string
  value?: string | null
  empty: string
  mono?: boolean
}) {
  const has = typeof value === 'string' && value.trim() !== ''
  return (
    <div className="border-b border-base-300/40 px-4 py-3 last:border-0">
      <p className="text-xs font-semibold tracking-wide text-base-content/45 uppercase">
        {label}
      </p>
      <p
        className={`mt-1 text-sm whitespace-pre-wrap ${
          has ? 'text-base-content/85' : 'text-base-content/45 italic'
        } ${mono && has ? 'font-mono text-xs' : ''}`}
      >
        {has ? value : empty}
      </p>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-1 text-xs text-base-content/50">{subtitle}</p>
      )}
      <div className="mt-2 rounded-xl ring-1 ring-base-300/60">{children}</div>
    </section>
  )
}

const TONE_RING: Record<string, string> = {
  stop: 'ring-error/40 bg-error/5',
  clock: 'ring-warning/40 bg-warning/5',
  ask: 'ring-info/40 bg-info/5',
  done: 'ring-base-300/60',
  none: 'ring-base-300/60',
}

/** A pill. One place, so the queue and the case view cannot drift apart. */
function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'paying' | 'needs' | 'edited' | 'done' | 'behind'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-base-200 text-base-content/65',
    paying: 'bg-success/15 text-success',
    needs: 'bg-error/10 text-error',
    edited: 'bg-secondary/15 text-secondary',
    done: 'bg-success/10 text-success',
    behind: 'bg-warning/15 text-warning',
  }
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** The provenance chip: sent by the bot, or you edited it. Server's words. */
function ProvenancePill({
  provenance,
  label,
}: {
  provenance?: string
  label?: string
}) {
  if (!label) return null
  return (
    <Pill tone={provenance === 'edited' ? 'edited' : 'neutral'}>{label}</Pill>
  )
}

/**
 * The countdown. `holdCountdown` returns a null display whenever the server
 * marked the number unavailable, and this renders the sentence instead — a
 * hold that is not counting down to anything must never look like one that is.
 */
function HoldBanner({
  hold,
  autosend,
}: {
  hold: AdminHold
  autosend: AutoSendState
}) {
  // One tick a second, only to re-render: holdCountdown derives the remaining
  // time from the server's deadline, so nothing here tracks it in state.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!hold.remaining_seconds.available || hold.expired) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [hold])

  const live = holdCountdown(hold)

  return (
    <div
      className={`rounded-xl px-4 py-3 ring-1 ${
        live.display
          ? 'bg-warning/10 ring-warning/40'
          : 'bg-base-200/40 ring-base-300/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        <Clock size={16} className="translate-y-0.5 shrink-0" />
        {live.display ? (
          <p className="text-sm font-semibold">
            {hold.verb} in {live.display}
          </p>
        ) : (
          <p className="text-sm font-semibold">
            {hold.verb} — on hold, not counting down
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-base-content/65">{live.note}</p>
      {!autosend.armed && (
        <p className="mt-1 text-xs text-base-content/50">{autosend.note}</p>
      )}
    </div>
  )
}

function FixCard({ fix }: { fix: AdminFix }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 ring-1 ${
        fix.proven
          ? 'bg-success/5 ring-success/40'
          : 'bg-base-200/40 ring-base-300/60'
      }`}
    >
      <div className="flex items-baseline gap-2">
        {fix.proven ? (
          <CheckCircle2
            size={16}
            className="translate-y-0.5 shrink-0 text-success"
          />
        ) : (
          <HelpCircle
            size={16}
            className="translate-y-0.5 shrink-0 text-base-content/40"
          />
        )}
        <p className="text-sm font-semibold">
          {fix.proven
            ? `Fix on record — shipped in ${fix.version}`
            : 'No fix on record'}
        </p>
      </div>
      <p className="mt-1 text-xs text-base-content/65">{fix.reason}</p>
      {fix.release_url && (
        <a
          href={fix.release_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          The release <ExternalLink size={12} />
        </a>
      )}
    </div>
  )
}

// ── everything that moved one level down ──────────────────────────

const KIND_LABEL: Record<string, string> = {
  user: 'They wrote',
  sent: 'We replied',
  ai_draft: 'Drafted, never sent',
  note: 'Internal note',
}

/** The eyebrow over each message, in the words the reader uses. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-bold tracking-[0.08em] text-base-content/45 uppercase">
      {children}
    </span>
  )
}

/**
 * The thread, oldest first.
 *
 * Every message is a card except an internal note, which is a left-rule block:
 * a note is us talking to ourselves, and giving it the same card as the words
 * a customer wrote puts them at the same weight.
 */
function Conversation({ detail }: { detail: CaseDetail }) {
  const messages = detail.messages ?? []
  if (messages.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>The conversation</Eyebrow>
        <p className="text-sm text-base-content/50">
          Nothing is on record for this ticket. The case database only carries
          messages the API saw or backfilled from osTicket, so an older ticket
          answered entirely inside osTicket can look empty here.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m, i) => {
        const note = m.kind === 'note'
        return (
          <div key={`${m.created_at}-${i}`} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Eyebrow>{KIND_LABEL[m.kind] ?? m.kind}</Eyebrow>
              <span className="font-mono text-xs text-base-content/45">
                {new Date(m.created_at).toLocaleString()}
                {m.superseded && ' · superseded'}
              </span>
            </div>
            {note ? (
              <p className="border-l-2 border-base-300 pl-4 text-[13px] whitespace-pre-wrap text-base-content/65">
                {m.body || '(empty)'}
              </p>
            ) : (
              <p
                className={`rounded-xl bg-base-150 px-4 py-3.5 text-sm leading-[1.55] whitespace-pre-wrap ring-1 ring-hairline ${
                  m.kind === 'ai_draft'
                    ? 'text-base-content/55 italic'
                    : 'text-base-content/85'
                }`}
              >
                {m.body || '(empty)'}
              </p>
            )}
          </div>
        )
      })}
      <p className="text-xs text-base-content/45">
        Oldest first. Drafts that were never sent are shown too, marked as such
        — this is the record of what we wrote, not only of what they read.
      </p>
    </div>
  )
}

function Pipeline({ detail }: { detail: CaseDetail }) {
  const draft = detail.draft
  if (!draft) {
    return (
      <Panel title="The pipeline">
        <p className="p-4 text-sm text-base-content/60">
          {detail.draft_note ?? 'There is no draft on this case.'}
        </p>
      </Panel>
    )
  }
  const tone = dispositionTone(draft.disposition, draft.status)

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
          What the server decided
        </h3>
        <div className={`mt-2 rounded-xl px-4 py-3 ring-1 ${TONE_RING[tone]}`}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {tone === 'stop' && (
              <AlertTriangle size={16} className="translate-y-0.5 text-error" />
            )}
            <span className="font-mono text-sm font-semibold">
              {draft.disposition || 'no disposition recorded'}
            </span>
            <span className="text-xs text-base-content/50">
              draft is {draft.status}
              {draft.intervened && ' · a person intervened'}
            </span>
          </div>
          {/* The rule that fired, verbatim. An escalation whose reason has to
              be guessed at is the Discord queue again. */}
          <p className="mt-2 max-w-[75ch] text-sm text-base-content/85">
            {draft.disposition_reason ||
              'No reason was recorded. This draft predates the autonomous policy, so nothing will send it on its own.'}
          </p>
        </div>
      </section>

      {/* The hold banner used to be repeated here as well as on the case.
          The countdown belongs to the ticket, so it is rendered once, beside
          the ticket (SCROLLR-219). */}

      {/* The draft as the model wrote it. The editable copy is above the
          fold; this is the original, and it only earns its place once an
          edit has replaced it. */}
      {draft.edited_body && (
        <Panel
          title="What the drafter wrote"
          subtitle="The original, before the edit that replaced it."
        >
          <div className="p-4">
            <p className="max-w-[75ch] text-sm whitespace-pre-wrap text-base-content/85">
              {draft.body || '(the drafting call produced no body)'}
            </p>
          </div>
        </Panel>
      )}

      <Panel title="What the classifier decided">
        <div className="grid grid-cols-2 gap-px bg-base-300/40 sm:grid-cols-3">
          {[
            ['Category', draft.category],
            ['Drafter said', draft.drafter_category],
            ['Priority', draft.priority],
            ['Confidence', draft.confidence],
            ['Sentiment', draft.sentiment],
            ['Duplicate of', draft.duplicate_of],
          ].map(([label, value]) => (
            <div key={label} className="bg-base-100 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-base-content/45 uppercase">
                {label}
              </p>
              <p className="mt-1 text-sm text-base-content/85">
                {value && String(value).trim() !== '' ? (
                  String(value)
                ) : (
                  <span className="text-base-content/40 italic">unset</span>
                )}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-base-300/40 px-4 py-3 text-xs text-base-content/60">
          needs_info is{' '}
          <span className="font-semibold">{String(draft.needs_info)}</span>;
          should_close is{' '}
          <span className="font-semibold">{String(draft.should_close)}</span>.
          {draft.category &&
            draft.drafter_category &&
            draft.category !== draft.drafter_category && (
              <>
                {' '}
                The two calls disagreed on the category, which is itself an
                escalation rule.
              </>
            )}
        </div>
      </Panel>
    </div>
  )
}

/**
 * What the draft says it knows, and what it still wants.
 *
 * Lifted out of `Pipeline` unchanged so it can be its own disclosure
 * (SCROLLR-219): "why it decided this" and "what it still does not know" are
 * two different questions, and they were answered in one scroll.
 */
function WhatItKnows({ detail }: { detail: CaseDetail }) {
  const draft = detail.draft
  if (!draft) {
    return (
      <p className="text-sm text-base-content/60">
        {detail.draft_note ?? 'There is no draft on this case.'}
      </p>
    )
  }
  return (
    <Panel
      title="What it says it knows"
      subtitle="Empty is an answer. A draft that cites nothing is escalated on exactly that."
    >
      <Field
        label="Grounded in"
        value={draft.grounded_in}
        empty="Cites nothing."
      />
      <Field
        label="Unknowns"
        value={draft.unknowns}
        empty="Nothing left open."
      />
      <Field
        label="Wants to ask"
        value={draft.ask_user_for}
        empty="Asks for nothing — this is meant as a final answer."
      />
      <Field
        label="Internal note"
        value={draft.internal_note}
        empty="No note to us."
      />
    </Panel>
  )
}

/** What the model was told about them, plus what it was shown. */
function TheEvidence({ detail }: { detail: CaseDetail }) {
  const ctx = detail.context
  const widgets = ctx.widgets ?? []
  const similar = detail.similar ?? []

  return (
    <div className="space-y-5">
      <Panel title="What the model was told about them" subtitle={ctx.note}>
        <div className="grid grid-cols-2 gap-px bg-base-300/40 sm:grid-cols-3">
          {[
            ['Plan when it opened', ctx.tier],
            [
              'App version',
              ctx.app_version
                ? `${ctx.app_version}${
                    ctx.version_state === 'behind'
                      ? ` (behind ${ctx.current_version})`
                      : ctx.version_state === 'current'
                        ? ' (current)'
                        : ''
                  }`
                : 'unknown',
            ],
            ['Operating system', ctx.os || 'unknown'],
            [
              'Monitors',
              ctx.monitors_attached > 0
                ? `${ctx.monitors_attached} attached, ${ctx.monitors_chosen} chosen`
                : 'unknown',
            ],
            [
              'Widgets',
              widgets.length === 0
                ? 'none known'
                : `${widgets.length} added, ${
                    widgets.filter((w) => w.on_ticker).length
                  } on the bar`,
            ],
            [
              'Waiting',
              detail.stale_days >= detail.stale_after
                ? `${detail.stale_days} days — past the ${detail.stale_after}-day line, so a reply must ask rather than tell`
                : `${detail.stale_days} days since they last wrote`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="bg-base-100 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-base-content/45 uppercase">
                {label}
              </p>
              <p className="mt-1 text-sm text-base-content/85">{value}</p>
            </div>
          ))}
        </div>
        {/* The plan above is tier_at_open — what the model was told on the day
            — and the header carries the current one. Saying which is which is
            the difference between a diagnostic and a contradiction. */}
        <p className="border-t border-base-300/40 px-4 py-3 text-xs text-base-content/60">
          This is the plan as the ticket recorded it when it opened. The badge
          in the header is the subscription they are on now.
        </p>
        {!ctx.has_diagnostics && (
          <p className="border-t border-base-300/40 px-4 py-3 text-xs text-base-content/60">
            No diagnostics were attached to this ticket, so the version, OS and
            monitor counts above are whatever the case row already knew.
          </p>
        )}
        {widgets.length > 0 && (
          <p className="border-t border-base-300/40 px-4 py-3 text-xs text-base-content/60">
            {widgets
              .map((w) => `${w.type}${w.on_ticker ? ' (on the bar)' : ''}`)
              .join(', ')}
          </p>
        )}
      </Panel>

      <section>
        <h3 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
          Can we claim a fix?
        </h3>
        <div className="mt-2">
          <FixCard fix={detail.fix} />
        </div>
      </section>

      <Panel title="What it was shown" subtitle={detail.evidence_note}>
        {similar.length === 0 ? (
          <p className="p-4 text-sm text-base-content/50">
            No past case we replied to matches this one closely enough to be a
            precedent.
          </p>
        ) : (
          <div className="divide-y divide-base-300/40">
            {similar.map((s) => (
              <div key={s.ticket_number} className="p-4">
                <p className="text-sm font-medium">
                  {s.subject}{' '}
                  <span className="font-mono text-xs text-base-content/45">
                    #{s.ticket_number}
                  </span>
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-base-content/60">
                  <span className="font-semibold">They wrote:</span>{' '}
                  {s.user_wrote}
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-base-content/60">
                  <span className="font-semibold">We sent:</span> {s.we_sent}
                </p>
              </div>
            ))}
          </div>
        )}
        {detail.known_issues && (
          <details className="border-t border-base-300/40 p-4">
            <summary className="cursor-pointer text-xs font-semibold tracking-wide text-base-content/50 uppercase">
              The known-issues block
            </summary>
            <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-base-content/70">
              {detail.known_issues}
            </pre>
          </details>
        )}
      </Panel>
    </div>
  )
}

// ── the case ──────────────────────────────────────────────────────

/** Loads one case and renders it. Used by both the case and person views. */
function useCase(ticket: string | null, reloadKey: number) {
  const getToken = useGetToken()
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The panel is NOT blanked on a re-read — only on a change of ticket — so a
  // reply landing while you are reading does not throw the page away.
  useEffect(() => setDetail(null), [ticket])

  useEffect(() => {
    if (!ticket) return
    let cancelled = false
    setError(null)
    adminApi
      .supportCase(getToken, ticket)
      .then((res) => !cancelled && setDetail(res))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setError(
            err instanceof Error
              ? err.message
              : 'That case could not be loaded.',
          ),
      )
    return () => {
      cancelled = true
    }
  }, [getToken, ticket, reloadKey])

  return { detail, error, setDetail }
}

/**
 * Who wrote in, above their thread.
 *
 * `person` is absent when the queue is reading by ticket; then the same facts
 * come off the case itself. Neither path invents anything the other knows —
 * a ticket read alone simply has one person's worth of history, not five.
 */
function PersonHeader({
  person,
  rows,
  detail,
}: {
  person: QueuePerson | null
  rows: Array<QueueRow>
  detail: CaseDetail | null
}) {
  const subject = person ?? {
    name: detail?.user_name,
    email: detail?.user_email,
    plan: detail?.plan,
    paying: detail?.paying ?? false,
    identity_state: detail?.identity_state ?? 'unknown_contact',
    plan_note: detail?.plan_note,
  }
  const who = personTitle(subject)
  const badge = planBadge(subject)
  const firstWrote =
    rows.reduce<string | null>(
      (min, r) => (min === null || r.opened_at < min ? r.opened_at : min),
      null,
    ) ??
    detail?.opened_at ??
    null

  const tickets = person?.tickets ?? (detail ? 1 : 0)
  const handled = person?.handled ?? 0
  const chips = detail ? diagnosticsChips(detail.context) : []
  const behind = detail?.context.version_state === 'behind'

  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h1
            className={`text-[22px] leading-tight font-extrabold tracking-[-0.02em] ${
              who.known ? '' : 'text-base-content/75 italic'
            }`}
          >
            {who.title}
          </h1>
          {badge ? (
            <Pill tone={badge.paying ? 'paying' : 'neutral'}>
              {badge.label}
            </Pill>
          ) : (
            <span className="text-[13px] text-base-content/45 italic">
              {identityLabel(subject.identity_state)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] text-base-content/65">
          {[
            who.subtitle,
            rows.find((r) => r.os)?.os ?? detail?.context.os,
            firstWrote &&
              `first wrote ${new Date(firstWrote).toLocaleDateString()}`,
            tickets > 0 &&
              `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'}${
                handled > 0 ? `, ${handled} resolved` : ''
              }`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {subject.plan_note && (
          <p className="mt-1.5 max-w-[75ch] text-xs text-base-content/50">
            {subject.plan_note}
          </p>
        )}
      </div>

      {detail && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {chips.map((chip, i) => (
            <Pill key={chip} tone={i === 1 && behind ? 'behind' : 'neutral'}>
              {chip}
            </Pill>
          ))}
          <Pill>Opened {new Date(detail.opened_at).toLocaleDateString()}</Pill>
        </div>
      )}
    </header>
  )
}

/**
 * The open ticket: why it stopped, the countdown if one is running, and the
 * thread. The reply and everything behind it live in the workbench, which is
 * its own pane from 1440 up and sits under this below that.
 */
function CaseConversation({ detail }: { detail: CaseDetail }) {
  const tone = dispositionTone(detail.draft?.disposition, detail.draft?.status)
  const stopped = detail.draft?.disposition_reason || detail.group_reason

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-bold">
          {detail.subject || '(no subject)'}
        </h2>
        <span className="font-mono text-xs text-base-content/45">
          #{detail.ticket_number}
        </span>
      </div>

      {/* Why it stopped, in one sentence, before anything else. The old page
          made you read eight sections to find this out. */}
      <div className={`rounded-xl px-4 py-3 ring-1 ${TONE_RING[tone]}`}>
        <div className="flex gap-2.5">
          {tone === 'stop' ? (
            <AlertTriangle
              size={17}
              className="mt-0.5 shrink-0 text-error"
              aria-hidden
            />
          ) : (
            <HelpCircle
              size={17}
              className="mt-0.5 shrink-0 text-base-content/40"
              aria-hidden
            />
          )}
          <p className="max-w-[75ch] text-sm leading-relaxed">{stopped}</p>
        </div>
      </div>

      {detail.hold && (
        <HoldBanner hold={detail.hold} autosend={detail.autosend} />
      )}

      <Conversation detail={detail} />
    </section>
  )
}

/** A collapsed disclosure. Closed on load; everything under it still exists. */
function Disclosure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <details className="group border-t border-hairline last:border-b">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-base-content/75 hover:text-base-content">
        <ChevronRight
          size={14}
          className="shrink-0 transition-transform group-open:rotate-90"
        />
        {label}
      </summary>
      <div className="pt-1 pb-5">{children}</div>
    </details>
  )
}

/** One fact about them, label left and value right. */
function AboutRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-hairline py-2 text-[13px]">
      <span className="text-base-content/65">{label}</span>
      <span
        className={`font-mono font-medium whitespace-nowrap ${
          tone === 'warn' ? 'text-warning' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/** The five facts the reply is written against. */
function AboutThem({ detail }: { detail: CaseDetail }) {
  const ctx = detail.context
  const widgets = ctx.widgets ?? []
  const behind = ctx.version_state === 'behind'
  return (
    <section className="flex flex-col">
      <div className="pb-1">
        <Eyebrow>About them</Eyebrow>
      </div>
      <AboutRow label="Plan" value={planBadge(detail)?.label ?? 'none'} />
      <AboutRow
        label="App version"
        tone={behind ? 'warn' : undefined}
        value={
          ctx.app_version
            ? behind && ctx.current_version
              ? `${ctx.app_version} · behind ${ctx.current_version}`
              : ctx.app_version
            : 'unknown'
        }
      />
      <AboutRow label="Operating system" value={ctx.os || 'unknown'} />
      <AboutRow
        label="Monitors · widgets"
        value={
          ctx.monitors_attached > 0 || widgets.length > 0
            ? `${ctx.monitors_attached} · ${widgets.length}`
            : 'unknown'
        }
      />
      <AboutRow
        label="Waiting since"
        value={`${detail.stale_days} ${detail.stale_days === 1 ? 'day' : 'days'}`}
      />
    </section>
  )
}

/**
 * The reply, the verbs, and everything one level down.
 *
 * Every button is the same button it was — `CaseActions` is untouched. The
 * three disclosures hold the read-only blocks REL-263 built, unchanged and
 * closed, because they are what you read when the answer is not obvious and
 * noise when it is.
 */
function CaseWorkbench({
  detail,
  onCase,
}: {
  detail: CaseDetail
  onCase: (next: CaseDetail) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <CaseActions detail={detail} onCase={onCase} />

      <div className="flex flex-col">
        <Disclosure label="Why it decided this">
          <Pipeline detail={detail} />
        </Disclosure>
        <Disclosure label="What it knows and wants to ask">
          <WhatItKnows detail={detail} />
        </Disclosure>
        <Disclosure label="Full diagnostics">
          <div className="space-y-5">
            <TheEvidence detail={detail} />
            <Panel title="What the ticket carried">
              <pre className="max-h-96 overflow-auto p-4 text-xs whitespace-pre-wrap text-base-content/70">
                {JSON.stringify(detail.context, null, 2)}
              </pre>
            </Panel>
            {detail.discord_url && (
              <a
                href={detail.discord_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <MessageSquare size={12} /> The Discord thread
              </a>
            )}
          </div>
        </Disclosure>
      </div>

      <AboutThem detail={detail} />
    </div>
  )
}

/**
 * The person's other tickets, at the end of their thread.
 *
 * Picking one makes it the open ticket. That is the whole argument for
 * grouping: five rows shouting becomes one person with a history, and the
 * history is a list you step through rather than five cases open at once.
 */
function OtherTickets({
  rows,
  active,
  onSelect,
}: {
  rows: Array<QueueRow>
  active: string | null
  onSelect: (ticket: string) => void
}) {
  const others = rows.filter((r) => r.ticket_number !== active)
  if (others.length === 0) return null
  return (
    <section className="flex flex-col">
      <div className="pb-1.5">
        <Eyebrow>Their other tickets</Eyebrow>
      </div>
      {others.map((r) => (
        <button
          key={r.ticket_number}
          type="button"
          onClick={() => onSelect(r.ticket_number)}
          className={`flex w-full cursor-pointer items-center gap-3 border-t border-hairline py-2.5 text-left hover:bg-base-200/40 ${
            r.group === 'handled' ? 'opacity-70' : ''
          }`}
        >
          <span className="w-16 shrink-0 font-mono text-xs text-base-content/45">
            #{r.ticket_number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {r.subject || '(no subject)'}
            </span>
            <span className="block truncate text-xs text-base-content/50">
              {r.group_reason}
            </span>
          </span>
          {r.group === 'needs_you' ? (
            <Pill tone="needs">needs you</Pill>
          ) : r.group === 'handled' ? (
            <Pill tone="done">resolved</Pill>
          ) : (
            <ProvenancePill
              provenance={r.provenance}
              label={r.provenance_label}
            />
          )}
          <ChevronRight
            size={14}
            className="shrink-0 text-base-content/35"
            aria-hidden
          />
        </button>
      ))}
    </section>
  )
}

// ── the queue ─────────────────────────────────────────────────────

/** The shared shape of a queue card, so a person and a ticket cannot drift. */
function QueueCard({
  active,
  onSelect,
  children,
}: {
  active: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      /* A <button> centres its text; the card is three left-aligned lines. */
      className={`w-full cursor-pointer rounded-lg px-2.5 py-2.5 text-left transition-colors ${
        active
          ? 'bg-base-200 ring-1 ring-primary'
          : 'hover:bg-base-200/50 ring-1 ring-transparent'
      }`}
    >
      {children}
    </button>
  )
}

function PersonCard({
  person,
  active,
  onSelect,
}: {
  person: QueuePerson
  active: boolean
  onSelect: () => void
}) {
  const who = personTitle(person)
  const badge = planBadge(person)
  return (
    <QueueCard active={active} onSelect={onSelect}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-sm font-bold ${who.known ? '' : 'text-base-content/75 italic'}`}
        >
          {who.title}
        </span>
        {badge ? (
          <Pill tone={badge.paying ? 'paying' : 'neutral'}>{badge.label}</Pill>
        ) : (
          person.section === 'answered' && (
            <ProvenancePill
              provenance={person.provenance}
              label={person.provenance_label}
            />
          )
        )}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-base-content/85">
        {person.headline ?? 'No ticket on record'}
        {person.needs_you > 0 && (
          <span className="font-semibold text-error"> · needs you</span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-base-content/45">
        <span className="truncate">
          {who.subtitle ?? identityLabel(person.identity_state)}
        </span>
        {/* The short form of `personMeta`, because on a 380px card the email
            and the meta share one line and the email is the identifying half.
            Same two facts, same source, same "never wrote in" for a person
            with nothing on record — a wait of none is not a wait of zero. */}
        <span className="shrink-0 font-mono" title={personMeta(person)}>
          {person.tickets === 1 ? '1 ticket' : `${person.tickets} tickets`} ·{' '}
          {relativeAge(person.last_user_message_at) ?? 'never wrote in'}
        </span>
      </div>
    </QueueCard>
  )
}

function TicketCard({
  row,
  active,
  onSelect,
}: {
  row: QueueRow
  active: boolean
  onSelect: () => void
}) {
  const wait = formatWait(row.waiting_hours)
  const countdown = holdCountdown(row.hold)
  const badge = fixBadge(row.fix ?? null)
  return (
    <QueueCard active={active} onSelect={onSelect}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold">
          {row.name || row.user_email || 'Requester unknown'}
        </span>
        {countdown.display ? (
          <Pill tone="needs">sends in {countdown.display}</Pill>
        ) : (
          <ProvenancePill
            provenance={row.provenance}
            label={row.provenance_label}
          />
        )}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-base-content/85">
        {row.subject || '(no subject)'}
        {row.group === 'needs_you' && (
          <span className="font-semibold text-error"> · needs you</span>
        )}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-base-content/45">
        <span className="truncate">
          #{row.ticket_number}
          {badge ? ` · ${badge}` : ''}
        </span>
        <span className="shrink-0 font-mono">
          {wait ? `waiting ${wait}` : 'wait unknown'}
        </span>
      </div>
    </QueueCard>
  )
}

/**
 * Search, then the two sort controls and the direction.
 *
 * The field and what-a-row-is are pills; the direction stays its own control
 * so reversing never costs a trip through a dropdown — the whole complaint the
 * "one sort control" mockup was rejected over. Its label is the sentence a
 * reader would say, right-aligned and dim, exactly where the drawing put it.
 */
function SortBar({
  sort,
  dir,
  rowsMode,
  search,
  onSort,
  onDir,
  onRowsMode,
  onSearch,
}: {
  sort: QueueSort
  dir: QueueDir
  rowsMode: QueueRowsMode
  search: string
  onSort: (s: QueueSort) => void
  onDir: (d: QueueDir) => void
  onRowsMode: (m: QueueRowsMode) => void
  onSearch: (q: string) => void
}) {
  const pill =
    'h-8 cursor-pointer rounded-full bg-base-150 px-3 text-xs font-semibold text-base-content/80 ring-1 ring-hairline outline-none focus:ring-2 focus:ring-primary/50'
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex h-[38px] items-center gap-2 rounded-lg bg-base-150 px-3 ring-1 ring-hairline focus-within:ring-2 focus-within:ring-primary/50">
        <Search size={15} className="shrink-0 text-base-content/40" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search people and tickets"
          aria-label="Search people and tickets"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sort}
          onChange={(e) => onSort(e.target.value as QueueSort)}
          aria-label="Sort by"
          className={pill}
        >
          {SORT_FIELDS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          value={rowsMode}
          onChange={(e) => onRowsMode(e.target.value as QueueRowsMode)}
          aria-label="What a row is"
          className={pill}
        >
          <option value="person">By person</option>
          <option value="ticket">By ticket</option>
        </select>

        {/* Its own control. Reversing is one click, both ways. */}
        <button
          type="button"
          onClick={() => onDir(dir === 'asc' ? 'desc' : 'asc')}
          title="Sections never reorder; this sorts inside each one."
          aria-label={`Direction: ${directionLabel(sort, dir)}`}
          className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs whitespace-nowrap text-base-content/45 hover:text-base-content"
        >
          {dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
          {directionLabel(sort, dir).toLowerCase()}
        </button>
      </div>
    </div>
  )
}

const SECTION_STYLE: Record<QueueSection, string> = {
  paying: 'text-success',
  open: 'text-error',
  answered: 'text-base-content/55',
  resolved: 'text-base-content/45',
}

/** The live-stream and auto-send pills, for the console bar's status slot. */
function StatusPills({
  live,
  autosend,
  switching,
  onToggle,
}: {
  live: boolean
  autosend: AutoSendState | null
  switching: boolean
  onToggle: () => void
}) {
  const pill =
    'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold'
  return (
    <>
      <span
        className={`${pill} ${live ? 'bg-success/12 text-success' : 'bg-base-200 text-base-content/60'}`}
        title={
          live
            ? 'Live — holds and replies appear here without a refresh.'
            : 'Not connected to the live stream; this page is showing what it last read.'
        }
      >
        <Radio size={12} aria-hidden />
        {live ? 'live' : 'not connected'}
      </span>

      {autosend &&
        /* The switch /pause and /resume throw, kept as the pill itself. When
           sending is disabled outright there is nothing to toggle, so it is a
           label rather than a dead button. */
        (autosend.enabled ? (
          <button
            type="button"
            onClick={onToggle}
            disabled={switching}
            title={autosend.note}
            className={`${pill} cursor-pointer disabled:opacity-50 ${
              autosend.armed
                ? 'bg-warning/12 text-warning'
                : 'bg-base-200 text-base-content/60'
            }`}
          >
            {switching ? (
              <Loader2 size={11} className="animate-spin" />
            ) : autosend.armed ? (
              <Pause size={11} aria-hidden />
            ) : (
              <Play size={11} aria-hidden />
            )}
            {autosend.armed ? 'Auto-send on' : 'Auto-send off'}
            {autosend.armed && (
              /* The hold length is the detail, not the state. It is the first
                 thing to go when the bar runs out of room; the switch
                 position never is. */
              <span className="hidden xl:inline">{` · ${autosend.hold_minutes} min hold`}</span>
            )}
          </button>
        ) : (
          <span
            className={`${pill} bg-base-200 text-base-content/60`}
            title={autosend.note}
          >
            Auto-send off
          </span>
        ))}
    </>
  )
}

/**
 * Three panes from 1440 up, two below it.
 *
 * Under 1440 the reply and the evidence are appended to the conversation in
 * the same order rather than rendered twice — two copies of the reply box
 * would be two independent drafts of the same answer.
 */
function useThreePane() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1440px)')
    const sync = () => setWide(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return wide
}

export default function SupportPage() {
  const getToken = useGetToken()
  const [sort, setSort] = useState<QueueSort>('last_wrote')
  const [dir, setDir] = useState<QueueDir>('desc')
  const [rowsMode, setRowsMode] = useState<QueueRowsMode>('person')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  const [queue, setQueue] = useState<SupportQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [queueKey, setQueueKey] = useState(0)
  const [caseKey, setCaseKey] = useState(0)
  const [switching, setSwitching] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const wide = useThreePane()

  // The search is a server round trip, so it waits for a pause in typing
  // rather than firing a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    let cancelled = false
    adminApi
      .supportQueue(getToken, { sort, dir, rows: rowsMode, q: debounced })
      .then((res) => !cancelled && setQueue(res))
      .catch(
        (err: unknown) =>
          !cancelled &&
          setError(
            err instanceof Error
              ? err.message
              : 'The support queue could not be loaded.',
          ),
      )
    return () => {
      cancelled = true
    }
  }, [getToken, sort, dir, rowsMode, debounced, queueKey])

  useEffect(() => load(), [load])

  // The open row lives in a ref so the subscription below never has to be torn
  // down and rebuilt when the selection changes — reconnecting the stream on
  // every click would drop events in the gap.
  const openRef = useRef<Array<string>>([])
  const rows = useMemo(() => queue?.rows ?? [], [queue])
  const people = useMemo(() => queue?.people ?? [], [queue])

  const person = useMemo(
    () => people.find((p) => p.key === selectedPerson) ?? null,
    [people, selectedPerson],
  )
  openRef.current = person
    ? (person.ticket_numbers ?? [])
    : selectedTicket
      ? [selectedTicket]
      : []

  useEffect(() => {
    return subscribeToSupportEvents(
      getToken,
      (event) => {
        // Every event moves the queue: a section, a countdown or a row. The
        // open case is re-read only when the event is about something on
        // screen, or about the pipeline switch, which changes what every
        // countdown means.
        setQueueKey((n) => n + 1)
        if (
          !event.ticket_number ||
          openRef.current.includes(event.ticket_number)
        ) {
          setCaseKey((n) => n + 1)
        }
      },
      setLive,
    )
  }, [getToken])

  const toggleAutoSend = async () => {
    if (!queue) return
    setSwitching(true)
    try {
      const next = await adminApi.setAutoSendPaused(
        getToken,
        !queue.autosend.paused,
      )
      setQueue({ ...queue, autosend: next })
      setQueueKey((n) => n + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'The switch did not move.')
    } finally {
      setSwitching(false)
    }
  }

  const toggleRef = useRef(toggleAutoSend)
  toggleRef.current = toggleAutoSend
  // Memoised on what it renders: an element rebuilt every render would set the
  // shell's state every render (see `useAdminStatus`). The switch goes through
  // a ref for the same reason — it closes over the queue it writes, so it is a
  // new function on every queue read and cannot be a dependency.
  const autosend = queue?.autosend ?? null
  const status = useMemo(
    () => (
      <StatusPills
        live={live}
        autosend={autosend}
        switching={switching}
        onToggle={() => void toggleRef.current()}
      />
    ),
    [live, autosend, switching],
  )
  useAdminStatus(status)

  /** The person's tickets, newest first. Empty when reading by ticket. */
  const mine = useMemo(() => {
    if (!person) return []
    const numbers = new Set(person.ticket_numbers ?? [])
    return rows
      .filter((r) => numbers.has(r.ticket_number))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [person, rows])

  // The thread that opens by default is the one that needs a person. Anything
  // else makes you click to find the only thing on the row asking for you.
  const activeTicket = useMemo(() => {
    if (rowsMode === 'ticket') return selectedTicket
    if (!person) return null
    if (
      selectedTicket &&
      (person.ticket_numbers ?? []).includes(selectedTicket)
    ) {
      return selectedTicket
    }
    return (
      mine.find((r) => r.group === 'needs_you')?.ticket_number ??
      (mine.length > 0 ? mine[0].ticket_number : null)
    )
  }, [rowsMode, selectedTicket, person, mine])

  const { detail, error: caseError, setDetail } = useCase(activeTicket, caseKey)

  const selected = rowsMode === 'person' ? selectedPerson : selectedTicket
  const back = () => {
    setSelectedPerson(null)
    setSelectedTicket(null)
  }
  const needsYou = queue?.counts.needs_you ?? 0
  const waiting = queue?.counts.waiting ?? 0
  const resolved = queue?.counts.handled ?? 0

  const workbench =
    detail && !caseError ? (
      <CaseWorkbench detail={detail} onCase={setDetail} />
    ) : null

  return (
    /* The console shell's <main> is full-bleed and 48px below the bar. From
       768 up this page is exactly that tall and each pane scrolls on its own,
       so the window never scrolls. Below it the mobile nav adds a row of its
       own and the page is an ordinary scrolling column. */
    <div className="flex flex-col md:h-[calc(100dvh-48px)]">
      <div className="flex h-11 shrink-0 flex-wrap items-baseline gap-x-2.5 overflow-hidden border-b border-hairline px-4">
        <h1 className="self-center text-base font-extrabold tracking-[-0.01em]">
          Support
        </h1>
        <span className="self-center text-[13px] font-bold text-error">
          {needsYou === 1 ? '1 needs you' : `${needsYou} need you`}
        </span>
        <span className="self-center text-[13px] text-base-content/45">
          · {waiting} waiting on them · {resolved} resolved
        </span>
      </div>

      {error && <p className="px-4 py-3 text-sm text-error">{error}</p>}
      {!queue && !error && (
        <div className="p-4">
          <Loader2 className="size-5 animate-spin text-base-content/40" />
        </div>
      )}

      {queue && (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Under 768px the queue IS the page; picking someone pushes their
              view over it and the back control returns. */}
          <div
            className={`min-w-0 border-hairline md:w-[320px] md:shrink-0 md:overflow-y-auto md:border-r min-[1440px]:w-[380px] ${
              selected ? 'hidden md:block' : 'block'
            }`}
          >
            <div className="border-b border-hairline p-3.5">
              <SortBar
                sort={sort}
                dir={dir}
                rowsMode={rowsMode}
                search={search}
                onSort={(s) => setSort(s)}
                onDir={(d) => setDir(d)}
                onRowsMode={(m) => {
                  setRowsMode(m)
                  back()
                }}
                onSearch={setSearch}
              />
            </div>

            <div className="px-2 pt-1.5 pb-3">
              {QUEUE_SECTIONS.map((section) => {
                const count = queue.sections[section.key] ?? 0
                const inSection =
                  rowsMode === 'person'
                    ? people.filter((p) => p.section === section.key)
                    : rows.filter((r) => r.section === section.key)

                // Resolved is a count that opens. Forty-six closed tickets are
                // not what anybody came here to read.
                const collapsed = section.key === 'resolved' && !showResolved

                return (
                  <section key={section.key}>
                    <div className="flex items-center gap-1.5 px-2 pt-3 pb-1.5">
                      {section.key === 'paying' && (
                        <Star size={12} className="shrink-0 text-success" />
                      )}
                      <h2
                        className={`text-[11px] font-bold tracking-[0.08em] uppercase ${SECTION_STYLE[section.key]}`}
                      >
                        {section.label}
                      </h2>
                      <span className="ml-auto font-mono text-[11px] text-base-content/40">
                        {section.key === 'paying' && queue.accounts.paying > 0
                          ? `${rowsMode === 'person' ? count : inSection.length} of ${queue.accounts.paying} paying`
                          : rowsMode === 'person'
                            ? count
                            : inSection.length}
                      </span>
                      {section.key === 'resolved' && (
                        <button
                          type="button"
                          onClick={() => setShowResolved((v) => !v)}
                          aria-expanded={showResolved}
                          aria-label="Show resolved"
                          className="cursor-pointer text-base-content/40 hover:text-base-content"
                        >
                          <ChevronRight
                            size={13}
                            className={`transition-transform ${showResolved ? 'rotate-90' : ''}`}
                          />
                        </button>
                      )}
                    </div>

                    {!collapsed && (
                      <div className="flex flex-col gap-0.5">
                        {inSection.length === 0 ? (
                          /* An empty paying section is a fact about the data,
                             not a blank box: almost no ticket is joined to an
                             account, and the server says so in a sentence. */
                          <p className="px-2 text-xs text-base-content/45">
                            {section.key === 'paying'
                              ? queue.accounts.note || section.empty
                              : section.empty}
                          </p>
                        ) : rowsMode === 'person' ? (
                          (inSection as Array<QueuePerson>).map((p) => (
                            <PersonCard
                              key={p.key}
                              person={p}
                              active={selectedPerson === p.key}
                              onSelect={() => {
                                setSelectedPerson(p.key)
                                setSelectedTicket(null)
                              }}
                            />
                          ))
                        ) : (
                          (inSection as Array<QueueRow>).map((r) => (
                            <TicketCard
                              key={r.ticket_number}
                              row={r}
                              active={selectedTicket === r.ticket_number}
                              onSelect={() => {
                                setSelectedTicket(r.ticket_number)
                                setSelectedPerson(null)
                              }}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </div>

          {/* The conversation. */}
          <div
            className={`min-w-0 flex-1 md:overflow-y-auto ${
              selected ? 'block' : 'hidden md:block'
            }`}
          >
            {selected && (
              <button
                type="button"
                onClick={back}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 px-4 text-sm font-medium text-base-content/70 hover:text-base-content md:hidden"
              >
                <ArrowLeft size={16} /> All of support
              </button>
            )}

            {!selected ? (
              <div className="p-8">
                <p className="mx-auto max-w-[50ch] text-center text-sm text-base-content/60">
                  Pick someone. Their identity and history come first, then the
                  thread that needs an answer — the reply and everything behind
                  it are on the right.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-5 px-5 py-5 min-[1440px]:px-8">
                <PersonHeader person={person} rows={mine} detail={detail} />
                {caseError && <p className="text-sm text-error">{caseError}</p>}
                {!detail && !caseError && activeTicket && (
                  <Loader2 className="size-5 animate-spin text-base-content/40" />
                )}
                {detail && <CaseConversation detail={detail} />}
                <OtherTickets
                  rows={mine}
                  active={activeTicket}
                  onSelect={setSelectedTicket}
                />
                {/* Under 1440 the right pane's content lands here, in order. */}
                {!wide && workbench}
              </div>
            )}
          </div>

          {/* The reply and the evidence, from 1440 up. */}
          {wide && selected && (
            <aside className="w-[520px] shrink-0 overflow-y-auto border-l border-hairline bg-base-100 px-5 py-5">
              {workbench}
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
