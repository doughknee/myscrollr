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

const MARKETS_FAQ = [
  {
    question: 'What can I track?',
    answer:
      'Scrollr has separate Stocks and Crypto widgets. The stock catalog includes equities and ETFs; both widgets let you search for symbols and build a watchlist.',
  },
  {
    question: 'Can I trade from Scrollr?',
    answer:
      'No. Scrollr displays market information; it is not a broker, exchange, order-entry system, or source of investment advice.',
  },
  {
    question: 'Is every quote real time?',
    answer:
      'Prices update automatically from Scrollr’s market data source, but availability and delay can vary by asset and upstream service. Do not use the ticker as an execution-grade quote feed.',
  },
] as const

export const Route = createFileRoute('/markets')({
  head: () =>
    seo({
      title: 'Desktop Stock & Crypto Ticker | Scrollr',
      description:
        'Build stock, ETF, and crypto watchlists and keep changing prices visible in a customizable desktop market ticker for macOS, Windows, and Linux.',
      path: '/markets',
      image: 'https://myscrollr.com/og/home.png',
      imageAlt: 'Scrollr desktop ticker showing stock and crypto prices.',
      jsonLd: [organization, softwareApplication, faqPage(MARKETS_FAQ)],
    }),
  component: MarketsPage,
})

function MarketsPage() {
  return (
    <div>
      <PageHeader
        size="lg"
        eyebrowLeft="／／ DESKTOP MARKET TICKER"
        eyebrowRight="STOCKS · ETFS · CRYPTO"
        line1="Live stocks and crypto"
        line2="on your desktop"
        sub="Build separate stock and crypto watchlists, then keep the symbols you actually follow in the bar above your other windows. Scrollr is for awareness, not trade execution."
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
            tag="SEC 01 ／ YOUR WATCHLISTS"
            stat="SEARCH · SELECT · REORDER"
          />
          <div className="grid items-center gap-10 py-12 lg:grid-cols-[0.85fr_1.4fr]">
            <div>
              <h2 className="type-display text-[clamp(32px,4vw,52px)]">
                Follow your list,
                <br />
                <span className="text-primary">not the whole market.</span>
              </h2>
              <p className="mt-5 leading-relaxed text-base-content/60">
                Search the catalog by symbol or name, add the assets you care
                about, and keep their order in the ticker. Open the market view
                when you want the larger list, categories, and sorting tools.
              </p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, ease: EASE }}
            >
              <ProductScreenshot
                basename="channels/finance"
                alt="Scrollr finance view showing market prices, changes, and watchlist controls."
                pictureClassName="overflow-hidden rounded-[4px] border border-hairline"
                sizes="(max-width: 1023px) 100vw, 700px"
              />
            </motion.div>
          </div>
        </TerminalContainer>
      </section>

      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 02 ／ TWO PURPOSE-BUILT WIDGETS" />
          <div className="pb-12">
            <DeparturesRow
              index="01"
              label="Stocks & ETFs"
              meta="symbol search · watchlist order · price and change"
              action="BROWSE WIDGETS →"
              to="/widgets"
            />
            <DeparturesRow
              index="02"
              label="Cryptocurrency"
              meta="separate catalog · separate watchlist · same desktop bar"
              action="BROWSE WIDGETS →"
              to="/widgets"
            />
            <DeparturesRow
              index="03"
              label="Prediction markets"
              meta="Kalshi is a distinct widget, not a stock or crypto quote"
              action="SEE CATALOG →"
              to="/widgets"
            />
          </div>
        </TerminalContainer>
      </section>

      <QuickAnswers items={MARKETS_FAQ} tag="SEC 03 ／ MARKET QUESTIONS" />

      <section className="border-b border-hairline">
        <TerminalContainer className="flex flex-wrap items-center justify-between gap-6 py-10">
          <p className="m-0 max-w-xl text-base-content/60">
            Keep market moves next to scores and headlines in the same desktop
            ticker.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/news"
              className="rounded-[4px] border border-hairline px-5 py-3 font-mono text-xs text-primary"
            >
              MARKET NEWS →
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
