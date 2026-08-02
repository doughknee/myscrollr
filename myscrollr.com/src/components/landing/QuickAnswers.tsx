/**
 * SEC 06 ／ QUICK ANSWERS — renders HOMEPAGE_FAQ_ITEMS directly, so the
 * visible FAQ always matches the faqPage JSON-LD in routes/index.tsx.
 *
 * Display treatment: each question is set in the condensed display face
 * over an oversized outlined ghost numeral (same vocabulary as the
 * HOW IT WORKS steps), cells take the departures-row hover tint, and
 * the final answer ends on a blinking terminal cursor.
 */

import { SectionRow, TerminalContainer } from '@/components/terminal'
import { HOMEPAGE_FAQ_ITEMS } from '@/lib/structured-data'

export function QuickAnswers() {
  const last = HOMEPAGE_FAQ_ITEMS.length - 1
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 06 ／ QUICK ANSWERS"
          stat={`${HOMEPAGE_FAQ_ITEMS.length} QUESTIONS · TEN-SECOND READS`}
        />
        <div className="grid gap-x-12 pb-12 pt-1 md:grid-cols-2">
          {HOMEPAGE_FAQ_ITEMS.map((f, i) => (
            <div
              key={f.question}
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
              <div className="relative text-[14.5px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
                {f.answer}
                {i === last && (
                  <span
                    aria-hidden="true"
                    className="animate-blink ml-1.5 inline-block h-[0.95em] w-[0.5em] translate-y-[0.12em] bg-primary"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </TerminalContainer>
    </section>
  )
}
