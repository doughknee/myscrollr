/**
 * SEC 06 ／ QUICK ANSWERS — renders HOMEPAGE_FAQ_ITEMS directly, so the
 * visible FAQ always matches the faqPage JSON-LD in routes/index.tsx.
 */

import { SectionRow, TerminalContainer } from '@/components/terminal'
import { HOMEPAGE_FAQ_ITEMS } from '@/lib/structured-data'

export function QuickAnswers() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 06 ／ QUICK ANSWERS" />
        <div className="grid gap-x-12 pb-10 pt-3 md:grid-cols-2">
          {HOMEPAGE_FAQ_ITEMS.map((f, i) => (
            <div
              key={f.question}
              className="border-b border-hairline-minor px-1 py-7"
            >
              <div className="mb-2.5 flex items-baseline gap-3.5">
                <span className="font-mono text-xs text-primary">
                  Q.{String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[17px] font-bold">{f.question}</span>
              </div>
              <div className="pl-[34px] text-[14.5px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
                {f.answer}
              </div>
            </div>
          ))}
        </div>
      </TerminalContainer>
    </section>
  )
}
