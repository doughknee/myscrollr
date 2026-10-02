/**
 * SEC 02 ／ ON YOUR DESKTOP — three pages of the real bar, rendered by the
 * app's own ticker code (`make marketing` shoots them from the same /bar/
 * build the live bar uses) and stacked, unedited, with a mono annotation
 * rail.
 */

import { motion } from 'motion/react'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { useTheme } from '@/hooks/useTheme'

// The shot follows the site color mode: light visitors see the light bar,
// dark visitors the dark one.
const srcset = (theme: 'dark' | 'light') =>
  `/marketing/desktop-proof-${theme}@1x.png 1648w, /marketing/desktop-proof-${theme}@2x.png 3296w`
const SIZES = '(max-width: 1023px) 100vw, 990px'

const ANNOTATIONS: ReadonlyArray<[string, string]> = [
  ['① A PAGE', 'one widget at a time, its games or quotes filling the width'],
  ['② THE EDGE', 'your local time, always; weather and GitHub sit here too'],
  ['③ THE SWIPE', 'a college Saturday, a Sunday slate, your pull requests'],
]

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
            Three pages of the bar, drawn by the same code that runs on your
            desktop. The bar at the edge of this page is that code too, live.
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
            <img
              src={`/marketing/desktop-proof-${theme}@1x.png`}
              srcSet={srcset(theme)}
              sizes={SIZES}
              width={1648}
              height={280}
              loading="lazy"
              decoding="async"
              alt="Three pages of the Scrollr ticker: college football scores, NFL scores, and GitHub pull requests, each with the local time on the bar's edge"
              className="block h-auto w-full rounded-[8px] border border-hairline"
            />
            <div className="flex flex-wrap justify-between gap-2 px-1 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-base-content/45">
              <span>FIG. 01 — THE BAR · THREE PAGES</span>
              <span>NO EDITS</span>
            </div>
          </motion.div>
        </div>
      </TerminalContainer>
    </section>
  )
}
