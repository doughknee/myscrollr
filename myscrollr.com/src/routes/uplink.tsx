import { ClientOnly, Link, createFileRoute } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { AnimateNumber } from 'motion-plus/react'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'

import type { SubscriptionStatus, TierLimitsResponse } from '@/api/client'
import { seo } from '@/lib/seo'
import {
  breadcrumbs,
  faqPage,
  organization,
  productOffers,
} from '@/lib/structured-data'
import { EASE } from '@/lib/animations'
import { FALLBACK_LIMITS } from '@/lib/fallbackTierLimits'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { useGetToken } from '@/hooks/useGetToken'
import { billingApi, tierLimitsApi } from '@/api/client'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  StepsGrid,
  TerminalContainer,
} from '@/components/terminal'

const CheckoutModal = lazy(() => import('@/components/billing/CheckoutModal'))

// ── Price IDs (from Stripe via env vars) ───────────────────────
const UPLINK_PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_MONTHLY || '',
  annual: import.meta.env.VITE_STRIPE_PRICE_ANNUAL || '',
} as const

const PRO_PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY || '',
  annual: import.meta.env.VITE_STRIPE_PRICE_PRO_ANNUAL || '',
} as const

const ULTIMATE_PRICE_IDS = {
  monthly: import.meta.env.VITE_STRIPE_PRICE_ULTIMATE_MONTHLY || '',
  annual: import.meta.env.VITE_STRIPE_PRICE_ULTIMATE_ANNUAL || '',
} as const

type PlanKey = 'monthly' | 'annual'
type TierKey = 'uplink' | 'pro' | 'ultimate'

// Motion+ AnimateNumber rolls the per-tier monthly price when the
// billing toggle flips (odometer-style digits instead of the old
// useSpring text interpolation — motion-plus is in the bundle now for
// the count-ups on / and /widgets). Fixed 2dp format keeps cent values
// (9.99, 6.67) exact through the roll. This page is ClientOnly, so no
// SSR wrapper is needed. The vertical-align nudge matches CountUp's:
// the digit strips' internal line-height sags the inline-flex baseline.
function AnimatedPrice({ value }: { value: number }) {
  return (
    <AnimateNumber
      format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
      locales="en-US"
      style={{ verticalAlign: '0.055em' }}
      transition={{
        y: { type: 'spring', visualDuration: 0.4, bounce: 0.15 },
        layout: { duration: 0.25 },
      }}
    >
      {value}
    </AnimateNumber>
  )
}

// Static JSON-LD source data for the /uplink route. Kept module-scope
// so it serializes cleanly inside head() during prerender. Pricing
// mirrors the in-file PRICING constant; widget counts mirror
// FALLBACK_LIMITS.max_widgets — keep all three in sync.
//
// FAQ answers match what the visible FAQ shows on first paint
// (buildUplinkFAQ reads FALLBACK_LIMITS before the API responds), so
// Google's FAQPage rich-result policy holds: schema answer text matches
// what crawlers see in the static HTML.
const STATIC_TIERS = [
  {
    name: 'Uplink',
    description:
      'Six widgets at once, priority support, and early access to new widgets.',
    priceMonthly: 9.99,
    priceAnnual: 79.99,
  },
  {
    name: 'Pro',
    description:
      'Twelve widgets at once, priority support, and early access to new widgets.',
    priceMonthly: 24.99,
    priceAnnual: 199.99,
  },
  {
    name: 'Ultimate',
    description:
      'Unlimited widgets at once, priority support, and early access to new widgets.',
    priceMonthly: 49.99,
    priceAnnual: 399.99,
  },
]

const STATIC_FAQ = [
  {
    question: 'What are widgets, and how many do I get?',
    answer:
      'Widgets are the building blocks of your ticker: MLB scores, a stocks watchlist, crypto prices, your news feed, Yahoo Fantasy, and more. Your plan sets how many run at the same time: Free runs 3, Uplink 6, Pro 12, and Ultimate is unlimited. Each widget holds as much as you want inside it — track a hundred stocks in one Stocks widget and it still counts as one.',
  },
  {
    question: 'How fast are live updates?',
    answer:
      'Instant, on every plan. The moment a price ticks or a score changes, it appears in your ticker over a live streaming connection. There is no faster tier to buy — everyone gets the same speed.',
  },
  {
    question: 'Are there limits inside a widget?',
    answer:
      'No. Every plan holds unlimited items inside each widget: track 5 or 500 symbols in your Stocks widget, follow every source in your news feeds, sync every fantasy league you play. Your plan only sets how many widgets run at once.',
  },
  {
    question: 'What does early access include?',
    answer:
      'When a new widget or feature needs a test run before wide release, paid tiers see it first. It is situational rather than constant (some releases ship to everyone at once), but when an early build exists, you get it, and your feedback shapes what ships.',
  },
  {
    question: 'Is the app different on paid plans?',
    answer:
      'No. Every tier is the same app with the same widgets and the same features. Paying changes how many widgets run at once, not what the app can do.',
  },
]

export const Route = createFileRoute('/uplink')({
  validateSearch: () => ({}),
  head: () =>
    seo({
      title: 'Scrollr Uplink: Pricing & Plans',
      description:
        'Scrollr Uplink adds more widgets at once, priority support, and early access, on top of live streaming for everyone. Plans from $9.99/month with annual savings.',
      path: '/uplink',
      image: 'https://myscrollr.com/og/uplink.png',
      type: 'product',
      jsonLd: [
        organization,
        productOffers(STATIC_TIERS),
        faqPage(STATIC_FAQ),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Uplink', path: '/uplink' },
        ]),
      ],
    }),
  // Uplink is auth/subscription-aware throughout — wrap the entire page
  // in ClientOnly so the route still prerenders correct <head> meta and
  // JSON-LD, while the dynamic auth-conditional body hydrates on the
  // client. The other landing pages prerender real body content; this
  // one is interactive-only by design.
  component: () => (
    <ClientOnly>
      <UplinkPage />
    </ClientOnly>
  ),
})

// ── Comparison Data ─────────────────────────────────────────────

interface ComparisonRow {
  label: string
  free: string
  uplink: string
  pro: string
  ultimate: string
  /** Which columns are visually "upgraded" vs free */
  uplinkUp?: boolean
  proUp?: boolean
  ultimateUp?: boolean
}

/**
 * Build the comparison table rows using the live tier-limits from the API.
 * Rows that describe limit-based features get their numbers from `limits`;
 * rows for non-limit features (alerts, priority support, etc.) are static.
 */
function buildComparison(limits: TierLimitsResponse): Array<ComparisonRow> {
  const free = limits.tiers.free
  const uplink = limits.tiers.uplink
  const pro = limits.tiers.uplink_pro
  const ult = limits.tiers.uplink_ultimate

  const widgets = (n: number | null): string =>
    n === null ? 'Unlimited' : `${n} widgets`

  return [
    {
      label: 'Widgets at once',
      free: widgets(free.max_widgets),
      uplink: widgets(uplink.max_widgets),
      pro: widgets(pro.max_widgets),
      ultimate: widgets(ult.max_widgets),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Live updates',
      free: 'Instant',
      uplink: 'Instant',
      pro: 'Instant',
      ultimate: 'Instant',
    },
    {
      label: 'Early Access',
      free: 'No',
      uplink: 'Yes',
      pro: 'Yes',
      ultimate: 'Yes',
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Priority Support',
      free: 'No',
      uplink: 'Yes',
      pro: 'Yes',
      ultimate: 'Yes',
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
  ]
}

// ── Pricing Plans ──────────────────────────────────────────────

interface PricingPlan {
  price: number
  period: string
  perMonth: number
  savings?: string
}

const PRICING: Record<TierKey, Record<PlanKey, PricingPlan>> = {
  uplink: {
    monthly: { price: 9.99, period: '/mo', perMonth: 9.99 },
    // Annual = exactly 8x monthly on every tier — sell it as time, not
    // a dollar delta ("4 months free" beats "Save ~$40/yr").
    annual: {
      price: 79.99,
      period: '/yr',
      perMonth: 6.67,
      savings: '4 months free',
    },
  },
  pro: {
    monthly: { price: 24.99, period: '/mo', perMonth: 24.99 },
    annual: {
      price: 199.99,
      period: '/yr',
      perMonth: 16.67,
      savings: '4 months free',
    },
  },
  ultimate: {
    monthly: { price: 49.99, period: '/mo', perMonth: 49.99 },
    annual: {
      price: 399.99,
      period: '/yr',
      perMonth: 33.33,
      savings: '4 months free',
    },
  },
}

/** Display price of the lifetime plan. The /uplink/lifetime route owns
 *  the actual checkout (CheckoutModal is passed the amount there). */
const LIFETIME_PRICE = 999

type BillingView = PlanKey | 'lifetime'

// ── Tier Helpers ───────────────────────────────────────────────

const TIER_RANK: Record<TierKey, number> = { uplink: 1, pro: 2, ultimate: 3 }

function tierFromPlan(plan: string): TierKey | null {
  if (plan === 'monthly' || plan === 'annual') return 'uplink'
  if (plan === 'pro_monthly' || plan === 'pro_annual') return 'pro'
  if (plan === 'ultimate_monthly' || plan === 'ultimate_annual')
    return 'ultimate'
  return null
}

// ── Tier Limits (fetched from /tier-limits, fallback for first paint) ──
//
// FALLBACK_LIMITS lives in @/lib/fallbackTierLimits, where a Vitest sync
// test pins it to api/internal/widgets/tier_limits.json (the shared snapshot of the
// backend's DefaultTierLimits).

/** Hook: fetch tier limits once on mount, fall back to embedded constant. */
function useTierLimits(): TierLimitsResponse {
  const [limits, setLimits] = useState<TierLimitsResponse>(FALLBACK_LIMITS)
  useEffect(() => {
    let cancelled = false
    tierLimitsApi
      .get()
      .then((data) => {
        if (!cancelled) setLimits(data)
      })
      .catch(() => {
        // Fallback already in place; silently keep serving cached values.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return limits
}

function getPriceId(tier: TierKey, plan: PlanKey): string {
  if (tier === 'ultimate') return ULTIMATE_PRICE_IDS[plan]
  if (tier === 'pro') return PRO_PRICE_IDS[plan]
  return UPLINK_PRICE_IDS[plan]
}

// ── Uplink FAQ ─────────────────────────────────────────────────

/**
 * Build the FAQ items. Answers that reference numeric caps interpolate
 * them from the live tier-limits; purely descriptive items stay static.
 * Question/answer text must stay in sync with STATIC_FAQ (JSON-LD).
 */
function buildUplinkFAQ(
  limits: TierLimitsResponse,
): Array<{ question: string; answer: string }> {
  const free = limits.tiers.free
  const uplink = limits.tiers.uplink
  const pro = limits.tiers.uplink_pro

  return [
    {
      question: 'What are widgets, and how many do I get?',
      answer: `Widgets are the building blocks of your ticker: MLB scores, a stocks watchlist, crypto prices, your news feed, Yahoo Fantasy, and more. Your plan sets how many run at the same time: Free runs ${free.max_widgets}, Uplink ${uplink.max_widgets}, Pro ${pro.max_widgets}, and Ultimate is unlimited. Each widget holds as much as you want inside it — track a hundred stocks in one Stocks widget and it still counts as one.`,
    },
    ...STATIC_FAQ.slice(1),
  ]
}

// ── Perks (SEC 02 — approved copy, verbatim) ───────────────────

const PERKS = [
  {
    num: '01',
    title: 'More at once',
    body: 'The only number that changes. Free runs three widgets; Uplink runs six, Pro twelve, Ultimate as many as you can read.',
  },
  {
    num: '02',
    title: 'Priority support',
    body: "Paid plans jump the queue. Real humans, usually the ones who wrote the code you're asking about.",
  },
  {
    num: '03',
    title: 'Early access',
    body: 'When a release needs a test run, paid tiers see it first before it rolls out to everyone. You fund the roadmap; you see it first.',
  },
]

const ASSURANCES = [
  '✓ 7-DAY FREE TRIAL',
  '✓ CANCEL WITH ONE CLICK',
  '✓ NO HIDDEN FEES',
  '✓ INSTANT ACTIVATION',
  '✓ FREE TIER ALWAYS INCLUDED',
]

// ── Comparison cell ────────────────────────────────────────────

function CompareCell({ value, up }: { value: string; up?: boolean }) {
  if (value === 'No') {
    return (
      <span
        className="font-mono text-xs text-base-subtle"
        aria-label="Not included"
      >
        —
      </span>
    )
  }
  if (up) {
    return <span className="font-mono text-xs text-primary">✓ {value}</span>
  }
  return <span className="font-mono text-xs text-base-muted">{value}</span>
}

// ── Page Component ──────────────────────────────────────────────

function UplinkPage() {
  const { isAuthenticated, signIn } = useScrollrAuth()
  const getToken = useGetToken()

  // Live tier limits from the backend (fallback-embedded for first paint).
  const tierLimits = useTierLimits()

  const comparisonRows = useMemo(
    () => buildComparison(tierLimits),
    [tierLimits],
  )
  const uplinkFAQ = useMemo(() => buildUplinkFAQ(tierLimits), [tierLimits])

  const [checkoutPlan, setCheckoutPlan] = useState<{
    name: string
    tier: TierKey
    priceId: string
    price: number
    interval: PlanKey
    perMonth: number
  } | null>(null)
  const [checkoutSuccess, setCheckoutSuccess] = useState(false)
  const [billingView, setBillingView] = useState<BillingView>('annual')
  const [currentSub, setCurrentSub] = useState<SubscriptionStatus | null>(null)
  const [planChanging, setPlanChanging] = useState(false)
  const [planChangeError, setPlanChangeError] = useState<string | null>(null)
  const [showTrialCancelModal, setShowTrialCancelModal] = useState(false)
  const [trialCanceling, setTrialCanceling] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)
  const [pendingChange, setPendingChange] = useState<{
    tier: TierKey
    plan: PlanKey
    priceId: string
    amountDue: number
    currency: string
    prorationDate: number
    isDowngrade: boolean
    scheduledDate: number
    isTrialChange: boolean
    trialEnd: number
  } | null>(null)
  const isLifetime = billingView === 'lifetime'
  const billingPeriod: PlanKey = isLifetime ? 'annual' : billingView

  // Derive active tier from current subscription (active, trialing, or canceling)
  const activeTier =
    currentSub &&
    (currentSub.status === 'active' ||
      currentSub.status === 'trialing' ||
      currentSub.status === 'canceling')
      ? tierFromPlan(currentSub.plan)
      : null
  const isTrialing = currentSub?.status === 'trialing'
  const hadPriorSub = currentSub?.had_prior_sub ?? false

  // Derive pending downgrade tier (if a downgrade is scheduled)
  const pendingDowngradeTier = currentSub?.pending_downgrade_plan
    ? tierFromPlan(currentSub.pending_downgrade_plan)
    : null

  // Fetch subscription status on mount (when authenticated)
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

  const handleSelectPlan = async (plan: PlanKey, tier: TierKey = 'uplink') => {
    if (!isAuthenticated) {
      signIn('/uplink')
      return
    }

    setPlanChangeError(null)

    // If user has an active subscription on a different tier, show preview first
    if (activeTier && activeTier !== tier) {
      setLoadingPreview(true)
      try {
        const priceId = getPriceId(tier, plan)
        const preview = await billingApi.previewPlanChange(priceId, getToken)
        setPendingChange({
          tier,
          plan,
          priceId,
          amountDue: preview.amount_due,
          currency: preview.currency,
          prorationDate: preview.proration_date,
          isDowngrade: preview.is_downgrade,
          scheduledDate: preview.scheduled_date,
          isTrialChange: preview.is_trial_change ?? false,
          trialEnd: preview.trial_end ?? 0,
        })
      } catch (err) {
        setPlanChangeError(
          err instanceof Error ? err.message : 'Failed to preview plan change',
        )
      } finally {
        setLoadingPreview(false)
      }
      return
    }

    // No subscription or same tier — open checkout modal
    const priceId = getPriceId(tier, plan)
    const pricing = PRICING[tier]
    const periodPricing = pricing[plan] as {
      price: number
      perMonth: number
    }
    setCheckoutPlan({
      name: TIER_NAMES[tier],
      tier,
      priceId,
      price: periodPricing.price,
      interval: plan,
      perMonth: periodPricing.perMonth,
    })
  }

  const handleConfirmChange = async () => {
    if (!pendingChange) return
    setPlanChanging(true)
    setPendingChange(null)
    try {
      const updated = await billingApi.changePlan(
        pendingChange.priceId,
        pendingChange.prorationDate,
        getToken,
      )
      setCurrentSub(updated)
      setCheckoutSuccess(true)
    } catch (err) {
      setPlanChangeError(
        err instanceof Error ? err.message : 'Failed to change plan',
      )
    } finally {
      setPlanChanging(false)
    }
  }

  const handleCloseCheckout = () => {
    setCheckoutPlan(null)
  }

  /** Get the CTA label for a tier card based on current subscription state. */
  const getCtaLabel = (tier: TierKey): string => {
    if (loadingPreview) return 'Fetching quote...'
    if (!activeTier) {
      // No active subscription — check if they've used their trial
      return hadPriorSub ? 'Subscribe' : 'Start free trial'
    }
    if (isTrialing && activeTier === tier) return 'Your choice'
    if (currentSub?.status === 'canceling' && activeTier === tier)
      return 'Current plan'
    if (activeTier === tier) return 'Current plan'
    if (pendingDowngradeTier === tier) return 'Downgrade scheduled'
    if (isTrialing) return 'Switch to ' + TIER_NAMES[tier]
    return TIER_RANK[tier] > TIER_RANK[activeTier] ? 'Upgrade' : 'Downgrade'
  }

  /** Whether a tier card should be non-interactive. Lifetime members
   *  already own permanent Ultimate — every subscription card is moot
   *  (and the server 409s the checkout anyway). */
  const isTierDisabled = (tier: TierKey): boolean =>
    currentSub?.lifetime === true ||
    activeTier === tier ||
    pendingDowngradeTier === tier

  const TIER_NAMES: Record<TierKey, string> = {
    uplink: 'Uplink',
    pro: 'Uplink Pro',
    ultimate: 'Uplink Ultimate',
  }

  // ── Plan card data (slot caps from live tier-limits — never hardcoded)
  const planDefs = useMemo(() => {
    const t = tierLimits.tiers
    return [
      {
        key: 'free',
        tier: null,
        name: 'Free',
        tagline: "Start here. It's free forever.",
        slots: t.free.max_widgets,
        popular: false,
      },
      {
        key: 'uplink',
        tier: 'uplink' as TierKey,
        name: 'Uplink',
        tagline: 'Check in every morning. Miss nothing.',
        slots: t.uplink.max_widgets,
        popular: false,
      },
      {
        key: 'pro',
        tier: 'pro' as TierKey,
        name: 'Pro',
        tagline: 'Know the moment it happens.',
        slots: t.uplink_pro.max_widgets,
        popular: false,
      },
      {
        key: 'ultimate',
        tier: 'ultimate' as TierKey,
        name: 'Ultimate',
        tagline: 'Everything. Zero limits.',
        slots: t.uplink_ultimate.max_widgets,
        popular: true,
      },
    ]
  }, [tierLimits])

  const billingTabs: Array<{ id: BillingView; label: string }> = [
    { id: 'monthly', label: 'MONTHLY' },
    { id: 'annual', label: 'ANNUAL · 4 MO FREE' },
    { id: 'lifetime', label: 'LIFETIME · LIMITED' },
  ]

  return (
    <div className="min-h-dvh">
      {/* ── Checkout Modal ──────────────────────────────────── */}
      {checkoutPlan && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutModal
            plan={checkoutPlan}
            hasTrial={!hadPriorSub}
            getToken={getToken}
            onSuccess={() => {
              setCheckoutPlan(null)
              setCheckoutSuccess(true)
            }}
            onClose={handleCloseCheckout}
          />
        </Suspense>
      )}
      {/* ── Plan Change Confirmation Modal ─────────────────── */}
      {pendingChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative mx-4 w-full max-w-sm rounded-[8px] border border-hairline bg-panel p-6"
          >
            <h3 className="mb-4 text-sm font-semibold text-base-muted">
              {pendingChange.isTrialChange
                ? 'Switch to'
                : pendingChange.isDowngrade
                  ? 'Downgrade to'
                  : 'Upgrade to'}{' '}
              {TIER_NAMES[pendingChange.tier]}
            </h3>

            <div className="mb-6 space-y-3">
              {pendingChange.isTrialChange ? (
                <>
                  <p className="text-xs text-base-muted">
                    No charge during your trial. Your plan will switch to{' '}
                    <span className="font-semibold text-base-muted">
                      {TIER_NAMES[pendingChange.tier]}
                    </span>{' '}
                    and billing starts{' '}
                    <span className="font-semibold text-base-muted">
                      {new Date(
                        pendingChange.trialEnd * 1000,
                      ).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    .
                  </p>
                  <p className="text-[10px] text-base-subtle">
                    You&rsquo;ll keep full{' '}
                    {TIER_NAMES[activeTier ?? 'ultimate']} access until your
                    trial ends.
                  </p>
                </>
              ) : pendingChange.isDowngrade ? (
                <>
                  <p className="text-xs text-base-muted">
                    Your {activeTier ? TIER_NAMES[activeTier] : ''} access
                    continues until{' '}
                    <span className="font-semibold text-base-muted">
                      {new Date(
                        pendingChange.scheduledDate * 1000,
                      ).toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    .
                  </p>
                  <p className="text-[10px] text-base-subtle">
                    After that, your plan switches to{' '}
                    {TIER_NAMES[pendingChange.tier]} at your next renewal. No
                    charge or refund — your current billing cycle is unaffected.
                  </p>
                </>
              ) : pendingChange.amountDue > 0 ? (
                <>
                  <p className="text-xs text-base-muted">
                    You will be charged{' '}
                    <span className="font-semibold text-base-muted">
                      ${(pendingChange.amountDue / 100).toFixed(2)}
                    </span>{' '}
                    today.
                  </p>
                  <p className="text-[10px] text-base-subtle">
                    This is the prorated difference for the remaining days in
                    your current billing cycle.
                  </p>
                </>
              ) : (
                <p className="text-xs text-base-muted">
                  No charge — your new plan starts immediately.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPendingChange(null)}
                className="flex-1 rounded-[4px] border border-hairline py-2.5 text-[10px] font-semibold text-base-subtle transition-colors hover:border-base-content/20 hover:text-base-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmChange}
                disabled={planChanging}
                className="flex-1 rounded-[4px] border border-primary/30 bg-primary/10 py-2.5 text-[10px] font-semibold text-primary transition-colors hover:border-primary/50 hover:bg-primary/20 disabled:opacity-50"
              >
                {planChanging
                  ? 'Processing...'
                  : pendingChange.isTrialChange
                    ? 'Switch Plan'
                    : pendingChange.isDowngrade
                      ? 'Confirm Downgrade'
                      : 'Confirm Upgrade'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* ── Trial Cancel Retention Modal ──────────────────────── */}
      {showTrialCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative mx-4 w-full max-w-sm space-y-4 rounded-[8px] border border-hairline bg-panel p-6"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10">
                <ShieldAlert size={20} className="text-error-ink" />
              </div>
              <h3 className="text-sm font-semibold text-base-muted">
                Cancel your free trial?
              </h3>
            </div>

            <div className="space-y-3 text-xs leading-relaxed text-base-muted">
              <p>
                If you cancel now, you&apos;ll lose access to all premium
                features immediately &mdash; including your extra widget slots
                and Uplink Ultimate access.
              </p>
              <p className="font-semibold text-base-muted">
                This is the only free trial offered per account. Once canceled,
                you&apos;ll need to purchase a paid plan to access premium
                features again.
              </p>
              <p>
                Your card has not been charged and won&apos;t be if you cancel.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowTrialCancelModal(false)}
                className="flex-1 rounded-[4px] border border-primary/30 py-2.5 text-xs font-semibold
                           text-primary transition-colors hover:bg-primary/10"
              >
                Keep My Trial
              </button>
              <button
                onClick={async () => {
                  setTrialCanceling(true)
                  setShowTrialCancelModal(false)
                  try {
                    await billingApi.cancelSubscription(getToken)
                    const sub = await billingApi.getSubscription(getToken)
                    setCurrentSub(sub)
                  } catch {
                    setPlanChangeError('Failed to cancel trial')
                  } finally {
                    setTrialCanceling(false)
                  }
                }}
                className="flex-1 rounded-[4px] border border-error/30 py-2.5 text-xs font-semibold
                           text-error-ink transition-colors hover:bg-error/10 hover:text-error-ink"
              >
                Cancel Trial
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* ── Checkout Success Banner ─────────────────────────── */}
      {checkoutSuccess &&
        (() => {
          const subTier = currentSub ? tierFromPlan(currentSub.plan) : null
          const tierName = subTier ? TIER_NAMES[subTier] : 'Uplink'
          return (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="fixed left-1/2 top-24 z-40 flex -translate-x-1/2 items-center gap-3 rounded-[4px] border border-success/30 bg-success/10 px-6 py-4 backdrop-blur-sm"
            >
              <CheckCircle2 size={18} className="text-success-ink" />
              <div>
                <p className="text-xs font-bold text-success-ink">
                  {tierName} Activated
                </p>
                <p className="text-[10px] text-base-subtle">
                  {currentSub?.status === 'trialing'
                    ? `Your 7-day free trial is active. Enjoy full Uplink Ultimate access.`
                    : `Your subscription is active. Welcome to ${tierName}.`}
                </p>
              </div>
              <button
                onClick={() => setCheckoutSuccess(false)}
                className="ml-4 text-xs text-base-subtle transition-colors hover:text-base-muted"
              >
                &times;
              </button>
            </motion.div>
          )
        })()}
      {/* ── Plan Change Error Banner ──────────────────────────── */}
      {planChangeError && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed left-1/2 top-24 z-40 flex -translate-x-1/2 items-center gap-3 rounded-[4px] border border-error/30 bg-error/10 px-6 py-4 backdrop-blur-sm"
        >
          <AlertTriangle size={18} className="text-error-ink" />
          <div>
            <p className="text-xs font-bold text-error-ink">Plan Change Failed</p>
            <p className="text-[10px] text-base-subtle">
              {planChangeError}
            </p>
          </div>
          <button
            onClick={() => setPlanChangeError(null)}
            className="ml-4 text-xs text-base-subtle transition-colors hover:text-base-muted"
          >
            ✕
          </button>
        </motion.div>
      )}
      {/* ================================================================
          HEADER
          ================================================================ */}
      <PageHeader
        eyebrowLeft="UPLINK ／ PRICING"
        eyebrowRight="EVERY PAID PLAN: 7-DAY FREE TRIAL · NOT CHARGED UNTIL DAY 8"
        line1="More widgets"
        line2="at once."
        sub="Every plan is the same app, and every widget costs the same. You're only choosing how many run on your bar at once. No feature matrix to squint at."
        actions={
          <div className="flex flex-wrap gap-1.5 font-mono text-xs tracking-[0.1em]">
            {billingTabs.map((tab) => {
              const active = billingView === tab.id
              const amber = tab.id === 'lifetime'
              return (
                <motion.button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBillingView(tab.id)}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className={`relative cursor-pointer whitespace-nowrap rounded-[4px] border px-[18px] py-2.5 transition-colors ${
                    active
                      ? amber
                        ? 'border-transparent text-[#fbbf24]'
                        : 'border-transparent text-primary'
                      : 'border-hairline text-base-muted hover:text-base-muted'
                  }`}
                >
                  {/* Active chip slides between billing views, turning
                      amber when it lands on LIFETIME */}
                  {active && (
                    <motion.span
                      aria-hidden="true"
                      layoutId="billing-tab"
                      className={`absolute inset-0 rounded-[4px] border ${
                        amber
                          ? 'border-[#fbbf24]/45 bg-[#fbbf24]/10'
                          : 'border-primary/45 bg-primary/10'
                      }`}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 35,
                      }}
                    />
                  )}
                  <span className="relative">{tab.label}</span>
                </motion.button>
              )
            })}
          </div>
        }
      />
      {/* ================================================================
          PLANS — 4 cards / lifetime card (AnimatePresence swap)
          ================================================================ */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <AnimatePresence mode="wait" initial={false}>
            {isLifetime ? (
              <motion.div
                key="lifetime-reveal"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="py-11"
              >
                <div className="relative">
                  {/* Retained aura work, re-tinted amber: ambient orb +
                      perpetual pulse rings behind the card. */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    aria-hidden="true"
                  >
                    <motion.div
                      className="absolute left-1/2 top-1/2 h-[420px] w-[560px] -translate-x-1/2 -translate-y-1/2"
                      style={{
                        background:
                          'radial-gradient(ellipse at center, rgba(251,191,36,0.10) 0%, rgba(251,191,36,0.03) 45%, transparent 70%)',
                        filter: 'blur(40px)',
                      }}
                      animate={{ scale: [1, 1.12, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{
                        duration: 5,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#fbbf24]/15"
                        animate={{ scale: [0.7, 1.8], opacity: [0.5, 0] }}
                        transition={{
                          delay: 1 + i * 1.3,
                          duration: 3,
                          ease: 'easeOut',
                          repeat: Infinity,
                          repeatDelay: 1.5,
                        }}
                      />
                    ))}
                  </div>

                  <div className="relative grid items-center gap-10 rounded-[8px] border border-[#fbbf24]/40 bg-[#fbbf24]/[0.03] px-7 py-10 sm:px-10 md:grid-cols-[1.2fr_1fr] md:gap-12">
                    <div
                      className="absolute -right-px -top-px bg-[#fbbf24] px-3 py-[5px] font-mono text-[10px] font-semibold tracking-[0.12em] text-[#101018]"
                      style={{ borderRadius: '0 8px 0 6px' }}
                    >
                      LIMITED · FOUNDING MEMBERS
                    </div>
                    <div>
                      <div className="mb-3.5 font-mono text-[11px] tracking-[0.14em] text-[#fbbf24]">
                        LIFETIME ULTIMATE
                      </div>
                      <h2
                        className="m-0 mb-3.5 font-display font-extrabold uppercase"
                        style={{
                          fontSize: 'clamp(28px, 3.4vw, 44px)',
                          fontStretch: '115%',
                          lineHeight: 1.05,
                        }}
                      >
                        One payment.
                        <br />
                        <span className="text-[#fbbf24]">
                          Every widget, forever.
                        </span>
                      </h2>
                      <p className="m-0 max-w-[440px] text-[15.5px] leading-[1.65] text-base-muted [text-wrap:pretty]">
                        Permanent Uplink Ultimate: unlimited slots, priority
                        support, and early access, plus a founding-member badge.
                        Pays for itself against Ultimate Annual in 2.5 years.
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-[18px]">
                      <div className="flex items-baseline gap-2.5">
                        <span className="font-mono text-[56px] font-semibold tracking-[-0.02em]">
                          ${LIFETIME_PRICE}
                        </span>
                        <span className="font-mono text-[13px] text-base-subtle">
                          ONCE
                        </span>
                      </div>
                      <Link
                        to="/uplink/lifetime"
                        className="inline-block rounded-[4px] bg-[#fbbf24] px-[30px] py-3.5 text-[15px] font-bold text-[#101018] transition-colors hover:bg-[#fde68a]"
                      >
                        Purchase lifetime access
                      </Link>
                      <div className="font-mono text-[10.5px] text-base-subtle">
                        NO SUBSCRIPTION · NO RENEWAL · STRIPE
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="tier-cards"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="grid grid-cols-1 items-stretch gap-3.5 py-11 sm:grid-cols-2 xl:grid-cols-4"
              >
                {planDefs.map((p, i) => {
                  const isFree = p.tier === null
                  const pricing = p.tier ? PRICING[p.tier][billingPeriod] : null
                  const disabled = p.tier ? isTierDisabled(p.tier) : false
                  const showFoot = isFree || (!activeTier && !hadPriorSub)
                  return (
                    <motion.div
                      key={p.key}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{
                        y: -3,
                        transition: {
                          type: 'spring',
                          stiffness: 400,
                          damping: 28,
                        },
                      }}
                      transition={{
                        delay: 0.03 + i * 0.03,
                        duration: 0.5,
                        ease: EASE,
                      }}
                      className={`relative flex flex-col rounded-[8px] border p-7 px-[26px] transition-colors duration-150 ${
                        p.popular
                          ? 'border-primary/45 bg-primary/5 hover:border-primary/70'
                          : 'border-hairline bg-panel hover:border-primary/35'
                      }`}
                    >
                      {p.popular && (
                        <div
                          className="absolute -right-px -top-px bg-primary px-3 py-[5px] font-mono text-[10px] font-semibold tracking-[0.12em] text-[#101018]"
                          style={{ borderRadius: '0 8px 0 6px' }}
                        >
                          MOST POPULAR
                        </div>
                      )}
                      {/* Name + tagline */}
                      <div className="font-display text-xl font-extrabold uppercase tracking-[0.02em]">
                        {p.name}
                      </div>
                      <div className="mb-6 mt-1.5 min-h-[20px] text-[13.5px] text-base-muted">
                        {p.tagline}
                      </div>

                      {/* Price */}
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[40px] font-semibold tracking-[-0.02em]">
                          {isFree ? (
                            '$0'
                          ) : (
                            <>
                              $<AnimatedPrice value={pricing!.perMonth} />
                            </>
                          )}
                        </span>
                        <span className="font-mono text-[13px] text-base-subtle">
                          /MO
                        </span>
                      </div>
                      {isFree ? (
                        <div className="mb-[26px] mt-2 flex min-h-[22px] items-center font-mono text-[11px] tracking-[0.06em] text-base-subtle">
                          FREE FOREVER
                        </div>
                      ) : (
                        // Both billing variants stay mounted, stacked in
                        // one grid cell: the container always sizes to
                        // the taller variant, so toggling never shifts
                        // the card height (at 4-col widths the annual
                        // line wraps its badge to a second row); the
                        // active variant crossfades in. whitespace-nowrap
                        // keeps "/YR" glued to its price — the badge
                        // wraps as a unit, never mid-text.
                        <div className="mb-[26px] mt-2 grid min-h-[22px]">
                          {(['monthly', 'annual'] as Array<PlanKey>).map(
                            (view) => {
                              const activeView = billingPeriod === view
                              return (
                                <motion.div
                                  key={view}
                                  initial={false}
                                  animate={{
                                    opacity: activeView ? 1 : 0,
                                    y: activeView ? 0 : 4,
                                  }}
                                  transition={{ duration: 0.2, ease: EASE }}
                                  aria-hidden={!activeView}
                                  className={`col-start-1 row-start-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 self-center font-mono text-[11px] tracking-[0.06em] text-base-subtle ${
                                    activeView ? '' : 'pointer-events-none'
                                  }`}
                                >
                                  {view === 'annual' ? (
                                    <>
                                      <span className="whitespace-nowrap">
                                        {`BILLED $${PRICING[p.tier].annual.price.toFixed(2)}/YR`}
                                      </span>
                                      {/* Compact enough that even BILLED
                                          $399.99/YR + badge fit one line
                                          in a 4-col card */}
                                      <span className="whitespace-nowrap rounded-[3px] border border-primary/35 px-[5px] py-[2px] text-[10px] tracking-[0.02em] text-primary">
                                        4 MONTHS FREE
                                      </span>
                                    </>
                                  ) : (
                                    <span>BILLED MONTHLY</span>
                                  )}
                                </motion.div>
                              )
                            },
                          )}
                        </div>
                      )}

                      {/* Capacity viz — slot squares from live tier-limits */}
                      <div className="mb-1.5 flex min-h-[34px] items-center">
                        {p.slots === null ? (
                          <motion.span
                            initial={{ opacity: 0, scale: 0.4 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              delay: 0.25 + i * 0.03,
                              type: 'spring',
                              stiffness: 380,
                              damping: 18,
                            }}
                            className="unlimited-text-glow font-mono text-[38px] font-semibold leading-none text-primary"
                          >
                            ∞
                          </motion.span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {/* Slot squares fill in one by one — the
                                card's capacity literally builds up */}
                            {Array.from({ length: p.slots }, (_, s) => (
                              <motion.span
                                key={s}
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{
                                  delay: 0.2 + i * 0.03 + s * 0.03,
                                  type: 'spring',
                                  stiffness: 500,
                                  damping: 28,
                                }}
                                className="h-[13px] w-[13px] rounded-[2px] bg-primary/75"
                              />
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="mb-[26px] font-mono text-[10px] uppercase tracking-[0.14em] text-base-subtle">
                        {p.slots === null
                          ? 'UNLIMITED WIDGETS AT ONCE'
                          : `${p.slots} WIDGETS AT ONCE`}
                      </div>

                      {/* CTA */}
                      {isFree ? (
                        isTrialing ? (
                          <button
                            type="button"
                            onClick={() => setShowTrialCancelModal(true)}
                            disabled={trialCanceling}
                            className="mt-auto block cursor-pointer rounded-[4px] border border-error/30 py-[13px] text-center text-[15px] font-bold text-error-ink transition-colors hover:border-error/50 hover:text-error-ink disabled:opacity-50"
                          >
                            {trialCanceling ? 'Canceling...' : 'Cancel trial'}
                          </button>
                        ) : (
                          <Link
                            to="/download"
                            className="mt-auto block rounded-[4px] border border-base-content/25 py-[13px] text-center text-[15px] font-bold transition-colors hover:border-primary"
                          >
                            Get started free
                          </Link>
                        )
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            handleSelectPlan(billingPeriod, p.tier)
                          }
                          className={`mt-auto block rounded-[4px] py-[13px] text-center text-[15px] font-bold transition-colors ${
                            p.popular
                              ? 'bg-primary text-[#101018] hover:bg-[#6ee7b7]'
                              : 'border border-base-content/25 hover:border-primary'
                          } ${disabled ? 'cursor-default opacity-50' : 'cursor-pointer'}`}
                        >
                          {planChanging && !disabled
                            ? 'Changing...'
                            : getCtaLabel(p.tier)}
                        </button>
                      )}

                      {/* Foot line */}
                      {showFoot && (
                        <div className="pt-2.5 text-center font-mono text-[10.5px] text-base-subtle">
                          {isFree
                            ? isTrialing
                              ? "YOU WON'T BE CHARGED"
                              : 'NO CARD REQUIRED'
                            : `7 DAYS FREE, THEN $${pricing!.perMonth.toFixed(2)}/MO`}
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Assurance strip */}
          <div className="flex flex-wrap justify-center gap-x-7 gap-y-2 border-t border-hairline-minor pb-[26px] pt-5 font-mono text-[11px] tracking-[0.1em] text-base-subtle">
            {ASSURANCES.map((a, i) => (
              <motion.span
                key={a}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.35, ease: EASE, delay: i * 0.05 }}
              >
                {a}
              </motion.span>
            ))}
          </div>
        </TerminalContainer>
      </section>

      {/* ================================================================
          SEC 02 ／ WHAT PAYING ACTUALLY GETS YOU
          ================================================================ */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 02 ／ WHAT PAYING ACTUALLY GETS YOU" />
          {/* StepsGrid cascades its own cells now — no outer wrapper,
              which was double-fading the whole grid */}
          <StepsGrid steps={PERKS} />
        </TerminalContainer>
      </section>

      {/* ================================================================
          SEC 03 ／ COMPARE TIERS — ledger rows
          ================================================================ */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 03 ／ COMPARE TIERS" stat="FREE IS FOREVER" />
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, ease: EASE }}
                className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] border-b border-hairline-minor py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-base-subtle"
              >
                <span>FEATURE</span>
                <span className="text-center">FREE</span>
                <span className="text-center">UPLINK</span>
                <span className="text-center">PRO</span>
                <span className="text-center text-primary">ULTIMATE</span>
              </motion.div>
              {comparisonRows.map((row, ri) => (
                <motion.div
                  key={row.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, ease: EASE, delay: ri * 0.07 }}
                  className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1fr] items-center border-b border-hairline-minor px-1 py-4 transition-colors duration-150 hover:bg-primary/5"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-base-muted">
                      {row.label}
                    </span>
                  </span>
                  <span className="text-center">
                    <CompareCell value={row.free} />
                  </span>
                  <span className="text-center">
                    <CompareCell value={row.uplink} up={row.uplinkUp} />
                  </span>
                  <span className="text-center">
                    <CompareCell value={row.pro} up={row.proUp} />
                  </span>
                  <span className="text-center">
                    <CompareCell value={row.ultimate} up={row.ultimateUp} />
                  </span>
                </motion.div>
              ))}
              <div className="py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-base-subtle">
                PER-ACCOUNT · FREE TIER ALWAYS INCLUDED · UPGRADE ANYTIME
              </div>
            </div>
          </div>
        </TerminalContainer>
      </section>

      {/* ================================================================
          SEC 04 ／ QUESTIONS — accordion ledger (feeds faqPage JSON-LD)
          ================================================================ */}
      {/* No border-b here — the departures row below brings its own
          border-t hairline. */}
      <section>
        <TerminalContainer>
          <SectionRow
            tag="SEC 04 ／ QUESTIONS"
            stat={`${uplinkFAQ.length} ANSWERS`}
          />
          <div className="pb-6">
            {uplinkFAQ.map((f, i) => {
              const open = openFaq === i
              return (
                <motion.div
                  key={f.question}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, ease: EASE, delay: i * 0.04 }}
                  className="border-b border-hairline-minor last:border-b-0"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="flex w-full cursor-pointer items-baseline justify-between gap-5 py-5 text-left"
                  >
                    <span className="flex items-baseline gap-4">
                      <span className="font-mono text-xs text-base-subtle">
                        Q{String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-[15px] font-semibold">
                        {f.question}
                      </span>
                    </span>
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={open ? 'minus' : 'plus'}
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ duration: 0.1 }}
                        className="inline-block w-[1ch] text-center font-mono text-sm text-primary"
                        aria-hidden="true"
                      >
                        {open ? '−' : '+'}
                      </motion.span>
                    </AnimatePresence>
                  </button>
                  {/* Answer unfolds; padding lives on the inner <p>, not
                      the height-animated container (the border-box
                      end-bump lesson from SEC 01 on the homepage). */}
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        key="answer"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="m-0 max-w-[760px] pb-6 text-sm leading-relaxed text-base-muted sm:pl-12">
                          {f.answer}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>
        </TerminalContainer>
      </section>

      {/* ================================================================
          FREE-TIER ESCAPE ROW
          ================================================================ */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <DeparturesRow
            index="00"
            label="Not ready? The free tier isn't a trial."
            meta="Three slots, forever. No card, no clock."
            action="DOWNLOAD FREE ↓"
            to="/download"
          />
        </TerminalContainer>
      </section>
    </div>
  )
}
