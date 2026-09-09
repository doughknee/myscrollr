import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bug,
  Hand,
  Link2,
  Link2Off,
  Loader2,
  MessageCircleQuestion,
  Pencil,
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

type Panel = 'none' | 'confirm-send' | 'edit' | 'ask' | 'link'

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

  const openEditor = () => {
    setPanel('edit')
    setError(null)
    // Opening the editor stops the countdown, exactly as opening the Discord
    // modal does. Typing a reply takes longer than a hold that is nearly up,
    // and "I am working on this one" has to actually stop the clock rather
    // than race it.
    if (pending && detail.hold) {
      void run('hold', () => adminApi.holdDraft(getToken, draft.id))
    }
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
      <h2 className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
        What you can do
      </h2>

      {!pending && (
        <p className="mt-2 rounded-xl bg-base-200/40 px-4 py-3 text-sm text-base-content/60 ring-1 ring-base-300/60">
          {draft
            ? `This draft is ${draft.status}, so there is nothing left to send on it. The issue link below is still yours to change.`
            : 'There is no draft to act on. Link an issue, or answer this one in osTicket.'}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {pending && (
          <>
            <ActionButton
              label="Send"
              icon={<Send size={14} />}
              tone="primary"
              busy={busy === 'send'}
              disabled={busy !== null}
              onClick={() => {
                setPanel('confirm-send')
                setError(null)
              }}
            />
            <ActionButton
              label="Edit"
              icon={<Pencil size={14} />}
              busy={busy === 'hold' && panel === 'edit'}
              disabled={busy !== null}
              onClick={openEditor}
            />
            <ActionButton
              label="Ask"
              icon={<MessageCircleQuestion size={14} />}
              disabled={busy !== null}
              onClick={() => {
                setPanel('ask')
                setError(null)
              }}
            />
            <ActionButton
              label="Hold"
              icon={<Hand size={14} />}
              busy={busy === 'hold' && panel !== 'edit'}
              disabled={busy !== null}
              onClick={() =>
                run('hold', () => adminApi.holdDraft(getToken, draft.id))
              }
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
            <ActionButton
              label="File as bug"
              icon={<Bug size={14} />}
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
            disabled={busy !== null}
            onClick={() => {
              setPanel('link')
              setError(null)
            }}
          />
        )}
      </div>

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

      {/* ── Send, confirmed ─────────────────────────────────────── */}
      {panel === 'confirm-send' && pending && (
        <ConfirmSend
          who={detail.user_email}
          closing={draft.should_close}
          busy={busy === 'send'}
          onCancel={() => setPanel('none')}
          onSend={() =>
            run(
              'send',
              () => adminApi.sendDraft(getToken, draft.id),
              () => setPanel('none'),
            )
          }
        />
      )}

      {/* ── The editor ──────────────────────────────────────────── */}
      {panel === 'edit' && pending && (
        <div className="mt-3 space-y-3 rounded-xl p-4 ring-1 ring-base-300/60">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label
                htmlFor="reply-body"
                className="text-xs font-semibold tracking-wide text-base-content/50 uppercase"
              >
                The reply
              </label>
              {/* No maxLength. Discord capped this at 4000 because a Discord
                  modal does; a support email does not, and a limit that comes
                  from the surface you happen to be typing into is a limit that
                  silently cuts somebody's answer in half. */}
              <textarea
                id="reply-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                spellCheck
                className="mt-1 w-full resize-y rounded-lg bg-base-100 px-3 py-2 font-mono text-sm ring-1 ring-base-300/60 focus:ring-2 focus:ring-primary/50 focus:outline-none"
              />
              <p className="mt-1 text-xs text-base-content/45">
                {edited.length.toLocaleString()} characters. Plain text — it is
                wrapped into paragraphs on the way out.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-wide text-base-content/50 uppercase">
                What they wrote
              </p>
              {/* Beside the box, not behind it. The Discord modal covered the
                  thread while it was open, so rewriting an answer meant
                  cancelling out to re-read the question. */}
              <div className="mt-1 max-h-[26rem] overflow-y-auto rounded-lg bg-base-200/40 px-3 py-2 text-sm whitespace-pre-wrap text-base-content/80 ring-1 ring-base-300/60">
                {lastUserMessage(detail) ?? (
                  <span className="text-base-content/45 italic">
                    Nothing from the user is on record for this ticket.
                  </span>
                )}
              </div>
            </div>
          </div>

          <DiffPanel before={draft.body} after={edited} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null || edited === ''}
              onClick={() =>
                run(
                  'edit',
                  () => adminApi.editAndSend(getToken, draft.id, edited),
                  () => setPanel('none'),
                )
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-content disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'edit' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Send this instead
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPanel('none')}
              className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200/60"
            >
              Cancel
            </button>
            {unchanged && edited !== '' && (
              <span className="text-xs text-base-content/50">
                Nothing has changed yet — this would send the draft as written.
              </span>
            )}
          </div>
        </div>
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
  busy,
  onSend,
  onCancel,
}: {
  who?: string
  closing: boolean
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
  busy,
  disabled,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  tone?: 'primary'
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

/** The reporter's most recent words — what an answer has to answer. */
function lastUserMessage(detail: CaseDetail): string | null {
  const messages = detail.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === 'user' && messages[i].body.trim() !== '') {
      return messages[i].body
    }
  }
  return null
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
