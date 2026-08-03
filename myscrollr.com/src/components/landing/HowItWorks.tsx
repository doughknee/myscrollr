import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Download,
  Ghost,
  Rss,
  Shield,
  Star,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react'
import { DownloadButton } from '@/components/DownloadButton'
import ScrollrSVG from '@/components/ScrollrSVG'

// ── Constants ────────────────────────────────────────────────────

const CYCLE_MS = 5000

const STEPS = [
  {
    id: 'download',
    title: 'Download the App',
    description:
      'Grab the installer for macOS, Windows, or Linux. No sign-up needed to try the basics — create a free account to unlock live data widgets.',
  },
  {
    id: 'choose',
    title: 'Pick Your Widgets',
    description:
      'Toggle on sports, markets, news, or fantasy. Whatever matters to you.',
  },
  {
    id: 'work',
    title: 'Work as Usual',
    description:
      'A quiet ticker at the edge of your screen. Always there, never in the way.',
  },
]

// ── Channel & chip data for visuals ──────────────────────────────

type ChannelColor = 'primary' | 'secondary' | 'info' | 'accent'
type ChipColor = 'primary' | 'secondary' | 'info'

const CHANNELS: Array<{
  name: string
  icon: typeof TrendingUp
  color: ChannelColor
  defaultOn: boolean
}> = [
  { name: 'Finance', icon: TrendingUp, color: 'primary', defaultOn: true },
  { name: 'Sports', icon: Trophy, color: 'secondary', defaultOn: true },
  { name: 'News', icon: Rss, color: 'info', defaultOn: false },
  { name: 'Fantasy', icon: Ghost, color: 'accent', defaultOn: true },
]

const DEMO_CHIPS: Array<{ label: string; value: string; color: ChipColor }> = [
  { label: 'BTC', value: '$67,241', color: 'primary' },
  { label: 'LAL 118', value: 'BOS 112', color: 'secondary' },
  { label: 'NVDA', value: '$891.20', color: 'primary' },
  { label: 'Fed holds rates', value: 'Reuters', color: 'info' },
]

// ── Style maps ───────────────────────────────────────────────────

const toggleBg: Record<ChannelColor, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  info: 'bg-info',
  accent: 'bg-accent',
}

const iconStyle: Record<ChannelColor, string> = {
  primary: 'text-primary bg-primary/10 border border-primary/15',
  secondary: 'text-secondary bg-secondary/10 border border-secondary/15',
  info: 'text-info bg-info/10 border border-info/15',
  accent: 'text-accent bg-accent/10 border border-accent/15',
}

const chipStyle: Record<
  ChipColor,
  { border: string; text: string; bg: string; sub: string }
> = {
  primary: {
    border: 'border-primary/25',
    text: 'text-primary',
    bg: 'bg-primary/[0.06]',
    sub: 'text-primary',
  },
  secondary: {
    border: 'border-secondary/25',
    text: 'text-secondary',
    bg: 'bg-secondary/[0.06]',
    sub: 'text-secondary',
  },
  info: {
    border: 'border-info/25',
    text: 'text-info',
    bg: 'bg-info/[0.06]',
    sub: 'text-info',
  },
}

// ── Shared visual transition ─────────────────────────────────────

const VISUAL_EASE = [0.22, 1, 0.36, 1] as const

// ── Step 1 Visual: Download ──────────────────────────────────────

function DownloadVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: VISUAL_EASE }}
      className="flex flex-col h-full"
    >
      {/* App listing card */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-10 py-8 sm:py-10">
        {/* Top: App info row */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45, ease: VISUAL_EASE }}
          className="flex items-start gap-4 sm:gap-5 mb-6 sm:mb-8"
        >
          {/* App icon */}
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 20,
              delay: 0.15,
            }}
            className="relative shrink-0"
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/10">
              <ScrollrSVG className="w-8 h-8 sm:w-10 sm:h-10" />
            </div>
          </motion.div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0 pt-0.5">
            <h4 className="text-lg sm:text-xl font-bold text-base-content mb-1">
              Scrollr
            </h4>
            <p className="text-xs sm:text-sm text-base-subtle leading-relaxed mb-2.5">
              Live finance, sports &amp; news in a quiet desktop ticker.
            </p>

            {/* Rating + meta row */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Stars */}
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      delay: 0.4 + i * 0.06,
                      type: 'spring',
                      stiffness: 400,
                      damping: 15,
                    }}
                  >
                    <Star size={12} className="text-warning-ink fill-warning" />
                  </motion.div>
                ))}
                <span className="text-[11px] text-base-subtle ml-1 font-medium">
                  5.0
                </span>
              </div>

              <span className="text-base-subtle">|</span>

              {/* Tags */}
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/[0.07] border border-primary/10 rounded-md px-1.5 py-0.5">
                  <Zap size={9} />
                  Free tier
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-base-subtle bg-base-300/10 border border-base-300/15 rounded-md px-1.5 py-0.5">
                  <Shield size={9} />
                  Privacy-first
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Feature highlights */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: VISUAL_EASE }}
          className="grid grid-cols-3 gap-3 mb-7 sm:mb-8"
        >
          {[
            { icon: Zap, label: 'Native app', sub: 'Fast & light' },
            { icon: Shield, label: 'No tracking', sub: 'Zero analytics' },
            { icon: Download, label: 'Instant setup', sub: 'No sign-up' },
          ].map((feat, i) => (
            <motion.div
              key={feat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.6 + i * 0.08,
                duration: 0.4,
                ease: VISUAL_EASE,
              }}
              className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-base-100/40 border border-base-300/15"
            >
              <feat.icon size={14} className="text-base-subtle" />
              <span className="text-[11px] font-semibold text-base-muted">
                {feat.label}
              </span>
              <span className="text-[10px] text-base-subtle">
                {feat.sub}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* Download button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.4, ease: VISUAL_EASE }}
          className="flex justify-center"
        >
          <DownloadButton />
        </motion.div>
      </div>
    </motion.div>
  )
}

// ── Step 2 Visual: Choose Channels ───────────────────────────────

function ChooseVisual() {
  const [toggled, setToggled] = useState<Array<boolean>>(
    CHANNELS.map(() => false),
  )

  useEffect(() => {
    const timeouts: Array<ReturnType<typeof setTimeout>> = []
    CHANNELS.forEach((channel, i) => {
      if (channel.defaultOn) {
        timeouts.push(
          setTimeout(
            () => {
              setToggled((prev) => {
                const next = [...prev]
                next[i] = true
                return next
              })
            },
            500 + i * 200,
          ),
        )
      }
    })
    return () => timeouts.forEach(clearTimeout)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: VISUAL_EASE }}
      className="flex items-center justify-center h-full py-8 sm:py-12 px-5 sm:px-10"
    >
      <div className="w-full max-w-sm space-y-2.5">
        {CHANNELS.map((channel, i) => (
          <motion.div
            key={channel.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: 0.12 + i * 0.08,
              duration: 0.4,
              ease: VISUAL_EASE,
            }}
            className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-base-100/60 border border-base-300/30"
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconStyle[channel.color]}`}
              >
                <channel.icon size={15} />
              </div>
              <span className="text-sm font-medium text-base-muted">
                {channel.name}
              </span>
            </div>

            {/* Toggle pill */}
            <div
              className={`relative w-11 h-6 rounded-full transition-colors duration-300 ${toggled[i] ? toggleBg[channel.color] : 'bg-base-300/40'}`}
            >
              <motion.div
                className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm"
                animate={{ x: toggled[i] ? 20 : 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 500,
                  damping: 30,
                }}
              />
            </div>
          </motion.div>
        ))}

        {/* Subtle helper text */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 0.5, ease: VISUAL_EASE }}
          className="text-[11px] text-base-subtle text-center pt-2"
        >
          Change anytime from the app settings
        </motion.p>
      </div>
    </motion.div>
  )
}

// ── Step 3 Visual: Work ──────────────────────────────────────────

function WorkVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: VISUAL_EASE }}
      className="flex flex-col h-full"
    >
      {/* Desktop workspace — app window with Scrollr ticker */}
      <div className="flex-1 flex flex-col bg-base-100/40">
        {/* Application title bar */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-base-300/20 bg-base-200/50">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-error/25" />
            <div className="w-2 h-2 rounded-full bg-warning/25" />
            <div className="w-2 h-2 rounded-full bg-success/25" />
          </div>
          <div className="flex-1 mx-2">
            <span className="text-[10px] text-base-subtle">
              Your workspace
            </span>
          </div>
        </div>

        {/* Content skeleton — represents any application */}
        <div className="flex-1 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-base-300/12 shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-2 bg-base-300/10 rounded w-3/4" />
              <div className="h-1.5 bg-base-300/7 rounded w-1/2" />
            </div>
          </div>
          <div className="h-14 bg-base-300/5 rounded-lg border border-base-300/8" />
          <div className="space-y-2">
            <div className="h-1.5 bg-base-300/8 rounded w-full" />
            <div className="h-1.5 bg-base-300/6 rounded w-5/6" />
            <div className="h-1.5 bg-base-300/5 rounded w-2/3" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <div className="w-7 h-7 rounded bg-base-300/8 shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-2 bg-base-300/7 rounded w-2/3" />
              <div className="h-1.5 bg-base-300/5 rounded w-2/5" />
            </div>
          </div>
          <div className="h-10 bg-base-300/4 rounded-lg border border-base-300/6" />
        </div>

        {/* Scrollr ticker — pinned to bottom edge, slides up */}
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.6, ease: VISUAL_EASE }}
          className="mt-auto border-t border-primary/15 bg-base-100/95 px-3 py-2"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {/* Scrollr live indicator */}
            <div className="flex items-center gap-1.5 pr-2 border-r border-base-300/20 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
            </div>

            {/* Data chips */}
            {DEMO_CHIPS.map((chip, i) => {
              const cs = chipStyle[chip.color]
              return (
                <motion.div
                  key={chip.label}
                  initial={{ opacity: 0, x: 15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.6 + i * 0.08,
                    duration: 0.4,
                    ease: VISUAL_EASE,
                  }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded border ${cs.border} ${cs.bg} shrink-0`}
                >
                  <span className={`text-[9px] font-bold font-mono ${cs.text}`}>
                    {chip.label}
                  </span>
                  <span className={`text-[8px] font-mono ${cs.sub}`}>
                    {chip.value}
                  </span>
                </motion.div>
              )
            })}
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ── Visual lookup ────────────────────────────────────────────────

const VISUALS = [DownloadVisual, ChooseVisual, WorkVisual]

// ── Main Component ───────────────────────────────────────────────

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0)
  const [cycleKey, setCycleKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sectionRef = useRef<HTMLElement>(null)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Restart the interval without resetting the active step
  const restartTimer = useCallback(() => {
    stopTimer()
    setCycleKey((k) => k + 1)
    timerRef.current = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % STEPS.length)
      setCycleKey((k) => k + 1)
    }, CYCLE_MS)
  }, [stopTimer])

  // IntersectionObserver: reset & play when visible, pause when not
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Reset to first step and start cycling
          setActiveStep(0)
          setCycleKey((k) => k + 1)
          if (timerRef.current) clearInterval(timerRef.current)
          timerRef.current = setInterval(() => {
            setActiveStep((prev) => (prev + 1) % STEPS.length)
            setCycleKey((k) => k + 1)
          }, CYCLE_MS)
        } else {
          // Stop cycling when out of view
          if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
          }
        }
      },
      { threshold: 0.35 },
    )

    observer.observe(el)
    return () => {
      observer.disconnect()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleSelect = useCallback(
    (index: number) => {
      setActiveStep(index)
      restartTimer()
    },
    [restartTimer],
  )

  const ActiveVisual = VISUALS[activeStep]

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative scroll-m-20"
    >
      {/* Subtle background band — signals a new "room" */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-base-200/20 to-transparent pointer-events-none" />

      <div className="container relative py-10 sm:py-14 lg:py-32">
        {/* Mobile header — static to avoid observer-related invisible states. */}
        <div className="flex flex-col items-center text-center mb-8 lg:hidden">
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            Ready in{' '}
            <span className="text-gradient-primary">Under a Minute</span>
          </h2>
          <p className="text-base text-base-muted leading-relaxed text-center max-w-lg">
            Three steps between you and live data on your desktop.
          </p>
        </div>

        {/* Desktop section header — keeps the existing motion treatment. */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-200px' }}
          transition={{ duration: 0.6, ease: VISUAL_EASE }}
          className="hidden lg:flex flex-col items-center text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            Ready in{' '}
            <span className="text-gradient-primary">Under a Minute</span>
          </h2>
          <p className="text-base text-base-muted leading-relaxed text-center max-w-lg">
            Three steps between you and live data on your desktop.
          </p>
        </motion.div>

        {/* ── Mobile layout ── */}
        <div className="lg:hidden space-y-3">
          {STEPS.map((step, i) => (
            <article
              key={step.id}
              data-mobile-step-card
              className="rounded-2xl border border-base-300/40 bg-base-200/35 p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-black text-primary border border-primary/15">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-base-content">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-base-muted">
                    {step.description}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* ── Desktop layout ── */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-10 items-start">
          {/* Steps — left column */}
          <div className="lg:col-span-5 space-y-3">
            {STEPS.map((step, i) => {
              const isActive = activeStep === i
              return (
                <motion.button
                  key={step.id}
                  type="button"
                  onClick={() => handleSelect(i)}
                  style={{ opacity: 0 }}
                  initial={{ opacity: 0, y: 15 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-200px' }}
                  transition={{
                    delay: 0.1 + i * 0.08,
                    duration: 0.5,
                    ease: VISUAL_EASE,
                  }}
                  className={`w-full text-left rounded-xl px-6 py-5 transition-[color,background-color,border-color,box-shadow] duration-300 cursor-pointer relative overflow-hidden ${
                    isActive
                      ? 'bg-base-200/70 border border-primary/15 shadow-sm shadow-primary/5'
                      : 'bg-transparent border border-transparent hover:bg-base-200/30'
                  }`}
                >
                  {/* Top progress bar */}
                  {isActive && (
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary/10 overflow-hidden">
                      <motion.div
                        key={`progress-${cycleKey}`}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: CYCLE_MS / 1000,
                          ease: 'linear',
                        }}
                        className="h-full bg-primary origin-left"
                      />
                    </div>
                  )}

                  <div className="flex items-start gap-4">
                    {/* Step number circle */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-colors duration-300 ${
                        isActive
                          ? 'bg-primary text-primary-content'
                          : 'bg-base-300/20 text-base-subtle'
                      }`}
                    >
                      {i + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3
                        className={`text-sm font-bold transition-colors duration-300 ${
                          isActive
                            ? 'text-base-content'
                            : 'text-base-subtle'
                        }`}
                      >
                        {step.title}
                      </h3>

                      {/* Description — expands when active */}
                      <AnimatePresence initial={false}>
                        {isActive && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                              height: {
                                duration: 0.3,
                                ease: VISUAL_EASE,
                              },
                              opacity: { duration: 0.2, delay: 0.05 },
                            }}
                            className="overflow-hidden"
                          >
                            <p className="text-sm text-base-subtle leading-relaxed mt-2">
                              {step.description}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </div>

          {/* Visual stage — right column */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-200px' }}
            transition={{ delay: 0.2, duration: 0.6, ease: VISUAL_EASE }}
            className="lg:col-span-7"
          >
            <div className="rounded-2xl bg-base-200/40 border border-base-300/40 overflow-hidden min-h-[420px] flex flex-col [&>*]:flex-1 [&>*]:flex [&>*]:flex-col">
              <AnimatePresence mode="wait">
                <ActiveVisual key={`desktop-${activeStep}-${cycleKey}`} />
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
