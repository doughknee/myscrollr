import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Box,
  Cable,
  CircuitBoard,
  Cloud,
  Cpu,
  Database,
  Globe,
  MonitorSmartphone,
  Radio,
  RefreshCw,
  Server,
  Shield,
  Workflow,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/architecture')({
  head: () =>
    seo({
      title: 'How Scrollr Works — Architecture Deep-Dive',
      description:
        'Behind the scenes: how Scrollr delivers real-time finance, sports, news, and fantasy data from source APIs through CDC PubSub to your desktop. Built with Go, Rust, React, PostgreSQL, and Redis.',
      path: '/architecture',
      image: 'https://myscrollr.com/og/architecture.png',
      type: 'article',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Architecture', path: '/architecture' },
      ]),
    }),
  component: ArchitecturePage,
})

// ── Signature easing (matches homepage) ────────────────────────
const EASE = [0.22, 1, 0.36, 1] as const

// ── Channel hex map ────────────────────────────────────────────
const HEX = {
  primary: '#34d399',
  secondary: '#ff4757',
  info: '#00b8db',
  accent: '#a855f7',
} as const

// ── Pipeline Steps ─────────────────────────────────────────────

interface PipelineStep {
  Icon: ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
  hex: string
  label: string
  items: Array<string>
  Watermark: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

const PIPELINE_STEPS: Array<PipelineStep> = [
  {
    Icon: Globe,
    title: 'Data Sources',
    description:
      'TwelveData WebSocket for market data, ESPN API for scores, RSS/Atom feeds for news, Yahoo Fantasy API for leagues.',
    hex: HEX.primary,
    label: 'INGEST',
    items: ['TwelveData WS', 'ESPN HTTP', 'Yahoo API', 'RSS Feeds'],
    Watermark: Globe,
  },
  {
    Icon: Cpu,
    title: 'Ingestion Services',
    description:
      'Three independent Rust services collect, normalize, and write data to PostgreSQL. Each runs its own schedule and connection strategy.',
    hex: HEX.info,
    label: 'PROCESS',
    items: ['Finance :3001', 'Sports :3002', 'RSS :3004'],
    Watermark: Cpu,
  },
  {
    Icon: Database,
    title: 'PostgreSQL + CDC',
    description:
      'All data lands in PostgreSQL. Sequin monitors table changes via CDC (Change Data Capture) and fires webhooks to the core API.',
    hex: HEX.secondary,
    label: 'DETECT',
    items: ['trades', 'games', 'rss_items', 'yahoo_*'],
    Watermark: Database,
  },
  {
    Icon: Radio,
    title: 'Real-time Delivery',
    description:
      'Core API routes CDC records to channel APIs, which return affected user lists. Core publishes to per-user Redis channels via SSE.',
    hex: HEX.accent,
    label: 'DELIVER',
    items: ['CDC Routing', 'Redis Pub/Sub', 'SSE Stream', 'Per-user'],
    Watermark: Radio,
  },
]

// ── CDC Flow Steps ─────────────────────────────────────────────

interface CdcStep {
  label: string
  detail: string
  Icon: ComponentType<{ size?: number; className?: string }>
  hex: string
}

const CDC_FLOW: Array<CdcStep> = [
  {
    label: 'Rust Service',
    detail: 'Writes to PostgreSQL',
    Icon: Cpu,
    hex: HEX.info,
  },
  {
    label: 'Sequin CDC',
    detail: 'Detects row changes',
    Icon: Activity,
    hex: HEX.secondary,
  },
  {
    label: 'Core API',
    detail: 'POST /webhooks/sequin',
    Icon: Server,
    hex: HEX.primary,
  },
  {
    label: 'Channel API',
    detail: 'POST /internal/cdc → users[]',
    Icon: Cable,
    hex: HEX.info,
  },
  {
    label: 'Redis Pub/Sub',
    detail: 'events:user:{sub}',
    Icon: Radio,
    hex: HEX.accent,
  },
  {
    label: 'SSE → Client',
    detail: 'Desktop App',
    Icon: MonitorSmartphone,
    hex: HEX.primary,
  },
]

// ── Architecture Principles ────────────────────────────────────

interface Principle {
  Icon: ComponentType<{ size?: number; className?: string }>
  title: string
  description: string
  hex: string
  Watermark: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

const PRINCIPLES: Array<Principle> = [
  {
    Icon: Box,
    title: 'Decoupled Channels',
    description:
      'Each channel is a fully self-contained unit with its own Go API, Rust service, frontend components, and config. No shared code between channels.',
    hex: HEX.primary,
    Watermark: Box,
  },
  {
    Icon: Shield,
    title: 'Zero-trust Proxying',
    description:
      'Core API validates JWTs and injects X-User-Sub headers. Integration APIs never see tokens — they trust the core gateway.',
    hex: HEX.secondary,
    Watermark: Shield,
  },
  {
    Icon: RefreshCw,
    title: 'Self-registration',
    description:
      'Channel APIs register in Redis on startup with a 30s TTL heartbeat. Core discovers them dynamically — no hardcoded routes.',
    hex: HEX.info,
    Watermark: RefreshCw,
  },
  {
    Icon: Workflow,
    title: 'Convention-based UI',
    description:
      'Desktop app discovers channel components at build time via import.meta.glob. Drop a file in the right folder and it appears.',
    hex: HEX.accent,
    Watermark: Workflow,
  },
]

// ── Tech Stack ─────────────────────────────────────────────────

interface TechGroup {
  category: string
  Icon: ComponentType<{ size?: number; className?: string }>
  hex: string
  items: Array<{ name: string; detail: string }>
  Watermark: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

const TECH_STACK: Array<TechGroup> = [
  {
    category: 'Core API',
    Icon: Server,
    hex: HEX.primary,
    items: [
      { name: 'Go 1.22', detail: 'Fiber v2, pgx, Redis' },
      { name: 'SSE Hub', detail: 'Per-user Redis Pub/Sub channels' },
      { name: 'Logto', detail: 'Self-hosted OIDC, JWT validation' },
    ],
    Watermark: Server,
  },
  {
    category: 'Ingestion',
    Icon: Cpu,
    hex: HEX.info,
    items: [
      { name: 'Rust', detail: 'tokio async runtime' },
      { name: 'WebSocket', detail: 'TwelveData persistent connection' },
      { name: 'HTTP Polling', detail: 'ESPN 60s, RSS 5min, Yahoo 120s' },
    ],
    Watermark: Cpu,
  },
  {
    category: 'Frontend',
    Icon: MonitorSmartphone,
    hex: HEX.accent,
    items: [
      { name: 'React 19', detail: 'Vite 7, TanStack Router' },
      { name: 'Tailwind v4', detail: 'daisyUI theme system' },
      { name: 'Motion', detail: 'Production-grade animations' },
    ],
    Watermark: MonitorSmartphone,
  },
  {
    category: 'Desktop',
    Icon: Globe,
    hex: HEX.secondary,
    items: [
      { name: 'Tauri v2', detail: 'Cross-platform native shell' },
      { name: 'React 19', detail: 'Multi-window UI' },
      { name: 'SSE + Polling', detail: 'Real-time data delivery' },
    ],
    Watermark: Globe,
  },
  {
    category: 'Infrastructure',
    Icon: Database,
    hex: HEX.primary,
    items: [
      { name: 'PostgreSQL', detail: 'Shared DB, natural table isolation' },
      { name: 'Redis', detail: 'Cache, Pub/Sub, registration' },
      { name: 'Sequin', detail: 'CDC webhooks from PostgreSQL' },
    ],
    Watermark: Database,
  },
  {
    category: 'Deployment',
    Icon: Cloud,
    hex: HEX.info,
    items: [
      { name: 'Coolify', detail: 'Self-hosted PaaS' },
      { name: 'Docker Compose', detail: 'Per-integration bundles' },
      { name: 'Nixpacks', detail: 'Frontend builds' },
    ],
    Watermark: Cloud,
  },
]

// ── Page Component ─────────────────────────────────────────────

function ArchitecturePage() {
  return (
    <div className="min-h-screen pt-20">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-20 overflow-hidden">
        {/* Background grid */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(52, 211, 153, 0.15) 1px, transparent 1px),
                linear-gradient(90deg, rgba(52, 211, 153, 0.15) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
            }}
          />
          <motion.div
            className="absolute top-[-10%] left-[40%] w-[600px] h-[600px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--glow-primary-subtle) 0%, transparent 70%)',
            }}
            whileInView={{ scale: [1, 1.06, 1], opacity: [0.3, 0.6, 0.3] }}
            viewport={{ once: false, margin: '200px' }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        <div className="container relative z-10 !py-0 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center justify-center gap-3 mb-8"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/8 text-primary text-[10px] font-bold rounded-lg border border-primary/15 uppercase tracking-wide">
              <CircuitBoard size={12} />
              System Design
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-black tracking-tight leading-[0.95] mb-6"
          >
            How Scrollr <span className="text-gradient-primary">Works</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
            className="text-base text-base-content/45 max-w-xl mx-auto leading-relaxed"
          >
            From source API to your desktop in milliseconds. A decoupled,
            CDC-driven pipeline built on Go, Rust, React, and Redis.
          </motion.p>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ── DATA PIPELINE ────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Tinted section background */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

        <div className="container relative z-10">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              The <span className="text-gradient-primary">Pipeline</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Four stages from data source to your screen
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {PIPELINE_STEPS.map((step, i) => (
              <motion.div
                key={step.title}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.1,
                  duration: 0.6,
                  ease: EASE,
                }}
                className="group relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden hover:border-base-300/50 transition-colors"
              >
                {/* Accent top line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${step.hex} 50%, transparent)`,
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

                {/* Ambient glow orb on hover */}
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `${step.hex}10` }}
                />

                <div className="relative z-10">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-5">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{
                        background: `${step.hex}15`,
                        boxShadow: `0 0 20px ${step.hex}15, 0 0 0 1px ${step.hex}20`,
                      }}
                    >
                      <step.Icon size={20} className="text-base-content/80" />
                    </div>
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border font-mono"
                      style={{
                        background: `${step.hex}10`,
                        color: step.hex,
                        borderColor: `${step.hex}30`,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-base-content mb-2">
                    {step.title}
                  </h3>
                  <p className="text-xs text-base-content/40 leading-relaxed mb-4">
                    {step.description}
                  </p>

                  {/* Items */}
                  <div className="space-y-1.5 pt-4 border-t border-base-300/25">
                    {step.items.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <span
                          className="w-1 h-1 rounded-full"
                          style={{ background: `${step.hex}60` }}
                        />
                        <span className="text-[10px] font-mono text-base-content/30">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Watermark icon */}
                <step.Watermark
                  size={100}
                  strokeWidth={0.4}
                  className="absolute -bottom-3 -right-3 text-base-content/[0.025] pointer-events-none"
                />
              </motion.div>
            ))}
          </div>

          {/* Flow arrows between cards (desktop) */}
          <div className="hidden lg:flex items-center justify-center gap-2 mt-8">
            {PIPELINE_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-base-content/20 font-mono">
                  {step.label}
                </span>
                {i < PIPELINE_STEPS.length - 1 && (
                  <ArrowRight size={12} className="text-primary/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CDC FLOW ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="container">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              CDC Record <span className="text-gradient-primary">Flow</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              How a single data change reaches the right user
            </p>
          </motion.div>

          {/* Two-column: flow diagram left, decorative SVG right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Flow diagram */}
            <div className="space-y-0">
              {CDC_FLOW.map((step, i) => (
                <motion.div
                  key={step.label}
                  style={{ opacity: 0 }}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    delay: i * 0.08,
                    duration: 0.5,
                    ease: EASE,
                  }}
                >
                  <div className="group flex items-center gap-4 p-4 bg-base-200/40 border border-base-300/25 rounded-xl hover:border-base-300/50 transition-colors">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: `${step.hex}15`,
                        boxShadow: `0 0 20px ${step.hex}15, 0 0 0 1px ${step.hex}20`,
                      }}
                    >
                      <step.Icon size={16} className="text-base-content/80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-base-content">
                        {step.label}
                      </p>
                      <p className="text-[10px] font-mono text-base-content/30 truncate">
                        {step.detail}
                      </p>
                    </div>
                    <span className="text-[9px] font-mono text-base-content/20 font-black shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  {i < CDC_FLOW.length - 1 && (
                    <div className="flex justify-start pl-7 py-1.5">
                      <ArrowDown size={14} className="text-primary/25" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            {/* Decorative node graph — right side (desktop only) */}
            <motion.div
              style={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.3, ease: EASE }}
              className="hidden lg:flex items-center justify-center"
            >
              <svg
                viewBox="0 0 320 400"
                fill="none"
                className="w-full max-w-xs text-primary"
                aria-hidden
              >
                {/* Grid dots */}
                {Array.from({ length: 8 }).map((_row, row) =>
                  Array.from({ length: 6 }).map((_col, col) => (
                    <circle
                      key={`dot-${row}-${col}`}
                      cx={30 + col * 52}
                      cy={25 + row * 50}
                      r={1}
                      fill="currentColor"
                      opacity={0.08}
                    />
                  )),
                )}

                {/* Connection lines */}
                <line
                  x1="82"
                  y1="75"
                  x2="238"
                  y2="75"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.08"
                />
                <line
                  x1="160"
                  y1="75"
                  x2="160"
                  y2="175"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.1"
                />
                <line
                  x1="82"
                  y1="175"
                  x2="238"
                  y2="175"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.08"
                />
                <line
                  x1="82"
                  y1="175"
                  x2="82"
                  y2="275"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.1"
                />
                <line
                  x1="238"
                  y1="175"
                  x2="238"
                  y2="275"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.1"
                />
                <line
                  x1="82"
                  y1="275"
                  x2="238"
                  y2="275"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.08"
                />
                <line
                  x1="160"
                  y1="275"
                  x2="160"
                  y2="350"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.1"
                />

                {/* Animated pulse lines */}
                <motion.line
                  x1="160"
                  y1="75"
                  x2="160"
                  y2="175"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity="0.25"
                  strokeDasharray="6 6"
                  animate={{ strokeDashoffset: [0, -24] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                />
                <motion.line
                  x1="160"
                  y1="275"
                  x2="160"
                  y2="350"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  opacity="0.25"
                  strokeDasharray="6 6"
                  animate={{ strokeDashoffset: [0, -24] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'linear',
                    delay: 0.5,
                  }}
                />

                {/* Nodes */}
                <rect
                  x="134"
                  y="50"
                  width="52"
                  height="52"
                  rx="4"
                  fill="currentColor"
                  opacity="0.05"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity="0.15"
                />
                <text
                  x="160"
                  y="80"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.3"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  SRC
                </text>

                <rect
                  x="134"
                  y="150"
                  width="52"
                  height="52"
                  rx="4"
                  fill="currentColor"
                  opacity="0.08"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity="0.2"
                />
                <text
                  x="160"
                  y="180"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.4"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  CDC
                </text>

                <rect
                  x="56"
                  y="250"
                  width="52"
                  height="52"
                  rx="4"
                  fill="currentColor"
                  opacity="0.05"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity="0.15"
                />
                <text
                  x="82"
                  y="280"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.3"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  USR:A
                </text>

                <rect
                  x="212"
                  y="250"
                  width="52"
                  height="52"
                  rx="4"
                  fill="currentColor"
                  opacity="0.05"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity="0.15"
                />
                <text
                  x="238"
                  y="280"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.3"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  USR:B
                </text>

                <rect
                  x="134"
                  y="330"
                  width="52"
                  height="52"
                  rx="4"
                  fill="currentColor"
                  opacity="0.06"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeOpacity="0.2"
                />
                <text
                  x="160"
                  y="360"
                  textAnchor="middle"
                  fill="currentColor"
                  opacity="0.35"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  SSE
                </text>

                {/* Pulsing center dot */}
                <motion.circle
                  cx="160"
                  cy="176"
                  r="3"
                  fill="currentColor"
                  animate={{
                    opacity: [0.2, 0.6, 0.2],
                    scale: [1, 1.67, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              </svg>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── ARCHITECTURE PRINCIPLES ──────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Tinted section background */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

        <div className="container relative z-10">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Design <span className="text-gradient-primary">Principles</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              The rules that shape every architectural decision
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
            {PRINCIPLES.map((principle, i) => (
              <motion.div
                key={principle.title}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.1,
                  duration: 0.6,
                  ease: EASE,
                }}
                className="group relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden hover:border-base-300/50 transition-colors"
              >
                {/* Accent top line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${principle.hex} 50%, transparent)`,
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

                {/* Ambient glow orb on hover */}
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `${principle.hex}10` }}
                />

                <div className="relative z-10 flex items-start gap-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                    style={{
                      background: `${principle.hex}15`,
                      boxShadow: `0 0 20px ${principle.hex}15, 0 0 0 1px ${principle.hex}20`,
                    }}
                  >
                    <principle.Icon
                      size={20}
                      className="text-base-content/80"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-base-content mb-1">
                      {principle.title}
                    </p>
                    <p className="text-xs text-base-content/40 leading-relaxed">
                      {principle.description}
                    </p>
                  </div>
                </div>

                {/* Watermark icon */}
                <principle.Watermark
                  size={100}
                  strokeWidth={0.4}
                  className="absolute -bottom-3 -right-3 text-base-content/[0.025] pointer-events-none"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TECH STACK ───────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="container pb-8">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="text-center mb-12 sm:mb-16"
          >
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
              Tech <span className="text-gradient-primary">Stack</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              What powers each layer
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {TECH_STACK.map((group, i) => (
              <motion.div
                key={group.category}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.08,
                  duration: 0.6,
                  ease: EASE,
                }}
                className="group relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden hover:border-base-300/50 transition-colors"
              >
                {/* Accent top line */}
                <div
                  className="absolute top-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${group.hex} 50%, transparent)`,
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

                {/* Ambient glow orb on hover */}
                <div
                  className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `${group.hex}10` }}
                />

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-5">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{
                        background: `${group.hex}15`,
                        boxShadow: `0 0 20px ${group.hex}15, 0 0 0 1px ${group.hex}20`,
                      }}
                    >
                      <group.Icon size={16} className="text-base-content/80" />
                    </div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-base-content/60">
                      {group.category}
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <div key={item.name}>
                        <p className="text-xs font-bold text-base-content mb-0.5">
                          {item.name}
                        </p>
                        <p className="text-[10px] font-mono text-base-content/30">
                          {item.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Watermark icon */}
                <group.Watermark
                  size={100}
                  strokeWidth={0.4}
                  className="absolute -bottom-3 -right-3 text-base-content/[0.025] pointer-events-none"
                />
              </motion.div>
            ))}
          </div>

          {/* Source link */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
            className="flex items-center justify-center gap-4 mt-12"
          >
            <span className="h-px w-8 bg-base-300/30" />
            <span className="text-xs text-base-content/25">
              Built and deployed on self-hosted infrastructure
            </span>
            <span className="h-px w-8 bg-base-300/30" />
          </motion.div>
        </div>
      </section>
    </div>
  )
}
