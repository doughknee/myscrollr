import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Keep scroll extent during uncached loads; reset the reservation at a new width. */
export function AnalyticsStage({
  children,
  transitionKey,
}: {
  children: ReactNode
  transitionKey: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return
    let width = 0
    let height = 0
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width
        height = 0
      }
      height = Math.max(height, entry.contentRect.height)
      frame.current?.style.setProperty(
        '--analytics-stage-height',
        `${height}px`,
      )
    })
    observer.observe(content.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (
      !content.current ||
      typeof content.current.animate !== 'function' ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    )
      return
    const chart = content.current.querySelector<HTMLElement>(
      ':scope > div:not([hidden]) .analytics-chart',
    )
    if (!chart) return
    const animation = chart.animate(
      [
        { transform: 'translateY(5px)', opacity: 0.75 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 180, easing: 'ease-out' },
    )
    return () => animation.cancel()
  }, [transitionKey])
  return (
    <div ref={frame} className="analytics-stage">
      <div ref={content} className="analytics-sections">
        {children}
      </div>
    </div>
  )
}
