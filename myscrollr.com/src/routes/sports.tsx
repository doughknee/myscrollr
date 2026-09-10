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
  breadcrumbs,
  faqPage,
  organization,
  softwareApplication,
} from '@/lib/structured-data'

const SPORTS_FAQ = [
  {
    question: 'Which sports can I follow?',
    answer:
      'The current catalog includes NFL, NBA, NHL, MLB, Formula 1, FIFA World Cup, NCAA football and basketball, Premier League, La Liga, MLS, Champions League, UFC, and AFL widgets.',
  },
  {
    question: 'Can I focus on one team?',
    answer:
      'Yes. Each league has its own widget, and the sports controls let you set a favorite team and choose the time window shown.',
  },
  {
    question: 'Are scores guaranteed to be instant?',
    answer:
      'Scores update automatically when Scrollr receives changes from its data sources. Upstream delays, corrections, outages, and internet connectivity can affect when an update appears.',
  },
] as const

const LEAGUE_GROUPS = [
  {
    index: '01',
    label: 'US leagues',
    meta: 'NFL · NBA · NHL · MLB · NCAA football · NCAA basketball · MLS',
  },
  {
    index: '02',
    label: 'World football',
    meta: 'Premier League · La Liga · Champions League · World Cup',
  },
  {
    index: '03',
    label: 'More competition',
    meta: 'Formula 1 · UFC · AFL',
  },
] as const

export const Route = createFileRoute('/sports')({
  head: () =>
    seo({
      title: 'Live Sports Ticker for Desktop | Scrollr',
      description:
        'Keep live scores, schedules, standings, and favorite teams visible in a customizable desktop sports ticker for macOS, Windows, and Linux.',
      path: '/sports',
      image: 'https://myscrollr.com/og/home.png',
      imageAlt: 'Scrollr showing live sports scores in a desktop ticker.',
      jsonLd: [
        organization,
        softwareApplication,
        faqPage(SPORTS_FAQ),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Sports', path: '/sports' },
        ]),
      ],
    }),
  component: SportsPage,
})

function SportsPage() {
  return (
    <div>
      <PageHeader
        size="lg"
        eyebrowLeft="／／ DESKTOP SPORTS TICKER"
        eyebrowRight="MACOS · WINDOWS · LINUX"
        line1="Live sports scores"
        line2="on your desktop"
        sub="Follow the leagues and teams you care about without keeping a scores tab open. Scrollr pins game state, score, and clock updates above the work already on your screen."
        actions={<DownloadActions />}
      />

      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow
            tag="SEC 01 ／ SCORES, SCHEDULES, STANDINGS"
            stat="ONE WIDGET PER LEAGUE"
          />
          <div className="grid items-center gap-10 py-12 lg:grid-cols-[0.85fr_1.4fr]">
            <div>
              <h2 className="type-display text-[clamp(32px,4vw,52px)]">
                A live score ticker,
                <br />
                <span className="text-primary">plus the full picture.</span>
              </h2>
              <p className="mt-5 leading-relaxed text-base-content/60">
                Open the sports view for scores, upcoming schedules, and league
                standings. Set a favorite team and time window; the compact bar
                stays useful when the larger window is closed.
              </p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.55, ease: EASE }}
            >
              <ProductScreenshot
                basename="channels/sports"
                alt="Scrollr sports view showing live games, scores, clocks, and league controls."
                pictureClassName="overflow-hidden rounded-[4px] border border-hairline"
                sizes="(max-width: 1023px) 100vw, 700px"
              />
            </motion.div>
          </div>
        </TerminalContainer>
      </section>

      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 02 ／ CURRENT SPORTS CATALOG" />
          <div className="pb-12">
            {LEAGUE_GROUPS.map((group) => (
              <DeparturesRow
                key={group.index}
                index={group.index}
                label={group.label}
                meta={group.meta}
                action="SEE CATALOG →"
                to="/widgets"
              />
            ))}
          </div>
        </TerminalContainer>
      </section>

      <QuickAnswers items={SPORTS_FAQ} tag="SEC 03 ／ SPORTS QUESTIONS" />

      <section className="border-b border-hairline">
        <TerminalContainer className="py-10">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <p className="m-0 max-w-xl text-base-content/60">
              Pair live games with your Yahoo Fantasy matchup, or start with any
              three widgets for free.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/fantasy"
                className="rounded-[4px] border border-hairline px-5 py-3 font-mono text-xs text-primary"
              >
                YAHOO FANTASY →
              </Link>
              <Link
                to="/download"
                className="rounded-[4px] bg-primary px-5 py-3 font-mono text-xs font-bold text-[#101018]"
              >
                DOWNLOAD FREE →
              </Link>
            </div>
          </div>
        </TerminalContainer>
      </section>
    </div>
  )
}

function DownloadActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        to="/download"
        className="rounded-[4px] bg-primary px-7 py-4 font-bold text-[#101018]"
      >
        Download Scrollr →
      </Link>
      <Link
        to="/widgets"
        className="rounded-[4px] border border-hairline px-7 py-4 font-bold text-base-content"
      >
        Browse sports widgets
      </Link>
    </div>
  )
}
