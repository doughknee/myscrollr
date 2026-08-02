/**
 * SEC 01 ／ THE CATALOG — the featured-widget picker that drives the
 * persistent demo bar. Toggling a pill writes the shared
 * `scrollr-marketing-demo` state, so the bar at the bottom of the page
 * updates immediately. Past 3 active widgets the slot meter flips amber
 * and the Uplink upsell strip appears — adding is never blocked.
 */

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { CatalogWidget } from '@/lib/catalog'
import { EASE } from '@/lib/animations'
import { SectionRow, TerminalContainer } from '@/components/terminal'
import {
  CATEGORY_ORDER,
  categoryCounts,
  useCatalog,
  widgetAccent,
} from '@/lib/catalog'
import { useDemoTicker } from '@/hooks/useDemoTicker'

const FEATURED_IDS = [
  'finance_stocks',
  'finance_crypto',
  'sports_nfl',
  'sports_nba',
  'news_bbc',
  'news_hackernews',
  'predictions',
  'fantasy_yahoo',
  'weather',
]

/** Compact category labels for the count line (mockup: "14 SPORTS · 11
 *  NEWS · … · FANTASY · PREDICTIONS" — singular categories drop the
 *  number). Order mirrors CATEGORY_ORDER. */
const COUNT_LINE_LABELS: ReadonlyArray<[string, string]> = [
  ['sports', 'SPORTS'],
  ['news', 'NEWS'],
  ['finance', 'FINANCE'],
  ['utility', 'UTILITIES'],
  ['fantasy', 'FANTASY'],
  ['predictions', 'PREDICTIONS'],
]

export function CatalogPicker() {
  const widgets = useCatalog()
  const { active, toggle } = useDemoTicker()
  const [expanded, setExpanded] = useState(false)

  const counts = categoryCounts(widgets)
  const used = active.length
  const featured = FEATURED_IDS.map((id) =>
    widgets.find((w) => w.id === id),
  ).filter((w): w is CatalogWidget => w != null)
  const moreCount = widgets.length - featured.length

  const countLine = COUNT_LINE_LABELS.filter(([id]) => (counts[id] ?? 0) > 0)
    .map(([id, label]) =>
      (counts[id] ?? 0) > 1 ? `${counts[id]} ${label}` : label,
    )
    .join(' · ')

  return (
    <section id="catalog" className="scroll-mt-32 border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag={`SEC 01 ／ THE CATALOG — ${widgets.length} WIDGETS & COUNTING`}
          stat={
            used <= 3 ? (
              <span className="text-primary">
                {`SLOTS ${'▓'.repeat(used)}${'░'.repeat(3 - used)} ${used}/3 FREE`}
              </span>
            ) : (
              <span className="text-warning">{`${used} RUNNING · UPLINK TERRITORY`}</span>
            )
          }
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-wrap items-end justify-between gap-8 pb-2 pt-12"
        >
          <h2 className="type-display m-0 text-[clamp(34px,4vw,52px)]">
            Pick widgets.
            <br />
            <span className="text-primary">Watch the bar change.</span>
          </h2>
          <p className="m-0 mb-1.5 max-w-[400px] text-[15px] text-base-content/60 [text-wrap:pretty]">
            Start with the hits. The full catalog is one click away. Everything
            you add shows up in the bar below, immediately.
          </p>
        </motion.div>
        <div className="pb-[18px] pt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-base-content/45">
          {countLine}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {!expanded ? (
            <motion.div
              key="featured"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.25 }}
              className="flex flex-wrap gap-2 pb-5"
            >
              {featured.map((w) => (
                <WidgetPill
                  key={w.id}
                  widget={w}
                  on={active.includes(w.id)}
                  onToggle={toggle}
                />
              ))}
              <button
                type="button"
                aria-expanded={false}
                onClick={() => setExpanded(true)}
                className="inline-flex cursor-pointer items-center gap-[9px] whitespace-nowrap rounded-[4px] border border-dashed border-base-content/25 bg-transparent px-[15px] py-2.5 font-mono text-xs tracking-[0.08em] text-base-content/55 transition-colors duration-150 hover:border-primary hover:text-primary"
              >
                ＋ {moreCount} MORE ▾
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="full"
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.05 } },
              }}
              className="pb-2"
            >
              {CATEGORY_ORDER.filter((c) => (counts[c.id] ?? 0) > 0).map(
                (c) => (
                  <motion.div
                    key={c.id}
                    variants={{
                      hidden: { opacity: 0, y: 14 },
                      show: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.35, ease: EASE },
                      },
                    }}
                    className="pb-[22px]"
                  >
                    <div className="pb-2.5 font-mono text-[10px] tracking-[0.14em] text-base-content/45">
                      {`${c.label} — ${counts[c.id]}`}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {widgets
                        .filter((w) => w.category === c.id)
                        .map((w) => (
                          <WidgetPill
                            key={w.id}
                            widget={w}
                            on={active.includes(w.id)}
                            onToggle={toggle}
                          />
                        ))}
                    </div>
                  </motion.div>
                ),
              )}
              <motion.button
                type="button"
                aria-expanded
                onClick={() => setExpanded(false)}
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.35, ease: EASE },
                  },
                }}
                className="mb-5 cursor-pointer rounded-[4px] border border-dashed border-base-content/25 bg-transparent px-[18px] py-2.5 font-mono text-xs tracking-[0.08em] text-base-content/55 transition-colors duration-150 hover:border-primary hover:text-primary"
              >
                SHOW LESS ▴
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
        {used > 3 && (
          <div className="mb-7 flex flex-wrap items-center gap-3.5 rounded-[4px] border border-dashed border-warning/40 px-[18px] py-3.5">
            <span className="font-mono text-xs tracking-[0.1em] text-warning">
              {used} RUNNING ▓ UPLINK TERRITORY
            </span>
            <span className="min-w-0 flex-[1_1_260px] text-sm text-base-content/75">
              This is what Uplink feels like: 6, 12, or unlimited slots. From
              $6.67/mo, 7-day free trial.
            </span>
            <Link
              to="/uplink"
              className="ml-auto font-mono text-xs font-semibold tracking-[0.1em] text-warning hover:text-warning/80"
            >
              SEE UPLINK →
            </Link>
          </div>
        )}
      </TerminalContainer>
    </section>
  )
}

function WidgetPill({
  widget,
  on,
  onToggle,
}: {
  widget: CatalogWidget
  on: boolean
  onToggle: (id: string) => void
}) {
  return (
    <motion.button
      type="button"
      title={widget.description}
      aria-pressed={on}
      onClick={() => onToggle(widget.id)}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={`inline-flex cursor-pointer items-center gap-[9px] rounded-[4px] border px-[15px] py-2.5 transition-colors duration-150 hover:border-primary ${
        on ? 'border-primary/45 bg-primary/10' : 'border-hairline bg-panel'
      }`}
    >
      <span
        aria-hidden="true"
        className="h-[7px] w-[7px] shrink-0 rounded-[2px]"
        style={{ background: widgetAccent(widget) }}
      />
      <span className="whitespace-nowrap text-sm font-semibold text-base-content">
        {widget.name}
      </span>
      {/* The ●/＋ pops on toggle — the pill echoes the bar updating */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={on ? 'on' : 'off'}
          aria-hidden="true"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={`font-mono text-[11px] ${on ? 'text-primary' : 'text-base-content/45'}`}
        >
          {on ? '●' : '＋'}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  )
}
