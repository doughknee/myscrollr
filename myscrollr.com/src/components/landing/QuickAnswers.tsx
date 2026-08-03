/**
 * SEC 06 ／ QUICK ANSWERS — renders HOMEPAGE_FAQ_ITEMS directly, so the
 * visible FAQ always matches the faqPage JSON-LD in routes/index.tsx.
 *
 * Display treatment: each question is set in the condensed display face
 * over an oversized outlined ghost numeral (same vocabulary as the
 * HOW IT WORKS steps), cells take the departures-row hover tint, and
 * the final answer ends on a blinking terminal cursor.
 */

import { motion } from 'motion/react'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { HOMEPAGE_FAQ_ITEMS } from '@/lib/structured-data'

export function QuickAnswers() {
  const last = HOMEPAGE_FAQ_ITEMS.length - 1
  return (
    <section className="border-b border-hairline pt-12">
      <TerminalContainer>
        <SectionRow
          tag="SEC 06 ／ QUICK ANSWERS"
          stat={`${HOMEPAGE_FAQ_ITEMS.length} QUESTIONS · TEN-SECOND READS`}
        />
        <div className="grid gap-x-12 pb-12 pt-1 md:grid-cols-2">
          {HOMEPAGE_FAQ_ITEMS.map((f, i) => (
            <motion.div
              key={f.question}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.5, ease: EASE, delay: (i % 2) * 0.08 }}
              className="group relative overflow-hidden border-b border-hairline-minor px-4 pb-8 pt-12 transition-colors duration-150 hover:bg-primary/5"
            >
              {/* Oversized ghost numeral behind the question */}
              <div
                aria-hidden="true"
                className="type-display type-ghost pointer-events-none absolute -top-2 right-1 select-none text-[72px] leading-none"
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="type-display relative m-0 mb-3 max-w-[86%] text-[clamp(19px,1.7vw,24px)]">
                <span className="mr-3 font-mono text-xs font-normal tracking-[0.1em] text-primary">
                  Q.{String(i + 1).padStart(2, '0')}
                </span>
                {f.question}
              </h3>
              <div className="relative text-[14.5px] leading-relaxed text-base-muted [text-wrap:pretty]">
                {f.answer}
                {i === last && (
                  <span
                    aria-hidden="true"
                    className="animate-blink ml-1.5 inline-block h-[0.95em] w-[0.5em] translate-y-[0.12em] bg-primary"
                  />
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </TerminalContainer>
    </section>
  )
}
