import { motion, useSpring, useTransform } from 'motion/react'
import type { MotionValue } from 'motion/react'

/**
 * Shared "convergence backdrop" used behind the homepage CTA and the
 * uplink page's BottomCTA. Both previously hand-rolled near-identical
 * stacks of:
 *
 *  - dark gradient base
 *  - mouse-following ambient orb (filter:blur, mouse-spring driven)
 *  - 4 angular convergence beams (linear-gradient strips, scale-on-mount)
 *  - N floating particles (y-translate + opacity loops, infinite)
 *  - 3 pulse rings (scale 0.8 → 2.5, opacity 0.4 → 0, infinite)
 *
 * Centralising means future paint-cost fixes (e.g. dropping the orb's
 * 60px filter blur on low-power devices) only need to touch one spot.
 *
 * The component intentionally does NOT own the section element or the
 * `onMouseMove` handler. Each call site keeps its own section so it
 * controls layout, padding, and section-level reveals; we just render
 * the absolute-positioned background layers as a sibling.
 */

export interface BackdropParticle {
  id: number | string
  /** % across the section (0-100) */
  x: number
  /** % down the section (0-100) */
  y: number
  /** Pixel diameter */
  size: number
  /** Resolved CSS color value */
  color: string
  /** Animation start delay in seconds */
  delay: number
  /** Loop duration in seconds */
  duration: number
}

export interface BackdropBeam {
  /** Rotation in degrees from the section's left/top center */
  angle: number
  /** Resolved CSS color (used inside a linear-gradient) */
  color: string
  /** Reveal delay in seconds */
  delay: number
}

export function ConvergenceBackdrop({
  mouseX,
  mouseY,
  isInView,
  particles,
  beams,
  pulseRingCount = 3,
  /** Tailwind classes applied to the gradient base layer. */
  baseClassName = 'absolute inset-0 bg-gradient-to-b from-base-100 via-base-200/80 to-base-100 pointer-events-none',
  /** Override the orb's `radial-gradient` if a section needs different
   * accent hues. Defaults to the homepage CTA's primary+info palette. */
  orbBackground = 'radial-gradient(circle, rgba(52,211,153,0.08) 0%, rgba(0,212,255,0.04) 40%, transparent 70%)',
}: {
  /** Optional mouse-x position (range 0-1). When provided alongside
   * `mouseY`, an ambient orb is rendered that springs toward the
   * cursor. Skip both to render a static backdrop. */
  mouseX?: MotionValue<number>
  mouseY?: MotionValue<number>
  isInView: boolean
  particles: ReadonlyArray<BackdropParticle>
  beams: ReadonlyArray<BackdropBeam>
  pulseRingCount?: number
  baseClassName?: string
  orbBackground?: string
}) {
  return (
    <>
      {/* Dark gradient base */}
      <div className={baseClassName} />

      {/* Mouse-following ambient orb — only when MotionValues are wired up */}
      {mouseX != null && mouseY != null ? (
        <AmbientOrb
          mouseX={mouseX}
          mouseY={mouseY}
          orbBackground={orbBackground}
        />
      ) : null}

      {/* Convergence beams */}
      <div className="absolute inset-0 pointer-events-none">
        {beams.map((beam) => (
          <motion.div
            key={beam.angle}
            className="absolute left-1/2 top-1/2 pointer-events-none"
            style={{
              width: '200%',
              height: 2,
              transformOrigin: 'left center',
              rotate: beam.angle,
              x: '-50%',
              y: '-50%',
              background: `linear-gradient(90deg, transparent 0%, ${beam.color}00 20%, ${beam.color}40 50%, ${beam.color}00 80%, transparent 100%)`,
              opacity: 0,
            }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={
              isInView ? { opacity: [0, 0.6, 0.3], scaleX: [0, 1, 1] } : {}
            }
            transition={{
              delay: beam.delay,
              duration: 2,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
        ))}
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => (
          <motion.div
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              opacity: 0,
            }}
            animate={
              isInView ? { y: [0, -80, -160], opacity: [0, 0.5, 0] } : {}
            }
            transition={{
              delay: p.delay,
              duration: p.duration,
              ease: 'easeInOut',
              repeat: Infinity,
            }}
          />
        ))}
      </div>

      {/* Pulse rings — concentric expanding borders from center */}
      {Array.from({ length: pulseRingCount }, (_, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/20 pointer-events-none"
          style={{ width: 280, height: 280, opacity: 0 }}
          animate={isInView ? { scale: [0.8, 2.5], opacity: [0.4, 0] } : {}}
          transition={{
            delay: 1.2 + i,
            duration: 3,
            ease: 'easeOut',
            repeat: Infinity,
            repeatDelay: 1,
          }}
        />
      ))}
    </>
  )
}

/** Internal helper: the mouse-driven blur orb. Lifted out so the
 * spring hooks always run in the same order even when the parent
 * doesn't pass mouse MotionValues (we early-return at the call site
 * instead). */
function AmbientOrb({
  mouseX,
  mouseY,
  orbBackground,
}: {
  mouseX: MotionValue<number>
  mouseY: MotionValue<number>
  orbBackground: string
}) {
  const orbX = useTransform(mouseX, [0, 1], [-30, 30])
  const orbY = useTransform(mouseY, [0, 1], [-30, 30])
  const smoothOrbX = useSpring(orbX, { stiffness: 50, damping: 30 })
  const smoothOrbY = useSpring(orbY, { stiffness: 50, damping: 30 })

  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: 600,
        height: 600,
        left: '50%',
        top: '50%',
        x: smoothOrbX,
        y: smoothOrbY,
        translateX: '-50%',
        translateY: '-50%',
        background: orbBackground,
        filter: 'blur(60px)',
      }}
    />
  )
}
