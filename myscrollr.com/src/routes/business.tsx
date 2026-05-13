import { createFileRoute } from '@tanstack/react-router'
import { motion, useInView, useMotionValue } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bitcoin,
  Briefcase,
  Building2,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  Dice5,
  Eye,
  FileSignature,
  GitFork,
  Github,
  Headphones,
  LayoutGrid,
  Loader2,
  Mail,
  MessageSquare,
  MonitorPlay,
  Newspaper,
  Palette,
  Radio,
  Rocket,
  Send,
  Server,
  Star,
  Trophy,
} from 'lucide-react'
import type { FormEvent } from 'react'

import type { BusinessUseCase } from '@/api/client'
import type { FAQItem } from '@/components/landing/FAQSection'
import type { BackdropBeam } from '@/components/landing/_ConvergenceBackdrop'
import { businessApi } from '@/api/client'
import { FAQSection } from '@/components/landing/FAQSection'
import { ConvergenceBackdrop } from '@/components/landing/_ConvergenceBackdrop'
import { usePageMeta } from '@/lib/usePageMeta'
import { seededRandom } from '@/lib/seededRandom'
import { useGitHubStats } from '@/hooks/useGitHubStats'

// ── Constants ───────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const
const CONTACT_EMAIL = 'enterprise@myscrollr.com'
const REPO = 'brandon-relentnet/myscrollr'

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute('/business')({
  component: BusinessPage,
})

// ── Audience cards (3x2 grid) ───────────────────────────────────

interface Audience {
  id: string
  icon: typeof MonitorPlay
  name: string
  copy: string
  accent: {
    text: string
    ring: string
    glow: string
    gradient: string
  }
}

const AUDIENCES: Array<Audience> = [
  {
    id: 'sports-bars',
    icon: MonitorPlay,
    name: 'Sports bars & restaurants',
    copy: 'Every TV in the room runs live scores, news, and your branding. Better than ESPN scrollers, fully under your control.',
    accent: {
      text: 'text-primary',
      ring: 'rgba(52,211,153,0.25)',
      glow: 'rgba(52,211,153,0.12)',
      gradient: 'rgba(52,211,153,0.06)',
    },
  },
  {
    id: 'brokerages',
    icon: Briefcase,
    name: 'Brokerages & financial advisors',
    copy: 'A branded desktop ticker for clients. Real-time quotes, custom watchlists, your logo, your colors, your domain.',
    accent: {
      text: 'text-info',
      ring: 'rgba(0,212,255,0.25)',
      glow: 'rgba(0,212,255,0.12)',
      gradient: 'rgba(0,212,255,0.06)',
    },
  },
  {
    id: 'fantasy',
    icon: Trophy,
    name: 'Fantasy sports platforms',
    copy: 'White-label the Scrollr desktop app as your platform’s companion. Native ticker, your branding, your standings.',
    accent: {
      text: 'text-secondary',
      ring: 'rgba(255,71,87,0.25)',
      glow: 'rgba(255,71,87,0.12)',
      gradient: 'rgba(255,71,87,0.06)',
    },
  },
  {
    id: 'sportsbooks',
    icon: Dice5,
    name: 'Sportsbooks & betting affiliates',
    copy: 'Stay on a user’s desktop without a tab open. Odds, scores, and your offers — visible the moment they matter.',
    accent: {
      text: 'text-accent',
      ring: 'rgba(167,139,250,0.25)',
      glow: 'rgba(167,139,250,0.12)',
      gradient: 'rgba(167,139,250,0.06)',
    },
  },
  {
    id: 'crypto',
    icon: Bitcoin,
    name: 'Crypto exchanges',
    copy: 'A native desktop price ticker for power users. Custom symbol list, your exchange’s pairs, your branding.',
    accent: {
      text: 'text-warning',
      ring: 'rgba(251,191,36,0.25)',
      glow: 'rgba(251,191,36,0.12)',
      gradient: 'rgba(251,191,36,0.06)',
    },
  },
  {
    id: 'news',
    icon: Newspaper,
    name: 'News aggregators & publishers',
    copy: 'A desktop distribution channel for your headlines. Always on, always visible, never another tab to open.',
    accent: {
      text: 'text-success',
      ring: 'rgba(45,212,191,0.25)',
      glow: 'rgba(45,212,191,0.12)',
      gradient: 'rgba(45,212,191,0.06)',
    },
  },
]

// ── "What you get" items ────────────────────────────────────────

interface Capability {
  icon: typeof Palette
  title: string
  body: string
}

const CAPABILITIES: Array<Capability> = [
  {
    icon: Palette,
    title: 'Custom branding',
    body: 'Logo, colors, fonts, domain. Down to the app icon.',
  },
  {
    icon: LayoutGrid,
    title: 'Multi-display deployment',
    body: 'Fleet-wide config push. One bar, one brokerage, one set of TVs.',
  },
  {
    icon: Server,
    title: 'Self-hosted or managed',
    body: 'Run the whole stack in your environment, or let us host it. Your call.',
  },
  {
    icon: Headphones,
    title: 'Dedicated support & SLA',
    body: 'Direct Slack or email channel. Response times in writing.',
  },
  {
    icon: Code2,
    title: 'API access',
    body: 'Programmatic read/write to your deployment. Integrate with your stack.',
  },
  {
    icon: FileSignature,
    title: 'NDA-friendly',
    body: 'Mutual NDA before the scoping call. Yours or ours.',
  },
]

// ── 3-step process ─────────────────────────────────────────────

interface Step {
  title: string
  body: string
}

const STEPS: Array<Step> = [
  {
    title: 'Contact',
    body: 'Tell us what you want to build. We respond within one business day.',
  },
  {
    title: 'Scope',
    body: 'A 30-minute call. We send a written scope and quote within three business days.',
  },
  {
    title: 'Deploy',
    body: 'Build, brand, ship. Most deployments go live in 2-4 weeks. We stay engaged for support and changes.',
  },
]

// ── "Why Scrollr" trust principles ─────────────────────────────

interface Principle {
  icon: typeof Rocket
  title: string
  body: string
  accent: {
    text: string
    ring: string
    glow: string
    gradient: string
  }
}

const PRINCIPLES: Array<Principle> = [
  {
    icon: Rocket,
    title: 'Already shipping',
    body: 'Real consumers, real installs, real revenue. Not a prototype.',
    accent: {
      text: 'text-primary',
      ring: 'rgba(52,211,153,0.25)',
      glow: 'rgba(52,211,153,0.12)',
      gradient: 'rgba(52,211,153,0.06)',
    },
  },
  {
    icon: Eye,
    title: 'Open source, AGPL-3.0',
    body: 'Audit every line. No black box, no hidden telemetry.',
    accent: {
      text: 'text-info',
      ring: 'rgba(0,212,255,0.25)',
      glow: 'rgba(0,212,255,0.12)',
      gradient: 'rgba(0,212,255,0.06)',
    },
  },
  {
    icon: Cpu,
    title: 'Native, not Electron',
    body: 'Tauri-based. ~15MB binary, sub-100MB resident memory. Runs on macOS, Windows, Linux.',
    accent: {
      text: 'text-secondary',
      ring: 'rgba(255,71,87,0.25)',
      glow: 'rgba(255,71,87,0.12)',
      gradient: 'rgba(255,71,87,0.06)',
    },
  },
  {
    icon: Radio,
    title: 'Real-time by default',
    body: 'Server-Sent Events backbone. Sub-second updates without polling.',
    accent: {
      text: 'text-accent',
      ring: 'rgba(167,139,250,0.25)',
      glow: 'rgba(167,139,250,0.12)',
      gradient: 'rgba(167,139,250,0.06)',
    },
  },
]

// ── FAQ items ──────────────────────────────────────────────────

const BUSINESS_FAQ: Array<FAQItem> = [
  {
    icon: Server,
    question: 'Can we self-host?',
    highlight:
      'Yes — the full stack runs in your environment. We document it and help you stand it up.',
    answer:
      'The full stack — desktop app, Go API, Rust ingestion services, Postgres, Redis — runs in your environment. We hand you the keys: deployment scripts, Docker Compose files, runbooks, and a hand-off call. We stay reachable after the handover.',
    accent: 'emerald',
  },
  {
    icon: FileSignature,
    question: 'Do you sign NDAs?',
    highlight: 'Yes. Mutual NDA before scoping calls. Standard form or yours.',
    answer:
      'We sign mutual NDAs before the scoping call so you can speak freely about deployment plans, integrations, and customers. We have a standard one-page form, or we can sign yours. No legal back-and-forth before the first call.',
    accent: 'sky',
  },
  {
    icon: Headphones,
    question: 'What’s the SLA?',
    highlight:
      'Discussed per contract. Response times, uptime targets, and a direct channel — in writing.',
    answer:
      'Typical engagements include defined response times for incidents (often P1 < 1hr, P2 < 4hrs business hours), monthly uptime targets, scheduled maintenance windows, and a direct Slack channel with the engineers building your deployment. We don’t pretend "enterprise-grade" means anything until it’s in writing.',
    accent: 'violet',
  },
  {
    icon: Palette,
    question: 'Can we fully white-label?',
    highlight:
      'Yes. Logo, colors, fonts, app name, domain, icon — your brand, not ours.',
    answer:
      'Your customers see your brand, not ours. Logo, colors, fonts, app name, app icon, install bundle identity, custom domain on the API. The codebase is AGPL-3.0, so the white-label is delivered as a separately-licensed build under a commercial license that removes the copyleft requirement for distribution.',
    accent: 'rose',
  },
  {
    icon: Rocket,
    question: 'How long does deployment take?',
    highlight:
      'Most engagements ship in 2-4 weeks. Timeline is committed in writing.',
    answer:
      'A typical managed deployment with custom branding, two channels, and basic integrations ships in 2-4 weeks from kickoff. Self-hosted or heavy customization (new data sources, custom UI components, complex SSO) can take 6-12 weeks. The exact timeline is committed in the scope document before you pay anything.',
    accent: 'orange',
  },
  {
    icon: Code2,
    question: 'Do you offer perpetual or one-time licensing?',
    highlight:
      'Yes, for self-hosted. Monthly is the default for managed deployments.',
    answer:
      'For self-hosted deployments, we offer perpetual licenses with optional annual maintenance for updates and support. For managed deployments, monthly billing is the default because we’re running the infrastructure. We’re flexible — bring us your procurement constraints and we’ll work with them.',
    accent: 'fuchsia',
  },
]

// ── Use-case dropdown options ──────────────────────────────────

const USE_CASE_OPTIONS = [
  { value: '', label: 'Select your use case' },
  { value: 'sports-bars', label: 'Sports bar / restaurant' },
  { value: 'brokerages', label: 'Brokerage / financial advisor' },
  { value: 'fantasy', label: 'Fantasy sports platform' },
  { value: 'sportsbooks', label: 'Sportsbook / betting affiliate' },
  { value: 'crypto', label: 'Crypto exchange' },
  { value: 'news', label: 'News aggregator / publisher' },
  { value: 'other', label: 'Other' },
] as const

// ── CTA Particles ──────────────────────────────────────────────

const CTA_PARTICLES = Array.from({ length: 12 }, (_, i) => {
  const random = seededRandom(i * 7919 + 31337)
  return {
    id: i,
    x: random() * 100,
    y: random() * 100,
    size: random() * 3 + 1.5,
    delay: random() * 5,
    duration: random() * 6 + 8,
    color: i % 2 === 0 ? '#34d399' : '#00b8db',
  }
})

/* ══════════════════════════════════════════════════════════════════
   HERO
   ══════════════════════════════════════════════════════════════════ */

function BusinessHero() {
  const scrollToForm = () => {
    document
      .getElementById('contact-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const scrollToAudiences = () => {
    document
      .getElementById('audiences')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="relative pt-32 pb-24 lg:pt-40 lg:pb-32 overflow-hidden">
      {/* ── Background system ───────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Fine dot matrix */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, var(--grid-dot-primary) 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Single primary orbital glow — institutional, not flashy */}
        <motion.div
          className="absolute top-[-15%] right-[-5%] w-[700px] h-[700px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, var(--glow-primary-subtle) 0%, transparent 70%)',
          }}
          animate={{
            scale: [1, 1.06, 1],
            opacity: [0.5, 0.9, 0.5],
          }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Top border accent */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="container relative z-10">
        {/* Badge row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex items-center gap-4 mb-10"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/8 text-primary text-[10px] font-bold rounded-lg border border-primary/15 uppercase tracking-wide">
            <Building2 size={12} />
            For business
          </span>
          <span className="h-px w-16 bg-gradient-to-r from-base-300 to-transparent" />
          <span className="text-[10px] text-base-content/25">
            Branded · Deployed · Supported
          </span>
        </motion.div>

        {/* Two-column: text left, monitor grid right */}
        <div className="flex flex-col-reverse lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left — headline + CTAs */}
          <div className="flex-1 min-w-0 w-full">
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
              className="text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-[0.9] mb-8"
            >
              <span className="block">Scrollr for your</span>
              <span className="relative inline-block">
                <span className="text-gradient-primary">business.</span>
                <motion.span
                  className="absolute -bottom-2 left-0 right-0 h-[3px] bg-gradient-to-r from-primary via-primary/60 to-transparent origin-left"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.8, delay: 0.8, ease: EASE }}
                />
              </span>
            </motion.h1>

            {/* Sub-copy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.35, ease: EASE }}
              className="flex items-start gap-3 mb-10 max-w-xl"
            >
              <span className="text-primary/30 font-mono text-sm mt-0.5 select-none shrink-0">
                $
              </span>
              <p className="text-base sm:text-lg text-base-content/50 leading-relaxed">
                The same real-time ticker thousands already run — branded,
                deployed, and supported for your team, bar, brokerage, or
                platform.
              </p>
            </motion.div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5, ease: EASE }}
              className="flex flex-wrap items-center gap-4"
            >
              <button
                type="button"
                onClick={scrollToForm}
                className="btn btn-pulse btn-lg gap-2.5"
              >
                <Mail size={14} />
                Talk to us
              </button>

              <button
                type="button"
                onClick={scrollToAudiences}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-base-300 bg-base-200/50 px-6 py-3 text-sm font-semibold text-base-content hover:bg-base-300 transition-colors backdrop-blur-sm"
              >
                See what’s possible
                <ArrowRight size={14} />
              </button>
            </motion.div>

            {/* Trust microcopy */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.7, ease: EASE }}
              className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-base-content/35"
            >
              {[
                'One business day response',
                'Mutual NDA on request',
                'Self-hosted available',
              ].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                  {item}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right — deployment fan-out visual */}
          <div className="hidden lg:flex items-center justify-center w-[420px] shrink-0">
            <DeploymentFanout />
          </div>
        </div>
      </div>

      {/* Bottom border */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
    </section>
  )
}

/* ── Deployment fan-out: 2x2 monitor grid with central node ───────────
 *
 * Four stylized monitor screens arranged in a grid, each showing the same
 * faint ticker bar but in a different accent color — suggesting the same
 * Scrollr platform deployed under different brands. Subtle pulse animation
 * radiates outward from the center node.
 */
function DeploymentFanout() {
  const monitors = useMemo(
    () => [
      { x: 0, y: 0, accent: '#34d399', delay: 0.4 },
      { x: 1, y: 0, accent: '#00b8db', delay: 0.55 },
      { x: 0, y: 1, accent: '#a78bfa', delay: 0.7 },
      { x: 1, y: 1, accent: '#fbbf24', delay: 0.85 },
    ],
    [],
  )

  return (
    <div className="relative w-[360px] h-[360px]">
      {/* Ambient orb behind everything */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at center, rgba(52,211,153,0.06) 0%, transparent 65%)',
          filter: 'blur(20px)',
        }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Center pulse rings */}
      {[0, 1].map((i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15 pointer-events-none"
          style={{ width: 100, height: 100 }}
          animate={{ scale: [0.6, 2.4], opacity: [0.4, 0] }}
          transition={{
            delay: 1 + i * 1.4,
            duration: 3,
            ease: 'easeOut',
            repeat: Infinity,
            repeatDelay: 1.2,
          }}
        />
      ))}

      {/* Monitor grid */}
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-6 p-4">
        {monitors.map((m, i) => (
          <MonitorTile
            key={i}
            accent={m.accent}
            delay={m.delay}
            mirrorX={m.x === 1}
            mirrorY={m.y === 1}
          />
        ))}
      </div>

      {/* Central hub icon */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.6, ease: EASE }}
      >
        <div
          className="relative w-14 h-14 rounded-2xl flex items-center justify-center backdrop-blur-md"
          style={{
            background: 'rgba(52,211,153,0.08)',
            boxShadow:
              '0 0 30px rgba(52,211,153,0.18), 0 0 0 1px rgba(52,211,153,0.25)',
          }}
        >
          <Building2 size={22} className="text-primary/80" />

          {/* Online indicator */}
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
          </span>
        </div>
      </motion.div>

      {/* Corner labels — anchor the visual to the 'fleet' idea */}
      <motion.span
        className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold uppercase tracking-widest text-base-content/30 bg-base-100/80 backdrop-blur-sm px-3 py-1 rounded-full border border-base-300/30"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.3, duration: 0.5, ease: EASE }}
      >
        One platform · Many deployments
      </motion.span>
    </div>
  )
}

function MonitorTile({
  accent,
  delay,
  mirrorX,
  mirrorY,
}: {
  accent: string
  delay: number
  mirrorX: boolean
  mirrorY: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: EASE }}
      className="relative rounded-lg border bg-base-200/40 overflow-hidden backdrop-blur-sm"
      style={{
        borderColor: `${accent}30`,
        boxShadow: `0 0 24px ${accent}10, inset 0 0 12px ${accent}06`,
      }}
    >
      {/* Title bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-base-300/20">
        <div
          className="w-1.5 h-1.5 rounded-full opacity-40"
          style={{ backgroundColor: accent }}
        />
        <div
          className="w-1.5 h-1.5 rounded-full opacity-25"
          style={{ backgroundColor: accent }}
        />
        <div
          className="w-1.5 h-1.5 rounded-full opacity-15"
          style={{ backgroundColor: accent }}
        />
      </div>

      {/* Content lines */}
      <div className="p-2.5 space-y-1.5">
        <div
          className="h-1 rounded"
          style={{
            backgroundColor: `${accent}25`,
            width: mirrorX ? '60%' : '75%',
          }}
        />
        <div
          className="h-1 rounded bg-base-content/8"
          style={{ width: mirrorY ? '45%' : '55%' }}
        />
        <div
          className="h-1 rounded bg-base-content/5"
          style={{ width: '40%' }}
        />
      </div>

      {/* Ticker bar — pinned to bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 border-t flex items-center gap-1.5 px-2 py-1.5"
        style={{ borderColor: `${accent}25`, background: `${accent}08` }}
      >
        {/* Live dot */}
        <motion.span
          className="relative inline-flex h-1 w-1 rounded-full"
          style={{ backgroundColor: accent }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Faux ticker chips */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-1.5 rounded-sm"
            style={{
              backgroundColor: `${accent}25`,
              width: 12 + i * 4,
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   AUDIENCES — 6-card grid (3x2)
   ══════════════════════════════════════════════════════════════════ */

function AudiencesSection() {
  return (
    <section id="audiences" className="relative py-24 lg:py-32 scroll-mt-20">
      <div className="container relative">
        {/* Header */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-14 lg:mb-18"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
            Who it’s <span className="text-gradient-primary">for</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-lg">
            Six places we already see Scrollr making sense. There are more.
          </p>
        </motion.div>

        {/* 3x2 grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
          {AUDIENCES.map((aud, i) => (
            <AudienceCard key={aud.id} audience={aud} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function AudienceCard({
  audience,
  index,
}: {
  audience: Audience
  index: number
}) {
  const Icon = audience.icon
  const { accent } = audience

  return (
    <motion.div
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        delay: 0.06 + (index % 3) * 0.08,
        duration: 0.5,
        ease: EASE,
      }}
      className="relative rounded-2xl bg-base-200/40 border border-base-300/25 p-6 sm:p-7 overflow-hidden h-full"
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-6 right-6 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent.ring} 50%, transparent)`,
        }}
      />

      {/* Ambient gradient orb */}
      <div
        className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none blur-3xl"
        style={{ background: accent.gradient }}
      />

      {/* Watermark icon */}
      <Icon
        size={130}
        strokeWidth={0.4}
        className="absolute -bottom-5 -right-5 text-base-content/[0.025] pointer-events-none select-none"
      />

      {/* Corner dot grid */}
      <div
        className="absolute bottom-4 right-4 w-14 h-14 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '8px 8px',
        }}
      />

      {/* Inline header — icon + title in a row */}
      <div className="relative flex items-center gap-3 mb-4">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: accent.glow,
            boxShadow: `0 0 20px ${accent.glow}, 0 0 0 1px ${accent.ring}`,
          }}
        >
          <Icon size={20} className="text-base-content/80" />
        </div>
        <h3
          className={`text-[15px] font-bold leading-snug ${accent.text} min-w-0`}
        >
          {audience.name}
        </h3>
      </div>

      {/* Body */}
      <p className="relative text-sm text-base-content/50 leading-relaxed">
        {audience.copy}
      </p>
    </motion.div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   WHAT YOU GET — 6 B2B capabilities
   ══════════════════════════════════════════════════════════════════ */

function CapabilitiesSection() {
  return (
    <section className="relative py-24 lg:py-32">
      {/* Background band */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

      <div className="container relative">
        {/* Header */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-14 lg:mb-18"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
            What you <span className="text-gradient-primary">get</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-lg">
            The features that matter when you’re deploying for a team, a venue,
            or a customer base.
          </p>
        </motion.div>

        {/* 2-col grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 max-w-5xl mx-auto">
          {CAPABILITIES.map((cap, i) => (
            <CapabilityRow key={cap.title} capability={cap} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

function CapabilityRow({
  capability,
  index,
}: {
  capability: Capability
  index: number
}) {
  const Icon = capability.icon

  return (
    <motion.div
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        delay: 0.06 + index * 0.06,
        duration: 0.5,
        ease: EASE,
      }}
      className="relative flex items-start gap-4 rounded-xl bg-base-200/30 border border-base-300/20 p-5 sm:p-6 overflow-hidden"
    >
      {/* Icon badge */}
      <div className="shrink-0">
        <div className="w-10 h-10 rounded-lg bg-primary/8 border border-primary/15 flex items-center justify-center">
          <Icon size={18} className="text-primary" />
        </div>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-base-content mb-1">
          {capability.title}
        </h3>
        <p className="text-sm text-base-content/45 leading-relaxed">
          {capability.body}
        </p>
      </div>
    </motion.div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   HOW IT WORKS — 3 horizontal steps
   ══════════════════════════════════════════════════════════════════ */

function ProcessSection() {
  return (
    <section className="relative py-24 lg:py-32">
      <div className="container relative">
        {/* Header */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-14 lg:mb-18"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
            How it <span className="text-gradient-primary">works</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-lg">
            Three steps from first email to live deployment.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative max-w-5xl mx-auto">
          {/* Horizontal connector line — desktop only */}
          <div
            className="hidden md:block absolute top-[44px] left-[15%] right-[15%] h-px pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg, transparent, var(--color-primary) 20%, var(--color-primary) 80%, transparent)',
              opacity: 0.15,
            }}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 relative">
            {STEPS.map((step, i) => (
              <ProcessStep key={step.title} step={step} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function ProcessStep({ step, index }: { step: Step; index: number }) {
  return (
    <motion.div
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{
        delay: 0.1 + index * 0.12,
        duration: 0.5,
        ease: EASE,
      }}
      className="relative flex flex-col items-center text-center"
    >
      {/* Step number badge */}
      <div className="relative z-10 mb-5">
        <div
          className="w-[88px] h-[88px] rounded-2xl bg-base-100 border-2 border-primary/20 flex items-center justify-center"
          style={{
            boxShadow:
              '0 0 30px rgba(52,211,153,0.08), inset 0 0 20px rgba(52,211,153,0.04)',
          }}
        >
          <span className="text-3xl font-black text-gradient-primary tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        {/* Pulse halo */}
        <motion.div
          className="absolute inset-0 rounded-2xl border-2 border-primary/15 pointer-events-none"
          animate={{ scale: [1, 1.2], opacity: [0.5, 0] }}
          transition={{
            delay: index * 0.5,
            duration: 2.5,
            ease: 'easeOut',
            repeat: Infinity,
            repeatDelay: 1.5,
          }}
        />
      </div>

      {/* Title */}
      <h3 className="text-lg sm:text-xl font-bold text-base-content mb-2">
        {step.title}
      </h3>

      {/* Body */}
      <p className="text-sm text-base-content/50 leading-relaxed max-w-xs">
        {step.body}
      </p>
    </motion.div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   WHY SCROLLR — 4 trust principles + GitHub stats
   ══════════════════════════════════════════════════════════════════ */

function WhyScrollrSection() {
  const stats = useGitHubStats(REPO)

  return (
    <section className="relative py-24 lg:py-32">
      {/* Background band */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

      <div className="container relative">
        {/* Header */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-14 lg:mb-18"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
            Why <span className="text-gradient-primary">Scrollr</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-lg">
            Not a prototype, not a pitch deck — a real product with real users.
          </p>
        </motion.div>

        {/* 4-up principle grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 max-w-6xl mx-auto mb-12 lg:mb-14">
          {PRINCIPLES.map((p, i) => (
            <PrincipleCard key={p.title} principle={p} index={i} />
          ))}
        </div>

        {/* GitHub footer card */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.35, duration: 0.5, ease: EASE }}
          className="relative max-w-5xl mx-auto"
        >
          {/* Outer glow */}
          <div
            className="absolute -inset-3 rounded-2xl pointer-events-none blur-2xl"
            style={{
              background:
                'radial-gradient(ellipse at center, var(--color-primary) 0%, transparent 70%)',
              opacity: 0.04,
            }}
          />

          <div className="relative rounded-xl border border-base-300/20 bg-base-200/30 overflow-hidden">
            {/* Top accent */}
            <div
              className="absolute top-0 left-10 right-10 h-px"
              style={{
                background:
                  'linear-gradient(90deg, transparent, rgba(52,211,153,0.15) 50%, transparent)',
              }}
            />

            <div className="px-6 py-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Left: message */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/8 border border-primary/15 flex items-center justify-center">
                  <Eye size={16} className="text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-base-content/70">
                    Inspect every line before you commit
                  </p>
                  <p className="text-xs text-base-content/30">
                    AGPL-3.0 · {REPO}
                  </p>
                </div>
              </div>

              {/* Right: stats + link */}
              <div className="flex items-center gap-3">
                {stats != null && (
                  <div className="hidden sm:flex items-center gap-1">
                    <a
                      href={`https://github.com/${REPO}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Star on GitHub"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-warning/50 hover:text-warning hover:bg-warning/[0.06] transition-[color,background-color] duration-200"
                    >
                      <Star className="size-3.5" />
                      <span className="font-semibold tabular-nums">
                        {stats.stars.toLocaleString()}
                      </span>
                    </a>
                    <a
                      href={`https://github.com/${REPO}/forks`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-info/50 hover:text-info hover:bg-info/[0.06] transition-[color,background-color] duration-200"
                    >
                      <GitFork className="size-3.5" />
                      <span className="font-semibold tabular-nums">
                        {stats.forks.toLocaleString()}
                      </span>
                    </a>
                  </div>
                )}

                <span className="hidden sm:block w-px h-6 bg-base-300/20" />

                <a
                  href={`https://github.com/${REPO}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-base-300/25 bg-base-200/40 text-sm font-semibold text-base-content/50 hover:text-primary hover:border-primary/25 transition-[color,border-color] duration-200"
                >
                  <Github className="size-4" />
                  <span>View source</span>
                </a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

function PrincipleCard({
  principle,
  index,
}: {
  principle: Principle
  index: number
}) {
  const Icon = principle.icon
  const { accent } = principle

  return (
    <motion.div
      style={{ opacity: 0 }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        delay: 0.08 + index * 0.08,
        duration: 0.5,
        ease: EASE,
      }}
      className="relative rounded-2xl bg-base-200/40 border border-base-300/25 p-6 overflow-hidden h-full"
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-6 right-6 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent.ring} 50%, transparent)`,
        }}
      />

      {/* Ambient gradient orb */}
      <div
        className="absolute -top-14 -right-14 w-40 h-40 rounded-full pointer-events-none blur-3xl"
        style={{ background: accent.gradient }}
      />

      {/* Inline header — icon + title in a row */}
      <div className="relative flex items-center gap-2.5 mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: accent.glow,
            boxShadow: `0 0 18px ${accent.glow}, 0 0 0 1px ${accent.ring}`,
          }}
        >
          <Icon size={18} className="text-base-content/80" />
        </div>
        <h3 className={`text-sm font-bold leading-snug ${accent.text} min-w-0`}>
          {principle.title}
        </h3>
      </div>

      {/* Body */}
      <p className="relative text-[13px] text-base-content/45 leading-relaxed">
        {principle.body}
      </p>
    </motion.div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   PRICING + LEAD CAPTURE FORM
   ══════════════════════════════════════════════════════════════════ */

function PricingFormSection() {
  return (
    <section id="contact-form" className="relative py-24 lg:py-32 scroll-mt-20">
      <div className="container relative">
        {/* Pricing line */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-12 lg:mb-16"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur-sm mb-6">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            Pricing
          </span>

          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-3">
            Starts at <span className="text-gradient-primary">$500/mo.</span>
          </h2>
          <p className="text-base sm:text-lg text-base-content/45 leading-relaxed max-w-lg">
            Custom quote based on scope.
          </p>
        </motion.div>

        {/* Form card */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
          className="max-w-2xl mx-auto"
        >
          <LeadForm />
        </motion.div>
      </div>
    </section>
  )
}

function LeadForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [useCase, setUseCase] = useState<BusinessUseCase | ''>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [emailCopied, setEmailCopied] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedCompany = company.trim()
    const trimmedMessage = message.trim()

    if (!trimmedName) {
      setError('Please enter your name.')
      return
    }
    // Frontend email check mirrors the backend's net/mail.ParseAddress
    // gate: catch obvious garbage before the round-trip. The backend
    // is still authoritative — this just saves a network roundtrip
    // for "a@b" / "foo @ bar" / unfinished input.
    if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!trimmedCompany) {
      setError('Please tell us your company name.')
      return
    }
    if (!useCase) {
      setError('Please pick a use case.')
      return
    }
    if (trimmedMessage.length < 10) {
      setError('Please give us at least one sentence of context (10+ chars).')
      return
    }

    setSubmitting(true)
    try {
      await businessApi.submit({
        name: trimmedName,
        email: trimmedEmail,
        company: trimmedCompany,
        use_case: useCase,
        message: trimmedMessage,
      })
      setSubmittedEmail(trimmedEmail)
      setSubmitted(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setEmailCopied(true)
      setTimeout(() => setEmailCopied(false), 2000)
    } catch {
      // Clipboard blocked — user can still type it manually
    }
  }

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col items-center gap-5 rounded-2xl border border-success/20 bg-success/5 p-8 sm:p-10 text-center"
        role="status"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-base-content">
            Thanks — we got your note.
          </h3>
          <p className="mt-2 max-w-md text-sm text-base-content/55 leading-relaxed">
            A confirmation email is on its way to{' '}
            <span className="text-base-content/80 font-medium">
              {submittedEmail}
            </span>{' '}
            with what to expect next. A real human will reply within one
            business day.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleCopyEmail}
            className="inline-flex items-center gap-2 rounded-lg border border-base-300/50 bg-base-200/40 px-4 py-2 text-sm font-medium text-base-content/70 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary cursor-pointer"
          >
            {emailCopied ? (
              <>
                <CheckCircle2 size={14} className="text-success" />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy {CONTACT_EMAIL}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSubmitted(false)
              setSubmittedEmail('')
              setError(null)
              setName('')
              setEmail('')
              setCompany('')
              setUseCase('')
              setMessage('')
            }}
            className="text-sm text-base-content/40 hover:text-base-content/70 transition-colors cursor-pointer"
          >
            Send another
          </button>
        </div>
      </motion.div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-2xl border border-base-300/40 bg-base-200/30 p-6 sm:p-8"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Your name" htmlFor="biz-name" required>
          <input
            id="biz-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            required
            autoComplete="name"
            maxLength={120}
            className="biz-input"
            placeholder="Alex Chen"
          />
        </FormField>

        <FormField label="Email" htmlFor="biz-email" required>
          <input
            id="biz-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            required
            autoComplete="email"
            maxLength={254}
            className="biz-input"
            placeholder="alex@company.com"
          />
        </FormField>
      </div>

      <FormField label="Company" htmlFor="biz-company" required>
        <input
          id="biz-company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          disabled={submitting}
          required
          autoComplete="organization"
          maxLength={200}
          className="biz-input"
          placeholder="Acme Corp."
        />
      </FormField>

      <FormField label="Use case" htmlFor="biz-use-case" required>
        <select
          id="biz-use-case"
          value={useCase}
          onChange={(e) => setUseCase(e.target.value as BusinessUseCase | '')}
          disabled={submitting}
          required
          className="biz-input"
        >
          {USE_CASE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={!opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Tell us about your deployment"
        htmlFor="biz-message"
        required
        counter={`${message.length}/5000`}
      >
        <textarea
          id="biz-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={submitting}
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className="biz-input resize-y"
          placeholder="How many displays / clients? What kind of branding? Self-hosted or managed? Anything else we should know."
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
          We&rsquo;ll send a confirmation to your email and reply within one
          business day.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send size={15} />
              Send inquiry
            </>
          )}
        </button>
      </div>

      {/* Local input styling — colocated, matches SupportContactForm pattern */}
      <style>{`
        .biz-input {
          width: 100%;
          background-color: color-mix(in oklab, var(--color-base-100) 85%, transparent);
          border: 1px solid color-mix(in oklab, var(--color-base-300) 60%, transparent);
          border-radius: 0.5rem;
          padding: 0.55rem 0.75rem;
          font-size: 0.875rem;
          color: var(--color-base-content);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .biz-input:focus {
          outline: none;
          border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
          box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-primary) 15%, transparent);
        }
        .biz-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .biz-input::placeholder {
          color: color-mix(in oklab, var(--color-base-content) 35%, transparent);
        }
        .biz-input:invalid {
          /* Don't paint invalid styling until the user actually interacts. */
          box-shadow: none;
        }
      `}</style>
    </form>
  )
}

interface FormFieldProps {
  label: string
  htmlFor: string
  required?: boolean
  counter?: string
  children: React.ReactNode
}

function FormField({
  label,
  htmlFor,
  required,
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

/* ══════════════════════════════════════════════════════════════════
   BOTTOM CTA — heavy treatment with ConvergenceBackdrop
   ══════════════════════════════════════════════════════════════════ */

function BottomCTA() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { amount: 0.15 })

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

  const beams = useMemo<Array<BackdropBeam>>(
    () => [
      { angle: 35, color: '#34d399', delay: 0.3 },
      { angle: 145, color: '#00b8db', delay: 0.45 },
      { angle: 215, color: '#34d399', delay: 0.6 },
      { angle: 325, color: '#00b8db', delay: 0.75 },
    ],
    [],
  )

  const handleScrollToForm = () => {
    document
      .getElementById('contact-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section
      ref={sectionRef}
      className="relative overflow-clip py-32 lg:py-44"
      onMouseMove={handleMouseMove}
    >
      <ConvergenceBackdrop
        mouseX={mouseX}
        mouseY={mouseY}
        isInView={isInView}
        particles={CTA_PARTICLES}
        beams={beams}
        pulseRingCount={3}
        orbBackground="radial-gradient(circle, rgba(52,211,153,0.08) 0%, rgba(0,212,255,0.04) 40%, transparent 70%)"
      />

      <div
        className="relative mx-auto px-5 sm:px-6 lg:px-8"
        style={{ maxWidth: 1400 }}
      >
        <div className="flex flex-col items-center text-center">
          {/* Pill */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur-sm">
              <Mail className="size-3" aria-hidden />
              {CONTACT_EMAIL}
            </span>
          </motion.div>

          {/* Headline */}
          <motion.h2
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
            className="mt-8 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-none"
          >
            <span className="block">Tell us what</span>
            <span className="block mt-2">
              you want <span className="text-gradient-primary">to build.</span>
            </span>
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
            One email kicks it off. We respond within a business day.
          </motion.span>

          {/* CTAs */}
          <motion.div
            className="relative mt-10"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.4, duration: 0.6, ease: EASE }}
          >
            {/* Central glow */}
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
                onClick={handleScrollToForm}
                className="btn btn-pulse gap-2 text-base px-8 py-5 shadow-2xl"
              >
                <MessageSquare size={14} />
                Send an inquiry
              </button>
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Scrollr for Business')}`}
                className="btn btn-outline gap-2 px-6 py-4"
              >
                <Mail size={14} />
                Or email directly
              </a>
            </div>
          </motion.div>

          {/* Trust signals */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
            className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-base-content/30"
          >
            {[
              'One business day response',
              'Mutual NDA on request',
              'Self-hosted available',
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                {item}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Bottom horizon glow */}
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

/* ══════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════ */

function BusinessPage() {
  usePageMeta({
    title: 'Business — Scrollr',
    description:
      'Scrollr for business: branded desktop deployments for teams, brokerages, sports venues, fantasy platforms, crypto exchanges, and news publishers. Custom branding, multi-display, self-hosted, dedicated support. Starts at $500/mo.',
    canonicalUrl: 'https://myscrollr.com/business',
  })

  return (
    <div className="min-h-screen">
      <BusinessHero />
      <AudiencesSection />
      <CapabilitiesSection />
      <ProcessSection />
      <WhyScrollrSection />
      <PricingFormSection />

      {/* FAQ — reuses the homepage FAQSection with B2B items */}
      <FAQSection
        items={BUSINESS_FAQ}
        title="Honest"
        titleHighlight="Answers"
        subtitle="No legalese, no salesy hand-waving."
      />

      <BottomCTA />
    </div>
  )
}
