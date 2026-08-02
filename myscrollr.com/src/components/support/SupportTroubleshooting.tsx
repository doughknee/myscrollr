import { useState } from 'react'
import { motion } from 'motion/react'
import { TROUBLESHOOTING_ARTICLES } from './support-content'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import { EASE } from '@/lib/animations'

/** SEC 02 ／ WHEN SOMETHING'S OFF — accordion ledger rendered from support-content. */
export function SupportTroubleshooting() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section id="troubleshooting" className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 02 ／ WHEN SOMETHING'S OFF" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="pb-8 pt-2"
        >
          {TROUBLESHOOTING_ARTICLES.map((article, i) => {
            const isOpen = open === i
            const id = `trouble-${i}`
            return (
              <div
                key={article.title}
                className="border-b border-hairline-minor"
              >
                <button
                  type="button"
                  id={`${id}-trigger`}
                  aria-expanded={isOpen}
                  aria-controls={`${id}-panel`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-5 px-2 py-[19px] text-left text-base-content"
                >
                  <span className="flex items-baseline gap-[18px]">
                    <span className="font-mono text-[11px] text-base-content/40">
                      T.{String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[16.5px] font-bold">
                      {article.title}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={`font-mono text-sm ${
                      isOpen ? 'text-primary' : 'text-base-content/40'
                    }`}
                  >
                    {isOpen ? '▴' : '▾'}
                  </span>
                </button>
                {isOpen ? (
                  <p
                    id={`${id}-panel`}
                    role="region"
                    aria-labelledby={`${id}-trigger`}
                    className="m-0 max-w-[720px] pb-[22px] pl-[47px] pr-2 text-[14.5px] leading-[1.7] text-base-content/60 [text-wrap:pretty]"
                  >
                    {article.body}
                  </p>
                ) : null}
              </div>
            )
          })}
        </motion.div>
      </TerminalContainer>
    </section>
  )
}
