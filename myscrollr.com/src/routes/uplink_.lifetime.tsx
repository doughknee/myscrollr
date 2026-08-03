import { ClientOnly, Link, createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { Suspense, lazy, useEffect, useState } from 'react'
import { Check, CheckCircle2, Loader2 } from 'lucide-react'

import type { SubscriptionStatus } from '@/api/client'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import { EASE, riseIn } from '@/lib/animations'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { useGetToken } from '@/hooks/useGetToken'
import { billingApi } from '@/api/client'

const CheckoutModal = lazy(() => import('@/components/billing/CheckoutModal'))

export const Route = createFileRoute('/uplink_/lifetime')({
  validateSearch: () => ({}),
  head: () =>
    seo({
      title: 'Scrollr Lifetime Ultimate: Founding Members',
      description:
        'One payment, permanent Uplink Ultimate access: unlimited widgets, priority support, and early access, forever. Only 128 founding member slots available.',
      path: '/uplink/lifetime',
      image: 'https://myscrollr.com/og/uplink.png',
      type: 'product',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Uplink', path: '/uplink' },
          { name: 'Lifetime', path: '/uplink/lifetime' },
        ]),
      ],
    }),
  // Lifetime is auth/subscription-aware throughout — wrap in ClientOnly
  // so the route still prerenders correct <head> meta and JSON-LD,
  // while the dynamic auth-conditional body hydrates on the client.
  component: () => (
    <ClientOnly>
      <LifetimePage />
    </ClientOnly>
  ),
})

// ── Feature line ────────────────────────────────────────────────
function Feature({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: -10 },
        show: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
        },
      }}
      className="flex items-center gap-3"
    >
      <Check size={14} className="shrink-0 text-warning-ink" />
      <span className="text-[13px] text-base-muted">{children}</span>
    </motion.div>
  )
}

// ── Page Component ──────────────────────────────────────────────
function LifetimePage() {
  const { isAuthenticated, signIn } = useScrollrAuth()
  const getToken = useGetToken()

  const [showCheckout, setShowCheckout] = useState(false)
  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [currentSub, setCurrentSub] = useState<SubscriptionStatus | null>(null)

  // Fetch subscription status (to check for existing lifetime or active sub)
  useEffect(() => {
    if (!isAuthenticated) {
      setCurrentSub(null)
      return
    }
    billingApi
      .getSubscription(getToken)
      .then(setCurrentSub)
      .catch(() => {})
  }, [isAuthenticated, getToken, checkoutSuccess])

  const isAlreadyLifetime = currentSub?.lifetime === true
  const hasActiveSub =
    currentSub?.status === 'active' || currentSub?.status === 'trialing'

  const handlePurchase = () => {
    if (!isAuthenticated) {
      signIn('/uplink/lifetime')
      return
    }
    setShowCheckout(true)
  }

  return (
    <div className="min-h-dvh">
      {/* ── Checkout Modal ──────────────────────────────────── */}
      {showCheckout && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutModal
            plan={{ name: 'Lifetime', tier: 'lifetime', price: 999 }}
            hasTrial={false}
            getToken={getToken}
            onSuccess={() => {
              setShowCheckout(false)
              setCheckoutSuccess(true)
            }}
            onClose={() => setShowCheckout(false)}
          />
        </Suspense>
      )}

      {/* ── Success Banner ──────────────────────────────────── */}
      {checkoutSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-24 z-40 flex -translate-x-1/2 items-center gap-3 rounded-[4px] border border-warning/30 bg-warning/10 px-6 py-4 backdrop-blur-sm"
        >
          <CheckCircle2 size={18} className="text-warning-ink" />
          <div>
            <p className="text-xs font-semibold text-warning-ink">
              Lifetime Uplink Activated
            </p>
            <p className="text-[10px] text-base-subtle">
              Welcome, founding member. Your access is permanent.
            </p>
          </div>
          <button
            onClick={() => setCheckoutSuccess(false)}
            className="ml-4 text-xs text-base-subtle transition-colors hover:text-base-muted"
          >
            ✕
          </button>
        </motion.div>
      )}

      {/* ================================================================
          HERO — terminal header, amber accents
          ================================================================ */}
      <section className="relative overflow-hidden border-b border-hairline px-5 pb-16 pt-14 sm:px-8">
        {/* Soft amber radial glow behind the header */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[220px] left-[45%] h-[480px] w-[720px]"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(251,191,36,.09), transparent 65%)',
          }}
        />

        <div className="relative mx-auto max-w-[1280px]">
          {/* Back link */}
          <motion.div {...riseIn(0)}>
            <Link
              to="/uplink"
              className="mb-10 inline-block font-mono text-[11px] tracking-[0.14em] text-base-subtle transition-colors hover:text-base-muted"
            >
              ← BACK TO UPLINK
            </Link>
          </motion.div>

          {/* Eyebrow row */}
          <motion.div
            {...riseIn(1)}
            className="mb-10 flex flex-wrap justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-base-subtle"
          >
            <span>UPLINK ／ LIFETIME</span>
            <span>128 FOUNDING MEMBER SLOTS · ONE PAYMENT</span>
          </motion.div>

          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            {/* Left — Copy */}
            <div>
              {/* Headline */}
              <motion.h1
                {...riseIn(2)}
                className="type-display m-0 mb-8 text-[clamp(44px,6vw,88px)]"
              >
                Ultimate.
                <br />
                <span className="text-primary">One Payment.</span>
                <br />
                <span className="text-warning-ink">Forever.</span>
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                {...riseIn(3)}
                className="m-0 mb-10 max-w-[480px] text-[15.5px] leading-relaxed text-base-muted [text-wrap:pretty]"
              >
                Lifetime members get permanent Uplink Ultimate access with a
                single payment: unlimited widgets at once, priority support, and
                early access, forever. No renewals, no tiers to think about.
                Only 128 founding member slots will ever exist.
              </motion.p>

              {/* Feature list */}
              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: {
                    transition: { delayChildren: 0.35, staggerChildren: 0.07 },
                  },
                }}
                className="space-y-3"
              >
                <Feature>
                  Permanent Uplink Ultimate access. One payment, no renewals.
                </Feature>
                <Feature>Unlimited widgets at once</Feature>
                <Feature>Early access to new widgets and features</Feature>
                <Feature>Unlimited items inside every widget</Feature>
                <Feature>Founding member badge & priority support</Feature>
              </motion.div>
            </div>

            {/* Right — Purchase Card */}
            <motion.div {...riseIn(3)} className="relative">
              {/* Ambient amber orb behind the card */}
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[520px] -translate-x-1/2 -translate-y-1/2"
                style={{
                  background:
                    'radial-gradient(ellipse at center, rgba(251,191,36,0.10) 0%, rgba(251,191,36,0.03) 45%, transparent 70%)',
                  filter: 'blur(40px)',
                }}
                animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              <div className="relative overflow-hidden rounded-[8px] border border-warning/40 bg-warning/[0.03]">
                {/* Corner tag */}
                <div
                  className="absolute -right-px -top-px z-10 bg-warning px-3 py-[5px] font-mono text-[10px] font-semibold tracking-[0.12em] text-[#101018]"
                  style={{ borderRadius: '0 8px 0 6px' }}
                >
                  LIMITED · FOUNDING MEMBERS
                </div>

                <div className="relative z-10 p-8 lg:p-10">
                  {/* Mono label row */}
                  <div className="mb-8 flex items-center justify-between gap-4">
                    <span className="font-mono text-[11px] tracking-[0.14em] text-warning-ink">
                      LIFETIME ULTIMATE
                    </span>
                    <span className="font-mono text-[10px] tracking-[0.12em] text-base-subtle">
                      128 SLOTS TOTAL
                    </span>
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[56px] font-semibold tracking-[-0.02em]">
                      $999
                    </span>
                    <span className="font-mono text-[13px] text-base-subtle">
                      ONCE
                    </span>
                  </div>
                  <p className="mb-6 mt-1 font-mono text-[10.5px] text-base-subtle">
                    PAYS FOR ITSELF VS ULTIMATE ANNUAL ($399.99/YR) IN 2.5 YEARS
                  </p>

                  {/* Unlimited upgrade callout */}
                  <div className="mb-6 rounded-[4px] border border-primary/20 bg-primary/5 p-3.5">
                    <p className="m-0 mb-1 text-[11px] font-semibold text-primary">
                      Everything Ultimate has. Forever.
                    </p>
                    <p className="m-0 text-[11px] leading-relaxed text-base-muted">
                      Every Ultimate feature, permanently included: unlimited
                      widgets at once, priority support, and early access.
                      Future Ultimate features land in your account
                      automatically.
                    </p>
                  </div>

                  {/* Slot progress (marketing) */}
                  <div className="mb-8 rounded-[4px] border border-hairline-minor bg-panel p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-base-subtle">
                        Available Slots
                      </span>
                      <span className="font-mono text-xs font-bold text-warning-ink">
                        128 / 128
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-base-300/50">
                      <motion.div
                        className="h-full origin-left rounded-full bg-gradient-to-r from-warning/60 to-primary/60"
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: 1.5,
                          delay: 0.5,
                          ease: EASE,
                        }}
                      />
                    </div>
                  </div>

                  {/* Purchase button */}
                  {isAlreadyLifetime ? (
                    <div className="w-full rounded-[4px] border border-success/20 bg-success/10 px-4 py-3 text-center text-xs font-semibold text-success-ink">
                      <CheckCircle2
                        size={14}
                        className="-mt-0.5 mr-1.5 inline"
                      />
                      You already have lifetime access
                    </div>
                  ) : hasActiveSub ? (
                    <div className="space-y-3">
                      <div className="rounded-[4px] border border-info/20 bg-info/10 px-3 py-2 text-center text-[10px] text-info">
                        You have an active subscription. Purchasing lifetime
                        will replace it.
                      </div>
                      <button
                        type="button"
                        onClick={handlePurchase}
                        className="w-full cursor-pointer rounded-[4px] bg-warning py-3.5 text-[15px] font-bold text-[#101018] transition-colors hover:bg-[#fde68a]"
                      >
                        Purchase lifetime access
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePurchase}
                      className="w-full cursor-pointer rounded-[4px] bg-warning py-3.5 text-[15px] font-bold text-[#101018] transition-colors hover:bg-[#fde68a]"
                    >
                      {isAuthenticated
                        ? 'Purchase lifetime access'
                        : 'Sign in to purchase'}
                    </button>
                  )}

                  {/* Trust signals */}
                  <div className="mt-6 text-center font-mono text-[10.5px] tracking-[0.1em] text-base-subtle">
                    NO SUBSCRIPTION · NO RENEWAL · STRIPE
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  )
}
