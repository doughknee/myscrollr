import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { FormEvent } from 'react'
import type { SupportCategory, SupportTicketPayload } from '@/api/client'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { supportApi } from '@/api/client'

const CATEGORIES: ReadonlyArray<{ value: SupportCategory; label: string }> = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'billing', label: 'Billing & subscription' },
  { value: 'feedback', label: 'General feedback' },
] as const

const SUBJECT_MIN = 3
const SUBJECT_MAX = 200
const MESSAGE_MIN = 10
const MESSAGE_MAX = 5000

export function SupportContactForm() {
  const { isAuthenticated, getAccessToken, getIdTokenClaims } = useScrollrAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState<SupportCategory>('feedback')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Pre-fill email + name from claims when authenticated. The contact
  // form still SUBMITS those values (the authed endpoint accepts them
  // for forwards-compatibility with OS Ticket), but the user doesn't
  // have to retype them.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    getIdTokenClaims()
      .then((claims) => {
        if (cancelled || !claims) return
        if (claims.email) setEmail(claims.email)
        if (claims.name) setName(claims.name)
      })
      .catch(() => {
        // Non-fatal: user can still type their email manually.
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getIdTokenClaims])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side validation matches the server's bounds so the user
    // sees the constraint before we round-trip.
    const trimmedSubject = subject.trim()
    const trimmedMessage = message.trim()
    const trimmedEmail = email.trim()

    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    if (
      trimmedSubject.length < SUBJECT_MIN ||
      trimmedSubject.length > SUBJECT_MAX
    ) {
      setError(`Subject must be ${SUBJECT_MIN}-${SUBJECT_MAX} characters.`)
      return
    }
    if (
      trimmedMessage.length < MESSAGE_MIN ||
      trimmedMessage.length > MESSAGE_MAX
    ) {
      setError(`Message must be ${MESSAGE_MIN}-${MESSAGE_MAX} characters.`)
      return
    }

    setSubmitting(true)
    try {
      const payload: SupportTicketPayload = {
        email: trimmedEmail,
        category,
        subject: trimmedSubject,
        message: trimmedMessage,
        name: name.trim() || undefined,
      }
      if (isAuthenticated) {
        await supportApi.submitTicket(payload, getAccessToken)
      } else {
        await supportApi.submitTicketPublic(payload)
      }
      setSuccess(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section id="contact" className="scroll-mt-24 border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 04 ／ OPEN A TICKET" />
        <div className="pb-14 pt-8">
          <p className="mb-8 max-w-[480px] text-[14.5px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
            We read every message. Replies usually arrive within 1-2 business
            days.
          </p>

          {success ? (
            <SuccessPanel
              onReset={() => {
                setSuccess(false)
                setSubject('')
                setMessage('')
              }}
            />
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex max-w-[760px] flex-col gap-5 rounded-[8px] border border-hairline bg-panel p-6 sm:p-8"
              noValidate
            >
              {/* Name + email row. Email is required for both flows; name is optional. */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Your name" htmlFor="support-name" optional>
                  <input
                    id="support-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    autoComplete="name"
                    maxLength={120}
                    className="input-base"
                    placeholder="Optional"
                  />
                </FormField>

                <FormField label="Email" htmlFor="support-email" required>
                  <input
                    id="support-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting || isAuthenticated}
                    required
                    autoComplete="email"
                    maxLength={254}
                    className="input-base"
                    placeholder="you@example.com"
                  />
                  {isAuthenticated ? (
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-base-content/40">
                      Linked to your account
                    </p>
                  ) : null}
                </FormField>
              </div>

              <FormField label="Category" htmlFor="support-category" required>
                <select
                  id="support-category"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as SupportCategory)
                  }
                  disabled={submitting}
                  className="input-base"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Subject" htmlFor="support-subject" required>
                <input
                  id="support-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={submitting}
                  required
                  minLength={SUBJECT_MIN}
                  maxLength={SUBJECT_MAX}
                  className="input-base"
                  placeholder="One-line summary"
                />
              </FormField>

              <FormField
                label="Message"
                htmlFor="support-message"
                required
                counter={`${message.length}/${MESSAGE_MAX}`}
              >
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={submitting}
                  required
                  minLength={MESSAGE_MIN}
                  maxLength={MESSAGE_MAX}
                  rows={7}
                  className="input-base resize-y"
                  placeholder="Tell us what's going on. The more detail, the better."
                />
              </FormField>

              {error ? (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-[4px] border border-error/30 bg-error/10 p-3"
                  role="alert"
                >
                  <p className="m-0 text-xs text-error">{error}</p>
                </motion.div>
              ) : null}

              <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-xs text-base-content/40">
                  {isAuthenticated
                    ? 'Submitted with your account, so we can look up your subscription if needed.'
                    : 'Submitted anonymously. Limited to 5 tickets per hour per IP.'}
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex cursor-pointer items-center justify-center rounded-[4px] bg-primary px-6 py-3 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[#101018] transition-colors hover:bg-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Local utility classes — kept here so the input styling stays
            colocated with the form rather than leaking into globals. */}
        <style>{`
          .input-base {
            width: 100%;
            background-color: var(--color-base-75);
            border: 1px solid var(--color-hairline);
            border-radius: 4px;
            padding: 0.55rem 0.75rem;
            font-size: 0.875rem;
            color: var(--color-base-content);
            transition: border-color 0.15s ease, box-shadow 0.15s ease;
          }
          .input-base:focus {
            outline: none;
            border-color: #34d399;
            box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.15);
          }
          .input-base:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .input-base::placeholder {
            color: color-mix(in oklab, var(--color-base-content) 35%, transparent);
          }
        `}</style>
      </TerminalContainer>
    </section>
  )
}

// ── Internal helpers ──────────────────────────────────────────────

interface FormFieldProps {
  label: string
  htmlFor: string
  required?: boolean
  optional?: boolean
  counter?: string
  children: React.ReactNode
}

function FormField({
  label,
  htmlFor,
  required,
  optional,
  counter,
  children,
}: FormFieldProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-base-content/60"
        >
          {label}
          {required ? <span className="ml-1 text-primary">*</span> : null}
          {optional ? (
            <span className="ml-1 text-base-content/30">(optional)</span>
          ) : null}
        </label>
        {counter ? (
          <span className="font-mono text-[10px] tabular-nums text-base-content/35">
            {counter}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function SuccessPanel({ onReset }: { onReset: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="flex max-w-[760px] flex-col items-start gap-4 rounded-[8px] border border-primary/30 bg-panel p-8"
      role="status"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
        Ticket received
      </div>
      <div>
        <h3 className="m-0 text-lg font-bold text-base-content">
          Message sent — thanks.
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-base-content/55">
          We've received your note and will get back to you within 1-2 business
          days at the email you provided.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="cursor-pointer rounded-[4px] border border-hairline px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-base-content/70 transition-colors hover:border-primary hover:text-primary"
      >
        Send another
      </button>
    </motion.div>
  )
}
