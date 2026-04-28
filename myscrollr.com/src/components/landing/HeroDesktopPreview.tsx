/**
 * @deprecated Replaced by `HeroProductShowcase` in v1.0.4 (2026-04-28).
 *
 * This animated SVG mockup taxed older / less powerful machines with
 * its per-frame Motion springs and per-chip enter/exit animations.
 * The replacement uses static WebP screenshots of the actual app for
 * a much lower CPU/GPU cost and an authentic representation of the
 * product. See `myscrollr.com/SCREENSHOTS.md` for the capture +
 * optimization workflow.
 *
 * Kept in the codebase for one release as a quick-revert escape hatch
 * in case the screenshot showcase needs to be rolled back. Scheduled
 * for deletion in the next minor cleanup PR after v1.0.5.
 *
 * NOT imported anywhere. The site uses `HeroProductShowcase`.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useSpring,
  useTransform,
  useVelocity,
} from 'motion/react'

// ── Accent color maps ────────────────────────────────────────────
// Tailwind classes for ticker chip styling
const accentMap = {
  secondary: {
    chipBg: 'bg-secondary/8',
    chipBorder: 'border-secondary/20',
    chipText: 'text-secondary',
    chipSub: 'text-secondary/60',
  },
  primary: {
    chipBg: 'bg-primary/8',
    chipBorder: 'border-primary/20',
    chipText: 'text-primary',
    chipSub: 'text-primary/60',
  },
  info: {
    chipBg: 'bg-info/8',
    chipBorder: 'border-info/20',
    chipText: 'text-info',
    chipSub: 'text-info/60',
  },
  accent: {
    chipBg: 'bg-accent/8',
    chipBorder: 'border-accent/20',
    chipText: 'text-accent',
    chipSub: 'text-accent/60',
  },
} as const

// Inline-style rgba values for smooth CSS transitions between accents
const ACCENT_STYLES = {
  secondary: {
    border: 'rgba(255,71,87,0.25)',
    shadow: '0 0 30px rgba(255,71,87,0.08), 0 0 60px rgba(255,71,87,0.04)',
    tickerBorder: 'rgba(255,71,87,0.4)',
    glow: 'rgba(255,71,87,0.04)',
  },
  primary: {
    border: 'rgba(52,211,153,0.25)',
    shadow: '0 0 30px rgba(52,211,153,0.08), 0 0 60px rgba(52,211,153,0.04)',
    tickerBorder: 'rgba(52,211,153,0.4)',
    glow: 'rgba(52,211,153,0.04)',
  },
  info: {
    border: 'rgba(0,212,255,0.25)',
    shadow: '0 0 30px rgba(0,212,255,0.08), 0 0 60px rgba(0,212,255,0.04)',
    tickerBorder: 'rgba(0,212,255,0.4)',
    glow: 'rgba(0,212,255,0.04)',
  },
  accent: {
    border: 'rgba(168,85,247,0.25)',
    shadow: '0 0 30px rgba(168,85,247,0.08), 0 0 60px rgba(168,85,247,0.04)',
    tickerBorder: 'rgba(168,85,247,0.4)',
    glow: 'rgba(168,85,247,0.04)',
  },
} as const

type Accent = keyof typeof accentMap

// ── Mockup configurations ────────────────────────────────────────

interface MockupConfig {
  word: string
  appTitle: string
  appIconBg: string
  appIconDot: string
  accent: Accent
  tickerChips: Array<{ label: string; value: string }>
}

const MOCKUPS: Array<MockupConfig> = [
  {
    word: 'Scores',
    appTitle: 'Music — Chill Mix',
    appIconBg: 'bg-secondary/15',
    appIconDot: 'bg-secondary',
    accent: 'secondary',
    tickerChips: [
      { label: 'LAL 112', value: 'BOS 108' },
      { label: 'MIA vs NYK', value: '7:30 PM' },
      { label: 'KC 24', value: 'BUF 21' },
    ],
  },
  {
    word: 'Markets',
    appTitle: 'Code — acme-project',
    appIconBg: 'bg-base-content/8',
    appIconDot: 'bg-base-content/50',
    accent: 'primary',
    tickerChips: [
      { label: 'BTC', value: '+2.47%' },
      { label: 'AAPL', value: '$198.30' },
      { label: 'ETH', value: '-1.21%' },
    ],
  },
  {
    word: 'Headlines',
    appTitle: 'Notes — Q4 Planning',
    appIconBg: 'bg-info/15',
    appIconDot: 'bg-info',
    accent: 'info',
    tickerChips: [
      { label: 'Fed holds rates', value: 'Reuters' },
      { label: 'AI surge', value: 'TechCrunch' },
      { label: 'Climate summit', value: 'AP' },
    ],
  },
  {
    word: 'Leagues',
    appTitle: 'Chat — #general',
    appIconBg: 'bg-base-content/8',
    appIconDot: 'bg-base-content/50',
    accent: 'accent',
    tickerChips: [
      { label: 'P. Mahomes', value: '28.4 pts' },
      { label: 'J. Jefferson', value: '22.1 pts' },
      { label: 'Matchup', value: 'W 6-4' },
    ],
  },
]

// ── Desktop app content ──────────────────────────────────────────
// Each shows a different desktop app the user might be working in.
// The ticker at the bottom shows live data (scores, markets, etc.)
// regardless of which app is in focus — proving Scrollr works
// across your entire desktop.

function MusicPlayerContent() {
  return (
    <div className="space-y-2">
      {/* Album art */}
      <div className="h-16 rounded-sm bg-base-300/30 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/8 to-secondary/15" />
        <div className="relative flex flex-col items-center">
          <span className="text-[16px]">&#9835;</span>
          <span className="text-[7px] text-base-content/30 mt-0.5">
            Now Playing
          </span>
        </div>
      </div>
      {/* Track info */}
      <div className="px-0.5 text-center">
        <p className="text-[11px] font-semibold text-base-content/65 leading-snug">
          Midnight Drift
        </p>
        <p className="text-[9px] text-base-content/30 mt-0.5">
          Chillhop Essentials
        </p>
      </div>
      {/* Progress bar */}
      <div className="flex items-center gap-2 px-0.5">
        <span className="text-[7px] font-mono text-base-content/20">2:34</span>
        <div className="flex-1 h-1 rounded-full bg-base-300/20 relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-3/5 rounded-full bg-secondary/40" />
        </div>
        <span className="text-[7px] font-mono text-base-content/20">4:12</span>
      </div>
      {/* Playback controls */}
      <div className="flex items-center justify-center gap-4">
        <span className="text-[10px] text-base-content/20">&#9198;</span>
        <div className="w-6 h-6 rounded-full bg-base-content/8 flex items-center justify-center">
          <span className="text-[10px] text-base-content/40 ml-0.5">
            &#9654;
          </span>
        </div>
        <span className="text-[10px] text-base-content/20">&#9197;</span>
      </div>
      {/* Up Next — the hint */}
      <div className="px-0.5 pt-1 border-t border-base-300/10">
        <span className="text-[8px] text-base-content/20 uppercase tracking-wider">
          Up Next
        </span>
        <p className="text-[9px] text-base-content/30 leading-snug mt-0.5">
          game day focus — scores live at the bottom &#127936;
        </p>
      </div>
    </div>
  )
}

function CodeEditorContent() {
  const lines = [
    { num: 1, code: 'import { fetchData } from', cls: 'text-info/50' },
    { num: 2, code: "  './api'", cls: 'text-primary/50' },
    { num: 3, code: '', cls: '' },
    {
      num: 4,
      code: '// prices in the ticker — focus here',
      cls: 'text-base-content/20',
    },
    {
      num: 5,
      code: 'async function syncPortfolio() {',
      cls: 'text-accent/50',
    },
    {
      num: 6,
      code: '  const data = await fetchData()',
      cls: 'text-base-content/40',
    },
    {
      num: 7,
      code: '  return data.filter(active)',
      cls: 'text-base-content/40',
    },
    { num: 8, code: '}', cls: 'text-accent/50' },
  ]

  return (
    <div className="space-y-0">
      {/* File tabs */}
      <div className="flex items-center gap-0 mb-2">
        <div className="px-2.5 py-1 rounded-t-sm bg-base-100/50 border border-b-0 border-base-300/10 text-[9px] text-base-content/40">
          app.ts
        </div>
        <div className="px-2.5 py-1 text-[9px] text-base-content/20">
          utils.ts
        </div>
      </div>
      {/* Code lines */}
      <div className="font-mono text-[9px] leading-relaxed">
        {lines.map((line) => (
          <div key={line.num} className="flex">
            <span className="w-5 text-right pr-2 text-base-content/15 select-none shrink-0">
              {line.num}
            </span>
            <span className={line.cls}>{line.code}</span>
          </div>
        ))}
      </div>
      {/* Cursor */}
      <div className="pl-5 mt-0.5">
        <span className="inline-block w-0.5 h-3 bg-primary/40 animate-pulse" />
      </div>
    </div>
  )
}

function NotesContent() {
  return (
    <div className="space-y-2">
      {/* Mini toolbar */}
      <div className="flex items-center gap-2.5 px-2 py-1 rounded-sm bg-base-300/8 border border-base-300/8">
        <span className="text-[10px] font-bold text-base-content/25">B</span>
        <span className="text-[10px] italic text-base-content/25">I</span>
        <span className="text-[10px] underline text-base-content/25">U</span>
        <span className="text-base-content/10">|</span>
        <span className="text-[10px] text-base-content/20">&equiv;</span>
        <span className="text-[10px] text-base-content/20">&#8942;&equiv;</span>
      </div>
      {/* Document content */}
      <div className="px-1">
        <p className="text-[13px] font-bold text-base-content/55 mb-2">
          Q4 Planning Notes
        </p>
        <div className="space-y-1.5 text-[10px] text-base-content/35 leading-relaxed">
          <p>&bull; Review product launch timeline</p>
          <p>&bull; Finalize Q1 budget allocation</p>
          {/* The hint — natural meeting note */}
          <p>&bull; Headlines streaming in the ticker &mdash; stay in flow ↓</p>
          <p className="text-base-content/15">
            &bull; Assign design review owners
          </p>
        </div>
      </div>
      {/* Cursor blink */}
      <div className="px-1">
        <span className="inline-block w-0.5 h-3.5 bg-info/40 animate-pulse" />
      </div>
    </div>
  )
}

function ChatContent() {
  const messages = [
    {
      name: 'Alex',
      time: '12m',
      text: 'standup notes pushed — reviews welcome',
    },
    {
      name: 'Jordan',
      time: '8m',
      // The hint — natural chat about fantasy scores
      text: 'Mahomes going OFF today \u{1F3C6} can see it right in the ticker',
    },
    {
      name: 'Sam',
      time: '3m',
      text: 'merging the auth PR now, looks good',
    },
  ]

  return (
    <div className="space-y-0">
      {messages.map((m) => (
        <div
          key={m.name}
          className="flex items-start gap-2 px-3 py-2 border-b border-base-300/10"
        >
          <div className="w-5 h-5 rounded-full bg-base-300/25 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-base-content/50">
                {m.name}
              </span>
              <span className="text-[8px] text-base-content/20">
                &middot; {m.time} ago
              </span>
            </div>
            <p className="text-[10px] text-base-content/45 leading-snug mt-0.5">
              {m.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

const CONTENT_RENDERERS: Partial<Record<string, React.FC>> = {
  Scores: MusicPlayerContent,
  Markets: CodeEditorContent,
  Headlines: NotesContent,
  Leagues: ChatContent,
}

// ── Content carousel (spring + motion blur) ──────────────────────

function calculateViewX(difference: number, containerWidth: number) {
  return difference * containerWidth * 0.75 * -1
}

function ContentView({
  children,
  containerWidth,
  viewIndex,
  activeIndex,
}: {
  children: React.ReactNode
  containerWidth: number
  viewIndex: number
  activeIndex: number
}) {
  const x = useSpring(calculateViewX(activeIndex - viewIndex, containerWidth), {
    stiffness: 400,
    damping: 60,
  })

  const xVelocity = useVelocity(x)

  const opacity = useTransform(
    x,
    [-containerWidth * 0.6, 0, containerWidth * 0.6],
    [0, 1, 0],
  )

  const blur = useTransform(xVelocity, [-1000, 0, 1000], [4, 0, 4], {
    clamp: false,
  })

  const filter = useMotionTemplate`blur(${blur}px)`

  useEffect(() => {
    x.set(calculateViewX(activeIndex - viewIndex, containerWidth))
  }, [activeIndex, containerWidth, viewIndex, x])

  return (
    <motion.div
      style={{
        position: 'absolute',
        inset: 0,
        x,
        opacity,
        filter,
        willChange: 'transform, filter',
        isolation: 'isolate',
      }}
    >
      {children}
    </motion.div>
  )
}

// ── Main Component ───────────────────────────────────────────────

interface HeroDesktopPreviewProps {
  activeIndex: number
  onSelect?: (index: number) => void
}

export function HeroDesktopPreview({
  activeIndex,
  onSelect,
}: HeroDesktopPreviewProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    const updateWidth = () => {
      if (contentRef.current) {
        setContentWidth(contentRef.current.getBoundingClientRect().width)
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [contentWidth])

  const activeMockup = MOCKUPS[activeIndex]
  const styles = ACCENT_STYLES[activeMockup.accent]
  const chipColors = accentMap[activeMockup.accent]

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      className="relative w-[360px] sm:w-[480px] lg:w-[500px] xl:w-[640px] 2xl:w-[780px] aspect-[4/3]"
    >
      {/* Ambient glow — transitions to active accent color */}
      <div
        className="absolute -inset-8 rounded-3xl blur-3xl pointer-events-none transition-[background-color] duration-700"
        style={{ backgroundColor: styles.glow }}
      />

      {/* ── Desktop window frame ── */}
      <div
        className="relative h-full rounded-xl overflow-hidden flex flex-col border bg-base-200/80 backdrop-blur-sm transition-[border-color,box-shadow] duration-500"
        style={{
          borderColor: styles.border,
          boxShadow: styles.shadow,
        }}
      >
        {/* ── Title bar — traffic lights + app tabs ── */}
        <div
          className="shrink-0 flex items-end px-2 pt-2 bg-base-200/95 border-b border-base-300/20"
          role="tablist"
        >
          {/* macOS traffic lights */}
          <div className="flex items-center gap-1.5 pl-1 pr-2 pb-2 shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]/80" />
          </div>

          {/* App tabs — each represents a different desktop app */}
          {MOCKUPS.map((mockup, i) => {
            const isActive = i === activeIndex

            return (
              <button
                key={mockup.word}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`View ${mockup.word} demo`}
                onClick={() => onSelect?.(i)}
                className="relative flex-1 min-w-0 cursor-pointer"
              >
                {/* Sliding active tab background */}
                {isActive && (
                  <motion.div
                    layoutId="hero-active-tab"
                    className="absolute top-0 left-0 right-0 -bottom-px rounded-t-lg bg-base-100/80 border border-b-0 border-base-300/15"
                    transition={{
                      type: 'spring',
                      bounce: 0.15,
                      duration: 0.4,
                    }}
                  />
                )}

                {/* Tab content */}
                <div className="relative z-10 flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1.5">
                  <div
                    className={`w-3 h-3 rounded-sm ${mockup.appIconBg} flex items-center justify-center shrink-0`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${mockup.appIconDot}`}
                    />
                  </div>
                  <span
                    className={`text-[10px] truncate transition-colors duration-300 ${
                      isActive ? 'text-base-content/50' : 'text-base-content/25'
                    }`}
                  >
                    {mockup.appTitle}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── App content — spring-animated carousel ── */}
        <div
          ref={contentRef}
          className="relative flex-1 min-h-0 overflow-hidden bg-base-100/30"
          role="tabpanel"
        >
          {isMounted &&
            MOCKUPS.map((mockup, idx) => {
              const ContentComponent = CONTENT_RENDERERS[mockup.word]

              return (
                <ContentView
                  key={mockup.word}
                  containerWidth={contentWidth}
                  viewIndex={idx}
                  activeIndex={activeIndex}
                >
                  <div className="px-4 py-3 h-full overflow-hidden">
                    {ContentComponent && <ContentComponent />}
                  </div>
                </ContentView>
              )
            })}
        </div>

        {/* ── Scrollr ticker bar ── */}
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-2 border-t-2 bg-base-100/60 overflow-hidden transition-[border-color] duration-500"
          style={{ borderTopColor: styles.tickerBorder }}
        >
          {/* Scrollr label */}
          <div className="flex items-center gap-1 shrink-0 pr-2 border-r border-base-300/15">
            <span className="relative flex h-1 w-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1 w-1 bg-primary" />
            </span>
            <span className="text-[8px] font-bold font-mono text-primary/60 uppercase tracking-wider">
              Scrollr
            </span>
          </div>

          {/* Ticker chips — crossfade per active app */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeMockup.word}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              {activeMockup.tickerChips.map((chip) => (
                <div
                  key={chip.label}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-sm border ${chipColors.chipBorder} ${chipColors.chipBg} shrink-0`}
                >
                  <span
                    className={`text-[9px] font-bold font-mono ${chipColors.chipText} whitespace-nowrap`}
                  >
                    {chip.label}
                  </span>
                  <span
                    className={`text-[8px] font-mono ${chipColors.chipSub} whitespace-nowrap`}
                  >
                    {chip.value}
                  </span>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
