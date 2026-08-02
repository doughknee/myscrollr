import { motion } from 'motion/react'
import { FAQ_ITEMS } from './support-content'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { EASE } from '@/lib/animations'

/** SEC 01 ／ COMMON QUESTIONS — two-column Q-grid rendered from support-content. */
export function SupportFAQ() {
  return (
    <section id="faq" className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 01 ／ COMMON QUESTIONS" />
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
              className="border-b border-hairline-minor px-1 py-[26px]"
            >
              <div className="mb-2 flex items-baseline gap-3.5">
                <span className="font-mono text-xs text-primary">
                  Q.{String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[16.5px] font-bold">{f.question}</span>
              </div>
              <p className="m-0 pl-[34px] text-[14.5px] leading-[1.65] text-base-content/60 [text-wrap:pretty]">
                {f.answer}
              </p>
            </div>
          ))}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}
