import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'

// SupportAccordion — generic single-expanded-at-a-time accordion used
// for FAQ, troubleshooting, and billing sections on /support.
//
// Why not reuse landing/FAQSection.tsx? That one uses a split desktop
// layout with iconography per item and a sliding spring panel — great
// for the homepage but heavy for a long-page support reference where
// users want to scan many items quickly. This is the simpler, denser
// accordion for that use case. Keyboard nav (Enter/Space toggle) is
// handled by native <button> semantics; the AnimatePresence height
// transition matches the landing accordion's feel.

const EASE = [0.22, 1, 0.36, 1] as const

export interface AccordionEntry {
  /** The summary line shown when collapsed. */
  title: string
  /** Pre-rendered body content. Use ReactNode to allow lists/paragraphs. */
  body: React.ReactNode
}

interface SupportAccordionProps {
  entries: Array<AccordionEntry>
  /** Optional id prefix so multiple accordions on the page get unique ids. */
  idPrefix?: string
}

export function SupportAccordion({
  entries,
  idPrefix = 'acc',
}: SupportAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => {
        const isOpen = openIndex === i
        const id = `${idPrefix}-${i}`

        return (
          <div
            key={id}
            className={`group relative rounded-xl border bg-base-200/40 transition-[border-color,background-color] duration-200 ${
              isOpen
                ? 'border-primary/25'
                : 'border-base-300/30 hover:border-base-300/50'
            }`}
          >
            <button
              type="button"
              id={`${id}-trigger`}
              aria-expanded={isOpen}
              aria-controls={`${id}-panel`}
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span
                className={`text-[15px] leading-snug font-semibold transition-colors duration-200 ${
                  isOpen ? 'text-base-content' : 'text-base-content/70'
                }`}
              >
                {entry.title}
              </span>
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${
                  isOpen
                    ? 'bg-primary/10 text-primary'
                    : 'bg-base-300/20 text-base-content/30'
                }`}
              >
                <ChevronDown size={15} />
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  key="panel"
                  id={`${id}-panel`}
                  role="region"
                  aria-labelledby={`${id}-trigger`}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{
                    height: { duration: 0.3, ease: EASE },
                    opacity: { duration: 0.2, delay: 0.05 },
                  }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pt-0 pb-5">
                    <div className="mb-3 h-px bg-base-300/20" />
                    <div className="text-sm leading-relaxed text-base-content/55">
                      {entry.body}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
