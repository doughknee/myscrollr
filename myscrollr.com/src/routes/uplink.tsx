import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useSpring,
} from 'motion/react'

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  CreditCard,
  Crown,
  Eye,
  Filter,
  Gauge,
  Layers,
  LayoutDashboard,
  Loader2,
  Lock,
  Minus,
  Rocket,
  Rss,
  Satellite,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react'

import type { FAQItem } from '@/components/landing/FAQSection'
import type { SubscriptionStatus, TierLimitsResponse } from '@/api/client'
import type { BackdropBeam } from '@/components/landing/_ConvergenceBackdrop'
import { ConvergenceBackdrop } from '@/components/landing/_ConvergenceBackdrop'
import { seo } from '@/lib/seo'
import { breadcrumbs, faqPage, productOffers } from '@/lib/structured-data'
import { seededRandom } from '@/lib/seededRandom'
import { useScrollrAuth } from '@/hooks/useScrollrAuth'
import { useGetToken } from '@/hooks/useGetToken'
import { billingApi, tierLimitsApi } from '@/api/client'
import { FAQSection } from '@/components/landing/FAQSection'

const CheckoutModal = lazy(() => import('@/components/billing/CheckoutModal'))

// ── Signature easing (matches homepage) ────────────────────────
const EASE = [0.22, 1, 0.36, 1] as const

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

// Animates the displayed integer toward `value` using a spring. This
// replaces `motion-plus`'s `<AnimateNumber>` (524 KB on disk) for the
// only place we used it: the per-tier monthly-price flip when the
// billing toggle changes. We lose `motion-plus`'s per-digit slot
// animation, but the prices are 2-3 digits so the simpler counter
// reads cleanly. Pattern mirrors `useAnimatedCounter` in CallToAction.
function AnimatedPrice({ value }: { value: number }) {
  const [display, setDisplay] = useState(value)
  const motionVal = useMotionValue(value)
  const spring = useSpring(motionVal, {
    stiffness: 90,
    damping: 22,
    restSpeed: 0.5,
  })

  useEffect(() => {
    motionVal.set(value)
  }, [value, motionVal])

  useEffect(() => {
    const unsub = spring.on('change', (v) => {
      setDisplay(Math.round(v))
    })
    return unsub
  }, [spring])

  return <>{display}</>
}

// Static JSON-LD source data for the /uplink route. Kept module-scope
// so it serializes cleanly inside head() during prerender. Pricing
// mirrors the in-file PRICING constant; cap numbers mirror
// FALLBACK_LIMITS — keep all three in sync.
//
// FAQ answers cite the same fallback caps the visible FAQ shows on
// first paint (buildUplinkFAQ reads FALLBACK_LIMITS before the API
// responds), so Google's FAQPage rich-result policy holds: schema
// answer text matches what crawlers see in the static HTML.
const STATIC_TIERS = [
  {
    name: 'Uplink',
    description:
      'Unlimited tracking, faster delivery, and full RSS catalog access.',
    priceMonthly: 9.99,
    priceAnnual: 79.99,
  },
  {
    name: 'Pro',
    description:
      'Real-time data, custom alerts, advanced feed controls, and more tracked symbols.',
    priceMonthly: 24.99,
    priceAnnual: 199.99,
  },
  {
    name: 'Ultimate',
    description:
      'No caps. Server-Sent Events delivery, unlimited fantasy leagues, webhooks, data export, and API access.',
    priceMonthly: 49.99,
    priceAnnual: 399.99,
  },
]

const STATIC_FAQ = [
  {
    question: 'What does "data delivery" mean?',
    answer:
      'Free users get data refreshed every 60 seconds via polling. Uplink cuts that to 30 seconds. Pro pushes it to 10 seconds. Ultimate eliminates polling entirely — data arrives the instant it changes via Server-Sent Events (SSE), the same technology used by stock trading platforms.',
  },
  {
    question: 'How many symbols can I track?',
    answer:
      'Tracked symbols are the stocks, ETFs, and crypto tickers that appear in your finance feed. Free accounts can follow up to 5 at a time. Uplink raises that to 25. Pro gives you 75 — enough for a serious portfolio. With Ultimate, there is no cap — add every ticker you care about and they all stream in real time.',
  },
  {
    question: 'How many RSS feeds can I follow?',
    answer:
      'RSS feeds power the news channel. Free accounts can subscribe to 1 feed from the default catalog. Uplink expands that to 25, Pro to 100, giving you broad coverage across topics. Ultimate removes the limit entirely — subscribe to as many sources as you want.',
  },
  {
    question: 'What are custom RSS feeds?',
    answer:
      'Beyond the built-in catalog, custom feeds let you paste any RSS or Atom URL. Free accounts cannot add custom feeds. Uplink gives you 1, Pro gives you 3 — enough for niche industry sources, personal blogs, or company news. Ultimate removes the cap so you can add every source you follow.',
  },
  {
    question: 'What sports leagues are included?',
    answer:
      'Every tier includes live scores from the NFL, NBA, MLB, NHL, MLS, and Premier League. All paid tiers add college football (NCAAF) and college basketball (NCAAM), with scores updating at the delivery speed of your tier.',
  },
  {
    question: 'How many fantasy leagues can I connect?',
    answer:
      'Scrollr syncs with Yahoo Fantasy Sports to show your standings, matchups, and roster updates. Free accounts cannot connect Yahoo leagues. Uplink supports up to 1. Pro gives you 3 — enough for multi-sport managers. Ultimate connects every league across every sport with no restrictions.',
  },
  {
    question: 'What are custom alerts?',
    answer:
      'Custom alerts let you define conditions that trigger notifications: a stock hitting a target price, a game entering the 4th quarter, or an RSS item matching a keyword. Alerts are evaluated in the app background — no server round-trip needed. Available on Pro and Ultimate tiers.',
  },
  {
    question: 'What are feed profiles and advanced controls?',
    answer:
      'Feed profiles let you save different configurations — like "Work" showing only finance and RSS, or "Weekend" with sports and fantasy. Advanced controls add pinning, custom sort rules, and per-channel filtering within the feed. Both features are exclusive to Pro and Ultimate tiers.',
  },
  {
    question: 'What is site filtering?',
    answer:
      'Site filtering controls where the feed bar appears. Every tier includes blacklist filtering — hide the bar on specific displays. Pro and Ultimate add whitelist mode on top, so you can restrict the bar to only the displays you choose.',
  },
  {
    question: 'What about webhooks, data export, and API access?',
    answer:
      'Webhooks push your alerts to Discord, Slack, or any URL. Data export lets you download tracked symbols, historical prices, and game results as CSV or JSON. API access gives you programmatic read access to your MyScrollr data for personal dashboards or automation. All three are exclusive to Ultimate.',
  },
  {
    question: 'What does early access include?',
    answer:
      'Every paid tier unlocks early access to new features, channels, and UI updates before they roll out to free users. This includes beta channels, experimental feed modes, and new dashboard widgets. You get to try everything first and provide feedback that shapes the final release.',
  },
  {
    question: 'Does every tier get the full dashboard?',
    answer:
      'Every user gets complete access to the web dashboard at myscrollr.com. You can view all your channels, manage your watchlists, configure feeds, and adjust preferences regardless of your subscription tier. Paid tiers enhance the data flowing into the dashboard, not the dashboard itself.',
  },
]

export const Route = createFileRoute('/uplink')({
  validateSearch: () => ({}),
  head: () =>
    seo({
      title: 'Uplink — Pricing for Scrollr',
      description:
        'Unlock unlimited tracking, real-time data delivery, and early access to new channels. Plans from $9.99/month with annual savings.',
      path: '/uplink',
      image: 'https://myscrollr.com/og/uplink.png',
      type: 'product',
      jsonLd: [
        productOffers(STATIC_TIERS),
        faqPage(STATIC_FAQ),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Uplink', path: '/uplink' },
        ]),
      ],
    }),
  component: UplinkPage,
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
  /** Feature planned but not yet shipped */
  comingSoon?: boolean
}

/**
 * Build the comparison table rows using the live tier-limits from the API.
 * Rows that describe limit-based features (symbols, feeds, leagues, etc.)
 * get their numbers from `limits`; rows for non-limit features (alerts,
 * priority support, etc.) are static.
 */
function buildComparison(limits: TierLimitsResponse): Array<ComparisonRow> {
  const free = limits.tiers.free
  const uplink = limits.tiers.uplink
  const pro = limits.tiers.uplink_pro
  const ult = limits.tiers.uplink_ultimate

  const none = (n: number | null): string => {
    if (n === null) return 'Unlimited'
    return n === 0 ? 'None' : String(n)
  }

  return [
    {
      label: 'Data Delivery',
      free: '60s polling',
      uplink: '30s polling',
      pro: '10s polling',
      ultimate: 'Real-time SSE',
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Tracked Symbols',
      free: fmtLimit(free.symbols, 'symbol'),
      uplink: fmtLimit(uplink.symbols, 'symbol'),
      pro: fmtLimit(pro.symbols, 'symbol'),
      ultimate: fmtLimit(ult.symbols, 'symbol'),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'RSS Feeds',
      free: fmtLimit(free.feeds, 'feed'),
      uplink: fmtLimit(uplink.feeds, 'feed'),
      pro: fmtLimit(pro.feeds, 'feed'),
      ultimate: fmtLimit(ult.feeds, 'feed'),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Custom RSS Feeds',
      free: none(free.custom_feeds),
      uplink: none(uplink.custom_feeds),
      pro: none(pro.custom_feeds),
      ultimate: none(ult.custom_feeds),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Sports Leagues',
      free: fmtLimit(free.leagues, 'league'),
      uplink: fmtLimit(uplink.leagues, 'league'),
      pro: fmtLimit(pro.leagues, 'league'),
      ultimate: fmtLimit(ult.leagues, 'league'),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Fantasy Leagues',
      free: none(free.fantasy),
      uplink: fmtLimit(uplink.fantasy, 'league'),
      pro: fmtLimit(pro.fantasy, 'league'),
      ultimate: fmtLimit(ult.fantasy, 'league'),
      uplinkUp: true,
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Site Filtering',
      free: 'Blacklist',
      uplink: 'Blacklist',
      pro: 'Blacklist + Whitelist',
      ultimate: 'Blacklist + Whitelist',
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Custom Alerts',
      free: 'No',
      uplink: 'No',
      pro: 'Yes',
      ultimate: 'Yes',
      proUp: true,
      ultimateUp: true,
      comingSoon: true,
    },
    {
      label: 'Feed Profiles',
      free: 'No',
      uplink: 'No',
      pro: 'Yes',
      ultimate: 'Yes',
      proUp: true,
      ultimateUp: true,
      comingSoon: true,
    },
    {
      label: 'Advanced Feed Controls',
      free: 'No',
      uplink: 'No',
      pro: 'Yes',
      ultimate: 'Yes',
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Priority RSS Refresh',
      free: 'No',
      uplink: 'No',
      pro: 'Yes',
      ultimate: 'Yes',
      proUp: true,
      ultimateUp: true,
    },
    {
      label: 'Webhooks & Integrations',
      free: 'No',
      uplink: 'No',
      pro: 'No',
      ultimate: 'Yes',
      ultimateUp: true,
      comingSoon: true,
    },
    {
      label: 'Data Export',
      free: 'No',
      uplink: 'No',
      pro: 'No',
      ultimate: 'CSV / JSON',
      ultimateUp: true,
      comingSoon: true,
    },
    {
      label: 'API Access',
      free: 'No',
      uplink: 'No',
      pro: 'No',
      ultimate: 'Yes',
      ultimateUp: true,
      comingSoon: true,
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
      uplink: 'No',
      pro: 'No',
      ultimate: 'Yes',
      ultimateUp: true,
    },
    {
      label: 'Dashboard Access',
      free: 'Full',
      uplink: 'Full',
      pro: 'Full',
      ultimate: 'Full',
    },
  ]
}

// ── Tier Feature Showcases ──────────────────────────────────────

interface TierShowcase {
  tier: TierKey
  Icon: typeof Gauge
  name: string
  tagline: string
  hex: string
  delivery: string
  deliverySub: string
  features: Array<string>
  useCase: string
}

/**
 * Build the three tier showcase cards (Uplink / Pro / Ultimate). Feature
 * bullets pull numeric caps from the live tier-limits; non-numeric
 * features ('Early access', 'Priority support', etc.) stay static.
 */
function buildTierShowcases(limits: TierLimitsResponse): Array<TierShowcase> {
  const uplink = limits.tiers.uplink
  const pro = limits.tiers.uplink_pro

  return [
    {
      tier: 'uplink',
      Icon: Rocket,
      name: 'Uplink',
      tagline: 'Check in every morning. Miss nothing.',
      hex: '#00b8db',
      delivery: '30s polling',
      deliverySub: '2x faster than free',
      useCase:
        "You open Scrollr with your coffee, scan your watchlist, skim the morning RSS headlines, and check last night's scores. Data refreshes every 30 seconds — fast enough to catch a pre-market move before you leave for work.",
      features: [
        `${fmtLimit(uplink.symbols, 'tracked symbol')}`,
        `${fmtLimit(uplink.feeds, 'RSS feed')}, ${uplink.custom_feeds ?? 0} custom`,
        `${fmtLimit(uplink.fantasy, 'fantasy league')}`,
        'Pro + College sports',
        'Blacklist site filtering',
        'Early access to features',
      ],
    },
    {
      tier: 'pro',
      Icon: Gauge,
      name: 'Pro',
      tagline: 'Know the moment it happens',
      hex: '#a78bfa',
      delivery: '10s polling',
      deliverySub: '6x faster than free',
      useCase:
        'You set an alert when TSLA crosses $280. You save a "Work" feed profile that hides sports. When the 4th quarter starts on a close game, you get notified without checking. Scrollr watches so you don\'t have to.',
      features: [
        `${fmtLimit(pro.symbols, 'tracked symbol')}`,
        `${fmtLimit(pro.feeds, 'RSS feed')}, ${pro.custom_feeds ?? 0} custom`,
        `${fmtLimit(pro.fantasy, 'fantasy league')}`,
        'Custom alerts & notifications',
        'Feed profiles & advanced controls',
        'Priority RSS refresh',
        'Blacklist + Whitelist filtering',
      ],
    },
    {
      tier: 'ultimate',
      Icon: Crown,
      name: 'Uplink Ultimate',
      tagline: 'Everything. Zero limits.',
      hex: '#34d399',
      delivery: 'Real-time SSE',
      deliverySub: 'Instant — zero delay',
      useCase:
        'Your data streams in real time via SSE. Webhooks push alerts to your Discord. You export weekly market data to a spreadsheet. Your personal dashboard pulls from the API. Scrollr becomes infrastructure, not just a feed.',
      features: [
        'Unlimited symbols, feeds & leagues',
        'Webhooks & integrations',
        'Data export (CSV / JSON)',
        'API access',
        'Priority support',
        'Everything in Pro, plus more',
      ],
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
    annual: {
      price: 79.99,
      period: '/yr',
      perMonth: 6.67,
      savings: 'Save ~$40/yr',
    },
  },
  pro: {
    monthly: { price: 24.99, period: '/mo', perMonth: 24.99 },
    annual: {
      price: 199.99,
      period: '/yr',
      perMonth: 16.67,
      savings: 'Save ~$100/yr',
    },
  },
  ultimate: {
    monthly: { price: 49.99, period: '/mo', perMonth: 49.99 },
    annual: {
      price: 399.99,
      period: '/yr',
      perMonth: 33.33,
      savings: 'Save ~$200/yr',
    },
  },
}

type BillingView = PlanKey | 'lifetime'

const BILLING_LABELS: Record<BillingView, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
  lifetime: 'Lifetime',
}

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
// FALLBACK_LIMITS mirrors api/core/tier_limits.go DefaultTierLimits. It
// only renders during the ~20-50ms between component mount and the fetch
// response — after that the real API values take over. If you edit
// this constant, also update api/core/tier_limits.go and
// desktop/src/tierLimits.ts. Drift is billing-trust damage.

const FALLBACK_LIMITS: TierLimitsResponse = {
  tiers: {
    free: {
      symbols: 5,
      feeds: 1,
      custom_feeds: 0,
      leagues: 1,
      fantasy: 0,
      max_ticker_rows: 1,
      max_ticker_customization: false,
    },
    uplink: {
      symbols: 25,
      feeds: 25,
      custom_feeds: 1,
      leagues: 8,
      fantasy: 1,
      max_ticker_rows: 2,
      max_ticker_customization: false,
    },
    uplink_pro: {
      symbols: 75,
      feeds: 100,
      custom_feeds: 3,
      leagues: 20,
      fantasy: 3,
      max_ticker_rows: 3,
      max_ticker_customization: false,
    },
    uplink_ultimate: {
      symbols: null,
      feeds: null,
      custom_feeds: 10,
      leagues: null,
      fantasy: 10,
      max_ticker_rows: 3,
      max_ticker_customization: true,
    },
    super_user: {
      symbols: null,
      feeds: null,
      custom_feeds: null,
      leagues: null,
      fantasy: null,
      max_ticker_rows: 3,
      max_ticker_customization: true,
    },
  },
}

/** Render a numeric cap in the form "25 feeds" / "Unlimited". */
function fmtLimit(value: number | null, unit: string): string {
  if (value === null) return 'Unlimited'
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

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

// ── CTA Particles ──────────────────────────────────────────────

const CTA_PARTICLES = Array.from({ length: 20 }, (_, i) => {
  const random = seededRandom(i * 6151 + 12289)
  return {
    id: i,
    x: random() * 100,
    y: random() * 100,
    size: random() * 3 + 1.5,
    delay: random() * 5,
    duration: random() * 6 + 8,
    color: i % 3 === 0 ? '#00b8db' : i % 3 === 1 ? '#a78bfa' : '#34d399',
  }
})

const FOOTER_PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const random = seededRandom(i * 4093 + 8191)
  return {
    id: i,
    x: 20 + random() * 60,
    y: 10 + random() * 80,
    size: random() * 2.5 + 1.5,
    delay: 0.5 + random() * 3,
    duration: random() * 5 + 6,
  }
})

// ── Uplink FAQ ─────────────────────────────────────────────────

/**
 * Build the FAQ items. Answers and highlights that reference numeric
 * caps interpolate them from the live tier-limits; purely descriptive
 * items stay static.
 */
function buildUplinkFAQ(limits: TierLimitsResponse): Array<FAQItem> {
  const free = limits.tiers.free
  const uplink = limits.tiers.uplink
  const pro = limits.tiers.uplink_pro

  // "Connect N league" — "None" when free has zero fantasy leagues.
  const freeFantasyCopy =
    free.fantasy === 0
      ? 'No Yahoo leagues'
      : `${free.fantasy} Yahoo league${free.fantasy === 1 ? '' : 's'}`

  return [
    {
      icon: Zap,
      question: 'What does "data delivery" mean?',
      highlight:
        'How fast new data reaches you — from 60-second polling to instant real-time streaming.',
      answer:
        'Free users get data refreshed every 60 seconds via polling. Uplink cuts that to 30 seconds. Pro pushes it to 10 seconds. Ultimate eliminates polling entirely — data arrives the instant it changes via Server-Sent Events (SSE), the same technology used by stock trading platforms.',
      accent: 'emerald',
    },
    {
      icon: BarChart3,
      question: 'How many symbols can I track?',
      highlight: `Free gets ${free.symbols}, Uplink gets ${uplink.symbols}, Pro gets ${pro.symbols}, and Ultimate has no cap at all.`,
      answer: `Tracked symbols are the stocks, ETFs, and crypto tickers that appear in your finance feed. Free accounts can follow up to ${free.symbols} at a time. Uplink raises that to ${uplink.symbols}. Pro gives you ${pro.symbols} — enough for a serious portfolio. With Ultimate, there is no cap — add every ticker you care about and they all stream in real time.`,
      accent: 'cyan',
    },
    {
      icon: Rss,
      question: 'How many RSS feeds can I follow?',
      highlight: `From ${free.feeds} feed${free.feeds === 1 ? '' : 's'} on Free to completely unlimited on the top tier.`,
      answer: `RSS feeds power the news channel. Free accounts can subscribe to ${free.feeds} feed${free.feeds === 1 ? '' : 's'} from the default catalog. Uplink expands that to ${uplink.feeds}, Pro to ${pro.feeds}, giving you broad coverage across topics. Ultimate removes the limit entirely — subscribe to as many sources as you want.`,
      accent: 'amber',
    },
    {
      icon: Sparkles,
      question: 'What are custom RSS feeds?',
      highlight:
        'Add any RSS URL you want — your own blogs, niche sources, anything with a feed.',
      answer: `Beyond the built-in catalog, custom feeds let you paste any RSS or Atom URL. Free accounts cannot add custom feeds. Uplink gives you ${uplink.custom_feeds}, Pro gives you ${pro.custom_feeds} — enough for niche industry sources, personal blogs, or company news. Ultimate removes the cap so you can add every source you follow.`,
      accent: 'orange',
    },
    {
      icon: Trophy,
      question: 'What sports leagues are included?',
      highlight: 'Free covers pro leagues. All paid tiers add college sports.',
      answer:
        "Every tier includes live scores from the NFL, NBA, MLB, NHL, MLS, and Premier League. All paid tiers add college football (NCAAF) and college basketball (NCAAM), with scores updating at your tier's delivery speed.",
      accent: 'violet',
    },
    {
      icon: Crown,
      question: 'How many fantasy leagues can I connect?',
      highlight: `${freeFantasyCopy} on free, ${uplink.fantasy} with Uplink, ${pro.fantasy} with Pro, or every league with Ultimate.`,
      answer: `Scrollr syncs with Yahoo Fantasy Sports to show your standings, matchups, and roster updates. Free accounts ${free.fantasy === 0 ? 'cannot connect Yahoo leagues' : `connect ${free.fantasy} league${free.fantasy === 1 ? '' : 's'}`}. Uplink supports up to ${uplink.fantasy}. Pro gives you ${pro.fantasy} — enough for multi-sport managers. Ultimate connects every league across every sport with no restrictions.`,
      accent: 'rose',
    },
    {
      icon: Bell,
      question: 'What are custom alerts?',
      highlight:
        'Set price targets, score thresholds, and keyword triggers — Pro and Ultimate only.',
      answer:
        'Custom alerts let you define conditions that trigger notifications: a stock hitting a target price, a game entering the 4th quarter, or an RSS item matching a keyword. Alerts are evaluated in the app background — no server round-trip needed. Available on Pro and Ultimate tiers.',
      accent: 'sky',
    },
    {
      icon: Layers,
      question: 'What are feed profiles and advanced controls?',
      highlight:
        'Save named configurations and fine-tune exactly what you see — Pro and Ultimate.',
      answer:
        'Feed profiles let you save different configurations — like "Work" showing only finance and RSS, or "Weekend" with sports and fantasy. Advanced controls add pinning, custom sort rules, and per-channel filtering within the feed. Both features are exclusive to Pro and Ultimate tiers.',
      accent: 'fuchsia',
    },
    {
      icon: Filter,
      question: 'What is site filtering?',
      highlight:
        'Control which websites show the Scrollr feed bar, from blocklists to allowlists.',
      answer:
        'Site filtering controls where the feed bar appears. Every tier includes blacklist filtering — hide the bar on specific displays. Pro and Ultimate add whitelist mode on top, so you can restrict the bar to only the displays you choose.',
      accent: 'cyan',
    },
    {
      icon: Code2,
      question: 'What about webhooks, data export, and API access?',
      highlight:
        'Ultimate-exclusive power features for integrations and automation.',
      answer:
        'Webhooks push your alerts to Discord, Slack, or any URL. Data export lets you download tracked symbols, historical prices, and game results as CSV or JSON. API access gives you programmatic read access to your MyScrollr data for personal dashboards or automation. All three are exclusive to Ultimate.',
      accent: 'teal',
    },
    {
      icon: Clock,
      question: 'What does early access include?',
      highlight:
        'All paid subscribers get new features and channels before anyone else.',
      answer:
        'Every paid tier unlocks early access to new features, channels, and UI updates before they roll out to free users. This includes beta channels, experimental feed modes, and new dashboard widgets. You get to try everything first and provide feedback that shapes the final release.',
      accent: 'orange',
    },
    {
      icon: LayoutDashboard,
      question: 'Does every tier get the full dashboard?',
      highlight:
        'Yes — the web dashboard is fully accessible on every tier, including free.',
      answer:
        'Every user gets complete access to the web dashboard at myscrollr.com. You can view all your channels, manage your watchlists, configure feeds, and adjust preferences regardless of your subscription tier. Paid tiers enhance the data flowing into the dashboard, not the dashboard itself.',
      accent: 'lime',
    },
  ]
}

// ── Signal Bars ─────────────────────────────────────────────────

function SignalBars() {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-primary origin-bottom"
          style={{ height: 4 + i * 4 }}
          initial={{ scaleY: 0, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{
            delay: 0.8 + i * 0.12,
            duration: 0.4,
            ease: EASE,
          }}
        />
      ))}
    </div>
  )
}

// ── Bottom CTA (full-section, matches homepage quality) ──────────

function BottomCTA({
  handleSelectPlan,
  hadPriorSub,
}: {
  handleSelectPlan: (period: PlanKey, tier: TierKey) => void
  hadPriorSub: boolean
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { amount: 0.15 })

  // Mouse parallax — actual orb + spring chain rendered inside the
  // shared `<ConvergenceBackdrop>`. We just own the raw 0-1 cursor
  // position MotionValues here.
  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      mouseX.set((e.clientX - rect.left) / rect.width)
      mouseY.set((e.clientY - rect.top) / rect.height)
    },
    [mouseX, mouseY],
  )

  // 4 beams alternating green/cyan around the section center.
  const beams = useMemo<Array<BackdropBeam>>(
    () => [
      { angle: 35, color: '#34d399', delay: 0.3 },
      { angle: 145, color: '#00b8db', delay: 0.45 },
      { angle: 215, color: '#34d399', delay: 0.6 },
      { angle: 325, color: '#00b8db', delay: 0.75 },
    ],
    [],
  )

  return (
    <section
      ref={sectionRef}
      className="relative overflow-clip py-32 lg:py-44"
      onMouseMove={handleMouseMove}
    >
      {/* ── Background layers (shared with the homepage CallToAction) */}
      <ConvergenceBackdrop
        mouseX={mouseX}
        mouseY={mouseY}
        isInView={isInView}
        particles={CTA_PARTICLES}
        beams={beams}
        pulseRingCount={3}
        orbBackground="radial-gradient(circle, rgba(52,211,153,0.08) 0%, rgba(0,184,219,0.04) 40%, transparent 70%)"
      />

      {/* ── Content ───────────────────────────────────────────────── */}
      <div
        className="relative mx-auto px-5 sm:px-6 lg:px-8"
        style={{ maxWidth: 1400 }}
      >
        <div className="flex flex-col items-center text-center">
          {/* Pill badge */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              Available Now
            </span>
          </motion.div>

          {/* Main headline */}
          <motion.h2
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
            className="mt-8 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-none"
          >
            <span className="block">Upgrade Your</span>
            <span className="block mt-2 text-gradient-primary">Signal.</span>
          </motion.h2>

          {/* Sub-copy */}
          <motion.span
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.25, duration: 0.5, ease: EASE }}
            className="block mt-6 text-lg sm:text-xl text-base-content/50 max-w-lg leading-relaxed"
          >
            The core is free forever. Uplink, Pro, and Ultimate are for those
            who want more data, faster delivery, and zero limits.
          </motion.span>

          {/* CTA buttons with central glow */}
          <motion.div
            className="relative mt-10"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4, duration: 0.6, ease: EASE }}
          >
            {/* Central glow behind buttons */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
              style={{
                width: 240,
                height: 240,
                background:
                  'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)',
                filter: 'blur(30px)',
              }}
            />

            <div className="relative z-10 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => handleSelectPlan('annual', 'ultimate')}
                className="btn btn-pulse gap-2 text-base px-8 py-5 shadow-2xl"
              >
                <Crown size={14} />{' '}
                {hadPriorSub
                  ? 'Subscribe — Ultimate'
                  : 'Start Free Trial — Ultimate'}
              </button>
              <button
                type="button"
                onClick={() => handleSelectPlan('annual', 'pro')}
                className="btn btn-outline gap-2 px-6 py-4"
              >
                <Gauge size={14} />{' '}
                {hadPriorSub ? 'Subscribe — Pro' : 'Try Pro Free for 7 Days'}
              </button>
            </div>
          </motion.div>

          {/* Trust signals */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
            className="mt-6 flex items-center gap-4 text-xs text-base-content/30"
          >
            {[
              '7-day free trial',
              'Cancel anytime',
              'Instant activation',
              'Stripe-secured',
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                {item}
              </span>
            ))}
          </motion.div>

          {/* Bottom links */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.75, duration: 0.5, ease: EASE }}
            className="mt-14 flex items-center gap-6"
          >
            <Link
              to="/uplink/lifetime"
              className="inline-flex items-center gap-2 text-sm text-base-content/40 hover:text-warning transition-colors duration-200"
            >
              <Sparkles className="size-4" aria-hidden />
              Lifetime Access
            </Link>
            <span className="w-px h-4 bg-base-content/10" />
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-base-content/40 hover:text-primary transition-colors duration-200"
            >
              <Satellite className="size-4" aria-hidden />
              Try Free First
            </Link>
          </motion.div>
        </div>
      </div>

      {/* ── Bottom horizon glow ───────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none">
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--color-primary), var(--color-info), var(--color-primary), transparent)',
            opacity: 0,
          }}
          animate={isInView ? { opacity: [0, 0.4, 0.2] } : {}}
          transition={{ delay: 1.5, duration: 2 }}
        />
        <motion.div
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{
            width: '60%',
            height: 120,
            background:
              'radial-gradient(ellipse at bottom, rgba(52,211,153,0.08) 0%, transparent 70%)',
            opacity: 0,
          }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 1.8, duration: 1.5 }}
        />
      </div>
    </section>
  )
}

// ── Pricing Feature Line ──────────────────────────────────────────

function PricingFeature({
  children,
  highlight,
}: {
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Check
        size={12}
        className={
          highlight ? 'text-primary shrink-0' : 'text-base-content/20 shrink-0'
        }
      />
      <span
        className={`text-xs ${highlight ? 'text-base-content/60' : 'text-base-content/35'}`}
      >
        {children}
      </span>
    </div>
  )
}

// ── Page Component ──────────────────────────────────────────────

function UplinkPage() {
  const { isAuthenticated, signIn } = useScrollrAuth()
  const getToken = useGetToken()

  // Live tier limits from the backend (fallback-embedded for first paint).
  // Rebuilds the comparison table, tier showcases, and FAQ whenever the
  // fetch resolves or the cached response changes.
  const tierLimits = useTierLimits()
  const comparisonRows = useMemo(
    () => buildComparison(tierLimits),
    [tierLimits],
  )
  const tierShowcases = useMemo(
    () => buildTierShowcases(tierLimits),
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
      return hadPriorSub ? 'Subscribe' : 'Start Free Trial'
    }
    if (isTrialing && activeTier === tier) return 'Your Choice'
    if (currentSub?.status === 'canceling' && activeTier === tier)
      return 'Current Plan'
    if (activeTier === tier) return 'Current Plan'
    if (pendingDowngradeTier === tier) return 'Downgrade Scheduled'
    if (isTrialing) return 'Switch to ' + TIER_NAMES[tier]
    if (currentSub?.status === 'canceling')
      return TIER_RANK[tier] > TIER_RANK[activeTier] ? 'Upgrade' : 'Downgrade'
    return TIER_RANK[tier] > TIER_RANK[activeTier] ? 'Upgrade' : 'Downgrade'
  }

  /** Whether a tier card should be non-interactive */
  const isTierDisabled = (tier: TierKey): boolean =>
    activeTier === tier || pendingDowngradeTier === tier

  const TIER_NAMES: Record<TierKey, string> = {
    uplink: 'Uplink',
    pro: 'Uplink Pro',
    ultimate: 'Uplink Ultimate',
  }

  return (
    <div className="min-h-screen pt-20">
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
            className="relative w-full max-w-sm mx-4 bg-base-200 border border-base-content/10 rounded-xl p-6"
          >
            <h3 className="text-sm font-semibold text-base-content/80 mb-4">
              {pendingChange.isTrialChange
                ? 'Switch to'
                : pendingChange.isDowngrade
                  ? 'Downgrade to'
                  : 'Upgrade to'}{' '}
              {TIER_NAMES[pendingChange.tier]}
            </h3>

            <div className="space-y-3 mb-6">
              {pendingChange.isTrialChange ? (
                <>
                  <p className="text-xs text-base-content/50">
                    No charge during your trial. Your plan will switch to{' '}
                    <span className="font-semibold text-base-content/80">
                      {TIER_NAMES[pendingChange.tier]}
                    </span>{' '}
                    and billing starts{' '}
                    <span className="font-semibold text-base-content/80">
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
                  <p className="text-[10px] text-base-content/30">
                    You&rsquo;ll keep full{' '}
                    {TIER_NAMES[activeTier ?? 'ultimate']} access until your
                    trial ends.
                  </p>
                </>
              ) : pendingChange.isDowngrade ? (
                <>
                  <p className="text-xs text-base-content/50">
                    Your {activeTier ? TIER_NAMES[activeTier] : ''} access
                    continues until{' '}
                    <span className="font-semibold text-base-content/80">
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
                  <p className="text-[10px] text-base-content/30">
                    After that, your plan switches to{' '}
                    {TIER_NAMES[pendingChange.tier]} at your next renewal. No
                    charge or refund — your current billing cycle is unaffected.
                  </p>
                </>
              ) : pendingChange.amountDue > 0 ? (
                <>
                  <p className="text-xs text-base-content/50">
                    You will be charged{' '}
                    <span className="font-semibold text-base-content/80">
                      ${(pendingChange.amountDue / 100).toFixed(2)}
                    </span>{' '}
                    today.
                  </p>
                  <p className="text-[10px] text-base-content/30">
                    This is the prorated difference for the remaining days in
                    your current billing cycle.
                  </p>
                </>
              ) : (
                <p className="text-xs text-base-content/50">
                  No charge — your new plan starts immediately.
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPendingChange(null)}
                className="flex-1 py-2.5 text-[10px] font-semibold border border-base-content/10 rounded-lg text-base-content/40 hover:text-base-content/60 hover:border-base-content/20 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmChange}
                disabled={planChanging}
                className="flex-1 py-2.5 text-[10px] font-semibold bg-primary/10 border border-primary/30 text-primary rounded-lg hover:bg-primary/20 hover:border-primary/50 transition-colors disabled:opacity-50"
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
            className="relative w-full max-w-sm mx-4 bg-base-200 border border-base-content/10 rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <ShieldAlert size={20} className="text-error" />
              </div>
              <h3 className="text-sm font-semibold text-base-content/80">
                Cancel your free trial?
              </h3>
            </div>

            <div className="space-y-3 text-xs text-base-content/50 leading-relaxed">
              <p>
                If you cancel now, you&apos;ll lose access to all premium
                features immediately &mdash; including real-time data, higher
                limits, and Uplink Ultimate access.
              </p>
              <p className="font-semibold text-base-content/70">
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
                className="flex-1 py-2.5 text-xs font-semibold border border-primary/30 rounded-lg
                           text-primary hover:bg-primary/10 transition-colors"
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
                className="flex-1 py-2.5 text-xs font-semibold border border-error/30 rounded-lg
                           text-error/60 hover:text-error hover:bg-error/10 transition-colors"
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
              className="fixed top-24 left-1/2 -translate-x-1/2 z-40 px-6 py-4 bg-success/10 border border-success/30 rounded-lg backdrop-blur-sm flex items-center gap-3"
            >
              <CheckCircle2 size={18} className="text-success" />
              <div>
                <p className="text-xs font-bold text-success">
                  {tierName} Activated
                </p>
                <p className="text-[10px] text-base-content/40">
                  {currentSub?.status === 'trialing'
                    ? `Your 7-day free trial is active. Enjoy full Uplink Ultimate access.`
                    : `Your subscription is active. Welcome to ${tierName}.`}
                </p>
              </div>
              <button
                onClick={() => setCheckoutSuccess(false)}
                className="ml-4 text-base-content/30 hover:text-base-content/60 transition-colors text-xs"
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
          className="fixed top-24 left-1/2 -translate-x-1/2 z-40 px-6 py-4 bg-error/10 border border-error/30 rounded-lg backdrop-blur-sm flex items-center gap-3"
        >
          <AlertTriangle size={18} className="text-error" />
          <div>
            <p className="text-xs font-bold text-error">Plan Change Failed</p>
            <p className="text-[10px] text-base-content/40">
              {planChangeError}
            </p>
          </div>
          <button
            onClick={() => setPlanChangeError(null)}
            className="ml-4 text-base-content/30 hover:text-base-content/60 transition-colors text-xs"
          >
            ✕
          </button>
        </motion.div>
      )}

      {/* ================================================================
          HERO
          ================================================================ */}
      <section className="relative pt-32 pb-28 overflow-hidden">
        {/* Layered background system */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Fine dot matrix */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, var(--grid-dot-primary) 1px, transparent 0)`,
              backgroundSize: '24px 24px',
            }}
          />

          {/* Primary orbital glow */}
          <motion.div
            className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--glow-primary-subtle) 0%, transparent 70%)',
            }}
            animate={{
              scale: [1, 1.08, 1],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Secondary glow */}
          <motion.div
            className="absolute bottom-[-30%] left-[-10%] w-[600px] h-[600px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--glow-info-subtle) 0%, transparent 70%)',
            }}
            animate={{
              scale: [1.08, 1, 1.08],
              opacity: [0.4, 0.7, 0.4],
            }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Scan line removed during the perf pass — was animating
              `y` from -10% to 110% over 6s on `repeat: Infinity` across
              the full hero. Compositor-tier so cheap individually, but
              the hero already has 4 nested ring loops + 6 floating dots
              + 2 perpetual orb pulses; the scan line wasn't pulling
              its weight visually and the surface area for layout
              reads grew on resize. */}
        </div>

        {/* Top border accent */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        <div className="container relative z-10 !py-0">
          {/* Badge row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center gap-4 mb-10"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/8 text-primary text-[10px] font-bold rounded-lg border border-primary/15 uppercase tracking-wide">
              <Satellite size={12} />
              uplink
            </span>
            <span className="h-px w-16 bg-gradient-to-r from-base-300 to-transparent" />
            <span className="text-[10px] text-base-content/25 flex items-center gap-3">
              power tier
              <SignalBars />
            </span>
          </motion.div>

          {/* Two-column: text left, tier cards right */}
          <div className="flex items-center gap-6">
            {/* Left — headline + CTA */}
            <div className="flex-1 min-w-0">
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
                className="text-6xl md:text-8xl lg:text-9xl font-black tracking-tight leading-[0.85] mb-8"
              >
                Total
                <br />
                <span className="relative inline-block">
                  <span className="text-gradient-primary">Coverage</span>
                  {/* Underline accent */}
                  <motion.span
                    className="absolute -bottom-2 left-0 right-0 h-[3px] bg-gradient-to-r from-primary via-primary/60 to-transparent origin-left"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.8, delay: 0.8, ease: EASE }}
                  />
                </span>
              </motion.h1>

              {/* Subtitle */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
                className="flex items-start gap-3 mb-12 max-w-xl"
              >
                <span className="text-primary/30 font-mono text-sm mt-0.5 select-none shrink-0">
                  $
                </span>
                <p className="text-base text-base-content/40 leading-relaxed">
                  Scrollr is free and open source. Three paid tiers for power
                  users who want more — expanded limits, faster delivery, custom
                  alerts, and real-time data via SSE.
                </p>
              </motion.div>

              {/* CTA row */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
                className="flex flex-wrap items-center gap-5"
              >
                <button
                  type="button"
                  onClick={() => {
                    document
                      .getElementById('pricing')
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }}
                  className="btn btn-pulse btn-lg gap-2.5"
                >
                  <Zap size={14} />
                  {hadPriorSub ? 'View Plans' : 'Start Free Trial'}
                </button>

                <div className="flex items-center gap-3">
                  <span className="h-px w-6 bg-base-300/50" />
                  <span className="text-[10px] font-mono text-base-content/20">
                    {hadPriorSub
                      ? `From $${PRICING.uplink.annual.perMonth}/mo \u00b7 Cancel anytime`
                      : `7 days free \u00b7 From $${PRICING.uplink.annual.perMonth}/mo \u00b7 Cancel anytime`}
                  </span>
                </div>
              </motion.div>
            </div>

            {/* Right — concentric signal rings (hidden on mobile) */}
            <div className="hidden lg:flex items-center justify-center w-[380px] shrink-0">
              <div className="relative w-[340px] h-[340px]">
                {/* ── Outer ring: Unlimited (green glow) ── */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.9, duration: 1, ease: EASE }}
                >
                  {/* Glow layer */}
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{
                      boxShadow:
                        '0 0 40px #34d39920, 0 0 80px #34d39910, inset 0 0 40px #34d39908',
                    }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{
                      duration: 4,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      border: '1.5px solid #34d39930',
                      background:
                        'radial-gradient(circle, transparent 60%, #34d39908 100%)',
                    }}
                  />
                  {/* Label */}
                  <motion.div
                    className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.6, duration: 0.5, ease: EASE }}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-widest text-primary/70 bg-base-100/80 backdrop-blur-sm px-3 py-1 rounded-full border border-primary/15">
                      Ultimate
                    </span>
                  </motion.div>
                </motion.div>

                {/* ── Pro ring (violet) ── */}
                <motion.div
                  className="absolute inset-[45px] rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.95, ease: EASE }}
                >
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      border: '1.5px solid #a78bfa25',
                      background:
                        'radial-gradient(circle, transparent 55%, #a78bfa06 100%)',
                    }}
                  />
                  {/* Label */}
                  <motion.div
                    className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.4, duration: 0.5, ease: EASE }}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#a78bfa]/60 bg-base-100/80 backdrop-blur-sm px-3 py-1 rounded-full border border-[#a78bfa]/15">
                      Pro
                    </span>
                  </motion.div>
                </motion.div>

                {/* ── Uplink ring (cyan) ── */}
                <motion.div
                  className="absolute inset-[85px] rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.9, ease: EASE }}
                >
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      border: '1.5px solid #00b8db25',
                      background:
                        'radial-gradient(circle, transparent 55%, #00b8db06 100%)',
                    }}
                  />
                  {/* Label */}
                  <motion.div
                    className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2, duration: 0.5, ease: EASE }}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-widest text-info/50 bg-base-100/80 backdrop-blur-sm px-3 py-1 rounded-full border border-info/10">
                      Uplink
                    </span>
                  </motion.div>
                </motion.div>

                {/* ── Inner ring: Free (muted) ── */}
                <motion.div
                  className="absolute inset-[120px] rounded-full"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.8, ease: EASE }}
                >
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  />
                  {/* Label */}
                  <motion.div
                    className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-1/2"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.0, duration: 0.5, ease: EASE }}
                  >
                    <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/25 bg-base-100/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-base-300/15">
                      Free
                    </span>
                  </motion.div>
                </motion.div>

                {/* ── Center: Satellite icon ── */}
                <motion.div
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.7, ease: EASE }}
                >
                  <div className="relative">
                    {/* Icon glow */}
                    <div
                      className="absolute inset-0 rounded-full blur-xl"
                      style={{
                        background:
                          'radial-gradient(circle, #34d39925 0%, transparent 70%)',
                        width: 80,
                        height: 80,
                        left: -16,
                        top: -16,
                      }}
                    />
                    <div
                      className="relative w-12 h-12 rounded-2xl flex items-center justify-center"
                      style={{
                        background: '#34d39910',
                        boxShadow: '0 0 24px #34d39915, 0 0 0 1px #34d39920',
                      }}
                    >
                      <Satellite size={22} className="text-primary/70" />
                    </div>
                  </div>
                </motion.div>

                {/* ── Radiating pulse (perpetual) ── */}
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="absolute inset-0 rounded-full border border-primary/10 pointer-events-none"
                    animate={{ scale: [0.35, 1.15], opacity: [0.6, 0] }}
                    transition={{
                      delay: 1.5 + i * 1.2,
                      duration: 3,
                      ease: 'easeOut',
                      repeat: Infinity,
                      repeatDelay: 1.6,
                    }}
                  />
                ))}

                {/* ── Floating data dots ── */}
                {[
                  {
                    angle: 30,
                    radius: 45,
                    color: '#34d399',
                    size: 3,
                    delay: 2,
                  },
                  {
                    angle: 150,
                    radius: 70,
                    color: '#00b8db',
                    size: 2.5,
                    delay: 2.8,
                  },
                  {
                    angle: 250,
                    radius: 55,
                    color: '#34d399',
                    size: 2,
                    delay: 3.5,
                  },
                  {
                    angle: 80,
                    radius: 85,
                    color: '#00b8db',
                    size: 3,
                    delay: 2.4,
                  },
                  {
                    angle: 200,
                    radius: 40,
                    color: '#34d399',
                    size: 2.5,
                    delay: 3.2,
                  },
                  {
                    angle: 320,
                    radius: 75,
                    color: '#00b8db',
                    size: 2,
                    delay: 2.6,
                  },
                ].map((dot) => (
                  <motion.div
                    key={`${dot.angle}-${dot.radius}`}
                    className="absolute rounded-full pointer-events-none"
                    style={{
                      width: dot.size,
                      height: dot.size,
                      backgroundColor: dot.color,
                      left: '50%',
                      top: '50%',
                      marginLeft: -dot.size / 2,
                      marginTop: -dot.size / 2,
                    }}
                    animate={{
                      x: [
                        Math.cos((dot.angle * Math.PI) / 180) *
                          (dot.radius * 0.6),
                        Math.cos((dot.angle * Math.PI) / 180) *
                          (dot.radius * 1.8),
                      ],
                      y: [
                        Math.sin((dot.angle * Math.PI) / 180) *
                          (dot.radius * 0.6),
                        Math.sin((dot.angle * Math.PI) / 180) *
                          (dot.radius * 1.8),
                      ],
                      opacity: [0, 0.8, 0],
                    }}
                    transition={{
                      delay: dot.delay,
                      duration: 4,
                      ease: 'easeInOut',
                      repeat: Infinity,
                      repeatDelay: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom border */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ================================================================
          PRICING — TOGGLE + 4 COLUMNS
          ================================================================ */}
      <section id="pricing" className="relative overflow-hidden scroll-mt-24">
        <div className="container">
          {/* Section header */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-10 sm:mb-14"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Pick Your <span className="text-gradient-primary">Plan</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Flexible billing — pick what works for you
            </p>
          </motion.div>

          {/* Billing period toggle */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="flex items-center justify-center mb-10"
          >
            <div className="relative inline-flex items-center gap-1 p-1 rounded-xl bg-base-200/60 border border-base-300/30 backdrop-blur-sm">
              {(['monthly', 'annual', 'lifetime'] as const).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setBillingView(period)}
                  className={`relative z-10 px-5 py-2 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-colors duration-200 ${
                    billingView === period
                      ? period === 'lifetime'
                        ? 'text-base-100'
                        : 'text-primary-content'
                      : period === 'lifetime'
                        ? 'text-warning/40 hover:text-warning/60'
                        : 'text-base-content/35 hover:text-base-content/55'
                  }`}
                >
                  {billingView === period && (
                    <motion.div
                      layoutId="billing-toggle"
                      className={`absolute inset-0 rounded-lg ${period === 'lifetime' ? 'bg-warning' : 'bg-primary'}`}
                      transition={{
                        type: 'spring',
                        bounce: 0.15,
                        duration: 0.5,
                      }}
                    />
                  )}
                  <span className="relative z-10">
                    {BILLING_LABELS[period]}
                  </span>
                  {period === 'annual' && (
                    <span
                      className={`relative z-10 ml-1.5 text-[8px] ${billingView === period ? 'text-primary-content/70' : 'text-primary/50'}`}
                    >
                      Best
                    </span>
                  )}
                  {period === 'lifetime' && (
                    <span
                      className={`relative z-10 ml-1.5 text-[8px] ${billingView === period ? 'text-base-100/70' : 'text-warning/40'}`}
                    >
                      Limited
                    </span>
                  )}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Risk-free trial banner */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.15, ease: EASE }}
            className="flex items-center justify-center gap-2 mb-8"
          >
            <CheckCircle2
              size={13}
              className={
                isTrialing
                  ? 'text-info/60 shrink-0'
                  : 'text-primary/50 shrink-0'
              }
            />
            <span className="text-[11px] text-base-content/35">
              {isTrialing ? (
                'Your trial includes full Uplink Ultimate access. Pick the plan you want when it ends.'
              ) : (
                <>
                  Every plan includes a 7-day free trial. Cancel anytime &mdash;
                  you won&apos;t be charged until day 8.
                </>
              )}
            </span>
          </motion.div>

          {/* Pricing cards — AnimatePresence swaps between tiers and Lifetime */}
          <AnimatePresence mode="wait">
            {isLifetime ? (
              /* ═══════════════════════════════════════════════════════════════
               LIFETIME REVEAL — Epic single card with aura
               ═══════════════════════════════════════════════════════════════ */
              <motion.div
                key="lifetime-reveal"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94, y: 10 }}
                transition={{ duration: 0.55, ease: EASE }}
                className="flex justify-center py-4"
              >
                <div className="relative w-full" style={{ maxWidth: 560 }}>
                  {/* ── Expanding aura rings ── */}
                  {[0, 1, 2, 3].map((i) => (
                    <motion.div
                      key={i}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border pointer-events-none"
                      style={{
                        width: 300 + i * 100,
                        height: 300 + i * 100,
                        borderColor: `rgba(245, 158, 11, ${0.12 - i * 0.025})`,
                      }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{
                        scale: [0.6, 1.1, 1],
                        opacity: [0, 0.8, 0.3],
                      }}
                      transition={{
                        delay: 0.2 + i * 0.12,
                        duration: 1.2,
                        ease: EASE,
                      }}
                    />
                  ))}

                  {/* ── Perpetual pulse rings ── */}
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={`pulse-${i}`}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-warning/15 pointer-events-none"
                      style={{ width: 400, height: 400 }}
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

                  {/* ── Ambient orb ── */}
                  <motion.div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                    style={{
                      width: 500,
                      height: 500,
                      background:
                        'radial-gradient(circle, rgba(245,158,11,0.1) 0%, rgba(245,158,11,0.03) 40%, transparent 70%)',
                      filter: 'blur(40px)',
                    }}
                    animate={{
                      scale: [1, 1.15, 1],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 5,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />

                  {/* ── Floating particles ── */}
                  {FOOTER_PARTICLES.map((p) => (
                    <motion.div
                      key={p.id}
                      className="absolute rounded-full pointer-events-none"
                      style={{
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: p.size,
                        height: p.size,
                        backgroundColor: '#f59e0b',
                      }}
                      animate={{ y: [0, -60, -120], opacity: [0, 0.6, 0] }}
                      transition={{
                        delay: p.delay,
                        duration: p.duration,
                        ease: 'easeInOut',
                        repeat: Infinity,
                      }}
                    />
                  ))}

                  {/* ── The Card ── */}
                  <motion.div
                    initial={{ y: 20 }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
                    className="relative rounded-2xl overflow-hidden"
                  >
                    {/* Pulsing border glow */}
                    <motion.div
                      className="absolute -inset-px rounded-2xl bg-gradient-to-b from-warning/30 via-warning/10 to-warning/5"
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />

                    <div className="relative border border-warning/25 rounded-2xl p-8 sm:p-10">
                      {/* Background */}
                      <div className="absolute inset-0 bg-base-200/70 rounded-2xl pointer-events-none" />

                      {/* Top accent */}
                      <div
                        className="absolute top-0 left-0 right-0 h-px"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent, #f59e0b 50%, transparent)',
                        }}
                      />

                      {/* ── Amber smoke ── */}
                      <div
                        className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
                        style={{ zIndex: 1 }}
                      >
                        <motion.div
                          className="absolute inset-0"
                          style={{
                            background:
                              'linear-gradient(135deg, #f59e0b12 0%, #f59e0b20 40%, #f59e0b12 60%, #f59e0b1a 100%)',
                          }}
                          animate={{ opacity: [0.4, 0.8, 0.4] }}
                          transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />
                        <motion.div
                          className="absolute bottom-[-10%] left-[10%] w-[80%] h-[55%] rounded-full blur-3xl"
                          style={{
                            background:
                              'radial-gradient(ellipse 70% 60% at center bottom, #f59e0b30 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -30, 0],
                            scaleX: [1, 1.25, 1],
                            opacity: [0.3, 0.7, 0.3],
                          }}
                          transition={{
                            duration: 7,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />
                        <motion.div
                          className="absolute top-[-8%] right-[5%] w-[70%] h-[50%] rounded-full blur-3xl"
                          style={{
                            background:
                              'radial-gradient(ellipse 65% 55% at center top, #f59e0b25 0%, transparent 65%)',
                          }}
                          animate={{
                            y: [0, 20, 0],
                            scaleX: [1, 1.15, 1],
                            opacity: [0.25, 0.6, 0.25],
                          }}
                          transition={{
                            duration: 8,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 1.5,
                          }}
                        />
                        <motion.div
                          className="absolute top-[30%] left-[15%] w-[45px] h-[45px] rounded-full blur-xl"
                          style={{
                            background:
                              'radial-gradient(circle, #f59e0b45 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -15, 10, 0],
                            opacity: [0, 0.7, 0.3, 0],
                          }}
                          transition={{
                            duration: 5,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />
                        <motion.div
                          className="absolute top-[60%] right-[12%] w-[40px] h-[40px] rounded-full blur-lg"
                          style={{
                            background:
                              'radial-gradient(circle, #f59e0b40 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -10, 0],
                            opacity: [0, 0.5, 0],
                          }}
                          transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 2.5,
                          }}
                        />
                      </div>

                      {/* Watermark */}
                      <Sparkles
                        size={140}
                        strokeWidth={0.3}
                        className="absolute -bottom-8 -right-8 text-base-content/[0.02] pointer-events-none"
                      />

                      {/* ── Content ── */}
                      <div className="relative z-10">
                        {/* Header */}
                        <div className="text-center mb-8">
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                              delay: 0.3,
                              type: 'spring',
                              bounce: 0.35,
                              duration: 0.6,
                            }}
                            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
                            style={{
                              background: '#f59e0b15',
                              boxShadow:
                                '0 0 40px #f59e0b20, 0 0 0 1px #f59e0b25',
                            }}
                          >
                            <Sparkles size={28} className="text-warning" />
                          </motion.div>

                          <h3 className="text-2xl font-black text-base-content mb-1">
                            The First Byte
                          </h3>
                          <p className="text-xs text-warning/50 font-medium">
                            Lifetime Uplink &middot; Founding Member
                          </p>
                        </div>

                        {/* Price */}
                        <div className="text-center mb-6">
                          <div className="flex items-baseline justify-center gap-2 mb-1">
                            <span className="text-5xl font-black text-base-content tracking-tight">
                              $399
                            </span>
                            <span className="text-sm text-base-content/25">
                              one-time
                            </span>
                          </div>
                          <p className="text-[10px] text-warning/40">
                            Permanent Uplink access &middot; No renewals
                          </p>
                        </div>

                        {/* Slot progress */}
                        <div className="mb-8 p-4 rounded-xl bg-base-100/60 border border-base-300/30">
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="text-[9px] text-base-content/25 uppercase tracking-wide">
                              Founding Member Slots
                            </span>
                            <span className="text-[10px] font-mono text-warning/60 font-bold">
                              128 total &middot; 0x00 — 0x7F
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-base-300/50 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full bg-gradient-to-r from-warning/70 via-warning to-primary/60 origin-left"
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: 1 }}
                              transition={{
                                duration: 2,
                                delay: 0.5,
                                ease: EASE,
                              }}
                            />
                          </div>
                        </div>

                        {/* Features — 2 columns */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-8">
                          {[
                            'Permanent Uplink-tier access',
                            '50% off Unlimited upgrade',
                            '30s polling delivery',
                            'Founding member badge',
                            `${tierLimits.tiers.uplink.symbols} symbols, ${tierLimits.tiers.uplink.feeds} RSS feeds`,
                            'Priority support',
                            'Pro + College sports',
                            'Early access to features',
                          ].map((feature) => (
                            <div
                              key={feature}
                              className="flex items-center gap-2"
                            >
                              <Check
                                size={12}
                                className="text-warning shrink-0"
                              />
                              <span className="text-[11px] text-base-content/55">
                                {feature}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Unlimited callout */}
                        <div
                          className="relative mb-8 p-3.5 rounded-xl border border-primary/15 overflow-hidden"
                          style={{ background: 'rgba(52, 211, 153, 0.04)' }}
                        >
                          <div className="relative z-10">
                            <p className="text-[10px] text-primary/70 font-semibold mb-1">
                              50% Off Ultimate — From $25.00/mo
                            </p>
                            <p className="text-[10px] text-base-content/35 leading-relaxed">
                              Lifetime members get half off any Ultimate
                              subscription. Real-time SSE, unlimited symbols and
                              feeds, webhooks, API access, and data export — all
                              at half price.
                            </p>
                          </div>
                        </div>

                        {/* CTA */}
                        <Link
                          to="/uplink/lifetime"
                          className="block w-full py-3.5 text-center text-xs font-bold bg-warning/10 border border-warning/30 text-warning rounded-xl hover:bg-warning/20 hover:border-warning/50 transition-colors"
                        >
                          Claim Your Slot
                        </Link>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            ) : (
              /* ═══════════════════════════════════════════════════════════════
               TIER CARDS — Uplink / Pro / Unlimited
               ═══════════════════════════════════════════════════════════════ */
              <motion.div
                key="tier-cards"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 6 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
                  {/* ─── FREE ─── */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.03, duration: 0.5, ease: EASE }}
                    className="group relative bg-base-200/20 border border-base-300/20 rounded-xl p-6 overflow-hidden flex flex-col"
                  >
                    <div className="relative z-10 flex flex-col flex-1">
                      <div className="flex items-start gap-2.5 mb-5">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center bg-base-300/30 shrink-0"
                          style={{
                            boxShadow: '0 0 0 1px rgba(255,255,255,0.04)',
                          }}
                        >
                          <Satellite
                            size={16}
                            className="text-base-content/40"
                          />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-base-content/50">
                            Free
                          </h3>
                          <p className="text-[11px] text-base-content/30 leading-snug mt-0.5">
                            Start here &mdash; it&apos;s free forever
                          </p>
                        </div>
                      </div>

                      {/* Price */}
                      <div className="mb-4">
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-3xl font-black text-base-content/40 tracking-tight font-mono tabular-nums">
                            $0
                          </span>
                          <span className="text-xs font-mono text-base-content/20">
                            /mo
                          </span>
                        </div>
                        <div className="h-5 flex items-center">
                          <span className="text-[10px] font-mono text-base-content/20">
                            Free forever
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2.5 mb-6">
                        <PricingFeature>60s polling delivery</PricingFeature>
                        <PricingFeature>
                          {tierLimits.tiers.free.symbols} symbols,{' '}
                          {tierLimits.tiers.free.feeds} RSS feed
                          {tierLimits.tiers.free.feeds === 1 ? '' : 's'}
                        </PricingFeature>
                        <PricingFeature>
                          {tierLimits.tiers.free.fantasy === 0
                            ? 'No fantasy leagues'
                            : `${tierLimits.tiers.free.fantasy} fantasy league${tierLimits.tiers.free.fantasy === 1 ? '' : 's'}`}
                        </PricingFeature>
                        <PricingFeature>Pro sports leagues</PricingFeature>
                        <PricingFeature>Full desktop app access</PricingFeature>
                      </div>

                      <div className="mt-auto pt-2 flex flex-col items-center gap-1.5">
                        {isTrialing ? (
                          <>
                            <button
                              onClick={() => setShowTrialCancelModal(true)}
                              disabled={trialCanceling}
                              className="block w-full py-2.5 text-center text-[10px] font-semibold border border-error/30 text-error/60 rounded-lg hover:border-error/50 hover:text-error/80 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {trialCanceling ? 'Canceling...' : 'Cancel Trial'}
                            </button>
                            <span className="text-[9px] text-base-content/20">
                              You won&apos;t be charged
                            </span>
                          </>
                        ) : (
                          <>
                            <Link
                              to="/"
                              className="block w-full py-2.5 text-center text-[10px] font-semibold border border-base-300/30 text-base-content/35 rounded-lg hover:border-base-300/50 hover:text-base-content/50 transition-colors"
                            >
                              Get Started Free
                            </Link>
                            <span className="text-[9px] text-base-content/20">
                              No card required
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* ─── UPLINK ─── */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06, duration: 0.5, ease: EASE }}
                    whileHover={{
                      y: -3,
                      transition: { type: 'tween', duration: 0.2 },
                    }}
                    role="button"
                    tabIndex={isTierDisabled('uplink') ? -1 : 0}
                    aria-label={`Select Uplink ${BILLING_LABELS[billingPeriod]} plan`}
                    onClick={() =>
                      !isTierDisabled('uplink') &&
                      handleSelectPlan(billingPeriod, 'uplink')
                    }
                    onKeyDown={(e) => {
                      if (
                        !isTierDisabled('uplink') &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault()
                        handleSelectPlan(billingPeriod, 'uplink')
                      }
                    }}
                    className={`group relative bg-base-200/40 border border-info/15 rounded-xl p-6 transition-colors overflow-hidden flex flex-col ${isTierDisabled('uplink') ? 'opacity-60 cursor-default' : 'hover:border-info/30 cursor-pointer'}`}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-px"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, #00b8db 50%, transparent)',
                      }}
                    />
                    <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-info/[0.06]" />
                    <Rocket
                      size={90}
                      strokeWidth={0.4}
                      className="absolute -bottom-4 -right-4 text-base-content/[0.02] pointer-events-none"
                    />
                    <div className="relative z-10 flex flex-col flex-1">
                      <div className="flex items-start gap-2.5 mb-5">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            background: '#00b8db15',
                            boxShadow:
                              '0 0 20px #00b8db15, 0 0 0 1px #00b8db20',
                          }}
                        >
                          <Rocket size={16} className="text-base-content/80" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-base-content">
                            Uplink
                          </h3>
                          <p className="text-[11px] text-base-content/40 leading-snug mt-0.5">
                            Check in every morning. Miss nothing.
                          </p>
                        </div>
                      </div>

                      {/* Price — monthly-first for annual, per-digit slot animation */}
                      <div className="mb-4">
                        <div className="flex items-center mb-1">
                          <span className="text-2xl font-black text-base-content tracking-tight font-mono tabular-nums">
                            $
                          </span>
                          <span className="text-3xl font-black text-base-content tracking-tight font-mono tabular-nums leading-none">
                            <AnimatedPrice
                              value={PRICING.uplink[billingPeriod].perMonth}
                            />
                          </span>
                          <span className="text-xs font-mono text-base-content/25 ml-1 self-end mb-0.5">
                            /mo
                          </span>
                        </div>
                        <div className="flex items-center gap-2 h-5">
                          <span className="inline-grid text-[10px] font-mono text-base-content/25 tabular-nums">
                            <span
                              className="col-start-1 row-start-1 transition-opacity duration-200"
                              style={{
                                opacity: billingPeriod === 'annual' ? 1 : 0,
                              }}
                            >
                              Billed ${PRICING.uplink.annual.price}/yr
                            </span>
                            <span
                              className="col-start-1 row-start-1 transition-opacity duration-200"
                              style={{
                                opacity: billingPeriod === 'monthly' ? 1 : 0,
                              }}
                            >
                              Billed monthly
                            </span>
                          </span>
                          <span
                            className="text-[8px] font-bold text-info/60 bg-info/8 px-1.5 py-0.5 rounded transition-opacity duration-200"
                            style={{
                              opacity: PRICING.uplink[billingPeriod].savings
                                ? 1
                                : 0,
                            }}
                          >
                            {PRICING.uplink[billingPeriod].savings ??
                              PRICING.uplink.annual.savings}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2.5 mb-6">
                        <PricingFeature>30s polling delivery</PricingFeature>
                        <PricingFeature>
                          {tierLimits.tiers.uplink.symbols} symbols,{' '}
                          {tierLimits.tiers.uplink.feeds} RSS feeds
                        </PricingFeature>
                        <PricingFeature>
                          {tierLimits.tiers.uplink.custom_feeds} custom RSS feed
                          {tierLimits.tiers.uplink.custom_feeds === 1
                            ? ''
                            : 's'}
                        </PricingFeature>
                        <PricingFeature>
                          {tierLimits.tiers.uplink.fantasy} fantasy league
                          {tierLimits.tiers.uplink.fantasy === 1 ? '' : 's'}
                        </PricingFeature>
                        <PricingFeature>Pro + College sports</PricingFeature>
                        <PricingFeature>Early access</PricingFeature>
                      </div>

                      <div className="mt-auto pt-2 flex flex-col items-center gap-1.5">
                        <div
                          className={`w-full py-2.5 text-center text-[10px] font-semibold border rounded-lg transition-colors ${
                            isTierDisabled('uplink')
                              ? 'border-base-content/10 text-base-content/30 cursor-default'
                              : 'border-info/20 text-info/60 group-hover:border-info/40 group-hover:text-info/80'
                          }`}
                        >
                          {planChanging && !isTierDisabled('uplink')
                            ? 'Changing...'
                            : getCtaLabel('uplink')}
                        </div>
                        {!activeTier && !hadPriorSub && (
                          <span className="text-[9px] text-base-content/20">
                            7 days free, then $
                            {PRICING.uplink[billingPeriod].perMonth}/mo
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* ─── PRO ─── */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.09, duration: 0.5, ease: EASE }}
                    whileHover={{
                      y: -3,
                      transition: { type: 'tween', duration: 0.2 },
                    }}
                    role="button"
                    tabIndex={isTierDisabled('pro') ? -1 : 0}
                    aria-label={`Select Pro ${BILLING_LABELS[billingPeriod]} plan`}
                    onClick={() =>
                      !isTierDisabled('pro') &&
                      handleSelectPlan(billingPeriod, 'pro')
                    }
                    onKeyDown={(e) => {
                      if (
                        !isTierDisabled('pro') &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault()
                        handleSelectPlan(billingPeriod, 'pro')
                      }
                    }}
                    className={`group relative bg-base-200/40 border border-[#a78bfa]/15 rounded-xl p-6 transition-colors overflow-hidden flex flex-col ${isTierDisabled('pro') ? 'opacity-60 cursor-default' : 'hover:border-[#a78bfa]/30 cursor-pointer'}`}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-px"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, #a78bfa 50%, transparent)',
                      }}
                    />
                    <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[#a78bfa]/[0.06]" />
                    <Gauge
                      size={90}
                      strokeWidth={0.4}
                      className="absolute -bottom-4 -right-4 text-base-content/[0.02] pointer-events-none"
                    />
                    <div className="relative z-10 flex flex-col flex-1">
                      <div className="flex items-start gap-2.5 mb-5">
                        <div
                          className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            background: '#a78bfa15',
                            boxShadow:
                              '0 0 20px #a78bfa15, 0 0 0 1px #a78bfa20',
                          }}
                        >
                          <Gauge size={16} className="text-base-content/80" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-base-content">
                            Pro
                          </h3>
                          <p className="text-[11px] text-base-content/40 leading-snug mt-0.5">
                            Know the moment it happens
                          </p>
                        </div>
                      </div>

                      {/* Price — monthly-first for annual, per-digit slot animation */}
                      <div className="mb-4">
                        <div className="flex items-center mb-1">
                          <span className="text-2xl font-black text-base-content tracking-tight font-mono tabular-nums">
                            $
                          </span>
                          <span className="text-3xl font-black text-base-content tracking-tight font-mono tabular-nums leading-none">
                            <AnimatedPrice
                              value={PRICING.pro[billingPeriod].perMonth}
                            />
                          </span>
                          <span className="text-xs font-mono text-base-content/25 ml-1 self-end mb-0.5">
                            /mo
                          </span>
                        </div>
                        <div className="flex items-center gap-2 h-5">
                          <span className="inline-grid text-[10px] font-mono text-base-content/25 tabular-nums">
                            <span
                              className="col-start-1 row-start-1 transition-opacity duration-200"
                              style={{
                                opacity: billingPeriod === 'annual' ? 1 : 0,
                              }}
                            >
                              Billed ${PRICING.pro.annual.price}/yr
                            </span>
                            <span
                              className="col-start-1 row-start-1 transition-opacity duration-200"
                              style={{
                                opacity: billingPeriod === 'monthly' ? 1 : 0,
                              }}
                            >
                              Billed monthly
                            </span>
                          </span>
                          <span
                            className="text-[8px] font-bold text-[#a78bfa]/60 bg-[#a78bfa]/8 px-1.5 py-0.5 rounded transition-opacity duration-200"
                            style={{
                              opacity: PRICING.pro[billingPeriod].savings
                                ? 1
                                : 0,
                            }}
                          >
                            {PRICING.pro[billingPeriod].savings ??
                              PRICING.pro.annual.savings}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2.5 mb-6">
                        <PricingFeature highlight>
                          10s polling delivery
                        </PricingFeature>
                        <PricingFeature highlight>
                          {tierLimits.tiers.uplink_pro.symbols} symbols,{' '}
                          {tierLimits.tiers.uplink_pro.feeds} RSS feeds
                        </PricingFeature>
                        <PricingFeature highlight>
                          Custom alerts & notifications
                        </PricingFeature>
                        <PricingFeature highlight>
                          Feed profiles & controls
                        </PricingFeature>
                        <PricingFeature highlight>
                          Priority RSS refresh
                        </PricingFeature>
                        <PricingFeature highlight>
                          {tierLimits.tiers.uplink_pro.fantasy} fantasy leagues
                        </PricingFeature>
                      </div>

                      <div className="mt-auto pt-2 flex flex-col items-center gap-1.5">
                        <div
                          className={`w-full py-2.5 text-center text-[10px] font-semibold border rounded-lg transition-colors ${
                            isTierDisabled('pro')
                              ? 'border-base-content/10 text-base-content/30 cursor-default'
                              : 'border-[#a78bfa]/20 text-[#a78bfa]/60 group-hover:border-[#a78bfa]/40 group-hover:text-[#a78bfa]/80'
                          }`}
                        >
                          {planChanging && !isTierDisabled('pro')
                            ? 'Changing...'
                            : getCtaLabel('pro')}
                        </div>
                        {!activeTier && !hadPriorSub && (
                          <span className="text-[9px] text-base-content/20">
                            7 days free, then $
                            {PRICING.pro[billingPeriod].perMonth}/mo
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* ─── UNLIMITED ─── */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.5, ease: EASE }}
                    whileHover={{
                      y: -4,
                      transition: { type: 'tween', duration: 0.2 },
                    }}
                    role="button"
                    tabIndex={isTierDisabled('ultimate') ? -1 : 0}
                    aria-label={`Select Ultimate ${BILLING_LABELS[billingPeriod]} plan`}
                    onClick={() =>
                      !isTierDisabled('ultimate') &&
                      handleSelectPlan(billingPeriod, 'ultimate')
                    }
                    onKeyDown={(e) => {
                      if (
                        !isTierDisabled('ultimate') &&
                        (e.key === 'Enter' || e.key === ' ')
                      ) {
                        e.preventDefault()
                        handleSelectPlan(billingPeriod, 'ultimate')
                      }
                    }}
                    className={`group relative rounded-xl overflow-hidden flex flex-col ${isTierDisabled('ultimate') ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
                  >
                    {/* Pulsing border glow */}
                    <motion.div
                      className="absolute -inset-px rounded-xl bg-gradient-to-b from-primary/30 via-primary/10 to-primary/5"
                      animate={{ opacity: [0.6, 1, 0.6] }}
                      transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />
                    <div className="relative p-6 border border-primary/20 rounded-xl flex flex-col flex-1">
                      {/* Background layer — below smoke. No backdrop-blur: it causes a
                     compositing snap when the parent's whileInView opacity animation
                     completes and the WAAPI layer is torn down. */}
                      <div className="absolute inset-0 bg-base-200/60 rounded-xl pointer-events-none" />
                      <div
                        className="absolute top-0 left-0 right-0 h-px"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent, #34d399 50%, transparent)',
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] to-transparent pointer-events-none rounded-xl" />
                      <Crown
                        size={90}
                        strokeWidth={0.4}
                        className="absolute -bottom-4 -right-4 text-base-content/[0.02] pointer-events-none"
                      />

                      {/* "Popular" badge */}
                      <div
                        className="absolute top-0 right-0"
                        style={{ zIndex: 20 }}
                      >
                        <div className="bg-primary text-primary-content text-[7px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-bl-lg">
                          Most Popular
                        </div>
                      </div>

                      {/* ── Ethereal smoke — above background, below content ── */}
                      <div
                        className="absolute inset-0 pointer-events-none rounded-xl overflow-hidden"
                        style={{ zIndex: 1 }}
                      >
                        {/* Base haze — fills card */}
                        <motion.div
                          className="absolute inset-0"
                          style={{
                            background:
                              'radial-gradient(ellipse 90% 60% at 50% 40%, #34d39928 0%, transparent 70%)',
                          }}
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{
                            duration: 5,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />

                        {/* Rising plume */}
                        <motion.div
                          className="absolute bottom-[-10%] left-[15%] w-[75%] h-[55%] rounded-full blur-2xl"
                          style={{
                            background:
                              'radial-gradient(ellipse 70% 60% at center bottom, #34d39938 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -30, 0],
                            scaleX: [1, 1.25, 1],
                            opacity: [0.4, 0.8, 0.4],
                          }}
                          transition={{
                            duration: 7,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />

                        {/* Descending plume */}
                        <motion.div
                          className="absolute top-[-8%] right-[10%] w-[65%] h-[50%] rounded-full blur-2xl"
                          style={{
                            background:
                              'radial-gradient(ellipse 65% 55% at center top, #34d39930 0%, transparent 65%)',
                          }}
                          animate={{
                            y: [0, 25, 0],
                            scaleX: [1, 1.15, 1],
                            opacity: [0.35, 0.7, 0.35],
                          }}
                          transition={{
                            duration: 8,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 1.5,
                          }}
                        />

                        {/* Mid-card turbulence */}
                        <motion.div
                          className="absolute top-[25%] left-[5%] w-[90%] h-[50%] rounded-full blur-3xl"
                          style={{
                            background:
                              'radial-gradient(ellipse 75% 50%, #34d39922 0%, transparent 60%)',
                          }}
                          animate={{
                            scaleX: [1, 1.2, 0.9, 1],
                            scaleY: [1, 0.9, 1.1, 1],
                            opacity: [0.4, 0.7, 0.5, 0.4],
                          }}
                          transition={{
                            duration: 10,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />

                        {/* Accent particle */}
                        <motion.div
                          className="absolute top-[30%] right-[15%] w-[50px] h-[50px] rounded-full blur-lg"
                          style={{
                            background:
                              'radial-gradient(circle, #34d39950 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -15, 10, 0],
                            x: [0, -8, 5, 0],
                            opacity: [0, 0.7, 0.35, 0],
                          }}
                          transition={{
                            duration: 5,
                            repeat: Infinity,
                            ease: 'easeInOut',
                          }}
                        />

                        {/* Second accent particle */}
                        <motion.div
                          className="absolute top-[65%] left-[20%] w-[40px] h-[40px] rounded-full blur-lg"
                          style={{
                            background:
                              'radial-gradient(circle, #34d39945 0%, transparent 70%)',
                          }}
                          animate={{
                            y: [0, -10, 0],
                            opacity: [0, 0.6, 0],
                          }}
                          transition={{
                            duration: 4,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: 2.5,
                          }}
                        />
                      </div>

                      <div className="relative z-10 flex flex-col flex-1">
                        <div className="flex items-start gap-2.5 mb-5">
                          <div
                            className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              background: '#34d39915',
                              boxShadow:
                                '0 0 20px #34d39915, 0 0 0 1px #34d39920',
                            }}
                          >
                            <Crown size={16} className="text-base-content/80" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-base-content">
                              Ultimate
                            </h3>
                            <p className="text-[11px] text-base-content/40 leading-snug mt-0.5">
                              Everything. Zero limits.
                            </p>
                          </div>
                        </div>

                        {/* Price — monthly-first for annual, per-digit slot animation */}
                        <div className="mb-4">
                          <div className="flex items-center mb-1">
                            <span className="text-2xl font-black text-base-content tracking-tight font-mono tabular-nums">
                              $
                            </span>
                            <span className="text-3xl font-black text-base-content tracking-tight font-mono tabular-nums leading-none">
                              <AnimatedPrice
                                value={PRICING.ultimate[billingPeriod].perMonth}
                              />
                            </span>
                            <span className="text-xs font-mono text-base-content/25 ml-1 self-end mb-0.5">
                              /mo
                            </span>
                          </div>
                          <div className="flex items-center gap-2 h-5">
                            <span className="inline-grid text-[10px] font-mono text-primary/40 tabular-nums">
                              <span
                                className="col-start-1 row-start-1 transition-opacity duration-200"
                                style={{
                                  opacity: billingPeriod === 'annual' ? 1 : 0,
                                }}
                              >
                                Billed ${PRICING.ultimate.annual.price}/yr
                              </span>
                              <span
                                className="col-start-1 row-start-1 transition-opacity duration-200"
                                style={{
                                  opacity: billingPeriod === 'monthly' ? 1 : 0,
                                }}
                              >
                                Billed monthly
                              </span>
                            </span>
                            <span
                              className="text-[8px] font-bold text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded transition-opacity duration-200"
                              style={{
                                opacity: PRICING.ultimate[billingPeriod].savings
                                  ? 1
                                  : 0,
                              }}
                            >
                              {PRICING.ultimate[billingPeriod].savings ??
                                PRICING.ultimate.annual.savings}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2.5 mb-6">
                          <PricingFeature highlight>
                            Real-time SSE delivery
                          </PricingFeature>
                          <PricingFeature highlight>
                            Unlimited everything
                          </PricingFeature>
                          <PricingFeature highlight>
                            Webhooks & integrations
                          </PricingFeature>
                          <PricingFeature highlight>
                            Data export & API access
                          </PricingFeature>
                          <PricingFeature highlight>
                            Priority support
                          </PricingFeature>
                          <PricingFeature highlight>
                            Everything in Pro, plus more
                          </PricingFeature>
                        </div>

                        <div className="mt-auto pt-2 flex flex-col items-center gap-1.5">
                          <div
                            className={`w-full py-2.5 text-center text-[10px] font-semibold border rounded-lg transition-colors ${
                              isTierDisabled('ultimate')
                                ? 'border-base-content/10 text-base-content/30 cursor-default'
                                : 'bg-primary/10 border-primary/30 text-primary group-hover:bg-primary/20 group-hover:border-primary/50'
                            }`}
                          >
                            {planChanging && !isTierDisabled('ultimate')
                              ? 'Changing...'
                              : getCtaLabel('ultimate')}
                          </div>
                          {!activeTier && !hadPriorSub && (
                            <span className="text-[9px] text-base-content/20">
                              7 days free, then $
                              {PRICING.ultimate[billingPeriod].perMonth}/mo
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Trust signals strip */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-8 flex flex-col items-center gap-3"
          >
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              {[
                { icon: Clock, text: '7-day free trial' },
                { icon: CreditCard, text: 'Cancel with one click' },
                { icon: Lock, text: 'No hidden fees' },
                { icon: Zap, text: 'Instant activation' },
              ].map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="flex items-center gap-1.5 text-[10px] text-base-content/30"
                >
                  <Icon size={11} className="text-primary/40 shrink-0" />
                  {text}
                </span>
              ))}
            </div>
            <p className="text-[9px] text-base-content/15">
              Free tier always included &middot; Payments via Stripe
            </p>
          </motion.div>
        </div>
      </section>

      {/* ================================================================
          COMPARISON TABLE
          ================================================================ */}
      <section className="relative overflow-hidden">
        <div className="container">
          {/* Section header */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Compare <span className="text-gradient-primary">Tiers</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Free is forever. Three tiers unlock more.
            </p>
          </motion.div>

          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="relative rounded-2xl border border-base-300/40 bg-base-100/60 backdrop-blur-md"
          >
            {/* ── Unlimited column full-column smoke ──
                 Grid is 1.4fr+1fr+1fr+1fr+1fr = 5.4fr.
                 Unlimited column = rightmost 1/5.4 ≈ 18.5% of table.
                 Smoke fills the full column and bleeds at edges. */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 1 }}
            >
              {/* Base wash — fills exact column bounds, breathing opacity */}
              <motion.div
                className="absolute inset-y-0 right-0 w-[18.5%]"
                style={{
                  background:
                    'linear-gradient(180deg, #34d39906 0%, #34d39914 25%, #34d39918 50%, #34d39914 75%, #34d39906 100%)',
                }}
                animate={{ opacity: [0.5, 0.85, 0.5] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Volumetric haze — wider than column, heavy blur, creates depth */}
              <motion.div
                className="absolute inset-y-[-8%] right-[-2%] w-[26%] blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse 80% 45% at 60% 50%, #34d39920 0%, #34d39908 50%, transparent 80%)',
                }}
                animate={{
                  scaleX: [1, 1.08, 1],
                  scaleY: [1, 1.04, 1],
                  opacity: [0.5, 0.9, 0.5],
                }}
                transition={{
                  duration: 6,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Left edge glow — vertical strip along column's left border */}
              <motion.div
                className="absolute inset-y-[5%] right-[16%] w-[5%] blur-2xl"
                style={{
                  background:
                    'linear-gradient(180deg, transparent 5%, #34d39918 25%, #34d39922 50%, #34d39918 75%, transparent 95%)',
                }}
                animate={{
                  opacity: [0.3, 0.7, 0.3],
                  x: [0, -8, 0],
                }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Rising plume — bottom to mid, drifts upward within column */}
              <motion.div
                className="absolute bottom-[-5%] right-[1%] w-[17%] h-[60%] rounded-full blur-2xl"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 60% at center bottom, #34d39925 0%, #34d39910 40%, transparent 75%)',
                }}
                animate={{
                  y: [0, -60, 0],
                  scaleX: [1, 1.3, 1],
                  opacity: [0.35, 0.8, 0.35],
                }}
                transition={{
                  duration: 7,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Descending plume — top to mid, fills upper column */}
              <motion.div
                className="absolute top-[-5%] right-[2%] w-[16%] h-[55%] rounded-full blur-2xl"
                style={{
                  background:
                    'radial-gradient(ellipse 65% 55% at center top, #34d39920 0%, #34d39908 45%, transparent 70%)',
                }}
                animate={{
                  y: [0, 40, 0],
                  scaleX: [1, 1.2, 1],
                  opacity: [0.25, 0.6, 0.25],
                }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 1.5,
                }}
              />

              {/* Mid-column turbulence — slow shape-shifting blob */}
              <motion.div
                className="absolute top-[20%] right-[0%] w-[19%] h-[60%] rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse 75% 50%, #34d39918 0%, transparent 65%)',
                }}
                animate={{
                  scaleX: [1, 1.25, 0.9, 1],
                  scaleY: [1, 0.9, 1.15, 1],
                  x: [0, -10, 6, 0],
                  opacity: [0.35, 0.65, 0.45, 0.35],
                }}
                transition={{
                  duration: 10,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Left drift tendril — leaks from column into Pro territory */}
              <motion.div
                className="absolute top-[15%] right-[12%] w-[20%] h-[40%] rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 45%, #34d39910 0%, transparent 65%)',
                }}
                animate={{
                  x: [0, -60, 0],
                  y: [0, 20, 0],
                  opacity: [0.06, 0.3, 0.06],
                }}
                transition={{
                  duration: 11,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Bright accent particle — upper column */}
              <motion.div
                className="absolute top-[25%] right-[5%] w-[50px] h-[50px] rounded-full blur-xl"
                style={{
                  background:
                    'radial-gradient(circle, #34d39938 0%, transparent 70%)',
                }}
                animate={{
                  y: [0, -20, 15, 0],
                  x: [0, -10, 5, 0],
                  opacity: [0, 0.7, 0.3, 0],
                }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Bright accent particle — lower column */}
              <motion.div
                className="absolute top-[65%] right-[10%] w-[40px] h-[40px] rounded-full blur-lg"
                style={{
                  background:
                    'radial-gradient(circle, #34d39930 0%, transparent 70%)',
                }}
                animate={{
                  y: [0, -15, 10, 0],
                  x: [0, 8, -12, 0],
                  opacity: [0, 0.5, 0.6, 0],
                }}
                transition={{
                  duration: 7,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 2,
                }}
              />

              {/* Top spill — smoke bleeds above the table */}
              <motion.div
                className="absolute -top-24 right-0 w-[24%] h-[200px] rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 60% at 55% 80%, #34d39918 0%, transparent 70%)',
                }}
                animate={{
                  scaleX: [1, 1.2, 1],
                  opacity: [0.2, 0.5, 0.2],
                }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />

              {/* Bottom spill — smoke bleeds below the table */}
              <motion.div
                className="absolute -bottom-20 right-0 w-[24%] h-[180px] rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse 70% 60% at 55% 20%, #34d39915 0%, transparent 70%)',
                }}
                animate={{
                  scaleX: [1.1, 1, 1.1],
                  opacity: [0.15, 0.45, 0.15],
                }}
                transition={{
                  duration: 9,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            </div>

            {/* Dot grid overlay */}
            <div
              className="absolute inset-0 opacity-[0.02] pointer-events-none rounded-2xl overflow-hidden"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, var(--grid-dot-primary) 1px, transparent 0)`,
                backgroundSize: '20px 20px',
              }}
            />

            {/* Watermark */}
            <TrendingUp
              size={160}
              strokeWidth={0.3}
              className="absolute -bottom-8 -right-8 text-base-content/[0.02] pointer-events-none"
            />

            {/* Table Header */}
            <div className="relative grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] border-b border-base-300/40">
              <div className="p-5 pl-6">
                <span className="text-[9px] text-base-content/25 uppercase tracking-wider font-medium">
                  Feature
                </span>
              </div>
              <div className="p-5 text-center border-l border-base-300/20">
                <span className="text-xs font-bold uppercase tracking-wider text-base-content/35">
                  Free
                </span>
              </div>
              <div className="p-5 text-center border-l border-info/15 bg-info/[0.03]">
                <span className="text-xs font-bold uppercase tracking-wider text-info inline-flex items-center gap-1.5">
                  <Rocket size={12} /> Uplink
                </span>
              </div>
              <div className="p-5 text-center border-l border-[#a78bfa]/15 bg-[#a78bfa]/[0.03]">
                <span className="text-xs font-bold uppercase tracking-wider text-[#a78bfa] inline-flex items-center gap-1.5">
                  <Gauge size={12} /> Pro
                </span>
              </div>
              <div className="relative p-5 text-center border-l border-primary/15 bg-primary/[0.04] rounded-tr-2xl">
                {/* Popular badge — absolute within header cell */}
                <motion.div
                  className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full"
                  initial={{ opacity: 0, y: 4 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5, duration: 0.4, ease: EASE }}
                >
                  <span className="bg-primary text-primary-content text-[7px] font-bold uppercase tracking-wider px-3 py-1 rounded-t-md block">
                    Popular
                  </span>
                </motion.div>
                <span className="text-xs font-bold uppercase tracking-wider text-primary inline-flex items-center gap-1.5">
                  <Crown size={12} /> Ultimate
                </span>
              </div>
            </div>

            {/* Table Rows */}
            {comparisonRows.map((row, i) => (
              <motion.div
                key={row.label}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.05,
                  duration: 0.4,
                  ease: EASE,
                }}
                className={`grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] ${i < comparisonRows.length - 1 ? 'border-b border-base-300/20' : ''} group hover:bg-base-200/40 transition-colors duration-200`}
              >
                <div className="p-4 pl-6 flex items-center gap-2">
                  <span className="text-xs text-base-content/55 font-medium">
                    {row.label}
                  </span>
                  {row.comingSoon && (
                    <span className="text-[9px] font-semibold text-warning/60 bg-warning/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Coming Soon
                    </span>
                  )}
                </div>
                <div className="p-4 flex items-center justify-center border-l border-base-300/20">
                  <span className="text-[11px] font-mono text-base-content/25">
                    {row.free}
                  </span>
                </div>
                <div className="p-4 flex items-center justify-center border-l border-info/10 bg-info/[0.015]">
                  {row.uplinkUp ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold font-mono text-info/80">
                      <Check size={11} className="text-info shrink-0" />
                      {row.uplink}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-base-content/25">
                      <Minus
                        size={9}
                        className="text-base-content/15 shrink-0"
                      />
                      {row.uplink}
                    </span>
                  )}
                </div>
                <div className="p-4 flex items-center justify-center border-l border-[#a78bfa]/10 bg-[#a78bfa]/[0.015]">
                  {row.proUp ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold font-mono text-[#a78bfa]/80">
                      <Check size={11} className="text-[#a78bfa] shrink-0" />
                      {row.pro}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-base-content/25">
                      <Minus
                        size={9}
                        className="text-base-content/15 shrink-0"
                      />
                      {row.pro}
                    </span>
                  )}
                </div>
                <div className="p-4 flex items-center justify-center border-l border-primary/10 bg-primary/[0.025] relative">
                  {/* Ethereal row glow for unlimited upgrades */}
                  {row.ultimateUp && (
                    <motion.div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent 0%, #34d39906 30%, #34d39910 70%, #34d39908 100%)',
                      }}
                      animate={{
                        opacity: [0.5, 1, 0.5],
                      }}
                      transition={{
                        duration: 3 + i * 0.3,
                        repeat: Infinity,
                        ease: 'easeInOut',
                      }}
                    />
                  )}
                  {row.ultimateUp ? (
                    <span className="relative inline-flex items-center gap-1.5 text-[11px] font-bold font-mono text-primary">
                      <motion.span
                        className="shrink-0"
                        whileInView={{ scale: [0, 1.2, 1] }}
                        viewport={{ once: true }}
                        transition={{
                          delay: 0.3 + i * 0.05,
                          duration: 0.4,
                          ease: EASE,
                        }}
                      >
                        <Check size={11} className="text-primary" />
                      </motion.span>
                      {row.ultimate}
                    </span>
                  ) : (
                    <span className="relative inline-flex items-center gap-1.5 text-[11px] font-mono text-base-content/25">
                      <Minus
                        size={9}
                        className="text-base-content/15 shrink-0"
                      />
                      {row.ultimate}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Table Footer */}
            <div className="border-t border-base-300/30 bg-base-200/30 px-6 py-4 flex items-center justify-between">
              <span className="text-[9px] text-base-content/20">
                Per-account &middot; Free tier always included &middot; Upgrade
                anytime
              </span>
              <motion.span
                className="text-[9px] text-primary/40 font-mono"
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                signal:locked
              </motion.span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ================================================================
          WHAT YOU GET — TIER SHOWCASES
          ================================================================ */}
      <section className="relative overflow-hidden">
        {/* Tinted background */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

        <div className="container relative z-10">
          {/* Section header */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              What You <span className="text-gradient-primary">Get</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Three tiers, one mission: total coverage
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {tierShowcases.map((tier, tierIdx) => (
              <motion.div
                key={tier.tier}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: tierIdx * 0.15,
                  duration: 0.6,
                  ease: EASE,
                }}
                className={`group relative rounded-2xl overflow-hidden ${
                  tier.tier === 'ultimate'
                    ? 'border border-primary/20'
                    : tier.tier === 'pro'
                      ? 'border border-[#a78bfa]/20'
                      : 'border border-base-300/30'
                }`}
              >
                {/* Animated border glow for Unlimited */}
                {tier.tier === 'ultimate' && (
                  <motion.div
                    className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/25 via-primary/8 to-primary/3 -z-10"
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{
                      duration: 4,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                )}

                <div
                  className={`relative p-7 md:p-8 h-full flex flex-col ${
                    tier.tier === 'ultimate' ? '' : 'bg-base-200/40'
                  }`}
                >
                  {/* Background layer — separate for Unlimited so smoke sits above it */}
                  {tier.tier === 'ultimate' && (
                    <div className="absolute inset-0 bg-base-200/60 rounded-2xl pointer-events-none" />
                  )}

                  {/* Top accent line */}
                  <div
                    className="absolute top-0 left-0 right-0 h-px"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${tier.hex} 50%, transparent)`,
                    }}
                  />

                  {/* Corner dot grid */}
                  <div
                    className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] text-base-content"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle, currentColor 1px, transparent 1px)',
                      backgroundSize: '8px 8px',
                    }}
                  />

                  {/* Ambient glow */}
                  <motion.div
                    className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none blur-3xl"
                    style={{ background: `${tier.hex}08` }}
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 1, 0.5],
                    }}
                    transition={{
                      duration: 6,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: tierIdx * 2,
                    }}
                  />

                  {/* Watermark */}
                  <tier.Icon
                    size={120}
                    strokeWidth={0.3}
                    className="absolute -bottom-6 -right-6 text-base-content/[0.02] pointer-events-none"
                  />

                  {/* "Recommended" badge for Unlimited */}
                  {tier.tier === 'ultimate' && (
                    <div
                      className="absolute top-0 right-0"
                      style={{ zIndex: 20 }}
                    >
                      <div className="bg-primary text-primary-content text-[7px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-bl-lg">
                        Recommended
                      </div>
                    </div>
                  )}

                  {/* ── Ethereal smoke (Unlimited only) — above background, below content ── */}
                  {tier.tier === 'ultimate' && (
                    <div
                      className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl"
                      style={{ zIndex: 1 }}
                    >
                      {/* Base wash */}
                      <motion.div
                        className="absolute inset-0"
                        style={{
                          background:
                            'linear-gradient(135deg, #34d39915 0%, #34d39928 40%, #34d39915 60%, #34d39925 100%)',
                        }}
                        animate={{ opacity: [0.5, 0.9, 0.5] }}
                        transition={{
                          duration: 4.5,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />

                      {/* Left bloom */}
                      <motion.div
                        className="absolute top-[10%] left-[-5%] w-[55%] h-[60%] rounded-full blur-3xl"
                        style={{
                          background:
                            'radial-gradient(ellipse 75% 60%, #34d39930 0%, transparent 70%)',
                        }}
                        animate={{
                          x: [0, 15, 0],
                          scaleY: [1, 1.15, 1],
                          opacity: [0.4, 0.75, 0.4],
                        }}
                        transition={{
                          duration: 7,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />

                      {/* Right bloom */}
                      <motion.div
                        className="absolute bottom-[5%] right-[-3%] w-[50%] h-[55%] rounded-full blur-3xl"
                        style={{
                          background:
                            'radial-gradient(ellipse 70% 55%, #34d39928 0%, transparent 65%)',
                        }}
                        animate={{
                          x: [0, -12, 0],
                          y: [0, -20, 0],
                          opacity: [0.35, 0.7, 0.35],
                        }}
                        transition={{
                          duration: 8,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: 1,
                        }}
                      />

                      {/* Center turbulence */}
                      <motion.div
                        className="absolute top-[30%] left-[20%] w-[60%] h-[45%] rounded-full blur-3xl"
                        style={{
                          background:
                            'radial-gradient(ellipse 70% 50%, #34d39922 0%, transparent 60%)',
                        }}
                        animate={{
                          scaleX: [1, 1.2, 0.9, 1],
                          scaleY: [1, 0.9, 1.15, 1],
                          opacity: [0.3, 0.65, 0.45, 0.3],
                        }}
                        transition={{
                          duration: 10,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />

                      {/* Rising tendril */}
                      <motion.div
                        className="absolute bottom-[-8%] left-[30%] w-[45%] h-[50%] rounded-full blur-2xl"
                        style={{
                          background:
                            'radial-gradient(ellipse 65% 60% at center bottom, #34d39935 0%, transparent 70%)',
                        }}
                        animate={{
                          y: [0, -40, 0],
                          scaleX: [1, 1.3, 1],
                          opacity: [0.35, 0.75, 0.35],
                        }}
                        transition={{
                          duration: 7,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: 2,
                        }}
                      />

                      {/* Accent particles */}
                      <motion.div
                        className="absolute top-[22%] right-[18%] w-[55px] h-[55px] rounded-full blur-xl"
                        style={{
                          background:
                            'radial-gradient(circle, #34d39950 0%, transparent 70%)',
                        }}
                        animate={{
                          y: [0, -15, 10, 0],
                          opacity: [0, 0.7, 0.35, 0],
                        }}
                        transition={{
                          duration: 5,
                          repeat: Infinity,
                          ease: 'easeInOut',
                        }}
                      />
                      <motion.div
                        className="absolute top-[60%] left-[12%] w-[45px] h-[45px] rounded-full blur-lg"
                        style={{
                          background:
                            'radial-gradient(circle, #34d39945 0%, transparent 70%)',
                        }}
                        animate={{
                          y: [0, -12, 0],
                          opacity: [0, 0.6, 0],
                        }}
                        transition={{
                          duration: 4.5,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: 3,
                        }}
                      />
                    </div>
                  )}

                  <div className="relative z-10 flex flex-col flex-1">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-6">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{
                          background: `${tier.hex}15`,
                          boxShadow: `0 0 24px ${tier.hex}15, 0 0 0 1px ${tier.hex}20`,
                        }}
                      >
                        <tier.Icon size={18} className="text-base-content/80" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-base-content">
                          {tier.name}
                        </h3>
                        <p className="text-[10px] text-base-content/35">
                          {tier.tagline}
                        </p>
                      </div>
                    </div>

                    {/* Delivery highlight */}
                    <div
                      className="mb-5 p-3.5 rounded-xl border"
                      style={{
                        background: `${tier.hex}06`,
                        borderColor: `${tier.hex}15`,
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <Zap
                          size={14}
                          style={{ color: tier.hex }}
                          className="shrink-0"
                        />
                        <div>
                          <span
                            className="text-xs font-bold"
                            style={{ color: tier.hex }}
                          >
                            {tier.delivery}
                          </span>
                          <span className="text-[10px] text-base-content/30 ml-2">
                            {tier.deliverySub}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Use case — differentiates from feature list */}
                    <p className="text-xs text-base-content/40 leading-relaxed mb-6 italic">
                      &ldquo;{tier.useCase}&rdquo;
                    </p>

                    {/* Feature list */}
                    <div className="space-y-3">
                      {tier.features.map((feature, i) => (
                        <motion.div
                          key={feature}
                          style={{ opacity: 0 }}
                          initial={{ opacity: 0, x: -8 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{
                            delay: 0.2 + tierIdx * 0.1 + i * 0.05,
                            duration: 0.35,
                            ease: EASE,
                          }}
                          className="flex items-center gap-2.5"
                        >
                          <Check
                            size={12}
                            className="shrink-0"
                            style={{ color: tier.hex }}
                          />
                          <span className="text-xs text-base-content/55">
                            {feature}
                          </span>
                        </motion.div>
                      ))}
                    </div>

                    {/* CTA — mt-auto pushes to bottom, pt-7 guarantees min gap */}
                    <div className="mt-auto pt-7">
                      <button
                        type="button"
                        onClick={() => handleSelectPlan('annual', tier.tier)}
                        className={`w-full py-2.5 text-center text-[10px] font-semibold rounded-lg transition-colors ${
                          tier.tier === 'ultimate'
                            ? 'bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 hover:border-primary/50'
                            : tier.tier === 'pro'
                              ? 'border border-[#a78bfa]/20 text-[#a78bfa]/60 hover:border-[#a78bfa]/40 hover:text-[#a78bfa]/80'
                              : 'border border-info/20 text-info/60 hover:border-info/40 hover:text-info/80'
                        }`}
                      >
                        {hadPriorSub ? 'Subscribe' : 'Start Free Trial'}
                      </button>
                      {!hadPriorSub && (
                        <p className="text-center mt-1.5 text-[9px] text-base-content/20">
                          {tier.tier === 'ultimate'
                            ? '7 days free, then $33.33/mo'
                            : tier.tier === 'pro'
                              ? '7 days free, then $16.67/mo'
                              : '7 days free, then $6.67/mo'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          START RISK-FREE — CONVERSION
          ================================================================ */}
      <section className="relative overflow-hidden">
        {/* Top border accent */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />

        <div className="container">
          {/* Section header */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: EASE }}
            className="text-center mb-14"
          >
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-[0.95] mb-4">
              Start <span className="text-gradient-primary">Risk-Free</span>
            </h2>
            <p className="text-sm text-base-content/40 max-w-lg mx-auto leading-relaxed">
              Try any plan free for 7 days. If it doesn&apos;t fit, cancel
              before the trial ends and pay nothing.
            </p>
          </motion.div>

          {/* 4-card grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {/* Free Trial — spans full width for emphasis */}
            <motion.div
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.05, ease: EASE }}
              className="relative md:col-span-2 bg-base-200/40 border border-primary/15 rounded-xl p-6 overflow-hidden"
            >
              {/* Top accent line */}
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, #34d399 50%, transparent)',
                }}
              />
              {/* Corner dot grid */}
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.03] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              {/* Watermark icon */}
              <CreditCard
                size={100}
                strokeWidth={0.3}
                className="absolute -bottom-3 -right-3 text-base-content/[0.02] pointer-events-none"
              />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-3 shrink-0">
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center"
                    style={{
                      background: '#34d39915',
                      boxShadow: '0 0 20px #34d39915, 0 0 0 1px #34d39920',
                    }}
                  >
                    <CreditCard size={16} className="text-base-content/80" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-base-content">
                      7-Day Free Trial
                    </h3>
                    <p className="text-[10px] text-base-content/35">
                      Card required, cancel anytime
                    </p>
                  </div>
                </div>
                <div className="hidden md:block w-px h-8 bg-base-300/30 shrink-0" />
                <p className="text-xs text-base-content/45 leading-relaxed">
                  Every paid tier starts with a 7-day free trial. Add a card
                  during onboarding, try the full feature set, and only pay if
                  you stay. Cancel before the trial ends and you won&apos;t be
                  charged &mdash; no questions asked.
                </p>
              </div>
            </motion.div>

            {/* Soft Limits */}
            <motion.div
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.15, ease: EASE }}
              className="relative bg-base-200/40 border border-base-300/30 rounded-xl p-6 overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, #00b8db 50%, transparent)',
                }}
              />
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.03] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              <Bell
                size={100}
                strokeWidth={0.3}
                className="absolute -bottom-3 -right-3 text-base-content/[0.02] pointer-events-none"
              />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center"
                    style={{
                      background: '#00b8db15',
                      boxShadow: '0 0 20px #00b8db15, 0 0 0 1px #00b8db20',
                    }}
                  >
                    <Bell size={16} className="text-base-content/80" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-base-content">
                      Gentle Nudges
                    </h3>
                    <p className="text-[10px] text-base-content/35">
                      In-app prompts at your limits
                    </p>
                  </div>
                </div>
                <p className="text-xs text-base-content/45 leading-relaxed">
                  When you hit a free tier cap — like trying to add an 11th
                  symbol or 6th RSS feed — the app shows a quiet prompt with
                  what the next tier unlocks. No pop-ups, no dark patterns. Just
                  context when it matters.
                </p>
              </div>
            </motion.div>

            {/* Locked Features Visible */}
            <motion.div
              style={{ opacity: 0 }}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
              className="relative bg-base-200/40 border border-base-300/30 rounded-xl p-6 overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{
                  background:
                    'linear-gradient(90deg, transparent, #f59e0b 50%, transparent)',
                }}
              />
              <div
                className="absolute top-0 right-0 w-20 h-20 opacity-[0.03] text-base-content"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, currentColor 1px, transparent 1px)',
                  backgroundSize: '8px 8px',
                }}
              />
              <Eye
                size={100}
                strokeWidth={0.3}
                className="absolute -bottom-3 -right-3 text-base-content/[0.02] pointer-events-none"
              />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center"
                    style={{
                      background: '#f59e0b15',
                      boxShadow: '0 0 20px #f59e0b15, 0 0 0 1px #f59e0b20',
                    }}
                  >
                    <Lock size={16} className="text-base-content/80" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-base-content">
                      See What You're Missing
                    </h3>
                    <p className="text-[10px] text-base-content/35">
                      Premium features ghosted on Free
                    </p>
                  </div>
                </div>
                <p className="text-xs text-base-content/45 leading-relaxed">
                  Locked features aren't hidden — they're visible but ghosted in
                  the UI. Custom alerts, feed profiles, webhooks, and export all
                  appear in their natural positions so you can see exactly what
                  upgrading unlocks before you decide.
                </p>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Bottom border */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ================================================================
          FAQ — TIER BREAKDOWN
          ================================================================ */}
      <FAQSection
        items={uplinkFAQ}
        title="Tiers"
        titleHighlight="Explained"
        subtitle="Everything in the comparison table, broken down."
      />

      {/* ================================================================
          BOTTOM CTA
          ================================================================ */}
      <BottomCTA
        handleSelectPlan={handleSelectPlan}
        hadPriorSub={hadPriorSub}
      />
    </div>
  )
}
