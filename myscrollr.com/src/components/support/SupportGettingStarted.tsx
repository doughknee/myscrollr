import { motion } from 'motion/react'
import { GETTING_STARTED_STEPS } from './support-content'
import { SupportSection } from './SupportSection'

const EASE = [0.22, 1, 0.36, 1] as const

export function SupportGettingStarted() {
  return (
    <SupportSection
      id="getting-started"
      eyebrow="Getting Started"
      title="From download to your first ticker in minutes"
      description="Five steps to go from zero to live data scrolling on your screen."
    >
      <ol className="space-y-3">
        {GETTING_STARTED_STEPS.map((step, i) => (
          <motion.li
            key={step.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: EASE, delay: i * 0.05 }}
            className="flex gap-4 rounded-xl border border-base-300/30 bg-base-200/30 p-5"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/5 text-sm font-bold text-primary tabular-nums"
            >
              {i + 1}
            </span>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-base-content">
                {step.title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-base-content/55">
                {step.description}
              </p>
            </div>
          </motion.li>
        ))}
      </ol>
    </SupportSection>
  )
}
