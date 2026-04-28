import { useEffect } from 'react'
import { motion } from 'motion/react'
import { useTheme } from '@/hooks/useTheme'

/**
 * Hero showcase that crossfades between real product screenshots.
 *
 * Replaces the older `HeroDesktopPreview`'s animated SVG mockup with
 * static WebP images of the actual app, eliminating the per-frame
 * Motion animation cost (springs, scale transitions, per-chip enter/exit)
 * that taxed older / less powerful machines.
 *
 * Renders all four channel screenshots stacked, with the active one
 * faded in. The `<picture>` element serves a 1x or 2x WebP variant
 * based on device pixel ratio, and the dark/light variant based on
 * the user's site theme. Black artifacts at the rounded corners of
 * the captured window (a side effect of OS screenshot tools) are
 * masked by `border-radius` on the image itself.
 *
 * Props match the previous component so `HeroSection.tsx` does not
 * need to change shape:
 *   - activeIndex: 0..3 corresponding to ['sports','finance','news','fantasy']
 *   - onSelect:    optional click-to-jump handler (kept for parity even
 *                  though the new component does not surface clickable
 *                  tabs itself; click control lives in the parent's
 *                  progress-bar UI).
 */

const CHANNELS = ['sports', 'finance', 'news', 'fantasy'] as const
type Channel = (typeof CHANNELS)[number]

// Accent colors for the ambient glow behind each channel. Kept in
// the same hue family as the previous mockup for continuity.
const ACCENT_GLOW: Record<Channel, string> = {
  sports: 'rgba(255,71,87,0.10)', // red
  finance: 'rgba(52,211,153,0.10)', // emerald
  news: 'rgba(0,212,255,0.10)', // cyan
  fantasy: 'rgba(168,85,247,0.10)', // violet
}

// Accessible alt-text per channel + theme. Surfaces what the screenshot
// actually shows for screen-reader users and as fallback when images
// fail to load.
const ALT_TEXT: Record<Channel, string> = {
  sports: 'Scrollr desktop app showing live sports scores feed.',
  finance: 'Scrollr desktop app showing live stock prices and crypto markets.',
  news: 'Scrollr desktop app showing the latest RSS news headlines.',
  fantasy: 'Scrollr desktop app showing a Yahoo Fantasy matchup view.',
}

interface HeroProductShowcaseProps {
  activeIndex: number
  /**
   * Kept for prop-shape parity with the previous HeroDesktopPreview.
   * Not currently consumed inside the showcase; HeroSection drives
   * channel selection via its own progress-bar UI.
   */
  onSelect?: (index: number) => void
}

export function HeroProductShowcase({ activeIndex }: HeroProductShowcaseProps) {
  const { theme } = useTheme()
  const safeIndex =
    ((activeIndex % CHANNELS.length) + CHANNELS.length) % CHANNELS.length
  const activeChannel = CHANNELS[safeIndex]
  const glow = ACCENT_GLOW[activeChannel]

  // Preload the next channel's image so the crossfade is instant.
  // We use a tiny prefetch link injected into the head; cleanup on
  // unmount or channel change.
  useEffect(() => {
    const next = CHANNELS[(safeIndex + 1) % CHANNELS.length]
    const links = [
      `/screenshots/hero/${next}-${theme}@1x.webp`,
      `/screenshots/hero/${next}-${theme}@2x.webp`,
    ].map((href) => {
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.as = 'image'
      link.href = href
      document.head.appendChild(link)
      return link
    })
    return () => {
      for (const link of links) {
        link.remove()
      }
    }
  }, [safeIndex, theme])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative w-[360px] sm:w-[480px] lg:w-[500px] xl:w-[640px] 2xl:w-[780px] aspect-[1600/1055]"
    >
      {/* Ambient glow tinted by the active channel's accent color. */}
      <div
        className="absolute -inset-8 rounded-3xl blur-3xl pointer-events-none transition-[background-color] duration-700"
        style={{ backgroundColor: glow }}
        aria-hidden="true"
      />

      {/* Stacked screenshots: only the active one has opacity 1. The
          others stay mounted at opacity 0 so swaps are instant once
          all images are decoded. */}
      <div className="relative h-full w-full">
        {CHANNELS.map((channel, idx) => {
          const isActive = idx === safeIndex
          const base = `/screenshots/hero/${channel}-${theme}`

          return (
            <picture
              key={channel}
              className="absolute inset-0"
              style={{
                opacity: isActive ? 1 : 0,
                transition: 'opacity 400ms ease-out',
                pointerEvents: 'none',
              }}
            >
              <source
                srcSet={`${base}@1x.webp 1x, ${base}@2x.webp 2x`}
                type="image/webp"
              />
              <img
                src={`${base}@1x.webp`}
                alt={isActive ? ALT_TEXT[channel] : ''}
                width={1600}
                height={1055}
                loading={isActive ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={isActive ? 'high' : 'auto'}
                className="block h-full w-full rounded-xl object-cover shadow-xl"
                draggable={false}
              />
            </picture>
          )
        })}
      </div>
    </motion.div>
  )
}
