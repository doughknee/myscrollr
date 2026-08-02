/**
 * SEC 02 ／ ON YOUR DESKTOP — the real, unretouched product screenshot
 * with a mono annotation rail. The image is preloaded from the route
 * head in routes/index.tsx; keep SRCSET/SIZES in sync with that link.
 */

import { motion } from 'motion/react'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'

// Keep in sync with the preload <link> in routes/index.tsx.
const SRCSET =
  '/marketing/desktop-home@1x.webp 1600w, /marketing/desktop-home@2x.webp 2940w'
const SIZES = '(max-width: 1023px) 100vw, 990px'

const ANNOTATIONS: ReadonlyArray<[string, string]> = [
  ['① THE BAR', 'pinned to the top edge, floating over every window'],
  [
    '② LIVE WIDGETS',
    'eight running at once — MLB, MLS, markets, Kalshi, a Pomodoro timer',
  ],
  ['③ HOME WINDOW', 'the glanceable briefing — open only when you want it'],
]

export function DesktopProof() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 02 ／ ON YOUR DESKTOP"
          stat="SAT AUG 1 · 4:53 PM · UNRETOUCHED"
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
            The bar pinned to the top of a real desktop — weather, MLB finals,
            and a focus timer streaming live — with the Home window open behind
            it.
          </p>
        </motion.div>
        <div className="grid items-start gap-10 pb-14 pt-7 md:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-[22px] font-mono text-xs leading-[1.6] text-base-content/55 md:pt-[18px]">
            {ANNOTATIONS.map(([head, body]) => (
              <div key={head}>
                <span className="text-primary">{head}</span>
                <br />
                {body}
              </div>
            ))}
          </div>
          <div className="rounded-[8px] border border-hairline bg-panel p-4">
            <img
              src="/marketing/desktop-home@1x.webp"
              srcSet={SRCSET}
              sizes={SIZES}
              width={1600}
              height={1041}
              loading="lazy"
              decoding="async"
              alt="Scrollr on a real macOS desktop: the live ticker pinned along the top of the screen showing MLB finals, weather, and a timer, with the Home window showing live scores, markets, and Kalshi"
              className="block h-auto w-full rounded-[4px]"
            />
            <div className="flex flex-wrap justify-between gap-2 px-1 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-base-content/45">
              <span>FIG. 01 — MACOS · SAT AUG 1, 4:53 PM</span>
              <span>UNRETOUCHED</span>
            </div>
          </div>
        </div>
      </TerminalContainer>
    </section>
  )
}
