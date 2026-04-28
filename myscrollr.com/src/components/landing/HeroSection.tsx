import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { wrap } from 'motion'
import HeroTextSwap, { WORDS } from '@/components/Typewriter'
import { HeroProductShowcase } from '@/components/landing/HeroProductShowcase'
import { DownloadButton } from '@/components/DownloadButton'

const CYCLE_MS = 4000

const WORD_ACCENTS = [
  {
    fill: 'bg-secondary',
    track: 'bg-secondary/15',
    text: 'text-secondary',
    textMuted: 'text-secondary/40',
  },
  {
    fill: 'bg-primary',
    track: 'bg-primary/15',
    text: 'text-primary',
    textMuted: 'text-primary/40',
  },
  {
    fill: 'bg-info',
    track: 'bg-info/15',
    text: 'text-info',
    textMuted: 'text-info/40',
  },
  {
    fill: 'bg-accent',
    track: 'bg-accent/15',
    text: 'text-accent',
    textMuted: 'text-accent/40',
  },
] as const

export function HeroSection() {
  const [activeWordIndex, setActiveWordIndex] = useState(0)
  const [cycleKey, setCycleKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    setCycleKey((k) => k + 1)
    timerRef.current = setInterval(() => {
      setActiveWordIndex((prev) => wrap(0, WORDS.length, prev + 1))
      setCycleKey((k) => k + 1)
    }, CYCLE_MS)
  }, [])

  // Auto-cycle on mount
  useEffect(() => {
    startTimer()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [startTimer])

  // Manual selection resets the timer
  const handleSelect = useCallback(
    (index: number) => {
      setActiveWordIndex(index)
      startTimer()
    },
    [startTimer],
  )

  const scrollToSection = (sectionId: string) => {
    const section = document.getElementById(sectionId)
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <section className="relative min-h-dvh flex items-center overflow-hidden">
      <div className="container relative">
        <div className="flex lg:flex-row flex-col justify-center items-center gap-12 lg:gap-12 xl:gap-16">
          {/* Desktop App Preview */}
          <div className="relative order-2 lg:order-1">
            <HeroProductShowcase
              activeIndex={activeWordIndex}
              onSelect={handleSelect}
            />
          </div>

          {/* Hero Text */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
            className="w-full lg:w-fit lg:min-w-80 xl:min-w-100 2xl:min-w-120 order-1 lg:order-2"
          >
            <HeroTextSwap activeIndex={activeWordIndex} />

            {/* Progress indicators */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.8 }}
              className="flex gap-2 my-6 max-w-md"
            >
              {WORDS.map((word, i) => {
                const accent = WORD_ACCENTS[i]
                const isActive = i === activeWordIndex

                return (
                  <button
                    key={word}
                    type="button"
                    onClick={() => handleSelect(i)}
                    aria-label={`Show ${word} demo`}
                    aria-pressed={isActive}
                    className="flex-1 cursor-pointer py-2"
                  >
                    <div
                      className={`h-1 rounded-full overflow-hidden ${accent.track}`}
                    >
                      {isActive ? (
                        <motion.div
                          key={`fill-${cycleKey}`}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{
                            duration: CYCLE_MS / 1000,
                            ease: 'linear',
                          }}
                          className={`h-full w-full rounded-full origin-left ${accent.fill}`}
                        />
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1 }}
              className="text-base text-base-content/50 max-w-md leading-relaxed"
            >
              A quiet ticker at the edge of your screen. Scores update, prices
              move, headlines arrive &mdash; all while you stay focused on
              whatever you&rsquo;re working on.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 1.2 }}
              className="flex flex-wrap gap-4 mt-10"
            >
              <DownloadButton />
              <motion.button
                type="button"
                whileHover={{
                  y: 2,
                  transition: { type: 'tween', duration: 0.2 },
                }}
                whileTap={{ y: 0 }}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-base-300 bg-base-200/50 px-6 py-3 text-sm font-semibold text-base-content hover:bg-base-300 transition-colors backdrop-blur-sm"
                onClick={() => scrollToSection('how-it-works')}
              >
                How It Works
              </motion.button>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-3 text-base-content/40"
      >
        <span className="text-xs text-base-content/40">Scroll</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-5 h-8 rounded-full border-2 border-current flex justify-center pt-2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-current"
          />
        </motion.div>
      </motion.div>
    </section>
  )
}
