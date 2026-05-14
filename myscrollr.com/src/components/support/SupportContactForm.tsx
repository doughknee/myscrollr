import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { SupportSection } from './SupportSection'
import type { FormEvent } from 'react'
import type { SupportCategory, SupportTicketPayload } from '@/api/client'
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
    <SupportSection
      id="contact"
      eyebrow="Contact"
      title="Still need help? Send us a note"
      description="We read every message. Replies usually arrive within 1-2 business days."
      screenshot={{
        basename: 'support/contact-form',
        alt: 'The in-app Contact form in Scrollr, which submits to the same support inbox as this form.',
      }}
    >
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
          className="flex flex-col gap-5 rounded-2xl border border-base-300/40 bg-base-200/30 p-6 sm:p-8"
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
                <p className="mt-1 text-xs text-base-content/40">
                  Linked to your account.
                </p>
              ) : null}
            </FormField>
          </div>

          <FormField label="Category" htmlFor="support-category" required>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as SupportCategory)}
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
              className="flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 p-3"
              role="alert"
            >
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-error"
                aria-hidden="true"
              />
              <p className="text-xs text-error">{error}</p>
            </motion.div>
          ) : null}

          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-base-content/40">
              {isAuthenticated
                ? 'Submitted with your account, so we can look up your subscription if needed.'
                : 'Submitted anonymously. Limited to 5 tickets per hour per IP.'}
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={15} />
                  Send message
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Local utility classes — kept here so the input styling stays
          colocated with the form rather than leaking into globals. */}
      <style>{`
        .input-base {
          width: 100%;
          background-color: color-mix(in oklab, var(--color-base-100) 85%, transparent);
          border: 1px solid color-mix(in oklab, var(--color-base-300) 60%, transparent);
          border-radius: 0.5rem;
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          color: var(--color-base-content);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .input-base:focus {
          outline: none;
          border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 15%, transparent);
        }
        .input-base:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .input-base::placeholder {
          color: color-mix(in oklab, var(--color-base-content) 35%, transparent);
        }
      `}</style>
    </SupportSection>
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
          className="text-xs font-semibold tracking-wider text-base-content/70 uppercase"
        >
          {label}
          {required ? <span className="ml-1 text-primary">*</span> : null}
          {optional ? (
            <span className="ml-1 text-base-content/30 normal-case">
              (optional)
            </span>
          ) : null}
        </label>
        {counter ? (
          <span className="text-[11px] tabular-nums text-base-content/35">
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
      className="flex flex-col items-center gap-4 rounded-2xl border border-success/20 bg-success/5 p-10 text-center"
      role="status"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
        <CheckCircle2 size={24} />
      </div>
      <div>
        <h3 className="text-lg font-bold text-base-content">
          Message sent — thanks!
        </h3>
        <p className="mt-2 max-w-md text-sm text-base-content/55">
          We've received your note and will get back to you within 1-2 business
          days at the email you provided.
        </p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="cursor-pointer rounded-lg border border-base-300/50 bg-base-200/40 px-4 py-2 text-sm font-medium text-base-content/70 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
      >
        Send another
      </button>
    </motion.div>
  )
}
