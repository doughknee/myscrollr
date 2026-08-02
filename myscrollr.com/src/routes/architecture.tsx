import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'

import { BASE_URL, seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import { EASE } from '@/lib/animations'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'

// TechArticle JSON-LD for the architecture deep-dive page.
// Per Google: TechArticle requires `headline`, `image`, `datePublished`.
// We don't have a stable publish date for this evergreen page, so we
// use the build date — accepted by validators and refreshed each deploy.
const ARCHITECTURE_TECH_ARTICLE = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: 'Scrollr Architecture: How Real-Time Data Reaches Your Desktop',
  description:
    'Behind the scenes: how Scrollr delivers real-time finance, sports, news, and fantasy data from source APIs through CDC PubSub to your desktop.',
  image: `${BASE_URL}/og/architecture.png`,
  author: { '@type': 'Organization', name: 'Scrollr', url: BASE_URL },
  publisher: {
    '@type': 'Organization',
    name: 'Scrollr',
    url: BASE_URL,
    logo: { '@type': 'ImageObject', url: `${BASE_URL}/icon-128.png` },
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().slice(0, 10),
  mainEntityOfPage: { '@type': 'WebPage', '@id': `${BASE_URL}/architecture` },
}

export const Route = createFileRoute('/architecture')({
  head: () =>
    seo({
      title: 'Scrollr Architecture: How Real-Time Data Reaches You',
      description:
        'Behind the scenes: how Scrollr delivers real-time finance, sports, news, and fantasy data from source APIs through CDC PubSub to your desktop. Built with Go, Rust, React, PostgreSQL, and Redis.',
      path: '/architecture',
      image: 'https://myscrollr.com/og/architecture.png',
      type: 'article',
      jsonLd: [
        organization,
        ARCHITECTURE_TECH_ARTICLE,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Architecture', path: '/architecture' },
        ]),
      ],
    }),
  component: ArchitecturePage,
})

// ── Channel hex map ────────────────────────────────────────────
const HEX = {
  primary: '#34d399',
  secondary: '#ff4757',
  info: '#00b8db',
  accent: '#a855f7',
} as const

// ── Pipeline Steps ─────────────────────────────────────────────

interface PipelineStep {
  title: string
  description: string
  hex: string
  label: string
  items: Array<string>
}

const PIPELINE_STEPS: Array<PipelineStep> = [
  {
    title: 'Data Sources',
    description:
      'TwelveData WebSocket for market data, ESPN API for scores, RSS/Atom feeds for news, Yahoo Fantasy API for leagues.',
    hex: HEX.primary,
    label: 'INGEST',
    items: ['TwelveData WS', 'ESPN HTTP', 'Yahoo API', 'RSS Feeds'],
  },
  {
    title: 'Ingestion Services',
    description:
      'Four independent Rust services collect, normalize, and write data to PostgreSQL. Each runs its own schedule and connection strategy.',
    hex: HEX.info,
    label: 'PROCESS',
    items: ['Finance :3001', 'Sports :3002', 'RSS :3004', 'Kalshi :3005'],
  },
  {
    title: 'PostgreSQL + CDC',
    description:
      'All data lands in PostgreSQL. Sequin monitors table changes via CDC (Change Data Capture) and fires webhooks to the core API.',
    hex: HEX.secondary,
    label: 'DETECT',
    items: ['trades', 'games', 'rss_items', 'yahoo_*'],
  },
  {
    title: 'Real-time Delivery',
    description:
      'Core API maps each CDC record to a topic in-process and publishes via Redis pub/sub. Every replica fans out to its own SSE clients.',
    hex: HEX.accent,
    label: 'DELIVER',
    items: ['Topic Routing', 'Redis Pub/Sub', 'SSE Stream', 'Per-user'],
  },
]

// ── CDC Flow Steps ─────────────────────────────────────────────

interface CdcStep {
  label: string
  detail: string
  hex: string
}

const CDC_FLOW: Array<CdcStep> = [
  { label: 'Rust Service', detail: 'Writes to PostgreSQL', hex: HEX.info },
  { label: 'Sequin CDC', detail: 'Detects row changes', hex: HEX.secondary },
  { label: 'Core API', detail: 'POST /webhooks/sequin', hex: HEX.primary },
  {
    label: 'Topic Router',
    detail: 'record → cdc:{source}:{key}',
    hex: HEX.info,
  },
  { label: 'Redis Pub/Sub', detail: 'events:user:{sub}', hex: HEX.accent },
  { label: 'SSE → Client', detail: 'Desktop App', hex: HEX.primary },
]

// ── Architecture Principles ────────────────────────────────────

interface Principle {
  title: string
  description: string
  hex: string
}

const PRINCIPLES: Array<Principle> = [
  {
    title: 'Isolated Ingestion',
    description:
      'Each data source has its own Rust ingestion service with an independent schedule, quota budget, and crash blast radius. Widget read APIs live inside the core gateway.',
    hex: HEX.primary,
  },
  {
    title: 'Zero-trust Gateway',
    description:
      'Core API validates JWTs at the edge. The one proxied service (Fantasy) never sees tokens — it trusts identity headers injected by the gateway.',
    hex: HEX.secondary,
  },
  {
    title: 'Self-registration',
    description:
      'The Fantasy service registers in Redis on startup with a 30s TTL heartbeat and is discovered dynamically. First-party widget sources are served natively by core.',
    hex: HEX.info,
  },
  {
    title: 'Server-authoritative catalog',
    description:
      'One catalog defines every widget, served from the API. The desktop fetches it and renders generically, so a new widget ships without a new release.',
    hex: HEX.accent,
  },
]

// ── Tech Stack ─────────────────────────────────────────────────

interface TechGroup {
  category: string
  hex: string
  items: Array<{ name: string; detail: string }>
}

const TECH_STACK: Array<TechGroup> = [
  {
    category: 'Core API',
    hex: HEX.primary,
    items: [
      { name: 'Go 1.25', detail: 'Fiber v2, pgx, Redis' },
      { name: 'SSE Hub', detail: 'Per-user Redis Pub/Sub channels' },
      { name: 'Logto', detail: 'Self-hosted OIDC, JWT validation' },
    ],
  },
  {
    category: 'Ingestion',
    hex: HEX.info,
    items: [
      { name: 'Rust', detail: 'tokio async runtime' },
      { name: 'WebSocket', detail: 'TwelveData persistent connection' },
      { name: 'HTTP Polling', detail: 'ESPN 60s, RSS 5min, Yahoo 120s' },
    ],
  },
  {
    category: 'Frontend',
    hex: HEX.accent,
    items: [
      { name: 'React 19', detail: 'Vite 7, TanStack Router' },
      { name: 'Tailwind v4', detail: 'daisyUI theme system' },
      { name: 'Motion', detail: 'Production-grade animations' },
    ],
  },
  {
    category: 'Desktop',
    hex: HEX.secondary,
    items: [
      { name: 'Tauri v2', detail: 'Cross-platform native shell' },
      { name: 'React 19', detail: 'Multi-window UI' },
      { name: 'SSE + Polling', detail: 'Real-time data delivery' },
    ],
  },
  {
    category: 'Infrastructure',
    hex: HEX.primary,
    items: [
      { name: 'PostgreSQL', detail: 'Shared DB, natural table isolation' },
      { name: 'Redis', detail: 'Cache, Pub/Sub, registration' },
      { name: 'Sequin', detail: 'CDC webhooks from PostgreSQL' },
    ],
  },
  {
    category: 'Deployment',
    hex: HEX.info,
    items: [
      { name: 'Kubernetes', detail: 'DigitalOcean DOKS + DOCR' },
      { name: 'GitHub Actions', detail: 'Build, deploy, smoke test' },
      { name: 'nginx + cert-manager', detail: 'Ingress, TLS' },
    ],
  },
]

// ── Motion helpers ─────────────────────────────────────────────

const reveal = (index = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: EASE, delay: index * 0.08 },
})

const revealX = (index = 0) => ({
  initial: { opacity: 0, x: -20 },
  whileInView: { opacity: 1, x: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, ease: EASE, delay: index * 0.08 },
})

// ── Section intro (display heading + muted sub) ────────────────

function SectionIntro({
  line1,
  outline,
  sub,
}: {
  line1: string
  outline: string
  sub: string
}) {
  return (
    <motion.div {...reveal(0)}>
      <h2 className="type-display m-0 text-[clamp(30px,4vw,52px)]">
        {line1} <span className="type-outline">{outline}</span>
      </h2>
      <p className="mb-0 mt-3 max-w-lg text-base leading-relaxed text-base-content/55">
        {sub}
      </p>
    </motion.div>
  )
}

// ── Page Component ─────────────────────────────────────────────

function ArchitecturePage() {
  return (
    <div>
      <PageHeader
        eyebrowLeft="ARCHITECTURE ／ SYSTEM DESIGN"
        eyebrowRight="GO · RUST · REACT · REDIS"
        line1="How Scrollr"
        line2="works."
        sub="From source API to your desktop in milliseconds. A decoupled, CDC-driven pipeline built on Go, Rust, React, and Redis."
      />

      {/* ── SEC 01 ／ THE PIPELINE ───────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 01 ／ THE PIPELINE"
            stat={`${PIPELINE_STEPS.length} STAGES · SOURCE → SCREEN`}
          />
          <div className="py-10 sm:py-14">
            <SectionIntro
              line1="The"
              outline="pipeline"
              sub="Four stages from data source to your screen"
            />

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {PIPELINE_STEPS.map((step, i) => (
                <motion.div
                  key={step.title}
                  {...reveal(i)}
                  className="relative overflow-hidden rounded-[8px] border border-hairline bg-panel p-6"
                >
                  {/* Accent top line */}
                  <div
                    className="absolute inset-x-0 top-0 h-px"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${step.hex} 50%, transparent)`,
                    }}
                  />

                  <div className="mb-4 flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.14em] text-base-content/40">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span
                      className="rounded-[3px] border px-2 py-[3px] font-mono text-[10px] font-bold tracking-[0.12em]"
                      style={{ color: step.hex, borderColor: `${step.hex}55` }}
                    >
                      {step.label}
                    </span>
                  </div>

                  <h3 className="m-0 text-[15px] font-bold uppercase tracking-[0.02em] text-base-content">
                    {step.title}
                  </h3>
                  <p className="mb-0 mt-2 text-[13px] leading-relaxed text-base-content/55">
                    {step.description}
                  </p>

                  <div className="mt-4 space-y-1.5 border-t border-hairline-minor pt-4">
                    {step.items.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-[1px]"
                          style={{ background: step.hex }}
                        />
                        <span className="font-mono text-[11px] text-base-content/45">
                          {item}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Flow strip (desktop) */}
            <div className="mt-8 hidden items-center justify-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-base-content/35 lg:flex">
              {PIPELINE_STEPS.map((step, i) => (
                <span key={step.label} className="flex items-center gap-3">
                  <span>{step.label}</span>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <span aria-hidden="true" className="text-primary/50">
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </TerminalContainer>
      </section>

      {/* ── SEC 02 ／ CDC RECORD FLOW ────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 02 ／ CDC RECORD FLOW"
            stat={`${CDC_FLOW.length} HOPS`}
          />
          <div className="py-10 sm:py-14">
            <SectionIntro
              line1="CDC record"
              outline="flow"
              sub="How a single data change reaches the right user"
            />

            <div className="mt-10 grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
              {/* Flow diagram */}
              <div>
                {CDC_FLOW.map((step, i) => (
                  <motion.div key={step.label} {...revealX(i)}>
                    <div className="flex items-center gap-4 rounded-[4px] border border-hairline bg-panel px-4 py-3.5">
                      <span className="font-mono text-[10px] text-base-content/35">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className="h-2 w-2 shrink-0 rounded-[1px]"
                        style={{ background: step.hex }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[13px] font-bold uppercase tracking-[0.02em] text-base-content">
                          {step.label}
                        </p>
                        <p className="m-0 truncate font-mono text-[11px] text-base-content/45">
                          {step.detail}
                        </p>
                      </div>
                    </div>
                    {i < CDC_FLOW.length - 1 && (
                      <div
                        aria-hidden="true"
                        className="py-1 pl-4 font-mono text-xs text-primary/40"
                      >
                        ↓
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* Decorative node graph — right side (desktop only) */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: 0.3, ease: EASE }}
                className="hidden items-center justify-center lg:flex"
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
        </TerminalContainer>
      </section>

      {/* ── SEC 03 ／ DESIGN PRINCIPLES ──────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 03 ／ DESIGN PRINCIPLES"
            stat={`${PRINCIPLES.length} RULES`}
          />
          <div className="py-10 sm:py-14">
            <SectionIntro
              line1="Design"
              outline="principles"
              sub="The rules that shape every architectural decision"
            />

            <div className="mt-10">
              {PRINCIPLES.map((principle, i) => (
                <motion.div
                  key={principle.title}
                  {...reveal(i)}
                  className="grid grid-cols-[64px_1fr] items-baseline gap-x-6 gap-y-1 border-t border-hairline-minor px-3 py-6 sm:grid-cols-[84px_260px_1fr]"
                >
                  <span
                    className="font-mono text-xs"
                    style={{ color: principle.hex }}
                  >
                    PR—{String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-display text-lg font-bold uppercase leading-tight tracking-[0.01em] text-base-content">
                    {principle.title}
                  </span>
                  <span className="col-start-2 max-w-[640px] text-sm leading-relaxed text-base-content/55 sm:col-start-3">
                    {principle.description}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </TerminalContainer>
      </section>

      {/* ── SEC 04 ／ TECH STACK ─────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 04 ／ TECH STACK"
            stat={`${TECH_STACK.length} LAYERS`}
          />
          <div className="py-10 sm:py-14">
            <SectionIntro
              line1="Tech"
              outline="stack"
              sub="What powers each layer"
            />

            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TECH_STACK.map((group, i) => (
                <motion.div
                  key={group.category}
                  {...reveal(i)}
                  className="relative overflow-hidden rounded-[8px] border border-hairline bg-panel p-6"
                >
                  {/* Accent top line */}
                  <div
                    className="absolute inset-x-0 top-0 h-px"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${group.hex} 50%, transparent)`,
                    }}
                  />

                  <h3
                    className="m-0 mb-5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: group.hex }}
                  >
                    {group.category}
                  </h3>
                  <div className="space-y-3">
                    {group.items.map((item) => (
                      <div key={item.name}>
                        <p className="m-0 mb-0.5 text-[13px] font-bold text-base-content">
                          {item.name}
                        </p>
                        <p className="m-0 font-mono text-[11px] text-base-content/45">
                          {item.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Infra note */}
            <motion.div
              {...reveal(2)}
              className="mt-12 flex items-center justify-center gap-4"
            >
              <span aria-hidden="true" className="h-px w-8 bg-hairline" />
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-base-content/40">
                Built and deployed on self-hosted infrastructure
              </span>
              <span aria-hidden="true" className="h-px w-8 bg-hairline" />
            </motion.div>
          </div>
        </TerminalContainer>
      </section>

      {/* ── SEC 05 ／ WHERE NEXT ─────────────────────────────────
          Internal-link CTA pair. Keeps technical readers on the
          site after they've finished the deep-dive: explore the
          widget catalog or just install the app. */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 05 ／ WHERE NEXT" />
          {/* -mt-px collapses the first row's border-t into the
              SectionRow's border-b so hairlines never double. */}
          <div className="-mt-px pb-4">
            <DeparturesRow
              index="01"
              label="Browse widgets"
              meta="Every source the pipeline serves, in one catalog."
              action="/CHANNELS →"
              to="/widgets"
            />
            <DeparturesRow
              index="02"
              label="Download Scrollr"
              meta="The end of the pipeline, on your desktop."
              action="DOWNLOAD ↓"
              to="/download"
            />
          </div>
        </TerminalContainer>
      </section>
    </div>
  )
}
