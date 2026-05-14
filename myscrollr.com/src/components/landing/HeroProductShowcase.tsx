import { useEffect } from 'react'
import { motion } from 'motion/react'
import { ProductScreenshot } from '@/components/ProductScreenshot'
import { useTheme } from '@/hooks/useTheme'

/**
 * Hero showcase that crossfades between real product screenshots.
 *
 * Refactored to consume the canonical `<ProductScreenshot>` primitive
 * so all four channel images share the same theming, srcset, decoding,
 * and alt-text plumbing as every other screenshot on the site. The
 * earlier inline `<picture>`/`<source>` implementation predated the
 * shared component and pointed at the deprecated `/screenshots/hero/`
 * directory; both have been collapsed into a single source of truth
 * under `/screenshots/channels/`.
 *
 * Renders all four channel screenshots stacked, with the active one
 * faded in via opacity. Inactive screenshots stay mounted at opacity 0
 * so subsequent swaps are instant once images are decoded. The first
 * channel preloads eagerly (`priority`); the rest fall back to lazy
 * decoding because they sit behind the active one and the user can't
 * see them until they advance.
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

// Accessible alt-text per channel. Surfaces what the screenshot
// actually shows for screen-reader users and as fallback when images
// fail to load. Inactive screenshots get an empty alt so AT only
// sees the visible one.
const ALT_TEXT: Record<Channel, string> = {
  sports:
    'Scrollr desktop app showing live MLB scores with team logos, status pills, and tabs for Schedule and Standings.',
  finance:
    'Scrollr desktop app showing live stock and crypto prices with category tags, percent change, and Gainers/Losers filters.',
  news: 'Scrollr desktop app showing the latest news headlines from custom RSS sources, with recency indicators.',
  fantasy:
    'Scrollr desktop app showing Yahoo Fantasy league overview cards with a live matchup score, win probability, and league standings context.',
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
  const siteTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark'
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
      `/screenshots/channels/${next}-${siteTheme}@1x.webp`,
      `/screenshots/channels/${next}-${siteTheme}@2x.webp`,
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
  }, [safeIndex, siteTheme])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative w-[360px] sm:w-[480px] lg:w-[500px] xl:w-[640px] 2xl:w-[780px] aspect-[1600/954]"
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
          return (
            <div
              key={channel}
              className="absolute inset-0"
              style={{
                opacity: isActive ? 1 : 0,
                transition: 'opacity 400ms ease-out',
                pointerEvents: 'none',
              }}
            >
              <ProductScreenshot
                basename={`channels/${channel}`}
                themeOverride={siteTheme}
                alt={isActive ? ALT_TEXT[channel] : ''}
                priority={isActive}
                pictureClassName="absolute inset-0"
                imgClassName="block h-full w-full rounded-xl object-cover shadow-xl"
              />
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
