import { useEffect, useRef, useState } from 'react'

/**
 * Tracks whether an element is intersecting the viewport via
 * IntersectionObserver. Used to pause expensive animations
 * (`repeat: Infinity` keyframes, RAF loops) while the host
 * section is off-screen.
 *
 * Pattern matches the IO pause already in `HowItWorks.tsx` — we
 * just lift it into a hook so other landing sections can reuse it
 * without each rolling their own observer.
 *
 * @param options.rootMargin Forwarded to `IntersectionObserver`.
 *   Defaults to `200px 0px` so animations spin up just before the
 *   section enters the viewport, avoiding a perceptible "cold start"
 *   on scroll.
 * @param options.threshold Forwarded to `IntersectionObserver`.
 *   Defaults to `0` so the section counts as visible the moment any
 *   pixel intersects.
 */
export function useInViewport<T extends Element = HTMLElement>(options?: {
  rootMargin?: string
  threshold?: number | Array<number>
}): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      // SSR / very-old browser fallback: assume visible so animations still run.
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
      },
      {
        rootMargin: options?.rootMargin ?? '200px 0px',
        threshold: options?.threshold ?? 0,
      },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [options?.rootMargin, options?.threshold])

  return [ref, inView]
}
