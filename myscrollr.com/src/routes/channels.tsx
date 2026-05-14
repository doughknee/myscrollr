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
import { ProductScreenshot } from '@/components/ProductScreenshot'

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
  /**
   * `<ProductScreenshot>` basename for the live-feed thumbnail shown at
   * the top of the card (e.g. `channels/finance`). Asset basenames don't
   * always match `id` (the RSS channel uses `news` assets), which is why
   * this is an explicit field rather than computed.
   */
  screenshot: string
  /** Alt text for the thumbnail. */
  screenshotAlt: string
  /** Companion configure-panel screenshot used in the mosaic below. */
  configureScreenshot: string
  configureScreenshotAlt: string
  /**
   * Optional compact ticker-strip screenshot rendered at the bottom of
   * the card to demonstrate the channel's always-on-top output. Only
   * available for channels (not widgets); widgets are dashboard-only.
   */
  tickerScreenshot?: string
  tickerScreenshotAlt?: string
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
    screenshot: 'channels/finance',
    screenshotAlt:
      'Scrollr finance channel showing live stock and crypto prices, percent change, and gainers/losers filters.',
    configureScreenshot: 'configure/finance',
    configureScreenshotAlt:
      'Scrollr finance configuration panel for adding and managing tracked symbols.',
    tickerScreenshot: 'ticker/finance-compact',
    tickerScreenshotAlt:
      'Compact Scrollr ticker strip showing live finance prices and percent change.',
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
    screenshot: 'channels/sports',
    screenshotAlt:
      'Scrollr sports channel showing live MLB scores with team logos and game status pills.',
    configureScreenshot: 'configure/sports',
    configureScreenshotAlt:
      'Scrollr sports configuration panel for selecting leagues and teams.',
    tickerScreenshot: 'ticker/sports-compact',
    tickerScreenshotAlt:
      'Compact Scrollr ticker strip showing live sports scores across multiple games.',
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
    screenshot: 'channels/news',
    screenshotAlt:
      'Scrollr news channel showing the latest headlines from custom RSS sources with recency indicators.',
    configureScreenshot: 'configure/news',
    configureScreenshotAlt:
      'Scrollr news configuration panel for subscribing to RSS feeds across multiple categories.',
    tickerScreenshot: 'ticker/news-compact',
    tickerScreenshotAlt:
      'Compact Scrollr ticker strip showing the latest RSS headlines scrolling across the screen.',
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
    screenshot: 'channels/fantasy',
    screenshotAlt:
      'Scrollr Yahoo Fantasy channel showing league overview cards, matchup scores, and win probability.',
    configureScreenshot: 'configure/fantasy',
    configureScreenshotAlt:
      'Scrollr fantasy configuration panel for managing connected Yahoo Fantasy leagues.',
    tickerScreenshot: 'ticker/fantasy-compact',
    tickerScreenshotAlt:
      'Compact Scrollr ticker strip showing Yahoo Fantasy league matchups.',
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
  /** `<ProductScreenshot>` basename for the widget feed thumbnail. */
  screenshot: string
  screenshotAlt: string
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
    screenshot: 'widgets/clock',
    screenshotAlt:
      'Scrollr world clock widget showing the current time across multiple cities.',
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
    screenshot: 'widgets/timer',
    screenshotAlt:
      'Scrollr timer widget showing a Pomodoro session with controls for play, pause, and reset.',
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
    screenshot: 'widgets/weather',
    screenshotAlt:
      'Scrollr weather widget showing current conditions, temperature, and forecast for a saved city.',
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
    screenshot: 'widgets/sysmon',
    screenshotAlt:
      'Scrollr system monitor widget showing CPU and memory usage with visual progress bars and system stats.',
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
              Choose your{' '}
              <span className="text-gradient-primary">Channels</span>
            </h2>
            <p className="text-base text-base-content/45 leading-relaxed max-w-lg mx-auto">
              Real-time data sources available in the desktop app
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 max-w-6xl mx-auto">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 max-w-6xl mx-auto">
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

      {/* ── CONFIGURE ANYTHING (screenshot mosaic) ─────────────── */}
      <ConfigureAnythingSection />

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

// ── Configure Anything (screenshot mosaic) ─────────────────────

/**
 * 2x2 mosaic of the four channel configuration panels, captioned with
 * the channel's name and a one-line description of what's configurable.
 * Sits between the Widgets grid and the Roadmap section to break up a
 * page of feature cards with a more atmospheric, "this is the actual
 * product" beat.
 *
 * Each tile uses the channel's accent color for its border + bottom
 * caption strip, so the mosaic reads as a continuation of the per-card
 * accent language used above.
 */
function ConfigureAnythingSection() {
  return (
    <section className="relative overflow-hidden">
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
            Configure <span className="text-gradient-primary">anything</span>
          </h2>
          <p className="text-base text-base-content/45 leading-relaxed max-w-xl mx-auto">
            Every channel comes with its own settings panel. Add the symbols,
            leagues, feeds, or teams you actually care about — and leave the
            rest out.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
          {CHANNELS.map((channel, i) => (
            <motion.figure
              key={`configure-${channel.id}`}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{
                delay: i * 0.08,
                duration: 0.6,
                ease: EASE,
              }}
              className="group relative overflow-hidden rounded-2xl border bg-base-200/40 backdrop-blur-sm"
              style={{ borderColor: `${channel.hex}25` }}
            >
              {/* Accent top line, matches the card pattern above */}
              <div
                className="absolute top-0 left-0 right-0 h-px z-10"
                style={{
                  background: `linear-gradient(90deg, transparent, ${channel.hex} 50%, transparent)`,
                  opacity: 0.5,
                }}
                aria-hidden="true"
              />

              {/* Configure panel screenshot */}
              <ProductScreenshot
                basename={channel.configureScreenshot}
                alt={channel.configureScreenshotAlt}
                pictureClassName="block w-full"
                imgClassName="block h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.02]"
              />

              {/* Caption strip */}
              <figcaption
                className="relative flex items-center justify-between gap-4 px-5 py-4 border-t"
                style={{
                  borderTopColor: `${channel.hex}20`,
                  background: `linear-gradient(180deg, transparent, ${channel.hex}06)`,
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: `${channel.hex}15`,
                      boxShadow: `0 0 0 1px ${channel.hex}20`,
                    }}
                  >
                    <channel.Icon
                      size={14}
                      className="text-base-content/80"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-base-content truncate">
                      {channel.name}
                    </p>
                    <p
                      className="text-[11px] font-medium truncate"
                      style={{ color: `${channel.hex}90` }}
                    >
                      {channel.description}
                    </p>
                  </div>
                </div>

                <span
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border shrink-0"
                  style={{
                    color: `${channel.hex}cc`,
                    background: `${channel.hex}0a`,
                    borderColor: `${channel.hex}25`,
                  }}
                >
                  <Puzzle size={10} />
                  Configurable
                </span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Channel Card ───────────────────────────────────────────────

function ChannelCard({ channel }: { channel: ChannelDef }) {
  const { hex } = channel

  return (
    <div className="group relative bg-base-200/40 border border-base-300/25 rounded-xl overflow-hidden hover:border-base-300/50 transition-colors h-full flex flex-col">
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px z-20"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
        }}
      />

      {/* Screenshot banner: the live-feed thumbnail anchors the card and
          gives each channel a unique visual identity beyond its color
          accent. Sits behind a subtle bottom gradient that blends into
          the card body so the icon/header reads against the screenshot
          without a hard seam. */}
      <div
        className="relative w-full overflow-hidden border-b border-base-300/25"
        style={{ backgroundColor: `${hex}08` }}
      >
        <ProductScreenshot
          basename={channel.screenshot}
          alt={channel.screenshotAlt}
          pictureClassName="block w-full"
          imgClassName="block h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]"
        />

        {/* Bottom fade into the card body */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
          style={{
            background:
              'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-base-200) 60%, transparent))',
          }}
          aria-hidden="true"
        />
      </div>

      {/* Card body — typography scales up with the 2-column layout
          so the screenshots above don't dominate at the expense of the
          card's actual content. */}
      <div className="relative p-7 sm:p-8 flex flex-col flex-1">
        {/* Corner dot grid */}
        <div
          className="absolute top-0 right-0 w-24 h-24 opacity-[0.04] text-base-content"
          style={{
            backgroundImage:
              'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '8px 8px',
          }}
        />

        {/* Ambient glow orb on hover */}
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{ background: `${hex}10` }}
        />

        <div className="relative z-10 flex flex-col flex-1">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: `${hex}15`,
                boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
              }}
            >
              <channel.Icon size={22} className="text-base-content/80" />
            </div>

            <span
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border"
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
          <h3 className="text-xl sm:text-2xl font-bold text-base-content mb-1.5 tracking-tight">
            {channel.name}
          </h3>
          <p
            className="text-xs mb-4 font-semibold uppercase tracking-wide"
            style={{ color: `${hex}b3` }}
          >
            {channel.description}
          </p>
          <p className="text-sm text-base-content/55 leading-relaxed">
            {channel.detail}
          </p>

          {/* Ticker preview — completes the card's narrative: the
              dashboard banner above shows the configure-target, this
              compact ticker strip shows the lived output. */}
          {channel.tickerScreenshot ? (
            <div
              className="mt-6 overflow-hidden rounded-md border bg-base-100/40"
              style={{
                aspectRatio: '2930 / 80',
                borderColor: `${hex}25`,
              }}
            >
              <ProductScreenshot
                basename={channel.tickerScreenshot}
                alt={channel.tickerScreenshotAlt ?? ''}
                aspect="2930 / 80"
                pictureClassName="block w-full h-full"
                imgClassName="block h-full w-full object-cover"
              />
            </div>
          ) : null}

          {/* Footer */}
          <div className="mt-auto pt-6">
            <span className="text-xs font-medium text-base-content/35">
              Available in the desktop app
            </span>
          </div>
        </div>
      </div>

      {/* Watermark icon — anchored to the outer card so it bleeds off
          the bottom-right corner of the body. */}
      <channel.Watermark
        size={120}
        strokeWidth={0.4}
        className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
      />
    </div>
  )
}

// ── Widget Card ────────────────────────────────────────────────

function WidgetCard({ widget }: { widget: WidgetDef }) {
  const { hex } = widget

  return (
    <div className="group relative bg-base-200/40 border border-base-300/25 rounded-xl overflow-hidden hover:border-base-300/50 transition-colors h-full flex flex-col">
      {/* Accent top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px z-20"
        style={{
          background: `linear-gradient(90deg, transparent, ${hex} 50%, transparent)`,
        }}
      />

      {/* Screenshot banner — same pattern as ChannelCard. */}
      <div
        className="relative w-full overflow-hidden border-b border-base-300/25"
        style={{ backgroundColor: `${hex}08` }}
      >
        <ProductScreenshot
          basename={widget.screenshot}
          alt={widget.screenshotAlt}
          pictureClassName="block w-full"
          imgClassName="block h-full w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
          style={{
            background:
              'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--color-base-200) 60%, transparent))',
          }}
          aria-hidden="true"
        />
      </div>

      {/* Card body — typography scales up for the 2-column layout. */}
      <div className="relative p-7 sm:p-8 flex flex-col flex-1">
        {/* Corner dot grid */}
        <div
          className="absolute top-0 right-0 w-24 h-24 opacity-[0.04] text-base-content"
          style={{
            backgroundImage:
              'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '8px 8px',
          }}
        />

        {/* Ambient glow */}
        <div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{ background: `${hex}10` }}
        />

        <div className="relative z-10 flex flex-col flex-1">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: `${hex}15`,
                boxShadow: `0 0 20px ${hex}15, 0 0 0 1px ${hex}20`,
              }}
            >
              <widget.Icon size={22} className="text-base-content/80" />
            </div>

            <span
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full border"
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
          <h3 className="text-xl sm:text-2xl font-bold text-base-content mb-1.5 tracking-tight">
            {widget.name}
          </h3>
          <p
            className="text-xs mb-4 font-semibold uppercase tracking-wide"
            style={{ color: `${hex}b3` }}
          >
            {widget.description}
          </p>
          <p className="text-sm text-base-content/55 leading-relaxed">
            {widget.detail}
          </p>

          {/* Footer info — no action button, widgets are built-in */}
          <div className="mt-auto pt-6">
            <span className="text-xs font-medium text-base-content/35">
              Built-in — no setup required
            </span>
          </div>
        </div>
      </div>

      {/* Watermark icon */}
      <widget.Icon
        size={120}
        className="absolute -bottom-4 -right-4 text-base-content/[0.025] pointer-events-none"
      />
    </div>
  )
}
