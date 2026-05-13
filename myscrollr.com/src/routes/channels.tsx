import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  BookOpen,
  Clock,
  Cloud,
  Code2,
  Cpu,
  Ghost,
  Lightbulb,
  MessageSquare,
  Music,
  Play,
  Plus,
  Puzzle,
  Rss,
  Timer,
  TrendingUp,
  Trophy,
  Tv,
} from 'lucide-react'

import { motion } from 'motion/react'
import type { ComponentType } from 'react'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'

export const Route = createFileRoute('/channels')({
  head: () =>
    seo({
      title: 'Channels — Scrollr',
      description:
        'Browse the channels and widgets available in the Scrollr desktop app: Finance, Sports, News, Fantasy, Clock, Timer, Weather, and System Monitor. Plus upcoming integrations.',
      path: '/channels',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Channels', path: '/channels' },
      ]),
    }),
  component: ChannelsPage,
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

// ── Channel Definitions ────────────────────────────────────────

interface ChannelDef {
  id: string
  name: string
  description: string
  detail: string
  Icon: ComponentType<{ size?: number; className?: string }>
  hex: string
  Watermark: ComponentType<{
    size?: number
    strokeWidth?: number
    className?: string
  }>
}

interface ComingSoonChannel {
  id: string
  name: string
  description: string
  Icon: ComponentType<{ size?: number; className?: string }>
}

const CHANNELS: Array<ChannelDef> = [
  {
    id: 'finance',
    name: 'Finance',
    description: 'Real-time market data',
    detail:
      'Tracked symbols across stocks and crypto via TwelveData WebSocket. Live price changes, percentage moves, and directional indicators.',
    Icon: TrendingUp,
    hex: HEX.primary,
    Watermark: TrendingUp,
  },
  {
    id: 'sports',
    name: 'Sports',
    description: 'Live scores & schedules',
    detail:
      'NFL, NBA, NHL, and MLB scores from ESPN. Game states, team matchups, and real-time score updates polling every minute.',
    Icon: Trophy,
    hex: HEX.secondary,
    Watermark: Trophy,
  },
  {
    id: 'rss',
    name: 'RSS Feeds',
    description: 'Custom news streams',
    detail:
      '100+ curated feeds across 8 categories. Subscribe to the sources you care about and get articles delivered in real-time.',
    Icon: Rss,
    hex: HEX.info,
    Watermark: Rss,
  },
  {
    id: 'fantasy',
    name: 'Yahoo Fantasy',
    description: 'Fantasy sports leagues',
    detail:
      'Connect your Yahoo account to view league standings, team rosters, weekly matchups, and live scoring across all your fantasy leagues.',
    Icon: Ghost,
    hex: HEX.accent,
    Watermark: Ghost,
  },
]

const COMING_SOON: Array<ComingSoonChannel> = [
  {
    id: 'discord',
    name: 'Discord',
    description: 'Server activity & notifications',
    Icon: MessageSquare,
  },
  {
    id: 'twitch',
    name: 'Twitch',
    description: 'Stream alerts & follows',
    Icon: Tv,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    description: 'Subreddit feeds & trending',
    Icon: BookOpen,
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Activity & notifications',
    Icon: Code2,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Subscription updates',
    Icon: Play,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    description: 'Now playing & activity',
    Icon: Music,
  },
]

// ── Widget Definitions ─────────────────────────────────────────

interface WidgetDef {
  id: string
  name: string
  description: string
  detail: string
  Icon: ComponentType<{ size?: number; className?: string }>
  hex: string
  platforms: string
}

const WIDGETS: Array<WidgetDef> = [
  {
    id: 'clock',
    name: 'World Clock',
    description: 'Multiple timezone display',
    detail:
      'Track time across 18 cities worldwide. Auto-detects your local timezone with add/remove city management.',
    Icon: Clock,
    hex: '#6366f1',
    platforms: 'Desktop',
  },
  {
    id: 'timer',
    name: 'Timer',
    description: 'Pomodoro, countdown & stopwatch',
    detail:
      'Three modes in one widget. Pomodoro with session tracking, countdown presets from 1-60 minutes, and a simple stopwatch. Keyboard shortcuts included.',
    Icon: Timer,
    hex: '#f59e0b',
    platforms: 'Desktop',
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Current conditions for your cities',
    detail:
      'Search and add any city worldwide. Shows temperature, feels-like, humidity, wind, and conditions. Auto-refreshes every 10 minutes. No API key needed.',
    Icon: Cloud,
    hex: '#0ea5e9',
    platforms: 'Desktop',
  },
  {
    id: 'sysmon',
    name: 'System Monitor',
    description: 'CPU, memory & system stats',
    detail:
      'Real-time CPU and memory usage with visual progress bars. Shows system info, swap usage, and uptime. Polls every 2 seconds.',
    Icon: Cpu,
    hex: '#06b6d4',
    platforms: 'Desktop only',
  },
]

// ── Page Component ─────────────────────────────────────────────

function ChannelsPage() {
  return (
    <div className="min-h-screen pt-20">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-28 pb-20 overflow-hidden">
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
              <Puzzle size={12} />
              {CHANNELS.length} channels &middot; {WIDGETS.length} widgets
              &middot; {COMING_SOON.length} coming soon
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-black tracking-tight leading-[0.95] mb-6"
          >
            Extend Your <span className="text-gradient-primary">Feed</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
            className="text-base text-base-content/45 max-w-lg mx-auto leading-relaxed"
          >
            Browse official channels or explore what the community is building.
            Can't find what you want? Build it or suggest it.
          </motion.p>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ── CHANNELS GRID ─────────────────────────────────────── */}
      <section className="relative overflow-hidden">
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
              <span className="text-gradient-primary">Channels</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Real-time data sources available in the desktop app
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {CHANNELS.map((channel, i) => (
              <motion.div
                key={channel.id}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.1,
                  duration: 0.6,
                  ease: EASE,
                }}
              >
                <ChannelCard channel={channel} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WIDGETS ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/10 to-transparent pointer-events-none" />

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
              Built-in <span className="text-gradient-primary">Widgets</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Lightweight utilities that live alongside your feed — no account
              required
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {WIDGETS.map((widget, i) => (
              <motion.div
                key={widget.id}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.1,
                  duration: 0.6,
                  ease: EASE,
                }}
              >
                <WidgetCard widget={widget} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMING SOON / ROADMAP ────────────────────────────── */}
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
              On the <span className="text-gradient-primary">Roadmap</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Community-requested channels in development
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
            {COMING_SOON.map((item, i) => (
              <motion.div
                key={item.id}
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: i * 0.06,
                  duration: 0.5,
                  ease: EASE,
                }}
                className="bg-base-200/40 border border-base-300/25 rounded-xl p-5 text-center opacity-60"
              >
                <div className="h-10 w-10 rounded-lg bg-base-300/30 flex items-center justify-center mx-auto mb-3 text-base-content/30">
                  <item.Icon size={18} />
                </div>
                <p className="text-xs font-semibold text-base-content/40">
                  {item.name}
                </p>
                <p className="text-[9px] text-base-content/25 mt-1">
                  {item.description}
                </p>
                <span className="inline-block mt-3 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-base-content/20 border border-base-300/25 rounded-full">
                  Roadmap
                </span>
              </motion.div>
            ))}

            {/* Suggest card */}
            <Link to="/support" className="block">
              <motion.div
                style={{ opacity: 0 }}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  delay: COMING_SOON.length * 0.06,
                  duration: 0.5,
                  ease: EASE,
                }}
                className="group bg-primary/[0.03] border border-dashed border-primary/20 rounded-xl p-5 text-center hover:border-primary/40 hover:bg-primary/[0.06] transition-colors cursor-pointer"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/8 border border-primary/15 flex items-center justify-center mx-auto mb-3 text-base-content/50 group-hover:text-base-content/70 transition-colors">
                  <Plus size={18} />
                </div>
                <p className="text-xs font-semibold text-primary/50 group-hover:text-primary/70 transition-colors">
                  Suggest
                </p>
                <p className="text-[9px] text-primary/30 mt-1">
                  Your idea here
                </p>
                <span className="inline-flex items-center gap-1 mt-3 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-primary/30 border border-primary/15 rounded-full group-hover:text-primary/50 group-hover:border-primary/25 transition-colors">
                  <Lightbulb size={8} />
                  Propose
                </span>
              </motion.div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── COMMUNITY CTA ────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="container pb-8">
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
            className="relative overflow-hidden rounded-2xl bg-base-200/40 border border-base-300/25 p-8 md:p-10"
          >
            {/* Accent top line */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{
                background: `linear-gradient(90deg, transparent, ${HEX.primary} 50%, transparent)`,
              }}
            />

            {/* Background texture */}
            <div
              className="absolute inset-0 opacity-[0.01] pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(var(--grid-line-color) 1px, transparent 1px),
                  linear-gradient(90deg, var(--grid-line-color) 1px, transparent 1px)
                `,
                backgroundSize: '40px 40px',
              }}
            />

            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="text-center md:text-left">
                <h3 className="text-lg font-bold text-base-content mb-2">
                  Missing Something?
                </h3>
                <p className="text-sm text-base-content/45 leading-relaxed max-w-md">
                  Every Scrollr channel is a self-contained package. Fork the
                  repo, follow the architecture, ship your plugin — or just tell
                  us what you want.
                </p>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <a
                  href="https://discord.gg/85b49TcGJa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm"
                >
                  <MessageSquare size={14} />
                  Suggest an Idea
                  <ArrowUpRight size={12} />
                </a>
                <a
                  href="https://github.com/brandon-relentnet/myscrollr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm"
                >
                  <Code2 size={14} />
                  Build Your Own
                  <ArrowUpRight size={12} />
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}

// ── Channel Card ───────────────────────────────────────────────

function ChannelCard({ channel }: { channel: ChannelDef }) {
  const { hex } = channel

  return (
    <div className="group relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden hover:border-base-300/50 transition-colors h-full flex flex-col">
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
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
        style={{ background: `${hex}10` }}
      />

      <div className="relative z-10 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{
              background: `${hex}15`,
              boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
            }}
          >
            <channel.Icon size={20} className="text-base-content/80" />
          </div>

          <span
            className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide rounded-full border"
            style={{
              color: `${hex}99`,
              background: `${hex}08`,
              borderColor: `${hex}20`,
            }}
          >
            Desktop
          </span>
        </div>

        {/* Content */}
        <h3 className="text-sm font-bold text-base-content mb-1">
          {channel.name}
        </h3>
        <p
          className="text-[10px] mb-3 font-medium"
          style={{ color: `${hex}90` }}
        >
          {channel.description}
        </p>
        <p className="text-xs text-base-content/40 leading-relaxed">
          {channel.detail}
        </p>

        {/* Footer */}
        <div className="mt-auto pt-5">
          <span className="text-[10px] font-medium text-base-content/30">
            Available in the desktop app
          </span>
        </div>
      </div>

      {/* Watermark icon */}
      <channel.Watermark
        size={100}
        strokeWidth={0.4}
        className="absolute -bottom-3 -right-3 text-base-content/[0.025] pointer-events-none"
      />
    </div>
  )
}

// ── Widget Card ────────────────────────────────────────────────

function WidgetCard({ widget }: { widget: WidgetDef }) {
  const { hex } = widget

  return (
    <div className="group relative bg-base-200/40 border border-base-300/25 rounded-xl p-6 overflow-hidden hover:border-base-300/50 transition-colors h-full flex flex-col">
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
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

      {/* Ambient glow */}
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: `${hex}10` }}
      />

      <div className="relative z-10 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{
              background: `${hex}15`,
              boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
            }}
          >
            <widget.Icon size={20} className="text-base-content/80" />
          </div>

          <span
            className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide rounded-full border"
            style={{
              color: `${hex}99`,
              background: `${hex}08`,
              borderColor: `${hex}20`,
            }}
          >
            {widget.platforms}
          </span>
        </div>

        {/* Content */}
        <h3 className="text-sm font-bold text-base-content mb-1">
          {widget.name}
        </h3>
        <p
          className="text-[10px] mb-3 font-medium"
          style={{ color: `${hex}90` }}
        >
          {widget.description}
        </p>
        <p className="text-xs text-base-content/40 leading-relaxed">
          {widget.detail}
        </p>

        {/* Footer info — no action button, widgets are built-in */}
        <div className="mt-auto pt-5">
          <span className="text-[10px] font-medium text-base-content/30">
            Built-in — no setup required
          </span>
        </div>
      </div>

      {/* Watermark icon */}
      <widget.Icon
        size={100}
        className="absolute -bottom-3 -right-3 text-base-content/[0.025] pointer-events-none"
      />
    </div>
  )
}
