/**
 * useTilt — pointer-tracking 3D card tilt with spring return.
 *
 * Ported from the motion-v (Vue) TiltCard example for the pricing
 * cards: the card rotates toward the pointer (up to `maxTilt` degrees)
 * and sinks slightly on entry, springing flat again on leave. Spread
 * the returned pieces onto a `motion.div`:
 *
 *   const tilt = useTilt()
 *   <motion.div ref={tilt.ref} style={tilt.style} {...tilt.handlers} />
 *
 * The springs are standalone MotionValues, so they compose with any
 * `initial`/`animate` entrance the element already has (transform
 * channels merge; the entrance `y` and the tilt `rotateX/rotateY/z`
 * don't fight).
 */
import { useRef } from 'react'
import { useSpring } from 'motion/react'
import type { MotionStyle } from 'motion/react'
import type * as React from 'react'

const TILT_SPRING = { stiffness: 200, damping: 20 }

export function useTilt(maxTilt = 7): {
  ref: React.RefObject<HTMLDivElement | null>
  style: MotionStyle
  handlers: {
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerEnter: () => void
    onPointerLeave: () => void
  }
} {
  const ref = useRef<HTMLDivElement>(null)
  const rotateX = useSpring(0, TILT_SPRING)
  const rotateY = useSpring(0, TILT_SPRING)
  const z = useSpring(0, TILT_SPRING)

  return {
    ref,
    style: {
      // Perspective on the element itself so the z push-back reads;
      // 800px keeps wide cards subtle (500 gets fishbowl-y).
      transformPerspective: 800,
      z,
      rotateX,
      rotateY,
      willChange: 'transform',
    },
    handlers: {
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const xPercent = (e.clientX - rect.left) / rect.width
        const yPercent = (e.clientY - rect.top) / rect.height
        rotateX.set(maxTilt * (0.5 - yPercent))
        rotateY.set(maxTilt * (xPercent - 0.5))
      },
      onPointerEnter: () => z.set(-6),
      onPointerLeave: () => {
        rotateX.set(0)
        rotateY.set(0)
        z.set(0)
      },
    },
  }
}
