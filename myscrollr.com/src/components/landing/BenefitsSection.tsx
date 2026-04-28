import { motion } from 'motion/react'
import { useState } from 'react'
import { Layers, SlidersHorizontal, Smartphone, Zap } from 'lucide-react'
import { useInViewport } from '@/hooks/useInViewport'

// ── Types & Data ─────────────────────────────────────────────────

interface Benefit {
  icon: typeof Zap
  title: string
  headline: string
  body: string
  accent: string
  accentBg: string
  accentBorder: string
  accentRaw: string
}

const BENEFITS: Array<Benefit> = [
  {
    icon: Smartphone,
    title: 'Your Phone Stays Down',
    headline: 'Stop reaching, start glancing',
    body: 'That impulse to check scores or prices mid-task fades. The info is already in your peripheral vision, so the urge to context-switch just stops.',
    accent: 'text-primary',
    accentBg: 'bg-primary/8',
    accentBorder: 'border-primary/15',
    accentRaw: 'primary',
  },
  {
    icon: Zap,
    title: 'You Catch Things First',
    headline: 'The moment it happens, not minutes later',
    body: 'Market flash crash, buzzer-beater, breaking headline. You see it when it happens, not 10 minutes later when someone mentions it in Slack.',
    accent: 'text-secondary',
    accentBg: 'bg-secondary/8',
    accentBorder: 'border-secondary/15',
    accentRaw: 'secondary',
  },
  {
    icon: Layers,
    title: 'Your Focus Gets Deeper',
    headline: 'No more app-switching',
    body: 'No jumping to ESPN. No opening a crypto app. No refreshing Reuters. Everything flows to you, so you stay locked into whatever you were doing.',
    accent: 'text-info',
    accentBg: 'bg-info/8',
    accentBorder: 'border-info/15',
    accentRaw: 'info',
  },
  {
    icon: SlidersHorizontal,
    title: 'It Gets Out of the Way',
    headline: 'Quiet when you need quiet',
    body: "Resize it, reposition it, minimize it, or collapse it entirely. When you need deep focus, one click and it's gone.",
    accent: 'text-accent',
    accentBg: 'bg-accent/8',
    accentBorder: 'border-accent/15',
    accentRaw: 'accent',
  },
]

// ── Constants ────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const

// ── Per-benefit illustrations ────────────────────────────────────

// `active` gates every `repeat: Infinity` animation in each illustration so
// loops don't keep ticking when the section is off-screen. We pass `false`
// for the `animate` value (Motion freezes in place); when `active` flips back
// the loop resumes. Entry-once `motion.{...}` reveals stay untouched since
// they don't loop — there's nothing to pause.

/** Benefit 0 — "Your Phone Stays Down": phone face-down, ticker bar glowing above */
function IllustrationPhoneDown({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      {/* Phone body — tilted face-down */}
      <motion.g
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <rect
          x="62"
          y="100"
          width="50"
          height="80"
          rx="8"
          className="stroke-base-content/20"
          strokeWidth="2"
          fill="none"
          transform="rotate(-12, 87, 140)"
        />
        {/* Screen — dim */}
        <rect
          x="66"
          y="108"
          width="42"
          height="60"
          rx="4"
          className="fill-base-content/5"
          transform="rotate(-12, 87, 140)"
        />
        {/* Down arrow on screen */}
        <motion.path
          d="M 85 128 L 85 145 M 80 140 L 85 145 L 90 140"
          className="stroke-base-content/15"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="rotate(-12, 87, 140)"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: [0, 0.4, 0.15] } : false}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.g>

      {/* Ticker bar — glowing above */}
      <motion.g
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
      >
        <rect
          x="30"
          y="50"
          width="140"
          height="24"
          rx="6"
          className="fill-base-200/60 stroke-primary/25"
          strokeWidth="1"
        />
        {/* Streaming data dots */}
        {[0, 1, 2, 3].map((i) => (
          <motion.circle
            key={i}
            cx={55 + i * 30}
            cy={62}
            r={3.5}
            fill={
              [
                'var(--color-primary)',
                'var(--color-secondary)',
                'var(--color-info)',
                'var(--color-accent)',
              ][i]
            }
            initial={{ opacity: 0.3 }}
            animate={active ? { opacity: [0.3, 0.9, 0.3] } : false}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.35,
            }}
          />
        ))}
      </motion.g>

      {/* Subtle pulse behind the ticker */}
      <motion.rect
        x="30"
        y="50"
        width="140"
        height="24"
        rx="6"
        fill="none"
        className="stroke-primary/20"
        strokeWidth="1"
        initial={{ scale: 1, opacity: 0.3 }}
        animate={
          active ? { scale: [1, 1.06, 1], opacity: [0.3, 0, 0.3] } : false
        }
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '100px 62px' }}
      />
    </svg>
  )
}

/** Benefit 1 — "You Catch Things First": live data chip appearing with pulse */
function IllustrationCatchFirst({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      {/* Concentric radar rings */}
      {[60, 44, 28].map((r, i) => (
        <motion.circle
          key={i}
          cx="100"
          cy="100"
          r={r}
          className="stroke-secondary/10"
          strokeWidth="1"
          fill="none"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15 * i, duration: 0.5, ease: EASE }}
        />
      ))}

      {/* Radar sweep line */}
      <motion.line
        x1="100"
        y1="100"
        x2="100"
        y2="40"
        className="stroke-secondary/30"
        strokeWidth="1.5"
        strokeLinecap="round"
        initial={{ rotate: 0 }}
        animate={active ? { rotate: 360 } : false}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '100px 100px' }}
      />

      {/* Radar sweep fade arc */}
      <motion.path
        d="M 100 100 L 100 40 A 60 60 0 0 1 152 70 Z"
        fill="url(#sweepGrad)"
        initial={{ rotate: 0 }}
        animate={active ? { rotate: 360 } : false}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
        style={{ transformOrigin: '100px 100px' }}
      />
      <defs>
        <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="1">
          <stop
            offset="0%"
            stopColor="var(--color-secondary)"
            stopOpacity="0.12"
          />
          <stop
            offset="100%"
            stopColor="var(--color-secondary)"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>

      {/* Live data chip popping in */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={active ? { scale: [0, 1.15, 1], opacity: [0, 1, 1] } : false}
        transition={{
          delay: 0.8,
          duration: 0.5,
          ease: EASE,
          repeat: Infinity,
          repeatDelay: 3.5,
        }}
      >
        <rect
          x="112"
          y="68"
          width="52"
          height="22"
          rx="6"
          className="fill-secondary/15 stroke-secondary/30"
          strokeWidth="1"
        />
        {/* Blinking live dot */}
        <motion.circle
          cx="122"
          cy="79"
          r="3"
          fill="var(--color-secondary)"
          animate={active ? { opacity: [1, 0.3, 1] } : false}
          transition={{ duration: 1, repeat: Infinity }}
        />
        {/* Price text placeholder */}
        <rect
          x="130"
          y="75"
          width="28"
          height="6"
          rx="2"
          className="fill-secondary/30"
        />
      </motion.g>

      {/* Center dot */}
      <circle cx="100" cy="100" r="3" className="fill-secondary/40" />
    </svg>
  )
}

/** Benefit 2 — "Your Focus Gets Deeper": tabs converging into single view */
function IllustrationFocusDeep({ active }: { active: boolean }) {
  const tabPositions = [
    { x: 30, y: 45, rot: -8 },
    { x: 100, y: 35, rot: 2 },
    { x: 145, y: 50, rot: 10 },
    { x: 55, y: 60, rot: -4 },
  ]

  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      {/* Scattered app windows — animate to converge */}
      {tabPositions.map((tab, i) => (
        <motion.g
          key={i}
          initial={{
            x: tab.x - 100,
            y: tab.y - 100,
            rotate: tab.rot,
            opacity: 0.6,
          }}
          animate={
            active
              ? {
                  x: [tab.x - 100, 0],
                  y: [tab.y - 100, 0],
                  rotate: [tab.rot, 0],
                  opacity: [0.6, 0],
                }
              : false
          }
          transition={{
            duration: 2,
            ease: EASE,
            delay: i * 0.2,
            repeat: Infinity,
            repeatDelay: 2.5,
          }}
        >
          <rect
            x={tab.x}
            y={tab.y}
            width="40"
            height="30"
            rx="4"
            className="fill-base-200/40 stroke-info/20"
            strokeWidth="1"
          />
          <rect
            x={tab.x + 4}
            y={tab.y + 3}
            width="16"
            height="3"
            rx="1.5"
            className="fill-info/25"
          />
        </motion.g>
      ))}

      {/* Unified browser window — center */}
      <motion.g
        initial={{ scale: 0.85, opacity: 0 }}
        animate={active ? { scale: [0.85, 1], opacity: [0, 1] } : false}
        transition={{
          delay: 1.2,
          duration: 0.8,
          ease: EASE,
          repeat: Infinity,
          repeatDelay: 3,
        }}
      >
        {/* Window chrome */}
        <rect
          x="48"
          y="75"
          width="104"
          height="70"
          rx="6"
          className="fill-base-200/50 stroke-info/25"
          strokeWidth="1.5"
        />
        {/* Title bar */}
        <rect
          x="48"
          y="75"
          width="104"
          height="16"
          rx="6"
          className="fill-info/8"
        />
        {/* Window dots */}
        <circle cx="58" cy="83" r="2" className="fill-info/30" />
        <circle cx="65" cy="83" r="2" className="fill-info/20" />
        <circle cx="72" cy="83" r="2" className="fill-info/15" />
        {/* Ticker bar inside */}
        <rect
          x="56"
          y="97"
          width="88"
          height="8"
          rx="2"
          className="fill-info/12"
        />
        {/* Content lines */}
        <rect
          x="56"
          y="112"
          width="64"
          height="4"
          rx="1.5"
          className="fill-base-content/10"
        />
        <rect
          x="56"
          y="120"
          width="48"
          height="4"
          rx="1.5"
          className="fill-base-content/7"
        />
        <rect
          x="56"
          y="128"
          width="56"
          height="4"
          rx="1.5"
          className="fill-base-content/5"
        />
      </motion.g>
    </svg>
  )
}

/** Benefit 3 — "It Gets Out of the Way": ticker bar minimizing/collapsing */
function IllustrationOutOfWay({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className="w-full h-full" fill="none">
      {/* Browser window background */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <rect
          x="32"
          y="50"
          width="136"
          height="100"
          rx="6"
          className="fill-base-200/40 stroke-base-content/10"
          strokeWidth="1"
        />
        {/* Title bar */}
        <rect
          x="32"
          y="50"
          width="136"
          height="16"
          rx="6"
          className="fill-base-content/5"
        />
        <circle cx="42" cy="58" r="2" className="fill-accent/30" />
        <circle cx="49" cy="58" r="2" className="fill-accent/20" />
        <circle cx="56" cy="58" r="2" className="fill-accent/15" />

        {/* Content area lines */}
        <rect
          x="44"
          y="90"
          width="80"
          height="5"
          rx="2"
          className="fill-base-content/8"
        />
        <rect
          x="44"
          y="100"
          width="60"
          height="5"
          rx="2"
          className="fill-base-content/5"
        />
        <rect
          x="44"
          y="110"
          width="72"
          height="5"
          rx="2"
          className="fill-base-content/6"
        />
        <rect
          x="44"
          y="120"
          width="50"
          height="5"
          rx="2"
          className="fill-base-content/4"
        />
      </motion.g>

      {/* Ticker bar — animates from expanded to collapsed */}
      <motion.g
        animate={
          active
            ? {
                scaleY: [1, 1, 0.15, 0.15, 1],
                opacity: [1, 1, 0.5, 0.5, 1],
              }
            : false
        }
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: 'easeInOut',
          times: [0, 0.3, 0.45, 0.75, 0.9],
        }}
        style={{ transformOrigin: '100px 74px' }}
      >
        <rect
          x="36"
          y="68"
          width="128"
          height="14"
          rx="3"
          className="fill-accent/10 stroke-accent/25"
          strokeWidth="1"
        />
        {/* Stream dots in ticker */}
        {[0, 1, 2, 3].map((i) => (
          <motion.circle
            key={i}
            cx={56 + i * 28}
            cy={75}
            r={2.5}
            fill={
              [
                'var(--color-primary)',
                'var(--color-secondary)',
                'var(--color-info)',
                'var(--color-accent)',
              ][i]
            }
            animate={active ? { opacity: [0.4, 0.8, 0.4] } : false}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
          />
        ))}
      </motion.g>

      {/* Collapse/expand arrow indicator */}
      <motion.g
        animate={
          active ? { y: [0, 0, -3, -3, 0], rotate: [0, 0, 180, 180, 0] } : false
        }
        transition={{
          duration: 5,
          repeat: Infinity,
          ease: 'easeInOut',
          times: [0, 0.3, 0.45, 0.75, 0.9],
        }}
        style={{ transformOrigin: '155px 75px' }}
      >
        <motion.path
          d="M 152 72 L 155 78 L 158 72"
          className="stroke-accent/40"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </motion.g>
    </svg>
  )
}

const ILLUSTRATIONS = [
  IllustrationPhoneDown,
  IllustrationCatchFirst,
  IllustrationFocusDeep,
  IllustrationOutOfWay,
]

// ── Single benefit block ─────────────────────────────────────────

function BenefitBlock({
  benefit,
  isHighlighted,
  onHighlight,
  index,
  illustrationActive,
}: {
  benefit: Benefit
  isHighlighted: boolean
  onHighlight: (index: number) => void
  index: number
  /** True only while the host section is in the viewport — pauses
   * the illustration's `repeat: Infinity` loops when scrolled away. */
  illustrationActive: boolean
}) {
  const Icon = benefit.icon
  const Illustration = ILLUSTRATIONS[index]

  return (
    <div className="relative flex items-center gap-6 lg:gap-10">
      {/* Accent glow — extends beyond card bounds */}
      <motion.div
        initial={false}
        animate={{ opacity: isHighlighted ? 0.1 : 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="absolute -inset-3 rounded-3xl blur-2xl pointer-events-none"
        style={{ backgroundColor: `var(--color-${benefit.accentRaw})` }}
      />

      {/* Card */}
      <motion.div
        initial={false}
        animate={{
          opacity: isHighlighted ? 1 : 0.45,
          scale: isHighlighted ? 1 : 0.98,
        }}
        transition={{ duration: 0.4, ease: EASE }}
        onViewportEnter={() => onHighlight(index)}
        viewport={{ margin: '-40% 0px -50% 0px', amount: 'some' }}
        className="relative flex-1 min-w-0 rounded-2xl py-6 px-5 lg:px-8 overflow-hidden"
      >
        {/* Background card — visible when highlighted */}
        <motion.div
          initial={false}
          animate={{ opacity: isHighlighted ? 1 : 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="absolute inset-0 rounded-2xl bg-base-200/50 border border-base-300/25 pointer-events-none"
        />

        {/* Watermark icon — large, faint, positioned top-right */}
        <motion.div
          initial={false}
          animate={{ opacity: isHighlighted ? 0.06 : 0.02 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="absolute -top-4 -right-4 pointer-events-none"
        >
          <Icon size={140} strokeWidth={1} className={benefit.accent} />
        </motion.div>

        {/* Left accent bar */}
        <motion.div
          initial={false}
          animate={{
            opacity: isHighlighted ? 1 : 0,
            scaleY: isHighlighted ? 1 : 0.5,
          }}
          transition={{ duration: 0.4, ease: EASE }}
          className="absolute left-0 top-4 bottom-4 w-[3px] rounded-full origin-center"
          style={{ backgroundColor: `var(--color-${benefit.accentRaw})` }}
        />

        {/* Content row */}
        <div className="relative flex items-start gap-4 lg:gap-5">
          {/* Icon */}
          <div className="shrink-0">
            <div
              className={`w-12 h-12 rounded-xl ${benefit.accentBg} border ${benefit.accentBorder} flex items-center justify-center`}
            >
              <Icon size={22} className={benefit.accent} />
            </div>
          </div>

          {/* Title + headline + body */}
          <div className="flex-1 min-w-0">
            <span
              className={`text-[11px] font-bold uppercase tracking-wider ${benefit.accent} mb-1.5 block`}
            >
              {benefit.title}
            </span>
            <h3 className="text-xl sm:text-2xl font-black tracking-tight text-base-content mb-2.5 leading-tight">
              {benefit.headline}
            </h3>
            <p className="text-[15px] text-base-content/55 leading-relaxed">
              {benefit.body}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Illustration — right side, desktop only */}
      <motion.div
        initial={false}
        animate={{
          opacity: isHighlighted ? 1 : 0.15,
          scale: isHighlighted ? 1 : 0.9,
        }}
        transition={{ duration: 0.4, ease: EASE }}
        className="hidden lg:block w-[200px] h-[200px] shrink-0"
      >
        <Illustration active={illustrationActive} />
      </motion.div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────

export function BenefitsSection() {
  const [activeIndex, setActiveIndex] = useState(0)
  // Pause the 21 `repeat: Infinity` SVG loops while the section is off-screen.
  // The observer fires with a 200 px rootMargin so animations have already
  // resumed by the time the user scrolls them into view.
  const [sectionRef, sectionInView] = useInViewport<HTMLElement>()

  return (
    <section ref={sectionRef} className="relative overflow-clip">
      {/* Ambient gradient orb — color-shifts per active card */}
      <div
        className="absolute pointer-events-none rounded-full blur-[120px] transition-colors duration-1000"
        style={{
          width: 500,
          height: 500,
          right: -100,
          top: '20%',
          opacity: 0.1,
          backgroundColor: `var(--color-${BENEFITS[activeIndex].accentRaw})`,
        }}
      />

      <div className="container relative py-20 lg:py-28">
        {/* Section heading — centered */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-14 lg:mb-20"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            What Actually <span className="text-gradient-primary">Changes</span>
          </h2>
          <p className="text-base sm:text-lg text-base-content/55 leading-relaxed text-center max-w-lg">
            It's not another app to check. It's the reason you stop checking.
          </p>
        </motion.div>

        {/* Benefit cards — single column, illustration inline per card */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ delay: 0.15, duration: 0.6, ease: EASE }}
          className="max-w-5xl mx-auto space-y-6 lg:space-y-10"
        >
          {BENEFITS.map((benefit, i) => (
            <BenefitBlock
              key={benefit.title}
              benefit={benefit}
              index={i}
              isHighlighted={activeIndex === i}
              onHighlight={setActiveIndex}
              illustrationActive={sectionInView}
            />
          ))}
        </motion.div>
      </div>
    </section>
  )
}
