import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Coffee,
  Ghost,
  Newspaper,
  Rss,
  Swords,
  Timer,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import { useInViewport } from '@/hooks/useInViewport'

// ── Types ────────────────────────────────────────────────────────

type ChannelKey = 'finance' | 'sports' | 'news' | 'fantasy'

interface TickerChip {
  label: string
  value: string
  channel: ChannelKey
  icon?: string
}

interface ChannelInfo {
  key: ChannelKey
  name: string
  icon: typeof TrendingUp
  color: string
  bg: string
  border: string
  activeBg: string
  activeText: string
  tagline: string
  scenarioIcon: typeof Coffee
  scenarioTitle: string
  scenarioBody: string
  stat: string
  statLabel: string
}

// ── Channel definitions ──────────────────────────────────────────

const CHANNELS: Array<ChannelInfo> = [
  {
    key: 'finance',
    name: 'Finance',
    icon: TrendingUp,
    color: 'text-primary',
    bg: 'bg-primary/8',
    border: 'border-primary/20',
    activeBg: 'bg-primary',
    activeText: 'text-primary-content',
    tagline: 'Live prices, always in sight',
    scenarioIcon: Coffee,
    scenarioTitle: 'Morning coffee, portfolio check',
    scenarioBody:
      "Glance at BTC, ETH, and your watchlist while reading the morning news. No apps to open, no tabs to switch. It's just there.",
    stat: 'Up to ∞',
    statLabel: 'tracked symbols',
  },
  {
    key: 'sports',
    name: 'Sports',
    icon: Trophy,
    color: 'text-secondary',
    bg: 'bg-secondary/8',
    border: 'border-secondary/20',
    activeBg: 'bg-secondary',
    activeText: 'text-secondary-content',
    tagline: 'Scores update, you keep scrolling',
    scenarioIcon: Timer,
    scenarioTitle: 'Never miss the final score',
    scenarioBody:
      "NFL, NBA, NHL, MLB. Live scores tick along the bottom of your screen. You'll know the second the game ends.",
    stat: '5',
    statLabel: 'major leagues',
  },
  {
    key: 'news',
    name: 'News',
    icon: Rss,
    color: 'text-info',
    bg: 'bg-info/8',
    border: 'border-info/20',
    activeBg: 'bg-info',
    activeText: 'text-info-content',
    tagline: 'Your sources, your pace',
    scenarioIcon: Newspaper,
    scenarioTitle: 'Headlines without the noise',
    scenarioBody:
      'Curated RSS from 100+ sources across tech, world, finance, and more. No algorithms, no clickbait. Just the feeds you choose.',
    stat: '100+',
    statLabel: 'curated feeds',
  },
  {
    key: 'fantasy',
    name: 'Fantasy',
    icon: Ghost,
    color: 'text-accent',
    bg: 'bg-accent/8',
    border: 'border-accent/20',
    activeBg: 'bg-accent',
    activeText: 'text-accent-content',
    tagline: 'League intel on your desktop',
    scenarioIcon: Swords,
    scenarioTitle: 'Matchup updates, zero effort',
    scenarioBody:
      'Connect your Yahoo account and see standings, matchups, and live scoring across all your leagues without switching apps.',
    stat: '∞',
    statLabel: 'leagues supported',
  },
]

// ── Ticker chip data ─────────────────────────────────────────────

const TICKER_CHIPS: Array<TickerChip> = [
  { label: 'BTC', value: '$67,241 ↑', channel: 'finance' },
  { label: 'LAL 118', value: 'BOS 112 · FINAL', channel: 'sports' },
  { label: 'NVDA', value: '$891.20 ↑', channel: 'finance' },
  { label: 'Fed holds rates steady', value: 'Reuters', channel: 'news' },
  { label: 'MIA 94', value: 'GSW 88 · Q4', channel: 'sports' },
  { label: 'ETH', value: '$3,412 ↓', channel: 'finance' },
  { label: 'Your Team', value: '2nd Place', channel: 'fantasy' },
  { label: 'SPY', value: '$512.08 ↑', channel: 'finance' },
  {
    label: 'AI hiring surges as layoffs slow',
    value: 'TechCrunch',
    channel: 'news',
  },
  { label: 'NYG 21', value: 'DAL 17 · HALF', channel: 'sports' },
  { label: 'AAPL', value: '$189.54 ↓', channel: 'finance' },
  { label: 'Matchup: W 6-4', value: 'vs Team Alpha', channel: 'fantasy' },
  { label: 'TSLA', value: '$242.68 ↑', channel: 'finance' },
  { label: 'Climate summit opens in Dubai', value: 'AP', channel: 'news' },
  { label: 'BUF 28', value: 'KC 24 · Q3', channel: 'sports' },
  { label: 'Roster Alert', value: 'J. Chase → IR', channel: 'fantasy' },
]

// ── Chip color map (per-channel) ─────────────────────────────────

const chipColors: Record<
  ChannelKey,
  { border: string; text: string; bg: string; sub: string }
> = {
  finance: {
    border: 'border-primary/25',
    text: 'text-primary',
    bg: 'bg-primary/[0.06]',
    sub: 'text-primary/60',
  },
  sports: {
    border: 'border-secondary/25',
    text: 'text-secondary',
    bg: 'bg-secondary/[0.06]',
    sub: 'text-secondary/60',
  },
  news: {
    border: 'border-info/25',
    text: 'text-info',
    bg: 'bg-info/[0.06]',
    sub: 'text-info/60',
  },
  fantasy: {
    border: 'border-accent/25',
    text: 'text-accent',
    bg: 'bg-accent/[0.06]',
    sub: 'text-accent/60',
  },
}

// ── Ease constant ────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const

// ── Ticker Chip Component ────────────────────────────────────────

function TickerChipItem({ chip }: { chip: TickerChip }) {
  const c = chipColors[chip.channel]
  return (
    <div
      className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg border ${c.border} ${c.bg} shrink-0`}
    >
      <span
        className={`text-[10px] sm:text-[11px] font-bold font-mono ${c.text} whitespace-nowrap`}
      >
        {chip.label}
      </span>
      <span
        className={`text-[9px] sm:text-[10px] font-mono ${c.sub} whitespace-nowrap`}
      >
        {chip.value}
      </span>
    </div>
  )
}

// ── Animated Ticker with per-item enter/exit ─────────────────────

const SPRING = { type: 'spring' as const, damping: 25, stiffness: 300 }

function AnimatedTicker({
  chips,
  velocity = 50,
  gap = 12,
  hoverFactor = 0.5,
  paused = false,
}: {
  chips: Array<TickerChip>
  velocity?: number
  gap?: number
  hoverFactor?: number
  /** Skip the per-frame transform write while the host section is
   * off-screen. Reset `lastTimeRef` on each pass so resuming doesn't
   * apply a giant accumulated delta. */
  paused?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const setRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)
  const setWidthRef = useRef(0)
  const isHoveredRef = useRef(false)
  const isPausedRef = useRef(false)
  const lastTimeRef = useRef(0)
  const prevKeyRef = useRef('')
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chipsKey = useMemo(() => chips.map((c) => c.label).join('|'), [chips])

  // Measure width of one full set of chips
  const measure = useCallback(() => {
    if (setRef.current) {
      setWidthRef.current = setRef.current.offsetWidth + gap
    }
  }, [gap])

  // Initial measurement after DOM paint
  useEffect(() => {
    const raf = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(raf)
  }, [measure])

  // Pause scroll during chip transitions so layout animations can play
  useEffect(() => {
    if (prevKeyRef.current && prevKeyRef.current !== chipsKey) {
      isPausedRef.current = true
      lastTimeRef.current = 0

      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
      pauseTimerRef.current = setTimeout(() => {
        measure()
        // Keep offset within new bounds to avoid a visible jump
        if (setWidthRef.current > 0) {
          offsetRef.current = -(
            Math.abs(offsetRef.current) % setWidthRef.current
          )
        }
        isPausedRef.current = false
      }, 450)
    }
    prevKeyRef.current = chipsKey

    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    }
  }, [chipsKey, measure])

  // Continuous scroll via requestAnimationFrame
  useEffect(() => {
    let rafId: number

    function tick(time: number) {
      rafId = requestAnimationFrame(tick)

      if (
        !trackRef.current ||
        isPausedRef.current ||
        paused ||
        setWidthRef.current === 0
      ) {
        lastTimeRef.current = time
        return
      }

      const delta = lastTimeRef.current
        ? (time - lastTimeRef.current) / 1000
        : 0
      lastTimeRef.current = time

      const speed = isHoveredRef.current ? velocity * hoverFactor : velocity
      offsetRef.current -= speed * Math.min(delta, 0.1)

      // Wrap when scrolled past one full set
      if (Math.abs(offsetRef.current) >= setWidthRef.current) {
        offsetRef.current += setWidthRef.current
      }

      trackRef.current.style.transform = `translateX(${offsetRef.current}px)`
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [velocity, hoverFactor, paused])

  if (chips.length === 0) return null

  return (
    <div
      className="overflow-hidden"
      onMouseEnter={() => {
        isHoveredRef.current = true
      }}
      onMouseLeave={() => {
        isHoveredRef.current = false
      }}
    >
      <div ref={trackRef} className="flex" style={{ gap }}>
        {/* Primary set — measured for loop width */}
        <div ref={setRef} className="flex shrink-0" style={{ gap }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {chips.map((chip) => (
              <motion.div
                key={chip.label}
                layout="position"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={SPRING}
                className="shrink-0"
              >
                <TickerChipItem chip={chip} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Duplicate set — seamless infinite loop */}
        <div className="flex shrink-0" style={{ gap }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {chips.map((chip) => (
              <motion.div
                key={chip.label}
                layout="position"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={SPRING}
                className="shrink-0"
              >
                <TickerChipItem chip={chip} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ── Channel Scenario Card ────────────────────────────────────────

function ScenarioCard({ stream }: { stream: ChannelInfo }) {
  const Icon = stream.scenarioIcon
  const colorVar =
    stream.key === 'finance'
      ? 'primary'
      : stream.key === 'sports'
        ? 'secondary'
        : stream.key === 'news'
          ? 'info'
          : 'accent'

  return (
    <div
      className={`group relative rounded-2xl p-6 sm:p-7 bg-base-200/70 border ${stream.border} shadow-sm h-full`}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-8 right-8 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, var(--color-${colorVar}) 50%, transparent)`,
          opacity: 0.3,
        }}
      />

      <div className="flex items-start gap-4 sm:gap-5">
        {/* Scenario icon */}
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${stream.bg} ${stream.color}`}
        >
          <Icon size={20} />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold mb-1.5 text-base-content">
            {stream.scenarioTitle}
          </h3>
          <p className="text-sm leading-relaxed text-base-content/55">
            {stream.scenarioBody}
          </p>

          {/* Stat */}
          <div className="inline-flex items-center gap-2 mt-4">
            <span className={`text-lg font-black font-mono ${stream.color}`}>
              {stream.stat}
            </span>
            <span className="text-xs text-base-content/35">
              {stream.statLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────

export function ChannelsShowcase() {
  const [activeChannels, setActiveChannels] = useState<Set<ChannelKey>>(
    new Set(['finance', 'sports', 'news', 'fantasy']),
  )
  // Pause the RAF marquee while the section is off-screen. The 200 px
  // viewport margin (default in `useInViewport`) primes the scroll loop
  // a touch before it appears, so users never see a frozen ticker.
  const [sectionRef, sectionInView] = useInViewport<HTMLElement>()

  const handleFilterClick = (key: ChannelKey) => {
    setActiveChannels((prev) => {
      const next = new Set(prev)
      // Don't allow deselecting all — keep at least one
      if (next.has(key) && next.size > 1) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Filter chips by active channels
  const visibleChips = useMemo(
    () => TICKER_CHIPS.filter((chip) => activeChannels.has(chip.channel)),
    [activeChannels],
  )

  return (
    <section ref={sectionRef} id="channels" className="relative">
      {/* Subtle background shift */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/30 to-transparent pointer-events-none" />

      {/* Header area — container-width but custom vertical padding */}
      <div
        className="mx-auto px-5 sm:px-6 lg:px-8 pt-14 sm:pt-16 lg:pt-24 relative"
        style={{ maxWidth: 1400 }}
      >
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-7 sm:mb-10 lg:mb-14"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-5 text-center">
            Everything You Follow.{' '}
            <span className="text-gradient-primary">One Ticker.</span>
          </h2>
          <p className="text-base text-base-content/45 max-w-lg leading-relaxed text-center">
            Finance, sports, news, and fantasy today &mdash; with more on the
            way. Toggle what you want, ignore the rest.
          </p>
        </motion.div>

        {/* Filter pills — fixed height via border-transparent on active */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15, duration: 0.5, ease: EASE }}
          className="-mx-5 flex flex-nowrap justify-center gap-1.5 overflow-x-auto px-3 pb-1 mb-5 sm:mx-0 sm:flex-wrap sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0 sm:mb-10 lg:mb-14"
        >
          {CHANNELS.map((stream) => {
            const isActive = activeChannels.has(stream.key)
            const Icon = stream.icon
            return (
              <button
                key={stream.key}
                type="button"
                onClick={() => handleFilterClick(stream.key)}
                className={`inline-flex shrink-0 items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-semibold border transition-[color,background-color,border-color,box-shadow] duration-300 cursor-pointer ${
                  isActive
                    ? `${stream.activeBg} ${stream.activeText} border-transparent shadow-md`
                    : 'bg-base-200/50 text-base-content/35 border-base-300/30 hover:text-base-content/55 hover:bg-base-200/70'
                }`}
              >
                <Icon size={15} />
                {stream.name}
              </button>
            )
          })}
        </motion.div>
      </div>

      {/* Full-bleed Motion+ Ticker */}
      <motion.div
        data-channel-ticker-band
        style={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
        className="relative bg-base-200/60 border-y border-base-300/30 py-2 sm:py-3"
      >
        {/* Left/Right fade masks */}
        <div className="absolute left-0 top-0 bottom-0 w-8 sm:w-24 bg-gradient-to-r from-base-100 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-8 sm:w-24 bg-gradient-to-l from-base-100 to-transparent z-10 pointer-events-none" />

        <AnimatedTicker
          chips={visibleChips}
          velocity={50}
          gap={12}
          hoverFactor={0.5}
          paused={!sectionInView}
        />
      </motion.div>

      {/* Ticker caption */}
      <motion.div
        style={{ opacity: 0 }}
        initial={{ opacity: 0, y: 15 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-40px' }}
        transition={{ delay: 0.1, duration: 0.5, ease: EASE }}
        data-channel-ticker-caption
        className="flex items-center justify-center gap-3 mt-3 sm:mt-4 mb-2 px-5"
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
        </span>
        <span className="text-[11px] text-base-content/30 font-medium text-center">
          <span className="sm:hidden">
            Tap filters to shape the ticker in real time.
          </span>
          <span className="hidden sm:inline">
            Your desktop, right now — hover to slow, click to explore.
          </span>
        </span>
      </motion.div>

      {/* Scenario cards — container-width but custom vertical padding */}
      <div
        className="mx-auto px-5 sm:px-6 lg:px-8 pt-6 pb-16 lg:pb-24 relative"
        style={{ maxWidth: 1400 }}
      >
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
        >
          <div className="flex flex-wrap justify-center gap-4 lg:gap-5">
            <AnimatePresence mode="popLayout" initial={false}>
              {CHANNELS.filter((s) => activeChannels.has(s.key)).map(
                (stream) => (
                  <motion.div
                    key={stream.key}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={SPRING}
                    className="w-full md:w-[calc(50%-10px)]"
                  >
                    <ScenarioCard stream={stream} />
                  </motion.div>
                ),
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Footer link */}
        <motion.div
          layout
          transition={SPRING}
          style={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-40px' }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-12"
        >
          <Link
            to="/channels"
            className="group inline-flex items-center gap-2 text-sm font-semibold text-base-content/40 hover:text-primary transition-colors"
          >
            See It in Action
            <ArrowRight
              size={14}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
