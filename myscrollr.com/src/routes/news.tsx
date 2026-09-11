import { Link, createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'

import { ProductScreenshot } from '@/components/ProductScreenshot'
import { QuickAnswers } from '@/components/landing/QuickAnswers'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'
import { EASE } from '@/lib/animations'
import { seo } from '@/lib/seo'
import {
  faqPage,
  organization,
  softwareApplication,
} from '@/lib/structured-data'

const NEWS_FAQ = [
  {
    question: 'Can I add my own feed?',
    answer:
      'Yes. Paste a public RSS or Atom feed URL, give it a name, and add it alongside Scrollr’s built-in source catalog.',
  },
  {
    question: 'Which publishers are built in?',
    answer:
      'The current catalog includes BBC News, NPR, The Guardian, Al Jazeera, ProPublica, Bloomberg, CNBC, NASA, Hacker News, and The Verge.',
  },
  {
    question: 'Why is a story late or missing?',
    answer:
      'Scrollr can only show what a publisher exposes in its feed. Publication timing, feed availability, corrections, and network outages can delay or remove items.',
  },
] as const

export const Route = createFileRoute('/news')({
  head: () =>
    seo({
      title: 'Desktop News & RSS Ticker | Scrollr',
      description:
        'Keep headlines from built-in publishers and your own RSS or Atom feeds visible in a customizable desktop news ticker.',
      path: '/news',
      image: 'https://myscrollr.com/og/home.png',
      imageAlt: 'Scrollr desktop ticker showing news and RSS headlines.',
      jsonLd: [organization, softwareApplication, faqPage(NEWS_FAQ)],
    }),
  component: NewsPage,
})

function NewsPage() {
  return (
    <div>
      <PageHeader
        size="lg"
        eyebrowLeft="／／ DESKTOP NEWS TICKER"
        eyebrowRight="BUILT-IN SOURCES · CUSTOM RSS & ATOM"
        line1="Live news and RSS feeds"
        line2="on your desktop"
        sub="Choose from the built-in source catalog or paste a public RSS or Atom feed. Scrollr keeps recent headlines in the desktop bar so you can notice a story without living in a feed reader."
        actions={
          <Link
            to="/download"
            className="rounded-[4px] bg-primary px-7 py-4 font-bold text-[#101018]"
          >
            Download Scrollr →
          </Link>
        }
      />

      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 01 ／ SOURCES YOU CHOOSE"
            stat="CURATED CATALOG · CUSTOM FEEDS"
          />
          <div className="grid items-center gap-10 py-12 lg:grid-cols-[0.85fr_1.4fr]">
            <div>
              <h2 className="type-display text-[clamp(32px,4vw,52px)]">
                Headlines in sight,
                <br />
                <span className="text-primary">
                  the article one click away.
                </span>
              </h2>
              <p className="mt-5 leading-relaxed text-base-content/60">
                Select publishers from the catalog, filter the larger news view
                by source, and open a headline when it earns your attention.
                Custom feeds use the same ticker and reading flow.
              </p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, ease: EASE }}
            >
              <ProductScreenshot
                basename="channels/news"
                alt="Scrollr news view showing recent headlines and source controls."
                pictureClassName="overflow-hidden rounded-[4px] border border-hairline"
                sizes="(max-width: 1023px) 100vw, 700px"
              />
            </motion.div>
          </div>
        </TerminalContainer>
      </section>

      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 02 ／ PICK THE INPUT" />
          <div className="pb-12">
            <DeparturesRow
              index="01"
              label="Built-in publishers"
              meta="news · business · technology · science · investigations"
              action="SEE SOURCES →"
              to="/widgets"
            />
            <DeparturesRow
              index="02"
              label="Custom RSS"
              meta="paste a public feed URL · name it · add or remove it"
              action="DOWNLOAD APP →"
              to="/download"
            />
            <DeparturesRow
              index="03"
              label="Custom Atom"
              meta="the same custom-feed workflow accepts Atom feeds"
              action="DOWNLOAD APP →"
              to="/download"
            />
          </div>
        </TerminalContainer>
      </section>

      <QuickAnswers items={NEWS_FAQ} tag="SEC 03 ／ NEWS QUESTIONS" />

      <section className="border-b border-hairline">
        <TerminalContainer className="flex flex-wrap items-center justify-between gap-6 py-10">
          <p className="m-0 max-w-xl text-base-content/60">
            Put headlines beside the stocks, sports, and utilities you already
            follow.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/markets"
              className="rounded-[4px] border border-hairline px-5 py-3 font-mono text-xs text-primary"
            >
              MARKET TICKER →
            </Link>
            <Link
              to="/download"
              className="rounded-[4px] bg-primary px-5 py-3 font-mono text-xs font-bold text-[#101018]"
            >
              DOWNLOAD FREE →
            </Link>
          </div>
        </TerminalContainer>
      </section>
    </div>
  )
}
