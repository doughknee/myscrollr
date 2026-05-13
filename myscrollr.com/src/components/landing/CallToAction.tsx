import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useInView, useMotionValue, useSpring } from 'motion/react'
import { Link } from '@tanstack/react-router'
import {
  Building2,
  GitFork,
  Github,
  Globe,
  MessageSquare,
  Star,
  Zap,
} from 'lucide-react'
import type {
  BackdropBeam,
  BackdropParticle,
} from '@/components/landing/_ConvergenceBackdrop'
import { DownloadButton } from '@/components/DownloadButton'

import { useGitHubStats } from '@/hooks/useGitHubStats'
import { ConvergenceBackdrop } from '@/components/landing/_ConvergenceBackdrop'

/* ────────────────────────────────────────────────────────────────────────── */
/*  Constants                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const EASE = [0.22, 1, 0.36, 1] as const

const CHANNELS = [
  { color: '#34d399', label: 'Finance' },
  { color: '#ff4757', label: 'Sports' },
  { color: '#00d4ff', label: 'News' },
  { color: '#a855f7', label: 'Fantasy' },
] as const

/** Floating particle positions — spread across the background.
 *
 * Down from 28 → 12. At 28 the section ran 28 simultaneous infinite
 * `animate={{ y, opacity }}` loops; with the section's other 3 pulse
 * rings + mouse-spring orb on top, that pushed integrated GPUs hard.
 * 12 reads as visually identical at typical viewport sizes (the field
 * was visually saturated at 28 anyway). */
const PARTICLES = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  y: Math.random() * 100,
  size: Math.random() * 3 + 1.5,
  delay: Math.random() * 5,
  duration: Math.random() * 6 + 8,
  channelIndex: i % 4,
}))

/* ────────────────────────────────────────────────────────────────────────── */
/*  Animated counter hook                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function useAnimatedCounter(target: number, isInView: boolean, suffix = '') {
  const [display, setDisplay] = useState('0' + suffix)
  const motionVal = useMotionValue(0)
  const springVal = useSpring(motionVal, { stiffness: 40, damping: 20 })

  useEffect(() => {
    if (isInView) {
      motionVal.set(target)
    }
  }, [isInView, target, motionVal])

  useEffect(() => {
    const unsub = springVal.on('change', (v) => {
      if (target >= 1000) {
        setDisplay(Math.round(v).toLocaleString() + suffix)
      } else {
        setDisplay(Math.round(v) + suffix)
      }
    })
    return unsub
  }, [springVal, target, suffix])

  return display
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Main CTA Component                                                       */
/* ────────────────────────────────────────────────────────────────────────── */
//
// The convergence beam, pulse ring, ambient orb, and particle layers used to
// live inline here. They moved to `_ConvergenceBackdrop.tsx` so the BottomCTA
// in `routes/uplink.tsx` can share the same implementation. Future paint-cost
// fixes touch one file instead of two.

export function CallToAction() {
  const sectionRef = useRef<HTMLElement>(null)
  const isInView = useInView(sectionRef, { amount: 0.15 })

  /* Mouse parallax for the ambient orb. The actual orb + spring chain
   * lives inside `<ConvergenceBackdrop>`; this component just owns the
   * raw 0-1 cursor position and forwards both MotionValues. */
  const mouseX = useMotionValue(0.5)
  const mouseY = useMotionValue(0.5)

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      mouseX.set((e.clientX - rect.left) / rect.width)
      mouseY.set((e.clientY - rect.top) / rect.height)
    },
    [mouseX, mouseY],
  )

  /* Resolve particle colors via channelIndex once. */
  const particles = useMemo<Array<BackdropParticle>>(
    () =>
      PARTICLES.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        size: p.size,
        color: CHANNELS[p.channelIndex].color,
        delay: p.delay,
        duration: p.duration,
      })),
    [],
  )

  /* 4 beams: cardinal channels at 45° offsets. */
  const beams = useMemo<Array<BackdropBeam>>(
    () =>
      CHANNELS.map((channel, i) => ({
        angle: i * 90 + 45,
        color: channel.color,
        delay: 0.3 + i * 0.15,
      })),
    [],
  )

  /* GitHub stats */
  const githubStats = useGitHubStats('brandon-relentnet/myscrollr')

  /* Animated counters */
  const statsRef = useRef<HTMLDivElement>(null)
  const statsInView = useInView(statsRef, { once: true, amount: 0.5 })
  const starsCount = useAnimatedCounter(
    githubStats?.stars ?? 0,
    statsInView && githubStats != null,
  )
  const forksCount = useAnimatedCounter(
    githubStats?.forks ?? 0,
    statsInView && githubStats != null,
  )

  return (
    <section
      ref={sectionRef}
      className="relative overflow-clip py-32 lg:py-44"
      onMouseMove={handleMouseMove}
    >
      {/* ── Background layers (shared with BottomCTA on /uplink) ──────── */}
      <ConvergenceBackdrop
        mouseX={mouseX}
        mouseY={mouseY}
        isInView={isInView}
        particles={particles}
        beams={beams}
        pulseRingCount={3}
      />

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div
        className="relative mx-auto px-5 sm:px-6 lg:px-8"
        style={{ maxWidth: 1400 }}
      >
        <div className="flex flex-col items-center text-center">
          {/* Pill badge */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur-sm">
              <Zap className="size-3" aria-hidden />
              Open source. Zero tracking. Always free.
            </span>
          </motion.div>

          {/* Main headline */}
          <motion.h2
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{
              delay: 0.1,
              duration: 0.6,
              ease: EASE,
            }}
            className="mt-8 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tight leading-none"
          >
            <span className="block">Stop</span>
            <span className="block mt-2 text-gradient-primary">
              Context-Switching.
            </span>
          </motion.h2>

          {/* Sub-copy */}
          <motion.span
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              delay: 0.25,
              duration: 0.5,
              ease: EASE,
            }}
            className="block mt-6 text-lg sm:text-xl text-base-content/50 max-w-lg leading-relaxed"
          >
            Download once. It runs quietly at the edge of your screen.
          </motion.span>

          {/* ── CTA button area with orbiting icons ─────────────────────── */}
          <motion.div
            className="relative mt-10"
            style={{ opacity: 0 }}
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{
              delay: 0.4,
              duration: 0.6,
              ease: EASE,
            }}
          >
            {/* Central glow behind button */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
              style={{
                width: 200,
                height: 200,
                background:
                  'radial-gradient(circle, rgba(52,211,153,0.15) 0%, transparent 70%)',
                filter: 'blur(30px)',
              }}
            />

            <DownloadButton />
          </motion.div>

          {/* Platform support line */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.5, ease: EASE }}
            className="mt-6 flex items-center gap-4 text-xs text-base-content/30"
          >
            {['macOS', 'Windows', 'Linux'].map((platform) => (
              <span key={platform} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                {platform}
              </span>
            ))}
          </motion.div>

          {/* ── Stats row ───────────────────────────────────────────────── */}
          <motion.div
            ref={statsRef}
            style={{ opacity: 0 }}
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.7, duration: 0.5, ease: EASE }}
            className="mt-16 flex items-center justify-center gap-3"
          >
            {/* Stars */}
            <a
              href="https://github.com/brandon-relentnet/myscrollr"
              target="_blank"
              rel="noreferrer"
              title="Star on GitHub"
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl border border-base-300/20 bg-base-200/30 text-warning/50 hover:text-warning hover:border-warning/20 hover:bg-warning/[0.04] transition-[color,border-color,background-color] duration-200"
            >
              <Star className="size-4" />
              <span className="text-sm font-bold tabular-nums">
                {githubStats != null ? starsCount : '...'}
              </span>
              <span className="text-xs text-base-content/30 group-hover:text-warning/40 transition-[color] duration-200">
                Stars
              </span>
            </a>

            {/* Forks */}
            <a
              href="https://github.com/brandon-relentnet/myscrollr/forks"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl border border-base-300/20 bg-base-200/30 text-info/50 hover:text-info hover:border-info/20 hover:bg-info/[0.04] transition-[color,border-color,background-color] duration-200"
            >
              <GitFork className="size-4" />
              <span className="text-sm font-bold tabular-nums">
                {githubStats != null ? forksCount : '...'}
              </span>
              <span className="text-xs text-base-content/30 group-hover:text-info/40 transition-[color] duration-200">
                Forks
              </span>
            </a>

            {/* Discussions */}
            <Link
              to="/support"
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl border border-base-300/20 bg-base-200/30 text-accent/50 hover:text-accent hover:border-accent/20 hover:bg-accent/[0.04] transition-[color,border-color,background-color] duration-200"
            >
              <MessageSquare className="size-4" />
              <span className="text-sm font-bold">Discuss</span>
            </Link>
          </motion.div>

          {/* ── Bottom links ────────────────────────────────────────────── */}
          <motion.div
            style={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.85, duration: 0.5, ease: EASE }}
            className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
          >
            <a
              href="https://github.com/brandon-relentnet/myscrollr"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-base-content/40 hover:text-primary transition-[color] duration-200"
            >
              <Github className="size-4" aria-hidden />
              View Source
            </a>
            <span className="w-px h-4 bg-base-content/10" />
            <a
              href="#channels"
              className="inline-flex items-center gap-2 text-sm text-base-content/40 hover:text-primary transition-[color] duration-200"
            >
              <Globe className="size-4" aria-hidden />
              Explore Channels
            </a>
            <span className="w-px h-4 bg-base-content/10" />
            <Link
              to="/business"
              className="inline-flex items-center gap-2 text-sm text-base-content/40 hover:text-primary transition-[color] duration-200"
            >
              <Building2 className="size-4" aria-hidden />
              Running a business?
            </Link>
          </motion.div>
        </div>
      </div>

      {/* ── Bottom horizon glow ─────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none">
        <motion.div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--color-primary), var(--color-info), var(--color-primary), transparent)',
            opacity: 0,
          }}
          animate={isInView ? { opacity: [0, 0.4, 0.2] } : {}}
          transition={{ delay: 1.5, duration: 2 }}
        />
        <motion.div
          className="absolute bottom-0 left-1/2 -translate-x-1/2"
          style={{
            width: '60%',
            height: 120,
            background:
              'radial-gradient(ellipse at bottom, rgba(52,211,153,0.08) 0%, transparent 70%)',
            opacity: 0,
          }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ delay: 1.8, duration: 1.5 }}
        />
      </div>
    </section>
  )
}
