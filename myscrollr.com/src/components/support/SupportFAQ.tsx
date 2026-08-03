import { motion } from 'motion/react'
import { FAQ_ITEMS } from './support-content'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { EASE } from '@/lib/animations'

/** SEC 01 ／ COMMON QUESTIONS — two-column Q-grid rendered from support-content. */
export function SupportFAQ() {
  return (
    <section id="faq" className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 01 ／ COMMON QUESTIONS"
          stat={`${FAQ_ITEMS.length} ANSWERS`}
        />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="grid grid-cols-1 gap-x-12 pb-10 pt-3 md:grid-cols-2"
        >
          {FAQ_ITEMS.map((f, i) => (
            <div
              key={f.question}
              className="group relative overflow-hidden border-b border-hairline-minor px-4 pb-8 pt-12 transition-colors duration-150 hover:bg-primary/5"
            >
              {/* Oversized ghost numeral — same vocabulary as the
                  landing QUICK ANSWERS cells */}
              <div
                aria-hidden="true"
                className="type-display type-ghost pointer-events-none absolute -top-2 right-1 select-none text-[64px] leading-none"
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="type-display relative m-0 mb-3 max-w-[86%] text-[clamp(17px,1.4vw,21px)]">
                <span className="mr-3 font-mono text-xs font-normal tracking-[0.1em] text-primary">
                  Q.{String(i + 1).padStart(2, '0')}
                </span>
                {f.question}
              </h3>
              <p className="relative m-0 text-[14.5px] leading-[1.65] text-base-muted [text-wrap:pretty]">
                {f.answer}
              </p>
            </div>
          ))}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}
