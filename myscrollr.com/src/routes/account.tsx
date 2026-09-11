import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Pencil, X } from 'lucide-react'
import type { UserOverview } from '@/api/client'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import LoadingSpinner from '@/components/LoadingSpinner'
import { userApi } from '@/api/client'
import { useGetToken } from '@/hooks/useGetToken'
import SubscriptionStatus from '@/components/billing/SubscriptionStatus'
import AccountDangerZone from '@/components/account/AccountDangerZone'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/account')({
  head: () =>
    seo({
      title: 'Account | Scrollr',
      description:
        'Manage your Scrollr account, subscription, and connected services.',
      path: '/account',
      noindex: true,
    }),
  component: AccountHub,
})

export function AccountHub() {
  const { isAuthenticated, isLoading, signIn, signOut } = useScrollrAuth()
  const getToken = useGetToken()
  const [overview, setOverview] = useState<UserOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const fetchOverview = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      setOverview(await userApi.overview(getToken))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load your account.',
      )
    } finally {
      setRefreshing(false)
    }
  }, [getToken])
  useEffect(() => {
    if (isAuthenticated) void fetchOverview()
    else setOverview(null)
  }, [isAuthenticated, fetchOverview])
  if (isLoading)
    return <LoadingSpinner variant="spin" label="Checking your session" />
  if (!isAuthenticated)
    return (
      <section className="mx-auto max-w-lg px-6 py-20 text-center">
        <h1 className="text-3xl font-bold">Your Scrollr account</h1>
        <p className="mt-3 text-base-content/65">
          Sign in to manage your profile, subscription, and privacy settings.
        </p>
        <button
          type="button"
          onClick={() => signIn('/account')}
          className="mt-6 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-content"
        >
          Sign in
        </button>
      </section>
    )
  const card = 'rounded-xl border border-hairline bg-base-100 p-5 sm:p-6'
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            Account
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {overview?.identity.name ||
              overview?.identity.username ||
              'Your account'}
          </h1>
          <p className="mt-2 text-sm text-base-content/65">
            Your profile, plan, and privacy controls in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut(window.location.origin)}
          className="rounded-lg border border-hairline px-4 py-2 text-sm font-semibold hover:bg-base-200"
        >
          Sign out
        </button>
      </header>
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-error/30 bg-error/5 p-4"
        >
          <p className="font-semibold">Could not load your account</p>
          <p className="mt-1 text-sm text-base-content/65">{error}</p>
          <div className="mt-3 flex gap-4">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void fetchOverview()}
              className="text-sm font-semibold text-primary"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => signIn('/account')}
              className="text-sm font-semibold underline"
            >
              Sign in again
            </button>
          </div>
        </div>
      )}
      {!overview && !error && (
        <LoadingSpinner variant="spin" label="Loading your account" />
      )}
      {overview && (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <section className={card} aria-labelledby="account-profile-heading">
              <h2
                id="account-profile-heading"
                className="mb-5 text-lg font-bold"
              >
                Profile & security
              </h2>
              <IdentityEditor
                getToken={getToken}
                overview={overview}
                onUpdated={fetchOverview}
              />
              {overview.links.logto_account && (
                <a
                  href={overview.links.logto_account}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex text-sm font-semibold text-primary"
                >
                  Password, two-step verification & linked accounts ↗
                </a>
              )}
              {overview.identity.username && (
                <Link
                  to="/u/$username"
                  params={{ username: overview.identity.username }}
                  className="mt-4 block text-sm text-base-content/65 underline"
                >
                  View public profile
                </Link>
              )}
            </section>
            <div className="space-y-6">
              <section className={card} aria-labelledby="account-plan-heading">
                <h2
                  id="account-plan-heading"
                  className="mb-5 text-lg font-bold"
                >
                  Plan & billing
                </h2>
                <SubscriptionStatus
                  getToken={getToken}
                  tier={overview.tier.current}
                />
                <Link
                  to="/uplink"
                  search={{ session_id: undefined }}
                  className="mt-5 inline-flex text-sm font-semibold text-primary"
                >
                  Compare plans →
                </Link>
              </section>
              <section className={card} aria-labelledby="account-app-heading">
                <h2 id="account-app-heading" className="text-lg font-bold">
                  Desktop app
                </h2>
                <p className="mt-2 text-sm text-base-content/65">
                  Manage your ticker, widgets, and app analytics preferences in
                  Scrollr.
                </p>
                <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold">
                  <Link to="/download" className="text-primary">
                    Download Scrollr →
                  </Link>
                  <Link to="/support" className="text-base-content/65">
                    Get help
                  </Link>
                  <Link to="/status" className="text-base-content/65">
                    Service status
                  </Link>
                </div>
              </section>
            </div>
          </div>
          <AccountDangerZone
            getToken={getToken}
            deletionStatus={overview.gdpr.deletion_status}
            purgeAt={overview.gdpr.purge_at}
            onDeletionChange={fetchOverview}
          />
        </>
      )}
    </div>
  )
}

// ── Identity Editor ─────────────────────────────────────────────
//
// Inline-edit pattern for display name + primary email, plus a
// password-reset trigger. The reset button doesn't reveal a token —
// it asks the API to email the user a link to the Logto sign-in page
// where they can use the standard "Forgot password?" flow. The
// username row is read-only (immutable).

interface IdentityEditorProps {
  getToken: () => Promise<string | null>
  overview: UserOverview | null
  onUpdated: () => void | Promise<void>
}

function IdentityEditor({
  getToken,
  overview,
  onUpdated,
}: IdentityEditorProps) {
  const [resetState, setResetState] = useState<
    'idle' | 'sending' | 'sent' | 'error'
  >('idle')
  const [resetError, setResetError] = useState<string | null>(null)

  // Auto-reset the "sent" confirmation back to idle after 30s so the
  // button becomes actionable again (e.g. for users who don't receive
  // the email or want to re-trigger).
  useEffect(() => {
    if (resetState !== 'sent') return
    const timer = setTimeout(() => setResetState('idle'), 30_000)
    return () => clearTimeout(timer)
  }, [resetState])

  async function handleSendReset() {
    try {
      setResetState('sending')
      setResetError(null)
      await userApi.requestPasswordReset(getToken)
      setResetState('sent')
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to send')
      setResetState('error')
    }
  }

  return (
    <div className="space-y-4">
      <EditableField
        label="Display name"
        value={overview?.identity.name ?? ''}
        placeholder="Add a display name"
        onSave={async (next) => {
          await userApi.updateProfile({ name: next }, getToken)
          await onUpdated()
        }}
      />
      <EditableField
        label="Email"
        type="email"
        value={overview?.identity.email ?? ''}
        placeholder="you@example.com"
        onSave={async (next) => {
          await userApi.updateProfile({ email: next }, getToken)
          await onUpdated()
        }}
      />
      <div className="flex items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-base-content/40 mb-1">
            Username
          </div>
          <div className="text-sm text-base-content/70 font-mono truncate">
            {overview?.identity.username || '—'}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-base-content/30 px-2 py-1 rounded-md bg-base-content/5 shrink-0">
          Cannot be changed
        </span>
      </div>

      <div className="pt-3 border-t border-base-300/30">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-base-content/40 mb-1">
              Password
            </div>
            <div className="text-sm text-base-content/60 leading-relaxed">
              We&apos;ll email you a link to reset it from the sign-in page.
            </div>
          </div>
          <button
            onClick={handleSendReset}
            disabled={resetState === 'sending' || resetState === 'sent'}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border border-base-content/10 rounded-lg text-base-content/60 hover:text-primary hover:border-primary/30 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {resetState === 'sending' ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Sending…
              </>
            ) : resetState === 'sent' ? (
              <>
                <Check size={12} /> Email sent
              </>
            ) : (
              <>
                <KeyRound size={12} /> Send reset email
              </>
            )}
          </button>
        </div>
        {resetState === 'error' && resetError && (
          <p className="mt-2 text-xs text-error/80">{resetError}</p>
        )}
      </div>
    </div>
  )
}

interface EditableFieldProps {
  label: string
  value: string
  placeholder?: string
  type?: 'text' | 'email'
  onSave: (next: string) => Promise<void>
}

function EditableField({
  label,
  value,
  placeholder,
  type = 'text',
  onSave,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the draft in sync if the parent re-fetches the overview while
  // we're not editing.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  async function handleSave() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      setEditing(false)
      setError(null)
      return
    }
    if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address')
      return
    }
    try {
      setSaving(true)
      setError(null)
      await onSave(trimmed)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="py-2">
      <div className="text-xs uppercase tracking-wide text-base-content/40 mb-1.5">
        {label}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
            className="flex-1 px-3 py-2 text-sm bg-base-300/50 border border-base-300/60 rounded-lg text-base-content focus:outline-none focus:border-primary/50 disabled:opacity-60"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            aria-label="Save"
            className="p-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
          </button>
          <button
            onClick={() => {
              setDraft(value)
              setEditing(false)
              setError(null)
            }}
            disabled={saving}
            aria-label="Cancel"
            className="p-2 rounded-lg border border-base-content/10 text-base-content/40 hover:text-base-content/70 disabled:opacity-60 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-base-content/80 truncate min-w-0">
            {value || (
              <span className="text-base-content/30 italic">
                {placeholder ?? 'Not set'}
              </span>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-base-content/40 hover:text-base-content/70 rounded-md transition-colors"
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-error/80">{error}</p>}
    </div>
  )
}
