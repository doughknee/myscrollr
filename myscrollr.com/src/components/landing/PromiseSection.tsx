/**
 * SEC 05 ／ THE PROMISE — zero telemetry, the refusals ledger, and the
 * live GitHub stat line (stars · forks · last commit).
 */

import { motion } from 'motion/react'
import type { GitHubStats } from '@/hooks/useGitHubStats'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { useGitHubStats } from '@/hooks/useGitHubStats'

const REPO = 'brandon-relentnet/myscrollr'
const GITHUB_URL = `https://github.com/${REPO}`

const REFUSALS = [
  'Read your other apps',
  'Collect personal data',
  'Show you ads',
  'Sell to data brokers',
]

function ghLine(stats: GitHubStats): string {
  const stars = `${stats.stars.toLocaleString()} ${stats.stars === 1 ? 'STAR' : 'STARS'}`
  const forks = `${stats.forks.toLocaleString()} ${stats.forks === 1 ? 'FORK' : 'FORKS'}`
  const d = stats.daysSincePush
  const commit = d === 0 ? 'TODAY' : d === 1 ? '1 DAY AGO' : `${d} DAYS AGO`
  return `★ ${stars} · ${forks} · LAST COMMIT ${commit}`
}

export function PromiseSection() {
  const stats = useGitHubStats(REPO)

  return (
    <section className="relative overflow-hidden border-b border-hairline">
      <TerminalContainer className="relative">
        <SectionRow tag="SEC 05 ／ THE PROMISE" />
        <div className="grid items-start gap-10 pb-10 pt-[52px] lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <h2 className="type-display m-0 mb-[18px] text-[clamp(30px,3.6vw,46px)] [text-wrap:balance]">
              Every line of code is public.
              <br />
              <span className="text-primary">So is the promise.</span>
            </h2>
            <p className="m-0 mb-7 max-w-[460px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
              {
                'Scrollr ships zero telemetry: no analytics, no tracking pixels, no "anonymous usage data." Tests block any deploy that breaks this. You don\'t have to take our word for it.'
              }
            </p>
            <a
              href={GITHUB_URL}
              rel="noopener noreferrer"
              className="inline-block rounded-[4px] border border-base-content/25 px-6 py-[13px] text-[15px] font-semibold text-base-content transition-colors duration-150 hover:border-primary hover:text-base-content"
            >
              Read the source on GitHub ↗
            </a>
            {stats != null && (
              <div className="pt-4 font-mono text-xs tracking-[0.08em] text-base-content/45">
                {ghLine(stats)}
              </div>
            )}
          </div>
          <div>
            <div className="border-b border-hairline pb-3 font-mono text-[11px] tracking-[0.14em] text-base-content/45">
              WHAT SCROLLR WILL NEVER DO
            </div>
            {REFUSALS.map((r, i) => (
              <motion.div
                key={r}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.45, ease: EASE, delay: i * 0.09 }}
                className="flex items-center gap-4 border-b border-hairline-minor px-1 py-4"
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[13px] font-semibold text-[#ff4757]"
                >
                  ✕
                </span>
                {/* The strike draws itself across each refusal once the
                    row lands — replaces the static line-through. */}
                <span className="relative font-semibold text-base-content/75">
                  {r}
                  <motion.span
                    aria-hidden="true"
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{
                      duration: 0.4,
                      ease: EASE,
                      delay: i * 0.09 + 0.35,
                    }}
                    className="absolute left-0 top-1/2 h-px w-full origin-left bg-[rgba(255,71,87,.5)]"
                  />
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </TerminalContainer>
      {/* Ghost signature — in normal flow BELOW the content (so it can
          never cover the button or the GitHub line). Rendered as SVG
          with textLength so the phrase spans EXACTLY the available
          width in every browser regardless of font metrics — no more
          clipped last glyph — while the negative margin keeps the
          half-sunk bleed off the section's bottom edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none -mb-[0.8vw] mt-2 select-none px-[2vw]"
      >
        <svg
          className="block w-full"
          viewBox="0 18 1000 82"
          role="presentation"
          focusable="false"
        >
          <text
            x="500"
            y="95"
            textAnchor="middle"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            className="type-display"
            style={{
              fontSize: 100,
              fill: 'none',
              stroke: 'var(--ghost-stroke)',
              strokeWidth: 1,
              vectorEffect: 'non-scaling-stroke',
            }}
          >
            ZERO TRACKING
          </text>
        </svg>
      </div>
    </section>
  )
}
