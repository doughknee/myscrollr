import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Radio,
} from 'lucide-react'
import type {
  AdminFix,
  AdminHold,
  AutoSendState,
  CaseDetail,
  QueueGroup,
  QueueRow,
  SupportQueue,
} from '@/api/admin'
import { adminApi, subscribeToSupportEvents } from '@/api/admin'
import CaseActions from '@/components/admin/CaseActions'
import {
  QUEUE_GROUPS,
  dispositionTone,
  fixBadge,
  formatWait,
  holdCountdown,
} from '@/lib/supportConsole'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * The Support section: the queue on the left, one case on the right.
 *
 * REL-263 built the read half; REL-261 gave every fact on it a button. Each
 * button calls the same server function the Discord button calls, so the two
 * surfaces cannot drift while they coexist, and a case reads the same
 * whichever one was used.
 *
 * The page moves on its own. A support event on the SSE hub — a draft written,
 * a disposition decided, a reply sent — re-reads the queue and the open case
 * from the endpoints that built them. Nothing polls, and nothing patches a
 * case out of a socket payload: the event says which ticket moved, and the
 * server says what it now looks like.
 *
 * The case view is the whole reason this exists. Discord could show the draft
 * and roughly two thousand characters of it; it could not show what the
 * classifier decided, what the drafter says it is grounded in, what it admits
 * it does not know, which rule chose the disposition, or what the model was
 * told about the person writing. All of that has been in Postgres since
 * REL-249. This is the first surface wide enough to read it.
 *
 * Nothing here recomputes the pipeline. Disposition, hold expiry and the
 * proven-fix answer arrive decided; the browser formats them.
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
      <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
        {title}
      </h2>
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

// ── the conversation ──────────────────────────────────────────────

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
                className={`mt-2 text-sm whitespace-pre-wrap ${
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

// ── the pipeline ──────────────────────────────────────────────────

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
        <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
          What the server decided
        </h2>
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
          <p className="mt-2 text-sm text-base-content/85">
            {draft.disposition_reason ||
              'No reason was recorded. This draft predates the autonomous policy, so nothing will send it on its own.'}
          </p>
        </div>
      </section>

      {detail.hold && (
        <HoldBanner hold={detail.hold} autosend={detail.autosend} />
      )}

      <Panel
        title="What the drafter wrote"
        subtitle={
          draft.edited_body
            ? 'The draft, and the edit that replaced it before sending.'
            : 'Exactly as stored — plain text, which is what the user receives.'
        }
      >
        <div className="p-4">
          <p className="text-sm whitespace-pre-wrap text-base-content/85">
            {draft.body || '(the drafting call produced no body)'}
          </p>
        </div>
        {draft.edited_body && (
          <div className="border-t border-base-300/40 p-4">
            <p className="text-xs font-semibold tracking-wide text-base-content/45 uppercase">
              Edited before sending
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-base-content/85">
              {draft.edited_body}
            </p>
          </div>
        )}
      </Panel>

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

// ── the case ──────────────────────────────────────────────────────

function CaseView({
  ticket,
  reloadKey,
}: {
  ticket: string
  reloadKey: number
}) {
  const getToken = useGetToken()
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // reloadKey is bumped when a support event names this ticket. The panel is
  // NOT blanked on a re-read — only on a change of ticket — so a reply landing
  // while you are reading does not throw the page away and start again.
  useEffect(() => {
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

  useEffect(() => setDetail(null), [ticket])

  if (error) {
    return <p className="p-4 text-sm text-error">{error}</p>
  }
  if (!detail) {
    return (
      <div className="p-4">
        <Loader2 className="size-5 animate-spin text-base-content/40" />
      </div>
    )
  }

  const ctx = detail.context
  const widgets = ctx.widgets ?? []
  const similar = detail.similar ?? []

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold">
            {detail.subject || '(no subject)'}
          </h1>
          <span className="font-mono text-xs text-base-content/50">
            #{detail.ticket_number}
          </span>
        </div>
        <p className="mt-1 text-sm text-base-content/60">
          {detail.user_email ?? 'no email on file'} · {detail.status}
          {detail.category && ` · ${detail.category}`}
          {detail.priority && ` · ${detail.priority}`} · opened{' '}
          {new Date(detail.opened_at).toLocaleDateString()}
        </p>
        <p className="mt-2 text-sm text-base-content/70">
          {detail.group_reason}
        </p>
        {detail.discord_url && (
          <a
            href={detail.discord_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <MessageSquare size={12} /> The Discord thread
          </a>
        )}
      </header>

      <Conversation detail={detail} />
      <Pipeline detail={detail} />
      <CaseActions detail={detail} onCase={setDetail} />

      <section>
        <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
          Can we claim a fix?
        </h2>
        <div className="mt-2">
          <FixCard fix={detail.fix} />
        </div>
      </section>

      <Panel title="What the model was told about them" subtitle={ctx.note}>
        <div className="grid grid-cols-2 gap-px bg-base-300/40 sm:grid-cols-3">
          {[
            ['Plan', ctx.tier],
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

// ── the queue ─────────────────────────────────────────────────────

function QueueItem({
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
      className={`w-full cursor-pointer border-b border-base-300/40 px-3 py-2.5 text-left transition-colors last:border-0 ${
        active ? 'bg-base-200' : 'hover:bg-base-200/50'
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
        {row.user_email ?? 'no email'}
        {row.category && ` · ${row.category}`}
        {' · '}
        {wait ? `waiting ${wait}` : 'wait unknown'}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-base-content/70">
        {row.disposition_reason || row.group_reason}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {countdown.display && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning-content/90 ring-1 ring-warning/30">
            sends in {countdown.display}
          </span>
        )}
        {row.disposition === 'escalate' && (
          <span className="rounded bg-error/10 px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-error/30">
            escalated
          </span>
        )}
        {badge && (
          <span className="rounded bg-base-200 px-1.5 py-0.5 text-[11px] text-base-content/60">
            {badge}
          </span>
        )}
      </div>
    </button>
  )
}

export default function SupportPage() {
  const getToken = useGetToken()
  const [filter, setFilter] = useState<QueueGroup | 'all'>('all')
  const [queue, setQueue] = useState<SupportQueue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [queueKey, setQueueKey] = useState(0)
  const [caseKey, setCaseKey] = useState(0)
  const [switching, setSwitching] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    adminApi
      .supportQueue(getToken, filter)
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
  }, [getToken, filter, queueKey])

  useEffect(() => load(), [load])

  // The open ticket lives in a ref so the subscription below never has to be
  // torn down and rebuilt when the selection changes — reconnecting the stream
  // on every click would drop events in the gap.
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selected

  useEffect(() => {
    return subscribeToSupportEvents(
      getToken,
      (event) => {
        // Every event moves the queue: a group, a countdown or a row. The open
        // case is re-read only when the event is about it, or about the
        // pipeline switch, which changes what every countdown means.
        setQueueKey((n) => n + 1)
        if (
          !event.ticket_number ||
          event.ticket_number === selectedRef.current
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

  const rows = queue?.rows ?? []
  const groups = QUEUE_GROUPS.filter(
    (g) => filter === 'all' || g.key === filter,
  )

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        <p className="mt-1 text-sm text-base-content/60">
          Every verb here is the same function the Discord buttons call. Send is
          the only one that cannot be undone, and the only one that asks twice.
        </p>
        {queue && (
          <div
            className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ${
              queue.autosend.armed
                ? 'bg-warning/10 ring-warning/30'
                : 'bg-base-200/50 ring-base-300/60'
            }`}
          >
            <p className="text-xs">{queue.autosend.note}</p>
            {/* Pause and resume, the same switch /pause and /resume throw.
                Un-demoting a category stays a Discord command: that is a
                judgement about a class of tickets, not a button beside one. */}
            {queue.autosend.enabled && (
              <button
                type="button"
                onClick={toggleAutoSend}
                disabled={switching}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-base-100 px-2.5 py-1 text-xs font-medium ring-1 ring-base-300/60 hover:bg-base-200/60 disabled:opacity-50"
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
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-[22rem] lg:shrink-0">
            <div className="flex flex-wrap gap-1 pb-1">
              {(['all', ...QUEUE_GROUPS.map((g) => g.key)] as const).map(
                (key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      filter === key
                        ? 'bg-base-200 text-base-content'
                        : 'text-base-content/60 hover:bg-base-200/60'
                    }`}
                  >
                    {key === 'all'
                      ? 'Everything'
                      : QUEUE_GROUPS.find((g) => g.key === key)?.label}
                    {key !== 'all' && (
                      <span className="ml-1 tabular-nums text-base-content/45">
                        {queue.counts[key] ?? 0}
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>

            <div className="mt-3 space-y-5">
              {groups.map((group) => {
                const items = rows.filter((r) => r.group === group.key)
                return (
                  <section key={group.key}>
                    <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
                      {group.label}{' '}
                      <span className="tabular-nums text-base-content/40">
                        {queue.counts[group.key] ?? 0}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-base-content/45">
                      {group.blurb}
                    </p>
                    <div className="mt-2 overflow-hidden rounded-xl ring-1 ring-base-300/60">
                      {items.length === 0 ? (
                        <p className="p-4 text-sm text-base-content/50">
                          {group.key === 'needs_you'
                            ? 'Nothing is waiting on you.'
                            : group.key === 'waiting'
                              ? 'Nobody owes us a reply.'
                              : 'Nothing has been handled yet.'}
                        </p>
                      ) : (
                        items.map((row) => (
                          <QueueItem
                            key={row.ticket_number}
                            row={row}
                            active={selected === row.ticket_number}
                            onSelect={() => setSelected(row.ticket_number)}
                          />
                        ))
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {selected ? (
              <CaseView ticket={selected} reloadKey={caseKey} />
            ) : (
              <div className="rounded-xl bg-base-200/30 px-6 py-16 text-center ring-1 ring-base-300/60">
                <p className="text-sm text-base-content/60">
                  Pick a case. The conversation reads top to bottom, and what
                  the pipeline decided about it sits underneath.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
