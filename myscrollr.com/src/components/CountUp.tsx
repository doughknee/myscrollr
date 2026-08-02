/**
 * SSR-safe Motion+ count-up around AnimateNumber.
 *
 * The server (and the hydration render) emit a PLAIN number — not
 * AnimateNumber — so prerendered HTML reads cleanly for crawlers
 * ("35 and counting", not the odometer's 0-9 digit strips). A layout
 * effect swaps in AnimateNumber before the first client paint: it
 * mounts at 0 and rolls up to the real value once the element scrolls
 * into view, and later value changes (slot toggles, live catalog
 * refresh) keep animating. Reduced motion shows the value immediately
 * and only animates subsequent changes.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimateNumber } from 'motion-plus/react'
import { useInView, useReducedMotion } from 'motion/react'
import type { ComponentProps } from 'react'

// useLayoutEffect is a no-op on the server but React warns about it in
// SSR; swap in useEffect there (it never runs server-side anyway).
const useClientLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

export function CountUp({
  value,
  className,
  transition,
}: {
  value: number
  className?: string
  transition?: ComponentProps<typeof AnimateNumber>['transition']
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const [mounted, setMounted] = useState(false)
  const [display, setDisplay] = useState(0)

  // Pre-paint: swap the plain SSR number for the animated one (at 0,
  // or at the real value under reduced motion) so nothing flashes.
  useClientLayoutEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (inView || reduce) setDisplay(value)
  }, [inView, reduce, value])

  return (
    <span ref={ref} className={className}>
      {mounted ? (
        <AnimateNumber
          // AnimateNumber's digit strips carry their own internal
          // line-height, so its inline-flex box's synthesized baseline
          // sags ~0.06em below the surrounding text (visible in the
          // tight-leading display headings). Nudge it back up; measured
          // residual is <1px from 375px to 1440px.
          style={{ verticalAlign: '0.055em' }}
          transition={transition}
        >
          {reduce ? value : display}
        </AnimateNumber>
      ) : (
        value
      )}
    </span>
  )
}
