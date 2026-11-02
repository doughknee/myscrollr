/**
 * SEC 02 ／ ON YOUR DESKTOP — the real bar in motion: an 11-second loop
 * (1920x384) rendered by the app's own page cells (promo/, the HeroLoop composition;
 * `hero-loop-{dark,light}.mp4` in public/marketing), with a mono
 * annotation rail. A score lands, the dwell runs out, the page turns to
 * stocks, and the loop closes on the swipe back. Reduced-motion visitors
 * get the poster frame instead.
 */

import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { useTheme } from '@/hooks/useTheme'

// The loop follows the site color mode: light visitors see the light bar,
// dark visitors the dark one.
const loopSrc = (theme: 'dark' | 'light') => `/marketing/hero-loop-${theme}.mp4`
const posterSrc = (theme: 'dark' | 'light') =>
  `/marketing/hero-loop-${theme}.jpg`
const LOOP_ALT =
  'The Scrollr ticker: the Bears score on the NFL page, the dwell pill fills, and the bar turns the page to live stock quotes'

const ANNOTATIONS: ReadonlyArray<[string, string]> = [
  ['① A PAGE', 'one widget at a time, its games or quotes filling the width'],
  ['② THE EDGE', 'your local time, always; weather and GitHub sit here too'],
  [
    '③ THE SWIPE',
    'the dwell runs out and the bar turns the page: a score, then your stocks',
  ],
]

// React does not serialize `muted` into prerendered markup, and a video
// that is not muted at the moment autoplay is decided will not autoplay.
// Setting it on the element before play() covers hydration and theme
// remounts alike.
function LoopVideo({ theme }: { theme: 'dark' | 'light' }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = true
    el.play().catch(() => {})
  }, [theme])
  return (
    <video
      key={theme}
      ref={ref}
      src={loopSrc(theme)}
      poster={posterSrc(theme)}
      width={1920}
      height={384}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-label={LOOP_ALT}
      className="block h-auto w-full rounded-[8px] border border-hairline motion-reduce:hidden"
    />
  )
}

export function DesktopProof({
  // Segmented landing pages reorder their sections, so the SEC number
  // has to move with them. Defaults to the homepage's slot.
  tag = 'SEC 02 ／ ON YOUR DESKTOP',
}: { tag?: string } = {}) {
  const { theme } = useTheme()
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag={tag}
          stat="THE APP'S OWN CODE · SAMPLE DATA · NO EDITS"
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-wrap items-end justify-between gap-8 pb-3 pt-12"
        >
          <h2 className="type-display m-0 text-[clamp(34px,4vw,52px)]">
            This is the app.
            <br />
            <span className="text-primary">Not a mockup.</span>
          </h2>
          <p className="m-0 mb-1.5 max-w-[400px] text-[15px] text-base-content/60 [text-wrap:pretty]">
            The bar, drawn by the same code that runs on your desktop: a score
            lands, the page turns. The bar at the edge of this page is that code
            too, live.
          </p>
        </motion.div>
        <div className="grid items-start gap-10 pb-14 pt-7 md:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-[22px] font-mono text-xs leading-[1.6] text-base-content/55 md:pt-[18px]">
            {ANNOTATIONS.map(([head, body], i) => (
              <motion.div
                key={head}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{
                  duration: 0.5,
                  ease: EASE,
                  delay: 0.2 + i * 0.12,
                }}
              >
                <span className="text-primary">{head}</span>
                <br />
                {body}
              </motion.div>
            ))}
          </div>
          {/* The shot IS the bar — no card chrome around it, just the
              image with a hairline edge and the FIG caption. */}
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.985 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <LoopVideo theme={theme} />
            <img
              src={posterSrc(theme)}
              width={1920}
              height={384}
              loading="lazy"
              decoding="async"
              alt={LOOP_ALT}
              className="hidden h-auto w-full rounded-[8px] border border-hairline motion-reduce:block"
            />
            <div className="flex flex-wrap justify-between gap-2 px-1 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-base-content/45">
              <span>FIG. 01 — THE BAR · A SCORE, THEN THE SWIPE</span>
              <span>LOOP · NO EDITS</span>
            </div>
          </motion.div>
        </div>
      </TerminalContainer>
    </section>
  )
}
