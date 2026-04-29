import { motion } from 'motion/react'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  ArrowUpRight,
  Code,
  Code2,
  Eye,
  GitFork,
  Github,
  Heart,
  Lightbulb,
  MessageSquare,
  Star,
  Users,
} from 'lucide-react'

import type { GitHubStats } from '@/hooks/useGitHubStats'
import { useGitHubStats } from '@/hooks/useGitHubStats'

// ── Constants ────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const
const REPO = 'brandon-relentnet/myscrollr'

// ── "What we refuse" badges ─────────────────────────────────────

const REFUSALS = [
  'Read other apps',
  'Collect personal data',
  'Show you ads',
  'Sell to data brokers',
] as const

// ── Principle cards ─────────────────────────────────────────────

interface Principle {
  icon: typeof Eye
  title: string
  highlight: string
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
    icon: Eye,
    title: 'Fully Auditable',
    highlight: 'Every line is public',
    body: 'No secret tracking, no hidden code, no fine print. The entire codebase is publicly available for anyone to inspect.',
    accent: {
      text: 'text-primary',
      ring: 'rgba(52,211,153,0.25)',
      glow: 'rgba(52,211,153,0.12)',
      gradient: 'rgba(52,211,153,0.06)',
    },
  },
  {
    icon: Users,
    title: 'Community Driven',
    highlight: 'Made by the people who use it',
    body: 'Built and maintained by developers who rely on Scrollr every day. No investors, no monetization playbook — just useful software.',
    accent: {
      text: 'text-info',
      ring: 'rgba(0,212,255,0.25)',
      glow: 'rgba(0,212,255,0.12)',
      gradient: 'rgba(0,212,255,0.06)',
    },
  },
  {
    icon: Heart,
    title: 'Actively Maintained',
    highlight: 'Shipping fixes and features constantly',
    body: "New features, fixes, and improvements ship regularly. If something bugs you, it probably won't for long.",
    accent: {
      text: 'text-secondary',
      ring: 'rgba(255,71,87,0.25)',
      glow: 'rgba(255,71,87,0.12)',
      gradient: 'rgba(255,71,87,0.06)',
    },
  },
]

// ── Coming-soon channel icons ────────────────────────────────────

const COMING_SOON_ICONS = [
  { name: 'Discord', emoji: '💬' },
  { name: 'Twitch', emoji: '📺' },
  { name: 'Reddit', emoji: '📖' },
  { name: 'GitHub', emoji: '🐙' },
  { name: 'YouTube', emoji: '▶' },
  { name: 'Spotify', emoji: '🎵' },
]

// ── Principle Card ───────────────────────────────────────────────

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
        delay: 0.08 + index * 0.1,
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

      {/* Icon badge with glow */}
      <div className="relative mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center"
          style={{
            background: accent.glow,
            boxShadow: `0 0 20px ${accent.glow}, 0 0 0 1px ${accent.ring}`,
          }}
        >
          <Icon size={20} className="text-base-content/80" />
        </div>
      </div>

      {/* Text content */}
      <div className="relative">
        <h3 className="text-[15px] font-bold text-base-content mb-1">
          {principle.title}
        </h3>
        <p
          className={`text-sm font-semibold ${accent.text} mb-2.5 leading-snug`}
        >
          {principle.highlight}
        </p>
        <p className="text-sm text-base-content/45 leading-relaxed">
          {principle.body}
        </p>
      </div>
    </motion.div>
  )
}

// ── GitHub Stats Row ─────────────────────────────────────────────

function GitHubFooter({ stats }: { stats: GitHubStats | null }) {
  return (
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

      {/* Card */}
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
              <Code size={16} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-base-content/70">
                Fully open source
              </p>
              <p className="text-xs text-base-content/30">
                Inspect, fork, or contribute on GitHub
              </p>
            </div>
          </div>

          {/* Right: stats + links */}
          <div className="flex items-center gap-3">
            {/* Live stats */}
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
                <Link
                  to="/support"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-accent/50 hover:text-accent hover:bg-accent/[0.06] transition-[color,background-color] duration-200"
                >
                  <MessageSquare className="size-3.5" />
                  <span className="font-semibold">Discuss</span>
                </Link>
              </div>
            )}

            {/* Divider */}
            <span className="hidden sm:block w-px h-6 bg-base-300/20" />

            {/* Architecture link */}
            <Link
              to="/architecture"
              className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-base-300/25 bg-base-200/40 text-sm font-semibold text-base-content/50 hover:text-primary hover:border-primary/25 transition-[color,border-color] duration-200"
            >
              <span>How It Works</span>
              <ArrowRight
                size={14}
                className="group-hover:translate-x-0.5 transition-transform duration-200"
              />
            </Link>

            {/* GitHub link */}
            <a
              href={`https://github.com/${REPO}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-base-300/25 bg-base-200/40 text-sm font-semibold text-base-content/50 hover:text-primary hover:border-primary/25 transition-[color,border-color] duration-200"
            >
              <Github className="size-4" />
              <span>View on GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main Component ───────────────────────────────────────────────

export function TrustSection() {
  const stats = useGitHubStats(REPO)

  return (
    <section className="relative py-24 lg:py-32">
      {/* Background band */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

      <div className="container relative">
        {/* ── Header ── */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-10 lg:mb-14"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4">
            Transparent by <span className="text-gradient-primary">Design</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-lg">
            Open source, zero analytics, no accounts. Your device, your data —
            we never see it.
          </p>
        </motion.div>

        {/* ── "What we refuse" badges ── */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex flex-wrap justify-center gap-2.5 sm:gap-3 mb-14 lg:mb-18"
        >
          {REFUSALS.map((item, i) => (
            <motion.span
              key={item}
              style={{ opacity: 0 }}
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{
                delay: 0.06 + i * 0.08,
                duration: 0.4,
                ease: EASE,
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] bg-error/[0.06] border border-error/[0.1] text-base-content/35 line-through decoration-error/25"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                className="shrink-0 text-error/40"
                aria-hidden="true"
              >
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {item}
            </motion.span>
          ))}
        </motion.div>

        {/* ── Principle cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6 max-w-4xl mx-auto mb-14 lg:mb-18">
          {PRINCIPLES.map((principle, i) => (
            <PrincipleCard
              key={principle.title}
              principle={principle}
              index={i}
            />
          ))}
        </div>

        {/* ── Community: Create / Suggest cards ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl mx-auto mb-14 lg:mb-18">
          {/* Card 1: Create (for developers) */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1, duration: 0.6, ease: EASE }}
            className="group relative bg-base-200/40 border border-base-300/25 rounded-xl overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-primary/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-primary/0 group-hover:via-primary/20 to-transparent transition-[background] duration-500" />

            <div className="relative z-10 p-8 lg:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-primary/8 border border-primary/15 flex items-center justify-center text-primary">
                  <Code2 size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-base-content">
                    Create a Channel
                  </h3>
                  <p className="text-[10px] text-primary/50">For developers</p>
                </div>
              </div>

              <p className="text-sm text-base-content/40 leading-relaxed mb-6">
                Every channel is a self-contained package — your own API, your
                own service, your own UI components. Follow the architecture,
                ship your plugin. The ecosystem grows with every contributor.
              </p>

              <div className="relative rounded-xl border border-base-300/40 bg-base-100/50 overflow-hidden mb-6 p-5">
                <p className="text-[9px] text-base-content/20 mb-4">
                  Each channel includes:
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Go API', desc: 'HTTP endpoints' },
                    { label: 'Rust Service', desc: 'Data ingestion' },
                    { label: 'Dashboard Tab', desc: 'Web UI component' },
                    { label: 'Feed Tab', desc: 'Desktop component' },
                  ].map((item, i) => (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.06 }}
                      className="flex flex-col gap-0.5 px-3 py-2.5 rounded-lg bg-base-200/60 border border-base-300/30"
                    >
                      <span className="text-[11px] font-semibold text-base-content/60">
                        {item.label}
                      </span>
                      <span className="text-[9px] text-base-content/25">
                        {item.desc}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>

              <a
                href="https://github.com/brandon-relentnet/myscrollr"
                target="_blank"
                rel="noopener noreferrer"
                className="group/link inline-flex items-center gap-2.5 px-5 py-2.5 text-[11px] font-semibold border border-base-300/25 text-base-content/60 rounded-lg hover:border-primary/30 hover:text-primary transition-colors"
              >
                <Github size={14} />
                View on GitHub
                <ArrowUpRight
                  size={12}
                  className="opacity-0 group-hover/link:opacity-100 transition-opacity"
                />
              </a>
            </div>
          </motion.div>

          {/* Card 2: Suggest (for everyone) */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.6, ease: EASE }}
            className="group relative bg-base-200/40 border border-base-300/25 rounded-xl overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-info/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
            <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-info/0 group-hover:via-info/20 to-transparent transition-[background] duration-500" />

            <div className="relative z-10 p-8 lg:p-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-info/8 border border-info/15 flex items-center justify-center text-info">
                  <Lightbulb size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-base-content whitespace-nowrap">
                    Suggest a Channel
                  </h3>
                  <p className="text-[10px] text-info/50">For everyone</p>
                </div>
              </div>

              <p className="text-sm text-base-content/40 leading-relaxed mb-6">
                Don't code? No problem. The best channels start as community
                ideas. Tell us what platforms and data you want in your feed —
                we'll make it happen.
              </p>

              <div className="rounded-xl border border-base-300/40 bg-base-100/50 p-5 mb-6">
                <p className="text-[9px] text-base-content/20 mb-4">
                  Community requested · On the roadmap
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {COMING_SOON_ICONS.map((item, i) => (
                    <motion.div
                      key={item.name}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.35 + i * 0.05 }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-base-200/60 border border-base-300/30"
                    >
                      <span className="text-sm leading-none">{item.emoji}</span>
                      <span className="text-[10px] text-base-content/30 truncate">
                        {item.name}
                      </span>
                    </motion.div>
                  ))}
                </div>
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.7 }}
                  className="mt-2.5 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-primary/20 bg-primary/[0.03] text-primary/40 hover:text-primary/60 hover:border-primary/30 transition-colors cursor-default"
                >
                  <span className="text-lg leading-none">+</span>
                  <span className="text-[10px]">Yours could be next</span>
                </motion.div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="https://discord.gg/85b49TcGJa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link inline-flex items-center gap-2.5 px-5 py-2.5 text-[11px] font-semibold border border-base-300/25 text-base-content/60 rounded-lg hover:border-info/30 hover:text-info transition-colors"
                >
                  <MessageSquare size={14} />
                  Join Discord
                  <ArrowUpRight
                    size={12}
                    className="opacity-0 group-hover/link:opacity-100 transition-opacity"
                  />
                </a>
                <Link
                  to="/support"
                  className="group/link inline-flex items-center gap-2 text-[11px] font-semibold text-base-content/30 hover:text-info transition-colors"
                >
                  Propose an Idea
                  <ArrowUpRight
                    size={12}
                    className="opacity-0 group-hover/link:opacity-100 transition-opacity"
                  />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── GitHub footer ── */}
        <GitHubFooter stats={stats} />
      </div>
    </section>
  )
}
