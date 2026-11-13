import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { pageVariants, sectionVariants } from '@/lib/animations'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/u/$username')({
  head: ({ params }) =>
    seo({
      title: `${params.username} | Scrollr`,
      description: `View ${params.username}'s Scrollr profile and connected widgets.`,
      path: `/u/${params.username}`,
      noindex: true,
    }),
  component: ProfilePage,
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

interface ProfileData {
  username: string
  display_name?: string
  avatar?: string
}

function ProfilePage() {
  const { username } = Route.useParams()
  const { isAuthenticated, isLoading, signIn, getIdTokenClaims } =
    useScrollrAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Logto reports signed-out until it has read the session; deciding now
    // would show the owner "not found".
    if (isLoading) return
    async function loadProfile() {
      setLoading(true)
      setError(null)

      // Handle /u/me redirect - get username from ID Token
      if (username === 'me') {
        if (!isAuthenticated) {
          setLoading(false)
          return
        }

        try {
          const claims = await getIdTokenClaims()
          const logtoUsername = claims?.username

          if (logtoUsername) {
            window.location.href = `/u/${logtoUsername}`
            return
          }

          // Fallback to sub if no username
          if (claims?.sub) {
            window.location.href = `/u/${claims.sub}`
            return
          }

          setError('No identity found in your Logto account')
        } catch {
          setError('Failed to load profile')
        }
        setLoading(false)
        return
      }

      // Core's GET /users/:username echoes any name back as a profile, so it
      // proves nothing. The only profile this page can vouch for is the
      // signed-in visitor's own; every other name is "not found".
      let own: Array<string> = []
      if (isAuthenticated) {
        const claims = await getIdTokenClaims()
        own = [claims?.username, claims?.sub].filter(
          (v): v is string => typeof v === 'string' && v !== '',
        )
      }
      if (!own.includes(username)) {
        setProfile(null)
        setLoading(false)
        return
      }

      const profileData: ProfileData = { username, display_name: username }

      setProfile(profileData)
      setLoading(false)
    }

    loadProfile()
  }, [username, isAuthenticated, isLoading, getIdTokenClaims])

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin h-12 w-12 text-base-content/30 mx-auto" />
          <p className="text-xs text-base-content/30">Loading profile...</p>
        </div>
      </div>
    )
  }

  // ── Sign-in prompt for unauthenticated /u/me ──
  if (username === 'me' && !isAuthenticated) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-12 overflow-hidden text-center max-w-md"
        >
          {/* Accent top line */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${HEX.primary} 50%, transparent)`,
            }}
          />
          <AlertCircle className="h-16 w-16 text-warning mx-auto mb-6" />
          <h1 className="text-2xl font-black tracking-tight mb-3">
            Auth Required
          </h1>
          <p className="text-base-content/45 text-sm leading-relaxed mb-8">
            Sign in to access your profile and connected widgets.
          </p>
          <button
            type="button"
            onClick={() => signIn()}
            className="btn btn-pulse btn-lg"
          >
            Sign In
          </button>
        </motion.div>
      </div>
    )
  }

  // ── Profile not found ──
  if (!profile) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="relative bg-base-200/40 border border-base-300/25 rounded-xl p-12 overflow-hidden text-center max-w-md"
        >
          {/* Accent top line */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${HEX.secondary} 50%, transparent)`,
            }}
          />
          <AlertCircle className="h-16 w-16 text-error mx-auto mb-6" />
          <h1 className="text-2xl font-black tracking-tight mb-3">
            Profile Not Found
          </h1>
          <p className="text-base-content/45 text-sm leading-relaxed">
            {error ||
              'There is no public profile at this address. Profiles are only shown to the person who owns them.'}
          </p>
        </motion.div>
      </div>
    )
  }

  // ── Main profile view ──
  return (
    <motion.div
      className="min-h-dvh pt-20"
      variants={pageVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── Profile Hero ── */}
      <section className="relative pt-24 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />
        <div className="container relative z-10">
          <motion.div className="text-center" variants={sectionVariants}>
            {/* Avatar */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5, ease: EASE }}
              className="mx-auto mb-6 w-28 h-28 rounded-xl flex items-center justify-center text-4xl font-black text-base-content/80 uppercase"
              style={{
                background: `${HEX.primary}15`,
                boxShadow: `0 0 40px ${HEX.primary}15, 0 0 0 1px ${HEX.primary}20`,
              }}
            >
              {profile.username ? profile.username[0] : '?'}
            </motion.div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              <span className="text-gradient-primary [overflow-wrap:anywhere]">
                @{profile.username}
              </span>
            </h1>

            {profile.display_name &&
              profile.display_name !== profile.username && (
                <p className="text-base text-base-content/45 mb-4">
                  {profile.display_name}
                </p>
              )}
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <section className="relative overflow-hidden">
        <div className="container py-16 lg:py-24 max-w-4xl mx-auto">
          <motion.div
            className="flex items-center justify-center gap-4 text-base-content/20 text-[10px] uppercase tracking-wide pt-12"
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.2 }}
          >
            <span className="h-px w-12 bg-current opacity-20" />
            <span>Identity Provided by Logto OSS</span>
            <span className="h-px w-12 bg-current opacity-20" />
          </motion.div>
        </div>
      </section>
    </motion.div>
  )
}
