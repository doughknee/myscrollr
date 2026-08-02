/**
 * Shared "terminal editorial" building blocks for the marketing pages
 * (design_handoff_marketing_site/README.md — the design system).
 *
 * Row vocabulary:
 *  - <SectionRow>    full-width hairline + mono tag row that opens every
 *                    section: `SEC NN ／ NAME` left, optional stat right.
 *  - <PageHeader>    two-part uppercase headline (payoff line outlined),
 *                    radial emerald glow, riseIn entrance stagger.
 *  - <DeparturesRow> full-width link row: `↳ NN` index, big uppercase
 *                    label, emerald mono action right, hover tint.
 *  - <StepsGrid>     ghost-numeral step sequence (01/02/03).
 */

import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { EASE, riseIn } from '@/lib/animations'

/** Max-width wrapper matching the mockups' 1280px content column. */
export function TerminalContainer({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`mx-auto max-w-[1280px] px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  )
}

/** Mono section tag row with the full-width hairline above it. */
export function SectionRow({
  tag,
  stat,
}: {
  tag: ReactNode
  stat?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-hairline py-5 font-mono text-[11px] uppercase tracking-[0.14em] text-base-content/45">
      <span>{tag}</span>
      {stat != null && <span className="text-right">{stat}</span>}
    </div>
  )
}

/**
 * Page header: mono eyebrow row, two-line uppercase display headline
 * with the payoff line outlined, then a sub row (left paragraph +
 * right-hand actions). Sections stagger in via riseIn.
 */
export function PageHeader({
  eyebrowLeft,
  eyebrowRight,
  line1,
  line2,
  sub,
  actions,
  size = 'md',
}: {
  eyebrowLeft: ReactNode
  eyebrowRight?: ReactNode
  line1: ReactNode
  line2: ReactNode
  sub: ReactNode
  actions?: ReactNode
  /** 'lg' = landing-hero scale, 'md' = interior pages. */
  size?: 'md' | 'lg'
}) {
  // The max-sm overrides keep the clamp floors from exceeding what a
  // ~280px content column can fit — otherwise the h1's last-resort
  // overflow-wrap:break-word splits words mid-glyph on small phones.
  const headline =
    size === 'lg'
      ? 'text-[clamp(56px,8.5vw,118px)] max-sm:text-[clamp(40px,13.5vw,56px)]'
      : 'text-[clamp(44px,6.5vw,96px)] max-sm:text-[clamp(34px,10.5vw,44px)]'
  return (
    <section className="relative overflow-hidden border-b border-hairline px-5 pb-14 pt-16 sm:px-8">
      {/* Soft accent radial glow behind the header — follows the active
          theme family's primary. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[220px] left-[45%] h-[480px] w-[720px]"
        style={{
          background:
            'radial-gradient(ellipse at center, color-mix(in srgb, var(--color-primary) 9%, transparent), transparent 65%)',
        }}
      />
      <div className="relative mx-auto max-w-[1280px]">
        <motion.div
          {...riseIn(0)}
          className="mb-10 flex flex-wrap justify-between gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-base-content/45"
        >
          <span>{eyebrowLeft}</span>
          {eyebrowRight != null && <span>{eyebrowRight}</span>}
        </motion.div>
        <motion.h1 {...riseIn(1)} className={`type-display m-0 ${headline}`}>
          {line1}
          <br />
          <span className="type-outline">{line2}</span>
        </motion.h1>
        <motion.div
          {...riseIn(3)}
          className="mt-10 flex flex-wrap items-end justify-between gap-10"
        >
          <p className="m-0 max-w-[480px] text-lg leading-relaxed text-base-content/60 [text-wrap:pretty]">
            {sub}
          </p>
          {actions != null && <div className="min-w-0">{actions}</div>}
        </motion.div>
      </div>
    </section>
  )
}

/** One departures-board row. Pass `to` for internal or `href` for external. */
export function DeparturesRow({
  index,
  label,
  meta,
  tag,
  action,
  to,
  href,
  onClick,
  labelClassName = 'text-2xl',
}: {
  index: string
  label: ReactNode
  /** Muted inline detail next to the label. */
  meta?: ReactNode
  /** Small bordered tag (e.g. YOURS). */
  tag?: ReactNode
  /** Right-hand emerald mono action, e.g. 'DOWNLOAD ↓'. */
  action: ReactNode
  to?: string
  href?: string
  onClick?: () => void
  labelClassName?: string
}) {
  const inner = (
    <>
      <span className="flex flex-wrap items-baseline gap-5">
        <span className="font-mono text-xs text-base-content/40">
          ↳ {index}
        </span>
        <span
          className={`font-display font-bold uppercase tracking-[0.01em] ${labelClassName}`}
        >
          {label}
        </span>
        {tag != null && (
          <span className="rounded-[3px] border border-primary/40 px-2 py-[3px] font-mono text-[10px] tracking-[0.12em] text-primary">
            {tag}
          </span>
        )}
        {meta != null && (
          <span className="text-sm text-base-content/55">{meta}</span>
        )}
      </span>
      <span className="whitespace-nowrap font-mono text-sm text-primary transition-transform duration-150 group-hover:translate-x-1">
        {action}
      </span>
    </>
  )
  // max-sm:flex-wrap lets the nowrap action drop below the label on
  // phones instead of crushing it into a one-word-per-line column or
  // clipping off-screen; text-left neutralizes the UA's centered
  // <button> text for the onClick variant.
  const className =
    'group flex max-sm:flex-wrap items-center justify-between gap-5 border-t border-hairline px-3 py-6 text-left text-base-content transition-colors duration-150 hover:bg-primary/5 hover:opacity-100'
  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    )
  }
  if (href) {
    const external = href.startsWith('http')
    return (
      <a
        href={href}
        className={className}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
      >
        {inner}
      </a>
    )
  }
  return (
    <button type="button" onClick={onClick} className={`w-full ${className}`}>
      {inner}
    </button>
  )
}

export interface TerminalStep {
  num: string
  title: string
  body: ReactNode
}

/** Ghost-numeral step sequence (01 / 02 / 03), cascading in on view. */
export function StepsGrid({ steps }: { steps: Array<TerminalStep> }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3">
      {steps.map((s, i) => (
        <motion.div
          key={s.num}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.55, ease: EASE, delay: i * 0.12 }}
          className="border-hairline-minor px-8 pb-12 pt-10 lg:border-r lg:last:border-r-0"
        >
          <div className="type-display type-ghost mb-[18px] text-7xl">
            {s.num}
          </div>
          <div className="mb-2.5 text-[19px] font-bold uppercase tracking-[0.02em]">
            {s.title}
          </div>
          <div className="max-w-[340px] text-[14.5px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
            {s.body}
          </div>
        </motion.div>
      ))}
    </div>
  )
}
