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
import { PageFrame } from './ui'
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
  lastUserMessage,
  personMeta,
  personTitle,
  planBadge,
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
  tone?: 'neutral' | 'paying' | 'needs' | 'edited' | 'done'
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-base-200 text-base-content/65',
    paying: 'bg-success/15 text-success',
    needs: 'bg-error/10 text-error',
    edited: 'bg-secondary/15 text-secondary',
    done: 'bg-success/10 text-success',
  }
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}
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

function Conversation({ detail }: { detail: CaseDetail }) {
  const messages = detail.messages ?? []
  if (messages.length === 0) {
    return (
      <Panel title="The conversation">
        <p className="p-4 text-sm text-base-content/50">
          Nothing is on record for this ticket. The case database only carries
          messages the API saw or backfilled from osTicket, so an older ticket
          answered entirely inside osTicket can look empty here.
        </p>
      </Panel>
    )
  }
  return (
    <Panel
      title="The conversation"
      subtitle="Oldest first. Drafts that were never sent are shown too, marked as such — this is the record of what we wrote, not only of what they read."
    >
      <div className="divide-y divide-base-300/40">
        {messages.map((m, i) => {
          const mine = m.kind === 'sent'
          return (
            <div key={`${m.created_at}-${i}`} className="p-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                  className={`text-xs font-semibold ${
                    mine ? 'text-primary' : 'text-base-content/70'
                  }`}
                >
                  {KIND_LABEL[m.kind] ?? m.kind}
                </span>
                <span className="text-xs text-base-content/45">
                  {new Date(m.created_at).toLocaleString()}
                </span>
                {m.superseded && (
                  <span className="rounded bg-base-300/60 px-1.5 py-0.5 text-[11px] text-base-content/60">
                    superseded
                  </span>
                )}
              </div>
              <p
                className={`mt-2 max-w-[75ch] text-sm whitespace-pre-wrap ${
                  m.kind === 'ai_draft'
                    ? 'text-base-content/55 italic'
                    : 'text-base-content/85'
                }`}
              >
                {m.body || '(empty)'}
              </p>
            </div>
          )
        })}
      </div>
    </Panel>
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

      {detail.hold && (
        <HoldBanner hold={detail.hold} autosend={detail.autosend} />
      )}

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

/**
 * One case, above the fold.
 *
 * `compact` is the version that appears inside a person's history: the same
 * case without its own header, because the person's name is already above it.
 */
function CaseBody({
  detail,
  onCase,
  compact,
}: {
  detail: CaseDetail
  onCase: (next: CaseDetail) => void
  compact?: boolean
}) {
  const theirWords = lastUserMessage(detail.messages)
  const chips = diagnosticsChips(detail.context)
  const tone = dispositionTone(detail.draft?.disposition, detail.draft?.status)
  const stopped = detail.draft?.disposition_reason || detail.group_reason

  return (
    <div className="space-y-5">
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

      <section>
        <h3 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
          They wrote
        </h3>
        <p className="mt-2 max-w-[75ch] border-l-2 border-base-300 pl-4 text-sm leading-relaxed whitespace-pre-wrap text-base-content/85">
          {theirWords ?? (
            <span className="text-base-content/45 italic">
              Nothing from the user is on record for this ticket. The case
              database only carries messages the API saw or backfilled.
            </span>
          )}
        </p>

        {/* Three chips instead of a diagnostics blob taller than the sentence
            above them. The blob is still here, one click down. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-md bg-base-200 px-2 py-1 text-xs text-base-content/70"
            >
              {chip}
            </span>
          ))}
          <span className="rounded-md bg-base-200 px-2 py-1 text-xs text-base-content/70">
            Opened {new Date(detail.opened_at).toLocaleDateString()}
          </span>
          <details className="text-xs">
            <summary className="min-h-11 cursor-pointer content-center px-1 text-base-content/50 hover:text-base-content">
              Full diagnostics
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-base-200/50 p-3 text-xs whitespace-pre-wrap text-base-content/70 ring-1 ring-base-300/60">
              {JSON.stringify(detail.context, null, 2)}
            </pre>
          </details>
        </div>
      </section>

      <CaseActions detail={detail} onCase={onCase} />

      {/* One disclosure, holding everything the old page shouted at once.
          Nothing was removed; it moved one level down. */}
      <details className="rounded-xl ring-1 ring-base-300/60">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-medium text-base-content/70 hover:text-base-content">
          <ChevronRight size={15} className="shrink-0" />
          Why it decided this
        </summary>
        <div className="space-y-6 border-t border-base-300/40 p-4">
          <Pipeline detail={detail} />
          <Conversation detail={detail} />
          <TheEvidence detail={detail} />
          {!compact && detail.discord_url && (
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
      </details>
    </div>
  )
}

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

function CaseView({
  ticket,
  reloadKey,
}: {
  ticket: string
  reloadKey: number
}) {
  const { detail, error, setDetail } = useCase(ticket, reloadKey)

  if (error) return <p className="p-4 text-sm text-error">{error}</p>
  if (!detail) {
    return (
      <div className="p-4">
        <Loader2 className="size-5 animate-spin text-base-content/40" />
      </div>
    )
  }

  const badge = planBadge(detail)

  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-base-content/45">
            #{detail.ticket_number}
          </span>
          <span className="text-xs text-base-content/50">
            {[detail.user_name, detail.user_email]
              .filter(Boolean)
              .join(' · ') || 'requester unknown'}
          </span>
          {badge ? (
            <Pill tone={badge.paying ? 'paying' : 'neutral'}>
              {badge.label}
            </Pill>
          ) : (
            <span className="text-xs text-base-content/45 italic">
              {identityLabel(detail.identity_state)}
            </span>
          )}
        </div>
        <h1 className="mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
          {detail.subject || '(no subject)'}
        </h1>
        {detail.plan_note && (
          <p className="mt-1.5 max-w-[75ch] text-xs text-base-content/50">
            {detail.plan_note}
          </p>
        )}
      </header>
      <CaseBody detail={detail} onCase={setDetail} />
    </div>
  )
}

// ── the person ────────────────────────────────────────────────────

/**
 * One person: who they are, then their threads newest first.
 *
 * The one needing action is open with its draft and buttons; the ones awaiting
 * a reply are listed; the resolved ones are dimmed. That ordering is the whole
 * argument for grouping — five rows shouting becomes one person with a
 * history.
 */
function PersonView({
  person,
  rows,
  reloadKey,
  openTicket,
  onOpenTicket,
}: {
  person: QueuePerson
  rows: Array<QueueRow>
  reloadKey: number
  openTicket: string | null
  onOpenTicket: (ticket: string | null) => void
}) {
  const mine = useMemo(() => {
    const numbers = new Set(person.ticket_numbers ?? [])
    return rows
      .filter((r) => numbers.has(r.ticket_number))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [person, rows])

  // The thread that opens by default is the one that needs a person. Anything
  // else makes you click to find the only thing on the row that is asking for
  // you.
  const needsAction = mine.find((r) => r.group === 'needs_you')
  const active = openTicket ?? needsAction?.ticket_number ?? null

  const who = personTitle(person)
  const badge = planBadge(person)
  const firstWrote = mine.reduce<string | null>(
    (min, r) => (min === null || r.opened_at < min ? r.opened_at : min),
    null,
  )

  return (
    <div className="space-y-5">
      <header className="border-b border-base-300/50 pb-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            {who.title}
          </h1>
          {badge ? (
            <Pill tone={badge.paying ? 'paying' : 'neutral'}>
              {badge.label}
            </Pill>
          ) : (
            <span className="text-xs text-base-content/45 italic">
              {identityLabel(person.identity_state)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-base-content/55">
          {[
            who.subtitle,
            mine.find((r) => r.os)?.os,
            firstWrote &&
              `first wrote ${new Date(firstWrote).toLocaleDateString()}`,
            `${person.tickets} ${person.tickets === 1 ? 'ticket' : 'tickets'}${
              person.handled > 0 ? `, ${person.handled} resolved` : ''
            }`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {person.plan_note && (
          <p className="mt-1.5 max-w-[75ch] text-xs text-base-content/50">
            {person.plan_note}
          </p>
        )}
      </header>

      <div className="divide-y divide-base-300/40">
        {mine.map((r) => (
          <Thread
            key={r.ticket_number}
            row={r}
            open={active === r.ticket_number}
            reloadKey={reloadKey}
            onToggle={() =>
              onOpenTicket(active === r.ticket_number ? null : r.ticket_number)
            }
          />
        ))}
      </div>
    </div>
  )
}

/** One of a person's threads. Open, it is the whole case view. */
function Thread({
  row,
  open,
  reloadKey,
  onToggle,
}: {
  row: QueueRow
  open: boolean
  reloadKey: number
  onToggle: () => void
}) {
  const { detail, error, setDetail } = useCase(
    open ? row.ticket_number : null,
    reloadKey,
  )
  const resolved = row.group === 'handled'

  return (
    <div className={`py-4 ${resolved && !open ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 text-left"
      >
        <span className="w-14 shrink-0 pt-0.5 font-mono text-[11px] text-base-content/40">
          #{row.ticket_number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-sm ${open || row.group === 'needs_you' ? 'font-semibold' : 'font-medium'}`}
            >
              {row.subject || '(no subject)'}
            </span>
            {row.group === 'needs_you' ? (
              <Pill tone="needs">needs you</Pill>
            ) : resolved ? (
              <Pill tone="done">resolved</Pill>
            ) : (
              <ProvenancePill
                provenance={row.provenance}
                label={row.provenance_label}
              />
            )}
          </span>
          <span className="mt-1 block text-xs text-base-content/50">
            {row.group_reason}
          </span>
        </span>
        <ChevronRight
          size={15}
          className={`mt-1 shrink-0 text-base-content/35 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-4 pl-0 sm:pl-17">
          {error && <p className="text-sm text-error">{error}</p>}
          {!detail && !error && (
            <Loader2 className="size-5 animate-spin text-base-content/40" />
          )}
          {detail && <CaseBody detail={detail} onCase={setDetail} compact />}
        </div>
      )}
    </div>
  )
}

// ── the queue ─────────────────────────────────────────────────────

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
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
        active
          ? 'bg-base-100 ring-2 ring-primary/60'
          : 'bg-base-100 ring-base-300/60 hover:bg-base-200/50'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`text-sm font-semibold ${who.known ? '' : 'text-base-content/70 italic'}`}
        >
          {who.title}
        </span>
        {badge && (
          <Pill tone={badge.paying ? 'paying' : 'neutral'}>{badge.label}</Pill>
        )}
        {!badge && person.section === 'answered' && (
          <ProvenancePill
            provenance={person.provenance}
            label={person.provenance_label}
          />
        )}
      </div>
      {who.subtitle && (
        <p className="mt-0.5 truncate text-[11px] text-base-content/45">
          {who.subtitle}
        </p>
      )}
      <p className="mt-1 line-clamp-2 text-xs text-base-content/60">
        {person.headline ?? 'No ticket on record'}
        {person.needs_you > 0 && (
          <>
            {' · '}
            <span className="font-semibold text-error">needs you</span>
          </>
        )}
      </p>
      <p className="mt-1 text-[11px] text-base-content/45">
        {personMeta(person)}
      </p>
    </button>
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
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
        active
          ? 'bg-base-100 ring-2 ring-primary/60'
          : 'bg-base-100 ring-base-300/60 hover:bg-base-200/50'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {row.subject || '(no subject)'}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-base-content/45">
          #{row.ticket_number}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs text-base-content/55">
        {row.name || row.user_email || 'requester unknown'}
        {' · '}
        {wait ? `waiting ${wait}` : 'wait unknown'}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-base-content/70">
        {row.disposition_reason || row.group_reason}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {countdown.display && (
          <Pill tone="needs">sends in {countdown.display}</Pill>
        )}
        <ProvenancePill
          provenance={row.provenance}
          label={row.provenance_label}
        />
        {badge && <Pill>{badge}</Pill>}
      </div>
    </button>
  )
}

/**
 * The three sort controls: a field, a direction of its own, and what a row is.
 *
 * The direction is a button rather than another menu entry so reversing never
 * costs a trip through a dropdown — that is the whole complaint the "one sort
 * control" mockup was rejected over.
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
  return (
    <div className="space-y-2">
      <label className="flex min-h-11 items-center gap-2 rounded-lg bg-base-100 px-3 ring-1 ring-base-300/60 focus-within:ring-2 focus-within:ring-primary/50">
        <Search size={15} className="shrink-0 text-base-content/40" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search people and tickets"
          aria-label="Search people and tickets"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-stretch overflow-hidden rounded-lg ring-1 ring-base-300/60">
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as QueueSort)}
            aria-label="Sort by"
            className="min-h-11 cursor-pointer bg-base-100 px-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-primary/50"
          >
            {SORT_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          {/* Its own button. Reversing is one click, both ways. */}
          <button
            type="button"
            onClick={() => onDir(dir === 'asc' ? 'desc' : 'asc')}
            title={directionLabel(sort, dir)}
            aria-label={`Direction: ${directionLabel(sort, dir)}`}
            className="min-h-11 cursor-pointer border-l border-base-300/60 bg-base-100 px-2.5 hover:bg-base-200/60"
          >
            {dir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>

        <select
          value={rowsMode}
          onChange={(e) => onRowsMode(e.target.value as QueueRowsMode)}
          aria-label="What a row is"
          className="min-h-11 cursor-pointer rounded-lg bg-base-100 px-2.5 text-xs font-medium ring-1 ring-base-300/60 outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="person">By person</option>
          <option value="ticket">By ticket</option>
        </select>
      </div>
      <p className="px-0.5 text-[11px] text-base-content/40">
        {directionLabel(sort, dir)} — inside each section. Sections never
        reorder.
      </p>
    </div>
  )
}

const SECTION_STYLE: Record<QueueSection, string> = {
  paying: 'text-success',
  open: 'text-error',
  answered: 'text-base-content/55',
  resolved: 'text-base-content/45',
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

  const selected = rowsMode === 'person' ? selectedPerson : selectedTicket
  const back = () => {
    setSelectedPerson(null)
    setSelectedTicket(null)
  }
  const needsYou = queue?.counts.needs_you ?? 0

  return (
    <PageFrame>
      <div className="space-y-4">
        {/* On a phone the header is the queue's header, and it steps aside once
          a person is open so the whole viewport is the thing you came to
          read. */}
        <header className={selected ? 'hidden md:block' : ''}>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-bold tracking-tight">Support</h1>
            <span className="text-sm text-base-content/50">
              {needsYou === 1 ? '1 needs you' : `${needsYou} need you`}
            </span>
          </div>
          {queue && (
            <div
              className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ${
                queue.autosend.armed
                  ? 'bg-warning/10 ring-warning/30'
                  : 'bg-base-200/50 ring-base-300/60'
              }`}
            >
              <p className="text-xs">{queue.autosend.note}</p>
              {/* Pause and resume, the same switch /pause and /resume throw. */}
              {queue.autosend.enabled && (
                <button
                  type="button"
                  onClick={toggleAutoSend}
                  disabled={switching}
                  className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-base-100 px-3 text-xs font-medium ring-1 ring-base-300/60 hover:bg-base-200/60 disabled:opacity-50"
                >
                  {switching ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : queue.autosend.paused ? (
                    <Play size={12} />
                  ) : (
                    <Pause size={12} />
                  )}
                  {queue.autosend.paused ? 'Resume sending' : 'Pause sending'}
                </button>
              )}
            </div>
          )}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-base-content/45">
            <Radio
              size={12}
              className={live ? 'text-success' : 'text-base-content/40'}
            />
            {live
              ? 'Live — holds and replies appear here without a refresh.'
              : 'Not connected to the live stream; this page is showing what it last read.'}
          </p>
        </header>

        {error && <p className="text-sm text-error">{error}</p>}
        {!queue && !error && (
          <Loader2 className="size-5 animate-spin text-base-content/40" />
        )}

        {queue && (
          <div className="flex flex-col gap-5 md:flex-row md:gap-5 lg:gap-8">
            {/* Under 768px the queue IS the page; picking someone pushes their
              view over it and the back control returns. From 768 up the two
              panes sit side by side, with the queue narrowed. */}
            <div
              className={`min-w-0 md:w-64 md:shrink-0 lg:w-80 xl:w-96 ${
                selected ? 'hidden md:block' : 'block'
              }`}
            >
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

              <div className="mt-4 space-y-5">
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
                      <div className="flex items-center gap-2 px-1 pb-2">
                        {section.key === 'paying' && (
                          <Star size={13} className="shrink-0 text-success" />
                        )}
                        <h2
                          className={`text-[11px] font-bold tracking-wider uppercase ${SECTION_STYLE[section.key]}`}
                        >
                          {section.label}
                        </h2>
                        <span className="ml-auto text-[11px] tabular-nums text-base-content/40">
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
                            className="cursor-pointer text-base-content/40 hover:text-base-content"
                          >
                            <ChevronRight
                              size={14}
                              className={`transition-transform ${showResolved ? 'rotate-90' : ''}`}
                            />
                          </button>
                        )}
                      </div>

                      {!collapsed && (
                        <div className="flex flex-col gap-2">
                          {inSection.length === 0 ? (
                            /* An empty paying section is a fact about the data,
                             not a blank box: almost no ticket is joined to an
                             account, and the server says so in a sentence. */
                            <p className="px-1 text-xs text-base-content/45">
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

            <div
              className={`min-w-0 flex-1 ${selected ? 'block' : 'hidden md:block'}`}
            >
              {selected && (
                <button
                  type="button"
                  onClick={back}
                  className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-medium text-base-content/70 hover:text-base-content md:hidden"
                >
                  <ArrowLeft size={16} /> All of support
                </button>
              )}

              {rowsMode === 'person' && person ? (
                <PersonView
                  person={person}
                  rows={rows}
                  reloadKey={caseKey}
                  openTicket={selectedTicket}
                  onOpenTicket={setSelectedTicket}
                />
              ) : rowsMode === 'ticket' && selectedTicket ? (
                <CaseView ticket={selectedTicket} reloadKey={caseKey} />
              ) : (
                <div className="rounded-xl bg-base-200/30 px-6 py-16 text-center ring-1 ring-base-300/60">
                  <p className="mx-auto max-w-[50ch] text-sm text-base-content/60">
                    Pick someone. Their identity and history come first, then
                    their threads newest first — the one needing an answer open
                    with its draft, the rest underneath.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PageFrame>
  )
}
