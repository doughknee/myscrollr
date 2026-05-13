import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, ChevronDown, Info, List } from 'lucide-react'

import type { LegalDocument, LegalSection } from '@/components/legal/documents'
import { usePageMeta } from '@/lib/usePageMeta'
import { itemVariants, pageVariants, sectionVariants } from '@/lib/animations'
import {
  LEGAL_DOCUMENTS,
  getDocument,
  getDocumentsByCategory,
} from '@/components/legal/documents'

// ── Route ───────────────────────────────────────────────────────

type LegalSearch = { doc?: string }

export const Route = createFileRoute('/legal')({
  head: () => ({
    meta: [
      { title: 'Legal — Scrollr' },
      {
        name: 'description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
      { property: 'og:title', content: 'Legal — Scrollr' },
      {
        property: 'og:description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
      { property: 'og:url', content: 'https://myscrollr.com/legal' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:title', content: 'Legal — Scrollr' },
      {
        name: 'twitter:description',
        content:
          'Terms of Service, Privacy Policy, License, and Cookie Policy for the Scrollr desktop app and myscrollr.com.',
      },
    ],
    links: [{ rel: 'canonical', href: 'https://myscrollr.com/legal' }],
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
  const contentRef = useRef<HTMLDivElement>(null)

  const activeSlug = docSlug && getDocument(docSlug) ? docSlug : 'terms'
  const activeDoc = getDocument(activeSlug)!
  const categories = useMemo(() => getDocumentsByCategory(), [])

  usePageMeta({
    title: `${activeDoc.title} — Scrollr`,
    description: `${activeDoc.title} for the Scrollr platform. Last updated ${activeDoc.lastUpdated}.`,
    canonicalUrl: 'https://myscrollr.com/legal',
  })

  // Scroll content to top when doc changes
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeSlug])

  const handleDocChange = (slug: string) => {
    navigate({ to: '/legal', search: { doc: slug }, replace: true })
  }

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen pt-20"
    >
      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative pt-24 pb-12 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 opacity-[0.02]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, var(--grid-dot-primary) 1px, transparent 0)`,
              backgroundSize: '32px 32px',
            }}
          />
          <motion.div
            className="absolute top-[-20%] left-[20%] w-[600px] h-[600px] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--glow-primary-subtle) 0%, transparent 70%)',
            }}
            whileInView={{ scale: [1, 1.06, 1], opacity: [0.4, 0.7, 0.4] }}
            viewport={{ once: false, margin: '200px' }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

        <div className="container relative z-10 !py-0">
          <motion.div variants={sectionVariants}>
            {/* Badge */}
            <div className="flex items-center gap-4 mb-8">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary/8 text-primary text-[10px] font-semibold rounded-lg border border-primary/15 uppercase tracking-wide">
                <BookOpen size={12} />
                legal_docs
              </span>
              <span className="h-px w-16 bg-gradient-to-r from-base-300 to-transparent" />
              <span className="text-[10px] font-mono text-base-content/25">
                {LEGAL_DOCUMENTS.length} documents
              </span>
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[0.9] mb-4">
              {activeDoc.title}
            </h1>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[10px] font-mono text-base-content/30">
                Last updated: {activeDoc.lastUpdated}
              </span>
              <span className="text-base-content/15">|</span>
              <span className="text-[10px] font-mono text-base-content/30">
                Effective: {activeDoc.effectiveDate}
              </span>
              {activeDoc.badge && (
                <>
                  <span className="text-base-content/15">|</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-info/8 text-info text-[9px] font-semibold rounded-lg border border-info/15 uppercase tracking-wide">
                    <Info size={10} />
                    {activeDoc.badge}
                  </span>
                </>
              )}
            </div>
          </motion.div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/50 to-transparent" />
      </section>

      {/* ── Body ────────────────────────────────────────────── */}
      <section className="relative">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
            {/* ── Sidebar (desktop) ──────────────────────────── */}
            <aside className="hidden lg:block lg:col-span-3">
              <div className="sticky top-28 space-y-6">
                <Sidebar
                  categories={categories}
                  activeSlug={activeSlug}
                  onSelect={handleDocChange}
                />

                {/* Table of Contents */}
                <TableOfContents
                  sections={activeDoc.sections}
                  docSlug={activeSlug}
                />
              </div>
            </aside>

            {/* ── Mobile selector ────────────────────────────── */}
            <div className="lg:hidden">
              <MobileSelector
                categories={categories}
                activeSlug={activeSlug}
                activeDoc={activeDoc}
                onSelect={handleDocChange}
              />
            </div>

            {/* ── Content ────────────────────────────────────── */}
            <div ref={contentRef} className="lg:col-span-9">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSlug}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{
                    duration: 0.35,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <DocumentContent doc={activeDoc} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>
    </motion.div>
  )
}

// ── Sidebar ─────────────────────────────────────────────────────

function Sidebar({
  categories,
  activeSlug,
  onSelect,
}: {
  categories: ReturnType<typeof getDocumentsByCategory>
  activeSlug: string
  onSelect: (slug: string) => void
}) {
  return (
    <nav className="space-y-5">
      {categories.map((group) => (
        <div key={group.category}>
          <h4 className="text-[9px] font-semibold uppercase tracking-wide text-base-content/25 mb-2.5 px-1">
            {group.label}
          </h4>
          <ul className="space-y-0.5">
            {group.docs.map((doc) => {
              const isActive = doc.slug === activeSlug
              const Icon = doc.icon
              return (
                <li key={doc.slug}>
                  <button
                    type="button"
                    onClick={() => onSelect(doc.slug)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-primary/8 border border-primary/15 text-primary'
                        : 'text-base-content/40 hover:text-base-content/60 hover:bg-base-200/50 border border-transparent'
                    }`}
                  >
                    <Icon
                      size={14}
                      className={
                        isActive ? 'text-primary' : 'text-base-content/25'
                      }
                    />
                    <span className="text-xs font-medium truncate">
                      {doc.shortTitle}
                    </span>
                    {doc.badge && (
                      <span className="ml-auto text-[8px] text-info/60 uppercase tracking-wide shrink-0">
                        Soon
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// ── Table of Contents ───────────────────────────────────────────

function TableOfContents({
  sections,
  docSlug,
}: {
  sections: Array<LegalSection>
  docSlug: string
}) {
  return (
    <div className="bg-base-200/30 border border-base-300/30 rounded-xl p-4">
      <h4 className="text-[9px] font-semibold uppercase tracking-wide text-base-content/25 mb-3 flex items-center gap-2">
        <List size={10} />
        On this page
      </h4>
      <ul className="space-y-1.5">
        {sections.map((section) => {
          const id = sectionId(docSlug, section.heading)
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block text-[11px] text-base-content/30 hover:text-primary transition-colors leading-snug py-0.5"
              >
                {section.heading}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Mobile Selector ─────────────────────────────────────────────

function MobileSelector({
  categories,
  activeSlug,
  activeDoc,
  onSelect,
}: {
  categories: ReturnType<typeof getDocumentsByCategory>
  activeSlug: string
  activeDoc: LegalDocument
  onSelect: (slug: string) => void
}) {
  const [open, setOpen] = useState(false)
  const Icon = activeDoc.icon

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-base-200/50 border border-base-300/50 rounded-xl text-left cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <Icon size={16} className="text-primary" />
          <span className="text-sm font-medium">{activeDoc.shortTitle}</span>
        </div>
        <ChevronDown
          size={16}
          className={`text-base-content/30 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="absolute z-50 top-full mt-1 left-0 right-0 bg-base-200 border border-base-300/50 rounded-xl shadow-lg max-h-80 overflow-y-auto"
          >
            {categories.map((group) => (
              <div key={group.category}>
                <div className="px-4 py-2 bg-base-300/30">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-base-content/25">
                    {group.label}
                  </span>
                </div>
                {group.docs.map((doc) => {
                  const DocIcon = doc.icon
                  const isActive = doc.slug === activeSlug
                  return (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() => {
                        onSelect(doc.slug)
                        setOpen(false)
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-primary/8 text-primary'
                          : 'text-base-content/50 hover:bg-base-200/80'
                      }`}
                    >
                      <DocIcon size={14} />
                      <span className="text-xs font-medium">
                        {doc.shortTitle}
                      </span>
                      {doc.badge && (
                        <span className="ml-auto text-[8px] text-info/60 uppercase tracking-wide">
                          Soon
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Document Content ────────────────────────────────────────────

function DocumentContent({ doc }: { doc: LegalDocument }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      className="space-y-10"
    >
      {doc.sections.map((section, i) => (
        <motion.div
          key={section.heading}
          variants={itemVariants}
          id={sectionId(doc.slug, section.heading)}
          className="scroll-mt-28"
        >
          {/* Section header */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-mono text-base-content/15 tabular-nums w-6 text-right">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h2 className="text-sm font-bold text-primary">
              {section.heading}
            </h2>
          </div>

          {/* Callout */}
          {section.callout && <Callout callout={section.callout} />}

          {/* Paragraphs */}
          <div className="pl-9 space-y-4">
            {section.content.map((paragraph, j) => (
              <p
                key={j}
                className="text-sm text-base-content/60 leading-relaxed"
              >
                {paragraph}
              </p>
            ))}
          </div>

          {/* Section divider */}
          {i < doc.sections.length - 1 && (
            <div className="mt-10 h-px bg-gradient-to-r from-base-300/40 via-base-300/20 to-transparent" />
          )}
        </motion.div>
      ))}

      {/* Document footer */}
      <motion.div
        variants={itemVariants}
        className="mt-16 pt-8 border-t border-base-300/30"
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[10px] text-base-content/20">{doc.title}</span>
          <span className="text-base-content/10">|</span>
          <span className="text-[10px] font-mono text-base-content/20">
            Last updated {doc.lastUpdated}
          </span>
          <span className="text-base-content/10">|</span>
          <span className="text-[10px] font-mono text-base-content/20">
            Effective {doc.effectiveDate}
          </span>
        </div>
        <p className="mt-3 text-xs text-base-content/25 leading-relaxed max-w-2xl">
          Questions about this document? Reach out via{' '}
          <Link
            to="/support"
            className="text-primary/50 hover:text-primary transition-colors"
          >
            Support
          </Link>{' '}
          or{' '}
          <a
            href="https://discord.gg/85b49TcGJa"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/50 hover:text-primary transition-colors"
          >
            Discord
          </a>
          .
        </p>
      </motion.div>
    </motion.div>
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
      className={`mb-6 ml-9 p-4 rounded-xl border ${
        isWarning
          ? 'bg-warning/5 border-warning/20'
          : 'bg-info/5 border-info/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 shrink-0 ${isWarning ? 'text-warning' : 'text-info'}`}
        >
          {isWarning ? <AlertTriangle size={16} /> : <Info size={16} />}
        </div>
        <p
          className={`text-xs leading-relaxed font-medium ${
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
