import { motion } from 'motion/react'
import type { ReactNode } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const

interface SupportSectionProps {
  /** Anchor id used by the hero quick-link nav (#getting-started, etc). */
  id: string
  eyebrow: string
  title: string
  description?: string
  children: ReactNode
}

// Shared section wrapper for /support — keeps the heading + spacing
// consistent across Getting Started / FAQ / Troubleshooting / Billing
// without forcing every section component to re-implement the same
// motion + layout boilerplate.
export function SupportSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: SupportSectionProps) {
  return (
    <section
      id={id}
      // scroll-margin so anchor jumps from the hero land below the
      // sticky header instead of underneath it.
      className="scroll-mt-24 border-t border-base-content/5 py-16 sm:py-24"
    >
      <div className="mx-auto max-w-4xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mb-10"
        >
          <p className="text-xs font-semibold tracking-[0.2em] text-primary/70 uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-base-content sm:text-3xl">
            {title}
          </h2>
          {description ? (
            <p className="mt-3 max-w-2xl text-base text-base-content/55">
              {description}
            </p>
          ) : null}
        </motion.div>

        {children}
      </div>
    </section>
  )
}
