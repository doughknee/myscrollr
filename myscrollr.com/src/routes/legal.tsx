import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { AlertTriangle, Info } from 'lucide-react'

import type { LegalDocument, LegalSection } from '@/components/legal/documents'
import { seo } from '@/lib/seo'
import { breadcrumbs, organization } from '@/lib/structured-data'
import { EASE, riseIn } from '@/lib/animations'
import {
  LEGAL_DOCUMENTS,
  getDocument,
  getDocumentsByCategory,
} from '@/components/legal/documents'
import {
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'

// ── Route ───────────────────────────────────────────────────────

type LegalSearch = { doc?: string }

export const Route = createFileRoute('/legal')({
  head: () =>
    seo({
      title: 'Scrollr Legal: Terms, Privacy, License',
      description:
        'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      path: '/legal',
      jsonLd: [
        organization,
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Legal', path: '/legal' },
        ]),
      ],
    }),
  validateSearch: (search: Record<string, unknown>): LegalSearch => ({
    doc: typeof search.doc === 'string' ? search.doc : undefined,
  }),
  component: LegalPage,
})

// ── Page ────────────────────────────────────────────────────────

function LegalPage() {
  const { doc: docSlug } = Route.useSearch()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLElement>(null)
  const isFirstRender = useRef(true)

  const activeSlug = docSlug && getDocument(docSlug) ? docSlug : 'terms'
  const activeDoc = getDocument(activeSlug)!
  const categories = useMemo(() => getDocumentsByCategory(), [])

  // Doc codes (DOC—01…) follow ledger display order.
  const docCodes = useMemo(() => {
    const map = new Map<string, string>()
    let n = 0
    for (const group of categories) {
      for (const doc of group.docs) {
        n += 1
        map.set(doc.slug, `DOC—${String(n).padStart(2, '0')}`)
      }
    }
    return map
  }, [categories])

  // Reflect the active legal doc in the browser tab title. The prerendered
  // <title> stays "Scrollr Legal: Terms, Privacy, License" (correct for
  // crawlers; canonical is /legal for all ?doc= variants). Each route owns
  // its head() — we only write here, never restore, so a route transition's
  // head() update is authoritative.
  useEffect(() => {
    document.title = `${activeDoc.title} | Scrollr`
  }, [activeDoc.title])

  // Bring the rendered document into view when a ledger row is picked
  // (skip the initial load so plain /legal visits start at the top).
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [activeSlug])

  const handleDocChange = (slug: string) => {
    navigate({ to: '/legal', search: { doc: slug }, replace: true })
  }

  return (
    <div>
      <PageHeader
        eyebrowLeft="LEGAL ／ THE PAPERWORK"
        eyebrowRight={`${LEGAL_DOCUMENTS.length} DOCUMENTS ON FILE`}
        line1="Everything in writing."
        line2="Nothing in fine print."
        sub="Every document that governs Scrollr and myscrollr.com: terms, privacy, licensing, cookies. Pick a row; the full text renders below."
      />

      {/* ── SEC 01 ／ THE LEDGER ─────────────────────────────── */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 01 ／ THE LEDGER"
            stat={`${LEGAL_DOCUMENTS.length} DOCUMENTS`}
          />
          <motion.div {...riseIn(1)} className="pb-4">
            {categories.map((group) => (
              <div
                key={group.category}
                className="border-t border-hairline first:border-t-0"
              >
                <div className="px-3 pb-1 pt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-base-content/35">
                  {group.label}
                </div>
                {group.docs.map((doc) => {
                  const isActive = doc.slug === activeSlug
                  return (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() => handleDocChange(doc.slug)}
                      aria-current={isActive || undefined}
                      className={`relative grid w-full cursor-pointer grid-cols-[64px_1fr] items-baseline gap-x-4 gap-y-1 border-t border-hairline-minor px-3 py-5 text-left transition-colors duration-150 sm:grid-cols-[84px_1fr_auto] ${
                        isActive ? 'bg-primary/5' : 'hover:bg-primary/5'
                      }`}
                    >
                      {/* Emerald edge slides to the doc being read */}
                      {isActive && (
                        <motion.span
                          aria-hidden="true"
                          layoutId="legal-active-doc"
                          className="absolute bottom-0 left-0 top-0 w-[2px] bg-primary"
                          transition={{
                            type: 'spring',
                            stiffness: 450,
                            damping: 38,
                          }}
                        />
                      )}
                      <span
                        className={`font-mono text-xs ${
                          isActive ? 'text-primary' : 'text-base-content/40'
                        }`}
                      >
                        {docCodes.get(doc.slug)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-baseline gap-3">
                          <span className="font-display text-lg font-bold uppercase leading-tight tracking-[0.01em] text-base-content">
                            {doc.title}
                          </span>
                          {doc.badge && (
                            <span className="rounded-[3px] border border-primary/40 px-2 py-[3px] font-mono text-[10px] tracking-[0.12em] text-primary">
                              {doc.badge}
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-sm text-base-content/55">
                          Last updated {doc.lastUpdated} · Effective{' '}
                          {doc.effectiveDate}
                        </span>
                      </span>
                      <span
                        className={`hidden whitespace-nowrap font-mono text-sm text-primary sm:block ${
                          isActive ? '' : 'opacity-80'
                        }`}
                      >
                        {isActive ? 'READING' : 'READ →'}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </motion.div>
        </TerminalContainer>
      </section>

      {/* ── SEC 02 ／ ON FILE ────────────────────────────────── */}
      <section ref={panelRef} className="scroll-mt-24 border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 02 ／ ON FILE"
            stat={`${docCodes.get(activeSlug)} · ${activeDoc.shortTitle.toUpperCase()}`}
          />
          <div className="py-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSlug}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <DocumentContent doc={activeDoc} />
              </motion.div>
            </AnimatePresence>
          </div>
        </TerminalContainer>
      </section>
    </div>
  )
}

// ── Document Content ────────────────────────────────────────────

function DocumentContent({ doc }: { doc: LegalDocument }) {
  return (
    <article className="rounded-[8px] border border-hairline bg-panel px-6 py-10 sm:px-12 sm:py-12">
      <div className="mx-auto max-w-[820px]">
        {/* Document header */}
        <h2 className="type-display m-0 text-[clamp(28px,3.5vw,44px)]">
          {doc.title}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline-minor pb-8 font-mono text-[11px] uppercase tracking-[0.1em] text-base-content/40">
          <span>Last updated {doc.lastUpdated}</span>
          <span className="text-base-content/20">·</span>
          <span>Effective {doc.effectiveDate}</span>
          {doc.badge && (
            <span className="rounded-[3px] border border-primary/40 px-2 py-[3px] text-[10px] tracking-[0.12em] text-primary">
              {doc.badge}
            </span>
          )}
        </div>

        {/* Sections */}
        <div className="mt-10 space-y-10">
          {doc.sections.map((section, i) => (
            <div
              key={section.heading}
              id={sectionId(doc.slug, section.heading)}
              className="scroll-mt-28"
            >
              {/* Section header */}
              <div className="mb-4 flex items-center gap-3">
                <span className="w-6 text-right font-mono text-[10px] tabular-nums text-base-content/30">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="m-0 text-sm font-bold text-primary">
                  {section.heading}
                </h3>
              </div>

              {/* Callout */}
              {section.callout && <Callout callout={section.callout} />}

              {/* Paragraphs */}
              <div className="space-y-4 pl-9">
                {section.content.map((paragraph, j) => (
                  <p
                    key={j}
                    className="m-0 text-sm leading-relaxed text-base-content/60"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {/* Section divider */}
              {i < doc.sections.length - 1 && (
                <div className="mt-10 h-px bg-hairline-minor" />
              )}
            </div>
          ))}
        </div>

        {/* Document footer */}
        <div className="mt-16 border-t border-hairline pt-8">
          <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-[0.1em] text-base-content/35">
            <span>{doc.title}</span>
            <span className="text-base-content/15">·</span>
            <span>Last updated {doc.lastUpdated}</span>
            <span className="text-base-content/15">·</span>
            <span>Effective {doc.effectiveDate}</span>
          </div>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-base-content/40">
            Questions about this document? Reach out via{' '}
            <Link
              to="/support"
              className="text-primary/70 transition-colors hover:text-primary"
            >
              Support
            </Link>{' '}
            or{' '}
            <a
              href="https://discord.gg/85b49TcGJa"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary/70 transition-colors hover:text-primary"
            >
              Discord
            </a>
            .
          </p>
        </div>
      </div>
    </article>
  )
}

// ── Callout ─────────────────────────────────────────────────────

function Callout({
  callout,
}: {
  callout: NonNullable<LegalSection['callout']>
}) {
  const isWarning = callout.type === 'warning'

  return (
    <div
      className={`mb-6 ml-9 rounded-[4px] border p-4 ${
        isWarning
          ? 'border-warning/25 bg-warning/5'
          : 'border-info/25 bg-info/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 shrink-0 ${isWarning ? 'text-warning' : 'text-info'}`}
        >
          {isWarning ? <AlertTriangle size={16} /> : <Info size={16} />}
        </div>
        <p
          className={`m-0 text-xs font-medium leading-relaxed ${
            isWarning ? 'text-warning/80' : 'text-info/80'
          }`}
        >
          {callout.text}
        </p>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────

function sectionId(docSlug: string, heading: string): string {
  return `${docSlug}-${heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}`
}
