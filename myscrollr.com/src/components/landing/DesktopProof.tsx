/**
 * SEC 02 ／ ON YOUR DESKTOP — the real, unedited product screenshot
 * with a mono annotation rail. The image is preloaded from the route
 * head in routes/index.tsx; keep SRCSET/SIZES in sync with that link.
 */

import { motion } from 'motion/react'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { useTheme } from '@/hooks/useTheme'

// Keep in sync with the preload <link>s in routes/index.tsx. The shot
// follows the site color mode: light visitors see the light desktop,
// dark visitors the dark one (captured two minutes apart).
const srcset = (theme: 'dark' | 'light') =>
  `/marketing/desktop-home-${theme}@1x.webp 1600w, /marketing/desktop-home-${theme}@2x.webp 2940w`
const SIZES = '(max-width: 1023px) 100vw, 990px'
const SHOT_TIME: Record<'dark' | 'light', string> = {
  dark: '2:37 PM',
  light: '2:37 PM',
}

const ANNOTATIONS: ReadonlyArray<[string, string]> = [
  ['① THE BAR', 'pinned to the top edge, floating over every window'],
  [
    '② LIVE WIDGETS',
    'eight running at once: MLB, MLS, markets, Kalshi, a Pomodoro timer',
  ],
  ['③ HOME WINDOW', 'the glanceable briefing, open only when you want it'],
]

export function DesktopProof() {
  const { theme } = useTheme()
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 02 ／ ON YOUR DESKTOP"
          stat={`SUN AUG 2 · ${SHOT_TIME[theme]} · NO EDITS`}
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
            The bar pinned to the top of a real desktop (weather, MLB scores,
            and a focus timer streaming live) with the Home window open behind
            it.
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
          {/* The shot IS a full desktop — no card chrome around it,
              just the image with a hairline edge and the FIG caption. */}
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.985 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            <img
              src={`/marketing/desktop-home-${theme}@1x.webp`}
              srcSet={srcset(theme)}
              sizes={SIZES}
              width={1600}
              height={1041}
              loading="lazy"
              decoding="async"
              alt="Scrollr on a real macOS desktop: the live ticker pinned along the top of the screen showing weather, MLB and MLS games, markets, and a timer, with the Home window open showing scores, markets, and Kalshi"
              className="block h-auto w-full rounded-[8px] border border-hairline"
            />
            <div className="flex flex-wrap justify-between gap-2 px-1 pt-3 font-mono text-[10px] uppercase tracking-[0.12em] text-base-content/45">
              <span>{`FIG. 01 — MACOS · SUN AUG 2, ${SHOT_TIME[theme]}`}</span>
              <span>NO EDITS</span>
            </div>
          </motion.div>
        </div>
      </TerminalContainer>
    </section>
  )
}
