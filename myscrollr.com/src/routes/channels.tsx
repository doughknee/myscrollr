/**
 * /channels — the full widget catalog, terminal-editorial style
 * (design_handoff_marketing_site/Widgets - Redesign.dc.html).
 *
 * Everything renders from the real catalog (`useCatalog`); counts are
 * always computed, never literals. ADD TO BAR writes the shared demo
 * ticker state so the persistent bar updates immediately.
 */

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { CatalogWidget } from '@/lib/catalog'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import { EASE } from '@/lib/animations'
import {
  CATEGORY_ORDER,
  categoryCounts,
  useCatalog,
  widgetAbbr,
  widgetAccent,
} from '@/lib/catalog'
import { chipText, chipsFor, useDemoTicker } from '@/hooks/useDemoTicker'
import {
  DeparturesRow,
  PageHeader,
  TerminalContainer,
} from '@/components/terminal'

export const Route = createFileRoute('/channels')({
  head: () =>
    seo({
      title: 'Scrollr Widget Catalog: Live Sports, Finance, News, Fantasy',
      description:
        'Browse the full Scrollr widget catalog — live sports leagues, stocks and crypto, curated news and custom RSS, Yahoo Fantasy, prediction markets, and utilities. Every widget streams live.',
      path: '/channels',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Widgets', path: '/channels' },
        ]),
      ],
    }),
  component: ChannelsPage,
})

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: EASE },
}

function ChannelsPage() {
  const widgets = useCatalog()
  const counts = categoryCounts(widgets)
  const n = widgets.length
  const { active, toggle } = useDemoTicker()

  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  // Local 3s tick driving the jittering sample-chip column (same
  // cadence as useDemoChips; `now` stays null through SSR/first paint
  // to avoid a timezone hydration mismatch on the Clock row).
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const iv = setInterval(() => {
      setTick((v) => v + 1)
      setNow(new Date())
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const q = query.trim().toLowerCase()
  const matches = (w: CatalogWidget) =>
    (filter === 'all' || w.category === filter) &&
    (!q ||
      `${w.name} ${w.description} ${w.category} ${widgetAbbr(w)}`
        .toLowerCase()
        .includes(q))

  // Filter tabs use the mockup's short category names; the long
  // CATEGORY_ORDER labels stay on the group headings below.
  const TAB_LABELS: Record<string, string> = {
    sports: 'SPORTS',
    news: 'NEWS',
    finance: 'FINANCE',
    utility: 'UTILITY',
    fantasy: 'FANTASY',
    predictions: 'PREDICTIONS',
  }
  const filters = [
    { id: 'all', label: `ALL ${n}` },
    ...CATEGORY_ORDER.map((c) => ({
      id: c.id,
      label: `${TAB_LABELS[c.id] ?? c.label} ${counts[c.id] ?? 0}`,
    })),
  ]

  const groups = CATEGORY_ORDER.map((c) => ({
    ...c,
    count: counts[c.id] ?? 0,
    items: widgets.filter((w) => w.category === c.id && matches(w)),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="min-h-dvh">
      <PageHeader
        eyebrowLeft="WIDGETS ／ THE CATALOG"
        eyebrowRight="NEW WIDGETS SHIP SERVER-SIDE — NO APP UPDATE NEEDED"
        line1="The catalog."
        line2={`${n} and counting.`}
        sub="Every widget streams live and takes ten seconds to add. Tap ADD TO BAR to preview any of them in the bar below — it follows you to every page."
        actions={
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`SEARCH ${n} WIDGETS…`}
            aria-label="Search widgets"
            className="w-[300px] max-w-full rounded-[4px] border border-hairline bg-panel px-[18px] py-[13px] font-mono text-[13px] tracking-[0.06em] text-base-content outline-none placeholder:text-base-content/35 focus:border-primary"
          />
        }
      />

      {/* ── Catalog list ─────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <motion.div {...reveal}>
            {/* Filter tabs */}
            <div className="flex flex-wrap gap-1.5 pb-2 pt-6">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`cursor-pointer whitespace-nowrap rounded-[4px] border px-3.5 py-2 font-mono text-[11px] tracking-[0.1em] transition-colors hover:border-primary ${
                    filter === f.id
                      ? 'border-primary/45 bg-primary/10 text-primary'
                      : 'border-hairline text-base-content/55'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Grouped ledger rows */}
            {groups.map((g) => (
              <div key={g.id} className="pb-1.5 pt-6">
                <div className="border-b border-hairline pb-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-base-content/45">
                  {g.label} — {g.count}
                </div>
                {g.items.map((w) => (
                  <CatalogRow
                    key={w.id}
                    widget={w}
                    inBar={active.includes(w.id)}
                    tick={tick}
                    now={now}
                    onToggle={() => toggle(w.id)}
                  />
                ))}
              </div>
            ))}

            {groups.length === 0 && (
              <div className="px-2 py-12 font-mono text-[13px] text-base-content/45">
                {`NO WIDGETS MATCH "${query.toUpperCase()}" — BUT THE CATALOG GROWS EVERY MONTH.`}
              </div>
            )}

            <div className="mt-5">
              <DeparturesRow
                index={String(n + 1)}
                label="Missing something?"
                labelClassName="text-xl"
                meta="Widgets ship server-side — a good request can be live for everyone in days."
                action="REQUEST A WIDGET ↗"
                href="https://github.com/brandon-relentnet/myscrollr/issues/new"
              />
            </div>
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── Download CTA ─────────────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <motion.div {...reveal}>
            <DeparturesRow
              index="00"
              label="Run any three of these, free forever."
              action="DOWNLOAD FREE ↓"
              to="/download"
            />
          </motion.div>
        </TerminalContainer>
      </section>
    </div>
  )
}

// ── Ledger row ─────────────────────────────────────────────────

function CatalogRow({
  widget,
  inBar,
  tick,
  now,
  onToggle,
}: {
  widget: CatalogWidget
  inBar: boolean
  tick: number
  now: Date | null
  onToggle: () => void
}) {
  const accent = widgetAccent(widget)
  const chip = chipsFor(widget.id, tick, now).at(0)
  const sample = chip ? `⋯ ${chipText(chip)} ⋯` : ''

  return (
    <div
      className={`grid grid-cols-[74px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-hairline-minor px-2 py-[15px] transition-colors duration-150 lg:grid-cols-[90px_190px_1.1fr_1.3fr_130px] lg:gap-[18px] ${
        inBar ? 'bg-primary/5' : ''
      }`}
    >
      <span
        className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold"
        style={{ color: accent }}
      >
        <span
          aria-hidden="true"
          className="h-[7px] w-[7px] shrink-0 rounded-[2px]"
          style={{ background: accent }}
        />
        {widgetAbbr(widget)}
      </span>

      <span className="text-base font-bold lg:whitespace-nowrap">
        {widget.name}
      </span>

      <span className="col-span-2 col-start-2 row-start-2 text-[13.5px] text-base-content/50 lg:col-span-1 lg:col-start-auto lg:row-start-auto">
        {widget.description}
      </span>

      {/* Jittering sample chip — desktop only */}
      <span className="hidden overflow-hidden overflow-ellipsis whitespace-nowrap font-mono text-xs text-base-content/40 lg:block">
        {sample}
      </span>

      <button
        type="button"
        onClick={onToggle}
        aria-pressed={inBar}
        className={`col-start-3 row-start-1 cursor-pointer whitespace-nowrap rounded-[4px] border px-3 py-2 font-mono text-[11px] tracking-[0.1em] transition-colors hover:border-primary lg:col-start-auto lg:row-start-auto lg:px-0 ${
          inBar
            ? 'border-primary/45 text-primary'
            : 'border-hairline text-base-content/55'
        }`}
      >
        {inBar ? '● IN BAR' : '＋ ADD TO BAR'}
      </button>
    </div>
  )
}
