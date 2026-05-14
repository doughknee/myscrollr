import { motion } from 'motion/react'
import { ImageIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { ProductScreenshot } from '@/components/ProductScreenshot'

const EASE = [0.22, 1, 0.36, 1] as const

interface SupportSectionProps {
  /** Anchor id used by the hero quick-link nav (#getting-started, etc). */
  id: string
  eyebrow: string
  title: string
  description?: string
  children: ReactNode
  /**
   * Optional in-app screenshot for this section. Rendered as a
   * collapsible disclosure ("See it in the app") at the end of the
   * section so it doesn't dominate the dense help content. The
   * screenshot itself is exactly the same surface the desktop app
   * shows for this topic, which doubles as visual "you'll find this
   * in-app too" reinforcement.
   *
   *   `basename`: ProductScreenshot basename, e.g. "support/faq".
   *   `alt`: required accessible description.
   *   `label`: button text override (default "See it in the app").
   */
  screenshot?: {
    basename: string
    alt: string
    label?: string
  }
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
  screenshot,
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

        {screenshot ? <SectionScreenshot {...screenshot} /> : null}
      </div>
    </section>
  )
}

// ── In-app screenshot disclosure ───────────────────────────────

interface SectionScreenshotProps {
  basename: string
  alt: string
  label?: string
}

/**
 * `<details>`-driven disclosure that reveals the in-app screenshot for
 * the surrounding section. Closed by default so the page stays focused
 * on the reference content; readers who want visual context expand it.
 *
 * Using native `<details>` rather than a controlled component keeps the
 * disclosure SSR-safe and keyboard-accessible for free, and the chevron
 * rotates via the `[open]` attribute selector without any JS.
 */
function SectionScreenshot({
  basename,
  alt,
  label = 'See it in the app',
}: SectionScreenshotProps) {
  return (
    <details className="group/details mt-10 overflow-hidden rounded-2xl border border-base-300/40 bg-base-200/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-base-200/50">
        <span className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-primary">
            <ImageIcon size={14} />
          </span>
          <span className="text-sm font-semibold text-base-content">
            {label}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs font-mono text-base-content/40 transition-transform duration-200 group-open/details:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-base-300/40 bg-base-100/20 p-4 sm:p-6">
        <div className="overflow-hidden rounded-xl border border-base-300/40 bg-base-100/40 shadow-sm">
          <ProductScreenshot
            basename={basename}
            alt={alt}
            pictureClassName="block w-full"
            imgClassName="block h-full w-full object-cover object-top"
          />
        </div>
      </div>
    </details>
  )
}
