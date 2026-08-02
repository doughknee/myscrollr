// Shared Framer Motion animation variants used across route pages.

/** Signature easing for the terminal-editorial marketing pages. */
export const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Entrance for page headers (the mockups' `riseIn`): 24px rise + fade,
 * staggered 80ms per index. Use with `initial`/`animate` on mount for
 * above-the-fold headers, or `whileInView` for lower sections.
 */
export const riseIn = (index = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease: EASE, delay: index * 0.08 },
})

export const pageVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
}

export const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 } as const,
  },
}

export const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 35 } as const,
  },
}
