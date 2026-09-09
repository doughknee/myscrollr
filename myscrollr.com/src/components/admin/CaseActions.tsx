import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bug,
  Hand,
  Link2,
  Link2Off,
  Loader2,
  MessageCircleQuestion,
  Send,
  SkipForward,
} from 'lucide-react'
import type { CaseDetail, FiledBug } from '@/api/admin'
import { adminApi } from '@/api/admin'
import { isUnchanged, lineDiff } from '@/lib/supportConsole'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * Every support verb, next to the case it acts on (REL-261).
 *
 * These are the same functions the Discord buttons call — one HTTP endpoint
 * each, one shared function behind both — so a decision reached here and a
 * decision reached in the thread are the same decision, with the same audit
 * trail. Nothing here computes a disposition or decides whether a fix is
 * proven; the server did that before this case ever reached a queue, and the
 * only thing a person adds is responsibility for the click.
 *
 * Send is the one action that cannot be undone, so it is the one action that
 * asks twice. Skip, hold, link, unlink and file go through on the first click
 * on purpose: a tool that makes you confirm everything is a tool you stop
 * using, and every one of those can be put back.
 */

type Panel = 'none' | 'confirm-send' | 'ask' | 'link'

export default function CaseActions({
  detail,
  onCase,
}: {
  detail: CaseDetail
  onCase: (next: CaseDetail) => void
}) {
  const getToken = useGetToken()
  const draft = detail.draft
  const pending = draft?.status === 'pending'

  const [panel, setPanel] = useState<Panel>('none')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [body, setBody] = useState('')
  const [question, setQuestion] = useState('')
  const [issueKey, setIssueKey] = useState('')

  // Reset when the case changes underneath — an open editor holding another
  // ticket's draft is how the wrong reply gets sent to the wrong person.
  useEffect(() => {
    setPanel('none')
    setError(null)
    setNotice(null)
    setBody(draft?.body ?? '')
    setQuestion(draft?.ask_user_for ?? '')
    setIssueKey('')
  }, [detail.ticket_number, draft?.id, draft?.body, draft?.ask_user_for])

  /** Runs one verb, keeps whatever case came back, and says what went wrong. */
  const run = async (
    name: string,
    call: () => Promise<CaseDetail>,
    after?: () => void,
  ) => {
    setBusy(name)
    setError(null)
    setNotice(null)
    try {
      onCase(await call())
      after?.()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'That did not go through.')
    } finally {
      setBusy(null)
    }
  }

  // Touching the reply box stops the countdown, exactly as opening the
  // Discord modal used to. Typing a reply takes longer than a hold that is
  // nearly up, and "I am working on this one" has to actually stop the clock
  // rather than race it. Once per case: the hold is already off after the
  // first touch, and re-holding on every refocus would be a write per click.
  const held = useRef<number | null>(null)
  const holdOnFirstTouch = () => {
    if (!pending || !detail.hold || held.current === draft.id) return
    held.current = draft.id
    void run('hold', () => adminApi.holdDraft(getToken, draft.id))
  }

  const fileBug = async () => {
    if (!draft) return
    setBusy('bug')
    setError(null)
    setNotice(null)
    try {
      const res = await adminApi.fileAsBug(getToken, draft.id)
      onCase(res.case)
      setNotice(describeFiling(res.filed))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not file that.')
    } finally {
      setBusy(null)
    }
  }

  const edited = body.trim()
  const unchanged = isUnchanged(draft?.body ?? '', edited)

  return (
    <section>
      {/* ── The reply, editable where it is read ────────────────
          The mockup's "Proposed reply · edit it here" is this box. It used to
          sit behind an Edit button, which meant the thing you are here to do
          was one click further away than the thing you are here to read. */}
      {pending && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
              Proposed reply
            </h2>
            <span className="text-xs text-base-content/45">edit it here</span>
          </div>
          <textarea
            id="reply-body"
            aria-label="Proposed reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={holdOnFirstTouch}
            rows={12}
            spellCheck
            /* No maxLength. Discord capped this at 4000 because a Discord
               modal does; a support email does not, and a limit inherited
               from the surface you happen to be typing into is a limit that
               silently cuts somebody's answer in half. */
            className="mt-2 w-full max-w-[75ch] resize-y rounded-xl bg-base-100 px-4 py-3 text-sm leading-relaxed ring-1 ring-base-300/60 focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
          <p className="mt-1 text-xs text-base-content/45">
            {edited.length.toLocaleString()} characters. Plain text — it is
            wrapped into paragraphs on the way out.
            {!unchanged && ' Sending will send your version.'}
          </p>
          {!unchanged && (
            <div className="mt-2 max-w-[75ch]">
              <DiffPanel before={draft.body} after={edited} />
            </div>
          )}
        </>
      )}

      {!pending && (
        <p className="rounded-xl bg-base-200/40 px-4 py-3 text-sm text-base-content/60 ring-1 ring-base-300/60">
          {draft
            ? `This draft is ${draft.status}, so there is nothing left to send on it. The issue link below is still yours to change.`
            : 'There is no draft to act on. Link an issue, or answer this one in osTicket.'}
        </p>
      )}

      {error && (
        <p className="mt-2 flex items-baseline gap-2 rounded-lg bg-error/10 px-3 py-2 text-sm text-error ring-1 ring-error/30">
          <AlertTriangle size={14} className="translate-y-0.5 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-2 rounded-lg bg-base-200/60 px-3 py-2 text-sm text-base-content/75 ring-1 ring-base-300/60">
          {notice}
        </p>
      )}

      {/* The quieter verbs. Above the pinned bar rather than in it: on a
          phone the bar is what a thumb reaches, and it should only hold the
          three things you came to do. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {pending && (
          <>
            <ActionButton
              label="Hold"
              icon={<Hand size={14} />}
              small
              busy={busy === 'hold'}
              disabled={busy !== null}
              onClick={() =>
                run('hold', () => adminApi.holdDraft(getToken, draft.id))
              }
            />
            <ActionButton
              label="File as bug"
              icon={<Bug size={14} />}
              small
              busy={busy === 'bug'}
              disabled={busy !== null}
              onClick={fileBug}
            />
          </>
        )}
        {detail.linear_issue_key ? (
          <ActionButton
            label={`Unlink ${detail.linear_issue_key}`}
            icon={<Link2Off size={14} />}
            small
            busy={busy === 'unlink'}
            disabled={busy !== null}
            onClick={() =>
              run('unlink', () =>
                adminApi.unlinkIssue(getToken, detail.ticket_number),
              )
            }
          />
        ) : (
          <ActionButton
            label="Link an issue"
            icon={<Link2 size={14} />}
            small
            disabled={busy !== null}
            onClick={() => {
              setPanel('link')
              setError(null)
            }}
          />
        )}
      </div>

      {/* ── The action bar ──────────────────────────────────────
          Pinned to the bottom of the viewport under 768px, above the safe
          area, so the three verbs are reachable with a thumb without
          scrolling past a reply that can run to forty lines. It rejoins the
          flow at md, where the whole case is on screen anyway. */}
      {pending && (
        <div className="sticky bottom-0 z-20 mt-3 -mb-4 flex flex-wrap items-center gap-2 border-t border-base-300/60 bg-base-100/95 px-1 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur md:static md:mb-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0 md:backdrop-blur-none">
          <ActionButton
            label="Send reply"
            icon={<Send size={14} />}
            tone="primary"
            busy={busy === 'send' || busy === 'edit'}
            disabled={busy !== null || edited === ''}
            onClick={() => {
              setPanel('confirm-send')
              setError(null)
            }}
          />
          <ActionButton
            label="Ask something else"
            icon={<MessageCircleQuestion size={14} />}
            disabled={busy !== null}
            onClick={() => {
              setPanel('ask')
              setError(null)
            }}
          />
          <ActionButton
            label="Skip"
            icon={<SkipForward size={14} />}
            busy={busy === 'skip'}
            disabled={busy !== null}
            onClick={() =>
              run('skip', () => adminApi.skipDraft(getToken, draft.id))
            }
          />
        </div>
      )}

      {/* ── Send, confirmed ───────────────────────────────────────
          The one confirmation on the page, in front of the one thing that
          cannot be undone. Which verb it runs depends on whether the box
          above still holds the draft: an untouched reply goes out as the
          draft, an edited one goes out as an edit and is recorded as one. */}
      {panel === 'confirm-send' && pending && (
        <ConfirmSend
          who={detail.user_email}
          closing={draft.should_close}
          editing={!unchanged}
          busy={busy === 'send' || busy === 'edit'}
          onCancel={() => setPanel('none')}
          onSend={() =>
            unchanged
              ? run(
                  'send',
                  () => adminApi.sendDraft(getToken, draft.id),
                  () => setPanel('none'),
                )
              : run(
                  'edit',
                  () => adminApi.editAndSend(getToken, draft.id, edited),
                  () => setPanel('none'),
                )
          }
        />
      )}

      {/* ── Ask one question ───────────────────────────────────── */}
      {panel === 'ask' && pending && (
        <div className="mt-3 space-y-3 rounded-xl p-4 ring-1 ring-base-300/60">
          <label
            htmlFor="ask-body"
            className="text-xs font-semibold tracking-wide text-base-content/50 uppercase"
          >
            One question, in place of the answer
          </label>
          <textarea
            id="ask-body"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            placeholder="Which version are you on, and does it happen on every launch?"
            className="w-full resize-y rounded-lg bg-base-100 px-3 py-2 text-sm ring-1 ring-base-300/60 focus:ring-2 focus:ring-primary/50 focus:outline-none"
          />
          <p className="text-xs text-base-content/50">
            {draft.ask_user_for
              ? 'Pre-filled with what the drafter said it still needs. Their answer comes back through the ticket and drafts afresh with it.'
              : 'The drafter did not say it was missing anything, so this box started empty.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || question.trim() === ''}
              onClick={() =>
                run(
                  'ask',
                  () => adminApi.askUser(getToken, draft.id, question.trim()),
                  () => setPanel('none'),
                )
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-content disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'ask' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Send the question
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPanel('none')}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Link an existing issue ─────────────────────────────── */}
      {panel === 'link' && (
        <div className="mt-3 space-y-3 rounded-xl p-4 ring-1 ring-base-300/60">
          <label
            htmlFor="issue-key"
            className="text-xs font-semibold tracking-wide text-base-content/50 uppercase"
          >
            Issue key
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="issue-key"
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value.toUpperCase())}
              placeholder="REL-261"
              className="w-40 rounded-lg bg-base-100 px-3 py-1.5 font-mono text-sm ring-1 ring-base-300/60 focus:ring-2 focus:ring-primary/50 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy !== null || issueKey.trim() === ''}
              onClick={() =>
                run(
                  'link',
                  () =>
                    adminApi.linkIssue(
                      getToken,
                      detail.ticket_number,
                      issueKey.trim(),
                    ),
                  () => setPanel('none'),
                )
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-base-200 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'link' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Link2 size={14} />
              )}
              Link it
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPanel('none')}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200/60"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-base-content/50">
            Checked against Linear before it is saved. A key that does not exist
            reads to the fix check as an issue it could not reach, which looks a
            great deal like &ldquo;not fixed yet&rdquo;.
          </p>
        </div>
      )}
    </section>
  )
}

/** The one confirmation on the page, in front of the one thing you cannot undo. */
function ConfirmSend({
  who,
  closing,
  editing,
  busy,
  onSend,
  onCancel,
}: {
  who?: string
  closing: boolean
  editing: boolean
  busy: boolean
  onSend: () => void
  onCancel: () => void
}) {
  return (
    <div className="mt-3 rounded-xl bg-warning/5 px-4 py-3 ring-1 ring-warning/40">
      <p className="text-sm font-semibold">
        Send this reply to {who ?? 'the reporter'}?
      </p>
      <p className="mt-1 text-xs text-base-content/70">
        It goes out as an email and is marked answered in osTicket. There is no
        undo.
        {closing && ' The ticket also closes — triage flagged it as resolved.'}
        {editing &&
          ' Your version is sent, not the draft, and the diff is posted into the Discord thread.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSend}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-content disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          Yes, send it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200/60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** What changed, before the click rather than after it. */
function DiffPanel({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after)
  const changed = lines.filter((l) => l.kind !== 'kept').length
  if (changed === 0) {
    return (
      <p className="text-xs text-base-content/50">
        No changes yet. The diff appears here as soon as there are any.
      </p>
    )
  }
  return (
    <details open>
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-base-content/50 uppercase">
        What changed · {changed} {changed === 1 ? 'line' : 'lines'}
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg bg-base-200/40 p-2 ring-1 ring-base-300/60">
        {lines.map((l, i) => (
          <p
            key={i}
            className={`font-mono text-xs whitespace-pre-wrap ${
              l.kind === 'removed'
                ? 'bg-error/10 text-error'
                : l.kind === 'added'
                  ? 'bg-success/10 text-success'
                  : 'text-base-content/50'
            }`}
          >
            {l.kind === 'removed' ? '- ' : l.kind === 'added' ? '+ ' : '  '}
            {l.text}
          </p>
        ))}
      </div>
    </details>
  )
}

function ActionButton({
  label,
  icon,
  tone,
  small,
  busy,
  disabled,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  tone?: 'primary'
  /** Secondary verbs. Still 44px tall on a phone; only the padding shrinks. */
  small?: boolean
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        small ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-2'
      } ${
        tone === 'primary'
          ? 'bg-primary text-primary-content'
          : 'bg-base-200 text-base-content hover:bg-base-300/70'
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

function describeFiling(filed: FiledBug): string {
  if (filed.already_filed) {
    return `Already filed as ${filed.issue_key} — ${filed.url}`
  }
  if (!filed.link_saved) {
    return `Filed ${filed.issue_key} (${filed.url}), but the link back to this ticket did not save. Filing again would create a duplicate — link ${filed.issue_key} by hand instead.`
  }
  return `Filed as ${filed.issue_key} — ${filed.url}`
}
