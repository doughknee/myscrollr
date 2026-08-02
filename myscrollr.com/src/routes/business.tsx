import { createFileRoute } from '@tanstack/react-router'
import { motion, useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import type { FormEvent } from 'react'

import type { BusinessUseCase } from '@/api/client'
import type { DemoTickerBarOverride } from '@/components/DemoTickerBar'
import type { DemoChip } from '@/hooks/useDemoTicker'
import type {
  BackdropBeam,
  BackdropParticle,
} from '@/components/landing/_ConvergenceBackdrop'
import { businessApi } from '@/api/client'
import DemoTickerBar from '@/components/DemoTickerBar'
import { ConvergenceBackdrop } from '@/components/landing/_ConvergenceBackdrop'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  StepsGrid,
  TerminalContainer,
} from '@/components/terminal'
import { EASE } from '@/lib/animations'
import { seededRandom } from '@/lib/seededRandom'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'

// ── Constants ───────────────────────────────────────────────────

const CONTACT_EMAIL = 'enterprise@myscrollr.com'

/** whileInView variant of the shared riseIn entrance. */
const reveal = (index = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, ease: EASE, delay: index * 0.08 },
})

// ── Route ───────────────────────────────────────────────────────

export const Route = createFileRoute('/business')({
  head: () =>
    seo({
      title: 'Scrollr for Business: Branded Desktop Deployments',
      description:
        'Custom-branded Scrollr deployments for brokerages, sports venues, fantasy platforms, crypto exchanges, and news publishers. From $500/mo.',
      path: '/business',
      image: 'https://myscrollr.com/og/business.png',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Business', path: '/business' },
        ]),
      ],
    }),
  component: BusinessPage,
})

/* ══════════════════════════════════════════════════════════════════
   WHITE-LABEL BAR DEMO — the page's money moment
   (brand defs + chips ported from Business - Redesign.dc.html)
   ══════════════════════════════════════════════════════════════════ */

type BrandId = 'scrollr' | 'acme' | 'dugout' | 'novax'

interface BrandDef {
  label: string
  accent: string
  bar: { bg: string; border: string; text: string; muted: string }
}

// prettier-ignore
const BRAND_DEFS: Record<BrandId, BrandDef> = {
  scrollr: { label: 'SCROLLR', accent: '#34d399', bar: { bg: 'rgba(16,16,24,.9)', border: '#2e2e42', text: '#c8c8d8', muted: '#5a5a72' } },
  acme: { label: 'ACME CAPITAL', accent: '#00d4ff', bar: { bg: 'rgba(8,16,28,.93)', border: '#1c3450', text: '#c9dcf0', muted: '#4a6a8a' } },
  dugout: { label: 'THE DUGOUT', accent: '#fbbf24', bar: { bg: 'rgba(22,14,8,.93)', border: '#4a3418', text: '#f0e2c9', muted: '#8a7a5a' } },
  novax: { label: 'NOVAX', accent: '#a855f7', bar: { bg: 'rgba(16,10,26,.93)', border: '#362050', text: '#ddc9f0', muted: '#6f5a8a' } },
}

const BRAND_IDS = Object.keys(BRAND_DEFS) as Array<BrandId>

function jitter(tick: number, base: number, seed: number, spread: number) {
  return base + Math.sin(tick * 0.9 + seed) * spread
}

/** Audience-specific chips per white-label brand (mockup `brandChips`),
 *  in the app-faithful structured chip shape rendered by DemoTickerBar. */
function brandChips(brand: BrandId, tick: number): Array<DemoChip> {
  const t = tick
  if (brand === 'acme') {
    const cyan = '#00d4ff'
    return [
      // prettier-ignore
      { kind: 'text', accent: cyan, label: 'ACME MODEL PORTFOLIO', value: '▲+0.8% TODAY' },
      // prettier-ignore
      { kind: 'trade', accent: cyan, symbol: 'SPY', price: '$' + jitter(t, 612.4, 1, 0.8).toFixed(2), delta: '▲+0.4%', up: true },
      // prettier-ignore
      { kind: 'trade', accent: cyan, symbol: 'QQQ', price: '$' + jitter(t, 482.1, 3, 1.2).toFixed(2), delta: '▲+0.9%', up: true },
      // prettier-ignore
      { kind: 'trade', accent: cyan, symbol: '10Y YIELD', price: '3.84%', delta: '▼-2BP', up: false },
      // prettier-ignore
      { kind: 'text', accent: cyan, label: 'YOUR ADVISOR', value: 'QUARTERLY REVIEW THU 2PM' },
    ]
  }
  if (brand === 'dugout') {
    const amber = '#fbbf24'
    return [
      // prettier-ignore
      { kind: 'game', accent: amber, away: 'NYY', awayScore: '5', home: 'BOS', homeScore: '3', status: '▲7', live: true, winner: 'away' },
      // prettier-ignore
      { kind: 'game', accent: amber, away: 'MIA', awayScore: '2', home: 'LA', homeScore: '1', status: '63′', live: true, winner: 'away' },
      // prettier-ignore
      { kind: 'text', accent: amber, label: 'TONIGHT', value: 'TRIVIA 8PM', sub: 'WINGS ½ OFF DURING ANY OT' },
      {
        kind: 'game',
        accent: amber,
        away: 'KC',
        awayScore: '24',
        home: 'BUF',
        homeScore: '21',
        status:
          'Q4 ' +
          (2 - (t % 3)) +
          ':' +
          String(59 - ((t * 7) % 60)).padStart(2, '0'),
        live: true,
        winner: 'away',
      },
    ]
  }
  if (brand === 'novax') {
    const purple = '#a855f7'
    return [
      // prettier-ignore
      { kind: 'trade', accent: purple, symbol: 'BTC/USDT', price: '$' + Math.round(jitter(t, 118240, 4, 180)).toLocaleString(), delta: '▲+2.4%', up: true },
      // prettier-ignore
      { kind: 'trade', accent: purple, symbol: 'ETH/USDT', price: '$' + Math.round(jitter(t, 4120, 5, 14)).toLocaleString(), delta: '▼-0.8%', up: false },
      // prettier-ignore
      { kind: 'trade', accent: purple, symbol: 'SOL/USDT', price: '$' + jitter(t, 212.5, 6, 2.4).toFixed(2), delta: '▲+5.1%', up: true },
      // prettier-ignore
      { kind: 'text', accent: purple, label: 'NOVAX', value: 'MAKER FEES 0% THROUGH SEPTEMBER' },
    ]
  }
  // 'scrollr' renders <DemoTickerBar /> with no override instead.
  return []
}

// ── Section content (copy verbatim from the mockup) ─────────────

// prettier-ignore
const AUDIENCES = [
  { tag: 'VENUE', color: '#fbbf24', name: 'Sports bars & restaurants', copy: 'Every TV in the room runs live scores, news, and your branding. Better than ESPN scrollers, fully under your control.' },
  { tag: 'FIN', color: '#00d4ff', name: 'Brokerages & advisors', copy: 'A branded desktop ticker for clients. Real-time quotes, custom watchlists, your logo, your colors, your domain.' },
  { tag: 'FAN', color: '#ff4757', name: 'Fantasy sports platforms', copy: "White-label the desktop app as your platform's companion. Native ticker, your branding, your standings." },
  { tag: 'ODDS', color: '#a855f7', name: 'Sportsbooks & betting affiliates', copy: "Stay on a user's desktop without a tab open. Odds, scores, and your offers, visible the moment they matter." },
  { tag: 'CRYPTO', color: '#34d399', name: 'Crypto exchanges', copy: "A native desktop price ticker for power users. Custom symbol list, your exchange's pairs, your branding." },
  { tag: 'NEWS', color: '#0ea5e9', name: 'News publishers', copy: "Your headlines on readers' desktops all day: a quiet, branded channel that doesn't depend on the algorithm." },
]

// prettier-ignore
const CAPABILITIES = [
  { num: 'CAP—01', title: 'Full white-label', body: 'Logo, colors, fonts, app name, app icon, install bundle identity, custom domain on the API. Your customers see your brand, not ours.' },
  { num: 'CAP—02', title: 'Multi-display deployment', body: 'Venue mode: one config, every screen in the building. Per-display content and scheduling included.' },
  { num: 'CAP—03', title: 'API access', body: 'Programmatic read/write to your deployment. Push your own data into the bar, pull state into your stack.' },
  { num: 'CAP—04', title: 'Custom data sources', body: 'Your odds feed, your CMS, your internal metrics: we build the ingester and it streams like everything else.' },
  { num: 'CAP—05', title: 'A real SLA', body: 'Defined response times in writing (typically P1 < 1hr), uptime targets, maintenance windows, and a direct Slack channel with the engineers.' },
  { num: 'CAP—06', title: 'Self-host option', body: 'The full stack runs in your environment. We hand you the keys (deploy scripts, Compose files, runbooks) and stay reachable after.' },
]

// prettier-ignore
const STEPS = [
  { num: '01', title: 'Scope', body: 'Mutual NDA first, then a scoping call. You get a written scope with a committed timeline and price before you pay anything.' },
  { num: '02', title: 'Build & brand', body: 'We build on the production Scrollr platform, the same pipeline running the public app, with your brand and data wired in.' },
  { num: '03', title: 'Deploy', body: 'Most deployments go live in 2-4 weeks. We stay engaged for support, changes, and whatever breaks at 5pm on a Friday.' },
]

// prettier-ignore
const FAQS = [
  { num: 'B.01', q: 'Can we self-host?', a: 'Yes. Desktop app, Go API, Rust ingesters, Postgres, Redis: all of it runs in your environment, with deployment scripts, runbooks, and a hand-off call.' },
  { num: 'B.02', q: 'Can we fully white-label?', a: 'Completely. The codebase is AGPL-3.0; white-label builds ship under a commercial license that removes the copyleft requirement for distribution.' },
  { num: 'B.03', q: 'Do you sign NDAs?', a: 'Before the scoping call, so you can speak freely. Our standard one-pager or yours, with no legal back-and-forth before the first conversation.' },
  { num: 'B.04', q: "What's the SLA?", a: 'Written, not implied: incident response times (often P1 < 1hr), monthly uptime targets, maintenance windows, and a direct Slack channel.' },
  { num: 'B.05', q: 'How long does deployment take?', a: 'Custom branding, two data sources, basic integrations: 2-4 weeks. Heavy customization (new sources, custom UI, SSO): 6-12 weeks. Committed in the scope doc.' },
  { num: 'B.06', q: 'Perpetual or one-time licensing?', a: 'For self-hosted, yes: perpetual licenses with optional annual maintenance. Managed deployments default to monthly. Bring us your procurement constraints.' },
]

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

// ── Contact-section backdrop (kept ConvergenceBackdrop) ─────────

const CTA_PARTICLES: Array<BackdropParticle> = Array.from(
  { length: 12 },
  (_, i) => {
    const random = seededRandom(i * 7919 + 31337)
    return {
      id: i,
      x: random() * 100,
      y: random() * 100,
      size: random() * 3 + 1.5,
      delay: random() * 5,
      duration: random() * 6 + 8,
      color: i % 2 === 0 ? '#34d399' : '#00d4ff',
    }
  },
)

const CTA_BEAMS: Array<BackdropBeam> = [
  { angle: 35, color: '#34d399', delay: 0.3 },
  { angle: 145, color: '#00d4ff', delay: 0.45 },
  { angle: 215, color: '#34d399', delay: 0.6 },
  { angle: 325, color: '#00d4ff', delay: 0.75 },
]

// ── Helpers ─────────────────────────────────────────────────────

function scrollToForm() {
  document
    .getElementById('contact-form')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ══════════════════════════════════════════════════════════════════
   DEPLOYMENT FANOUT — kept 2x2 branded-monitors visual, re-skinned
   to the terminal palette and paired with the hero. Each monitor
   wears one of the white-label demo brands.
   ══════════════════════════════════════════════════════════════════ */

// prettier-ignore
const FANOUT_MONITORS: ReadonlyArray<{
  id: BrandId
  label: string
  accent: string
  delay: number
  sample: string
}> = [
  { id: 'scrollr', label: 'SCROLLR', accent: '#34d399', delay: 0.4, sample: 'AAPL $232.14 ▲+1.2%' },
  { id: 'acme', label: 'ACME CAPITAL', accent: '#00d4ff', delay: 0.55, sample: 'SPY $612.40 ▲+0.4%' },
  { id: 'dugout', label: 'THE DUGOUT', accent: '#fbbf24', delay: 0.7, sample: 'NYY 5 - 3 BOS · ▲7' },
  { id: 'novax', label: 'NOVAX', accent: '#a855f7', delay: 0.85, sample: 'BTC/USDT $118,240 ▲' },
]

function DeploymentFanout({
  brand,
  onSelect,
}: {
  brand: BrandId
  onSelect: (id: BrandId) => void
}) {
  return (
    <div className="relative h-[360px] w-[340px] sm:h-[420px] sm:w-[560px] lg:w-[680px]">
      {/* Center pulse rings */}
      {[0, 1].map((i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15"
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
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-5 p-3">
        {FANOUT_MONITORS.map((m) => (
          <MonitorTile
            key={m.id}
            label={m.label}
            accent={m.accent}
            delay={m.delay}
            sample={m.sample}
            active={brand === m.id}
            onClick={() => onSelect(m.id)}
          />
        ))}
      </div>

      {/* Central hub */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.6, ease: EASE }}
      >
        <div className="relative flex h-12 w-12 items-center justify-center rounded-[8px] border border-primary/40 bg-panel shadow-[0_0_30px_rgba(52,211,153,.18)]">
          <Building2 size={20} className="text-primary/80" />
          <span className="animate-pulse-dot absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
        </div>
      </motion.div>
    </div>
  )
}

function MonitorTile({
  label,
  accent,
  delay,
  sample,
  active,
  onClick,
}: {
  label: string
  accent: string
  delay: number
  sample: string
  active: boolean
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={active}
      aria-label={`Switch the white-label demo to ${label}`}
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: active ? 1 : 0.75, scale: active ? 1.02 : 1 }}
      transition={{ delay, duration: 0.5, ease: EASE }}
      className="relative flex cursor-pointer flex-col items-stretch justify-start overflow-hidden rounded-[8px] border bg-panel text-left transition-shadow"
      style={{
        borderColor: active ? accent : `${accent}30`,
        boxShadow: active ? `0 0 30px ${accent}30` : 'none',
        background: active ? `${accent}0a` : undefined,
      }}
    >
      {/* Title row — mono brand tag */}
      <div className="flex items-center justify-between border-b border-hairline-minor px-2.5 py-1.5">
        <span
          className="font-mono text-[8px] font-semibold tracking-[0.12em]"
          style={{ color: accent }}
        >
          {label}
        </span>
        <span
          className="h-[5px] w-[5px] rounded-full opacity-40"
          style={{ background: accent }}
        />
      </div>

      {/* Content lines */}
      <div className="space-y-1.5 p-2.5">
        <div
          className="h-1 rounded-[1px]"
          style={{ background: `${accent}25`, width: '70%' }}
        />
        <div className="h-1 w-[55%] rounded-[1px] bg-base-content/10" />
        <div className="h-1 w-[40%] rounded-[1px] bg-base-content/5" />
      </div>

      {/* Ticker bar — pinned to bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 border-t px-2.5 py-1.5"
        style={{ borderColor: `${accent}25`, background: `${accent}08` }}
      >
        <span
          className="animate-pulse-dot h-1 w-1 rounded-full"
          style={{ background: accent }}
        />
        <span
          className="truncate font-mono text-[9px] font-medium"
          style={{ color: active ? accent : `${accent}99` }}
        >
          {sample}
        </span>
      </div>
    </motion.button>
  )
}

/* ══════════════════════════════════════════════════════════════════
   SECTIONS
   ══════════════════════════════════════════════════════════════════ */

function AudiencesSection() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 01 ／ WHO DEPLOYS THIS" />
        <motion.div {...reveal()} className="pb-8 pt-2">
          {AUDIENCES.map((a) => (
            <div
              key={a.tag}
              className="grid grid-cols-1 gap-2 border-b border-hairline-minor px-2 py-[19px] sm:grid-cols-[70px_260px_1fr] sm:items-baseline sm:gap-5"
            >
              <span
                className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold"
                style={{ color: a.color }}
              >
                <span
                  className="h-[7px] w-[7px] rounded-[2px]"
                  style={{ background: a.color }}
                />
                {a.tag}
              </span>
              <span className="text-[17px] font-bold">{a.name}</span>
              <span className="text-sm text-base-content/60 [text-wrap:pretty]">
                {a.copy}
              </span>
            </div>
          ))}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}

function CapabilitiesSection() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 02 ／ WHAT A DEPLOYMENT INCLUDES" />
        <motion.div
          {...reveal()}
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
        >
          {CAPABILITIES.map((c) => (
            <div
              key={c.num}
              className="border-b border-r border-hairline-minor px-8 pb-[42px] pt-9"
            >
              <div className="mb-3.5 font-mono text-[11px] tracking-[0.14em] text-primary">
                {c.num}
              </div>
              <div className="mb-[9px] text-lg font-bold uppercase tracking-[0.02em]">
                {c.title}
              </div>
              <div className="max-w-[360px] text-sm leading-[1.65] text-base-content/60 [text-wrap:pretty]">
                {c.body}
              </div>
            </div>
          ))}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}

function ProcessSection() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 03 ／ FIRST EMAIL TO LIVE" />
        <motion.div {...reveal()}>
          <StepsGrid steps={STEPS} />
        </motion.div>
      </TerminalContainer>
    </section>
  )
}

function FaqSection() {
  return (
    <section>
      <TerminalContainer>
        <SectionRow tag="SEC 04 ／ STRAIGHT ANSWERS" />
        <motion.div
          {...reveal()}
          className="grid grid-cols-1 gap-x-12 pb-10 pt-3 md:grid-cols-2"
        >
          {FAQS.map((f) => (
            <div
              key={f.num}
              className="border-b border-hairline-minor px-1 py-[26px]"
            >
              <div className="mb-[9px] flex items-baseline gap-3.5">
                <span className="font-mono text-xs text-primary">{f.num}</span>
                <span className="text-[16.5px] font-bold">{f.q}</span>
              </div>
              <p className="m-0 pl-[34px] text-[14.5px] leading-[1.65] text-base-content/60 [text-wrap:pretty]">
                {f.a}
              </p>
            </div>
          ))}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}

function CtaSection() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <DeparturesRow
          index="01"
          label="Starts at $500/mo."
          meta="Timeline and scope committed in writing before you pay anything."
          action="START THE CONVERSATION →"
          onClick={scrollToForm}
          labelClassName="text-left text-[26px]"
        />
      </TerminalContainer>
    </section>
  )
}

/* ══════════════════════════════════════════════════════════════════
   CONTACT FORM — kept businessApi wiring, re-skinned to terminal
   ══════════════════════════════════════════════════════════════════ */

function ContactSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { amount: 0.15 })

  return (
    <section
      ref={sectionRef}
      id="contact-form"
      className="relative scroll-mt-24 overflow-clip border-b border-hairline"
    >
      <ConvergenceBackdrop
        isInView={isInView}
        particles={CTA_PARTICLES}
        beams={CTA_BEAMS}
        baseClassName="pointer-events-none absolute inset-0"
      />
      <TerminalContainer className="relative">
        <SectionRow
          tag="SEC 05 ／ START THE CONVERSATION"
          stat={
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="transition-colors hover:text-primary"
            >
              ENTERPRISE@MYSCROLLR.COM
            </a>
          }
        />
        <motion.div {...reveal()} className="mx-auto max-w-2xl py-12">
          <LeadForm />
        </motion.div>
      </TerminalContainer>
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
        className="flex flex-col items-center gap-5 rounded-[8px] border border-primary/30 bg-panel p-8 text-center sm:p-10"
        role="status"
      >
        <div className="font-mono text-[11px] tracking-[0.14em] text-primary">
          INQUIRY RECEIVED
        </div>
        <div>
          <h3 className="text-lg font-bold text-base-content">
            Thanks — we got your note.
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-base-content/60">
            A confirmation email is on its way to{' '}
            <span className="font-medium text-base-content/85">
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
            className="cursor-pointer rounded-[4px] border border-hairline px-4 py-2 font-mono text-[11px] tracking-[0.08em] text-base-content/70 transition-colors hover:border-primary/40 hover:text-primary"
          >
            {emailCopied ? 'COPIED' : `COPY ${CONTACT_EMAIL.toUpperCase()}`}
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
            className="cursor-pointer text-sm text-base-content/40 transition-colors hover:text-base-content/70"
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
      className="flex flex-col gap-5 rounded-[8px] border border-hairline bg-panel p-6 sm:p-8"
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
          className="rounded-[4px] border border-error/30 bg-error/10 p-3"
          role="alert"
        >
          <p className="m-0 text-xs text-error">{error}</p>
        </motion.div>
      ) : null}

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-xs text-base-content/40">
          We&rsquo;ll send a confirmation to your email and reply within one
          business day.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex cursor-pointer items-center justify-center rounded-[4px] bg-primary px-6 py-2.5 font-mono text-xs font-bold tracking-[0.08em] text-[#101018] transition-colors hover:bg-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'SENDING…' : 'SEND INQUIRY →'}
        </button>
      </div>

      {/* Local input styling — colocated, matches SupportContactForm pattern */}
      <style>{`
        .biz-input {
          width: 100%;
          background-color: var(--color-base-75);
          border: 1px solid var(--color-hairline);
          border-radius: 4px;
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
          className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/60"
        >
          {label}
          {required ? <span className="ml-1 text-primary">*</span> : null}
        </label>
        {counter ? (
          <span className="font-mono text-[11px] tabular-nums text-base-content/35">
            {counter}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   PAGE
   ══════════════════════════════════════════════════════════════════ */

function BusinessPage() {
  const [brand, setBrand] = useState<BrandId>('scrollr')
  const [tick, setTick] = useState(0)

  // 3s jitter tick for the branded chip text (mirrors useDemoChips).
  useEffect(() => {
    const iv = setInterval(() => setTick((v) => v + 1), 3000)
    return () => clearInterval(iv)
  }, [])

  // The white-label demo never writes the scrollr-marketing-demo key —
  // the override path in DemoTickerBar already guarantees this.
  const override: DemoTickerBarOverride | undefined =
    brand === 'scrollr'
      ? undefined
      : {
          label: BRAND_DEFS[brand].label,
          accent: BRAND_DEFS[brand].accent,
          palette: BRAND_DEFS[brand].bar,
          chips: brandChips(brand, tick),
        }

  return (
    // __root skips its demo-bar padding on /business; add it here so
    // the fixed white-label bar never overlaps the footer.
    <div className="pb-[72px]">
      <PageHeader
        eyebrowLeft="BUSINESS ／ BRANDED DEPLOYMENTS"
        eyebrowRight="FROM $500/MO · MUTUAL NDA BEFORE THE FIRST CALL"
        line1="YOUR BRAND,"
        line2="OUR RAILS."
        sub="The Scrollr platform (ticker, data pipeline, and all) wearing your logo, your colors, your domain. Built, deployed, and supported by the people who wrote it."
        actions={
          <div className="flex flex-col items-start gap-3.5 sm:items-end">
            <button
              type="button"
              onClick={scrollToForm}
              className="cursor-pointer rounded-[4px] bg-primary px-[30px] py-[15px] font-mono text-[13px] font-bold tracking-[0.08em] text-[#101018] shadow-[0_0_60px_color-mix(in_srgb,var(--color-primary)_18%,transparent)] transition-colors hover:bg-[#6ee7b7]"
            >
              START THE CONVERSATION →
            </button>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-mono text-[11px] tracking-[0.1em] text-base-content/45 transition-colors hover:text-primary"
            >
              ENTERPRISE@MYSCROLLR.COM
            </a>
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] tracking-[0.1em] text-base-content/45">
              <span>TRY THE WHITE-LABEL ↘</span>
              {BRAND_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={brand === id}
                  onClick={() => setBrand(id)}
                  className={`cursor-pointer whitespace-nowrap rounded-[4px] border px-3 py-[7px] font-mono text-[11px] tracking-[0.08em] transition-colors hover:border-primary ${
                    brand === id
                      ? 'border-primary/45 bg-primary/10 text-primary'
                      : 'border-hairline text-base-content/55'
                  }`}
                >
                  {BRAND_DEFS[id].label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Kept hero visual — the 2x2 branded-monitors fan-out, wired to
          the same brand state as the switcher and the pinned bar. */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 00 ／ ONE PLATFORM, MANY DEPLOYMENTS"
            stat="CLICK A SCREEN · THE BAR BELOW REBRANDS"
          />
          <div className="flex justify-center py-12">
            <DeploymentFanout brand={brand} onSelect={setBrand} />
          </div>
        </TerminalContainer>
      </section>

      <AudiencesSection />
      <CapabilitiesSection />
      <ProcessSection />
      <FaqSection />
      <CtaSection />
      <ContactSection />

      {/* Page exception: /business renders its own bar as the
          white-label demo (see DEMO_BAR_EXCLUDED in __root.tsx). */}
      <DemoTickerBar override={override} />
    </div>
  )
}
