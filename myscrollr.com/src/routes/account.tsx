import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Check,
  Crown,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Settings,
  User,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import type { ComponentType } from 'react'
import type { UserOverview } from '@/api/client'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import LoadingSpinner from '@/components/LoadingSpinner'
import { pageVariants, sectionVariants } from '@/lib/animations'
import { userApi } from '@/api/client'
import { useGetToken } from '@/hooks/useGetToken'
import SubscriptionStatus from '@/components/billing/SubscriptionStatus'
import AccountDangerZone from '@/components/account/AccountDangerZone'
import { usePageMeta } from '@/lib/usePageMeta'

export const Route = createFileRoute('/account')({
  component: AccountHub,
})

// ── Signature easing (matches homepage) ────────────────────────
const EASE = [0.22, 1, 0.36, 1] as const

// ── Hex colors ─────────────────────────────────────────────────
const HEX = {
  primary: '#34d399',
  secondary: '#ff4757',
  info: '#00b8db',
  accent: '#a855f7',
} as const

// ── Hub card definitions ───────────────────────────────────────
interface HubCardDef {
  title: string
  desc: string
  to?: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  href?: string
  Icon: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
  hex: string
  WatermarkIcon: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

const HUB_CARDS: Array<HubCardDef> = [
  {
    title: 'Desktop App',
    desc: 'Download the Scrollr desktop app',
    to: '/download',
    Icon: BarChart3,
    hex: HEX.primary,
    WatermarkIcon: BarChart3,
  },
  {
    title: 'Public Profile',
    desc: 'View your public presence',
    to: '/u/$username',
    params: { username: 'me' },
    Icon: Globe,
    hex: HEX.info,
    WatermarkIcon: Globe,
  },
  {
    title: 'Security Node',
    desc: 'Manage password, MFA & linked accounts',
    // href is injected at render time from overview.links.logto_account
    Icon: Lock,
    hex: HEX.secondary,
    WatermarkIcon: Lock,
  },
  {
    title: 'Uplink',
    desc: 'Manage your subscription tier',
    to: '/uplink',
    search: { session_id: undefined },
    Icon: Crown,
    hex: HEX.accent,
    WatermarkIcon: Crown,
  },
]

function AccountHub() {
  usePageMeta({
    title: 'Account — Scrollr',
    description:
      'Manage your Scrollr account, subscription, and connected services.',
    canonicalUrl: 'https://myscrollr.com/account',
  })
  const { isAuthenticated, isLoading } = useScrollrAuth()
  const navigate = useNavigate()
  const getToken = useGetToken()

  // ── Prevent remount/re-animation on token refresh ──────────────
  const hasLoaded = useRef(false)
  const autoRedirectTriggered = useRef(false)

  // ── Unified overview state ────────────────────────────────────
  // One round-trip replaces the previous claims + channels +
  // deletion-status fan-out. SubscriptionStatus and the GDPR mutating
  // actions still use their dedicated endpoints.
  const [overview, setOverview] = useState<UserOverview | null>(null)

  const fetchOverview = useCallback(async () => {
    try {
      const data = await userApi.overview(getToken)
      setOverview(data)
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load account overview', err)
      }
    }
  }, [getToken])

  // ── Redirect if not authenticated ────────────────────────────
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !autoRedirectTriggered.current) {
      autoRedirectTriggered.current = true
      navigate({ to: '/' })
    }
  }, [isLoading, isAuthenticated, navigate])

  // ── Fetch data when authenticated ─────────────────────────────
  useEffect(() => {
    if (isAuthenticated) {
      fetchOverview()
    }
  }, [isAuthenticated, fetchOverview])

  // ── Loading / auth guards ─────────────────────────────────────
  if (isLoading && !hasLoaded.current) {
    return <LoadingSpinner variant="spin" label="" />
  }

  if (!isAuthenticated) {
    return <LoadingSpinner variant="spin" label="" />
  }

  hasLoaded.current = true

  return (
    <motion.main
      className="min-h-screen pt-20"
      variants={pageVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── Personalized Hero ── */}
      <section className="relative pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
        <div className="container relative z-10">
          <motion.div className="text-center" variants={sectionVariants}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Welcome back,{' '}
              <span className="text-gradient-primary">
                {overview?.identity.name ||
                  overview?.identity.username ||
                  'User'}
              </span>
            </h1>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Your personal data channels are ready for orchestration. Sync your
              leagues, track your assets, and stay in the flow.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Stats & Status ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
        <div className="container py-16 lg:py-24">
          <motion.div
            className="text-center mb-12 sm:mb-16"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Your <span className="text-gradient-primary">Dashboard</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Subscription, channels, and system health at a glance
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Identity & Security Card */}
            <motion.div
              className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-8 overflow-hidden lg:col-span-2"
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${HEX.info} 50%, transparent)`,
                }}
              />
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />

              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: `${HEX.info}15`,
                    boxShadow: `0 0 20px ${HEX.info}15, 0 0 0 1px ${HEX.info}20`,
                  }}
                >
                  <User size={20} className="text-base-content/80" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-base-content">
                  Identity &amp; Security
                </h3>
              </div>

              <IdentityEditor
                getToken={getToken}
                overview={overview}
                onUpdated={fetchOverview}
              />

              <Lock
                size={130}
                strokeWidth={0.4}
                className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
              />
            </motion.div>

            {/* System Status Link Card */}
            <motion.div
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              <Link
                to="/status"
                className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-8 overflow-hidden group block h-full hover:border-base-300/50 transition-colors"
              >
                {/* Accent top line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${HEX.primary} 50%, transparent)`,
                  }}
                />
                {/* Corner dot grid */}
                <div
                  className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle, currentColor 1px, transparent 1px)',
                    backgroundSize: '8px 8px',
                  }}
                />
                {/* Hover glow orb */}
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `${HEX.primary}10` }}
                />

                <div className="flex items-center gap-3 mb-6">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{
                      background: `${HEX.primary}15`,
                      boxShadow: `0 0 20px ${HEX.primary}15, 0 0 0 1px ${HEX.primary}20`,
                    }}
                  >
                    <Settings size={20} className="text-base-content/80" />
                  </div>
                  <h3 className="text-lg font-black tracking-tight text-base-content">
                    System Status
                  </h3>
                </div>
                <p className="text-sm text-base-content/45 mb-6 leading-relaxed">
                  Monitor infrastructure health, ingestion workers, and live
                  connection status.
                </p>
                <div className="flex items-center gap-2 text-xs font-semibold text-base-content/40 group-hover:text-base-content/70 transition-colors">
                  View Status Dashboard
                  <ArrowRight size={14} />
                </div>

                {/* Watermark */}
                <Settings
                  size={130}
                  strokeWidth={0.4}
                  className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
                />
              </Link>
            </motion.div>

            {/* Subscription Status Card */}
            <motion.div
              className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-8 overflow-hidden group lg:col-span-2"
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
            >
              {/* Accent top line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${HEX.accent} 50%, transparent)`,
                }}
              />
              {/* Corner dot grid */}
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.04] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              {/* Hover glow orb */}
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: `${HEX.accent}10` }}
              />

              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{
                    background: `${HEX.accent}15`,
                    boxShadow: `0 0 20px ${HEX.accent}15, 0 0 0 1px ${HEX.accent}20`,
                  }}
                >
                  <Crown size={20} className="text-base-content/80" />
                </div>
                <h3 className="text-lg font-black tracking-tight text-base-content">
                  Subscription
                </h3>
              </div>

              <SubscriptionStatus
                getToken={getToken}
                tier={overview?.tier.current}
              />

              <Link
                to="/uplink"
                search={{ session_id: undefined }}
                className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-base-content/40 hover:text-base-content/70 transition-colors"
              >
                View Plans <ArrowRight size={14} />
              </Link>

              {/* Watermark */}
              <Crown
                size={130}
                strokeWidth={0.4}
                className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Quick Links (relocated from top — secondary affordances) ── */}
      <section className="relative overflow-hidden">
        <div className="container py-10 lg:py-14">
          <motion.div
            className="text-center mb-8"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-base-content/70 mb-2">
              Quick Links
            </h2>
          </motion.div>

          {(() => {
            const visibleCards = HUB_CARDS.filter((card) => {
              if (card.title === 'Public Profile') {
                return Boolean(overview?.identity.username)
              }
              if (card.title === 'Security Node') {
                return Boolean(overview?.links.logto_account)
              }
              return true
            }).map((card) => {
              if (
                card.title === 'Public Profile' &&
                overview?.identity.username
              ) {
                return {
                  ...card,
                  params: { username: overview.identity.username },
                }
              }
              if (
                card.title === 'Security Node' &&
                overview?.links.logto_account
              ) {
                return {
                  ...card,
                  href: overview.links.logto_account,
                }
              }
              return card
            })

            return (
              <div className="flex flex-wrap items-stretch justify-center gap-4 max-w-5xl mx-auto">
                {visibleCards.map((card, i) => (
                  <div
                    key={card.title}
                    className="w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)] min-w-[220px] max-w-sm"
                  >
                    <HubCard card={card} index={i} />
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      </section>

      {/* ── GDPR: Export + Delete ── */}
      <AccountDangerZone
        getToken={getToken}
        deletionStatus={overview?.gdpr.deletion_status ?? 'none'}
        purgeAt={overview?.gdpr.purge_at ?? null}
        onDeletionChange={fetchOverview}
      />
    </motion.main>
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
          Immutable
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

// ── Hub Card ───────────────────────────────────────────────────

function HubCard({ card, index }: { card: HubCardDef; index: number }) {
  const { title, desc, to, params, search, href, Icon, hex, WatermarkIcon } =
    card
  const isInteractive = Boolean(href || to)

  const inner = (
    <motion.div
      className={`relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden group h-full flex flex-col justify-between transition-colors ${
        isInteractive
          ? 'cursor-pointer hover:border-base-300/50'
          : 'cursor-default opacity-75'
      }`}
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, ease: EASE, delay: index * 0.1 }}
      whileHover={
        isInteractive
          ? { y: -3, transition: { type: 'tween', duration: 0.2 } }
          : undefined
      }
    >
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
        }}
      />
      {/* Corner dot grid */}
      <div
        className="absolute top-0 right-0 w-16 h-16 opacity-[0.04] text-base-content"
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />
      {/* Hover glow orb */}
      <div
        className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `${hex}10` }}
      />

      {/* Arrow indicator */}
      {isInteractive ? (
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowRight size={16} className="text-base-content/40" />
        </div>
      ) : null}

      <div className="space-y-5">
        {/* Icon badge */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{
            background: `${hex}15`,
            boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
          }}
        >
          <Icon size={20} className="text-base-content/80" />
        </div>
        <div>
          <h3 className="text-lg font-black tracking-tight text-base-content group-hover:text-base-content/80 transition-colors">
            {title}
          </h3>
          <p className="text-xs text-base-content/40 mt-2 leading-relaxed">
            {desc}
          </p>
        </div>
      </div>

      {/* Watermark */}
      <WatermarkIcon
        size={80}
        strokeWidth={0.4}
        className="absolute -bottom-2 -right-2 text-base-content/[0.025] pointer-events-none"
      />
    </motion.div>
  )

  // External link (e.g. Logto Account Center)
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full"
      >
        {inner}
      </a>
    )
  }

  if (!to) {
    return <div className="block h-full">{inner}</div>
  }

  return (
    <Link
      to={to}
      params={params as Record<string, string>}
      search={search as Record<string, unknown>}
      className="block h-full"
    >
      {inner}
    </Link>
  )
}
