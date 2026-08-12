import { Suspense, lazy, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { PlatformInfo } from '@/lib/detectPlatform'
import { seo } from '@/lib/seo'
import {
  breadcrumbs,
  faqPage,
  organization,
  softwareApplication,
} from '@/lib/structured-data'
import {
  DeparturesRow,
  PageHeader,
  SectionRow,
  StepsGrid,
  TerminalContainer,
} from '@/components/terminal'
import { ProductScreenshot } from '@/components/ProductScreenshot'
import { detectPlatform } from '@/lib/detectPlatform'
import { triggerDownload } from '@/lib/getDownloadInfo'
import { EASE } from '@/lib/animations'

// Audience-segmented landing page (REL-115), in the terminal editorial
// vocabulary. Two jobs, and the second is the reason it exists:
//
//   1. Speak to one audience — fantasy players — where the homepage
//      deliberately speaks to everyone.
//   2. Give us an audience-level read on traffic from ingress logs
//      alone. The distinct URL IS the instrument: hits on /fantasy vs
//      /, and the Referer on /download/$os telling us which page
//      sourced an install. No client telemetry, so this costs nothing
//      against the zero-telemetry promise.
//
// Section order is a narrative, not a copy of the homepage's:
//   01 what you see  ->  02 proof it does FANTASY  ->  03 the ritual
//   -> 04 proof it's a real app  ->  05 how to get it  ->  06 trust
//   -> 07 objections  ->  CTA
//
// The fantasy screenshot leads (SEC 02) because a fantasy visitor's
// first proof has to be proof of THIS job. DesktopProof still earns a
// slot at 04 — it's the only "real desktop, no edits" evidence — but
// it can't go first here: its annotations are MLB/MLS/markets/Kalshi.
//
// NOT a landing-page template system. If a third segmented page shows
// up and the duplication hurts, extract then — with three real
// examples instead of one imagined one.
const DesktopProof = lazy(() =>
  import('@/components/landing/DesktopProof').then((m) => ({
    default: m.DesktopProof,
  })),
)
const PromiseSection = lazy(() =>
  import('@/components/landing/PromiseSection').then((m) => ({
    default: m.PromiseSection,
  })),
)
const QuickAnswers = lazy(() =>
  import('@/components/landing/QuickAnswers').then((m) => ({
    default: m.QuickAnswers,
  })),
)
const ClosingCta = lazy(() =>
  import('@/components/landing/ClosingCta').then((m) => ({
    default: m.ClosingCta,
  })),
)

// LCP preload for the SEC 02 fantasy capture — it's this page's main
// image and its <img> only renders after React mounts, so the browser
// can't discover the URL from the initial HTML without this. Mirrors
// the widths ProductScreenshot builds for non-ticker basenames.
const heroShotSrcSet = (theme: 'dark' | 'light') =>
  [
    `/screenshots/channels/fantasy-${theme}@sm.webp 800w`,
    `/screenshots/channels/fantasy-${theme}@md.webp 1200w`,
    `/screenshots/channels/fantasy-${theme}@1x.webp 1600w`,
    `/screenshots/channels/fantasy-${theme}@2x.webp 3200w`,
  ].join(', ')
// 1216px = TerminalContainer's content column at desktop (max-w-1280
// minus sm:px-8 either side). Undershooting `sizes` makes the browser
// pick too small a rendition and the shot renders soft — see the note
// in ProductScreenshot.tsx.
const HERO_SHOT_SIZES = '(max-width: 1023px) 100vw, 1216px'

// Fantasy FAQ. This exact array goes to BOTH <QuickAnswers> and
// faqPage() below — see the note in QuickAnswers.tsx for why they must
// never diverge. Ordered by what actually blocks a download: does it
// know my league, what does it cost, will it annoy me.
const FANTASY_FAQ_ITEMS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'Does it work with my league?',
    answer:
      'Connect Yahoo Fantasy once and Scrollr pulls matchups, weekly scoring, standings, and roster injuries for every league on your account — not just one. Redraft, keeper, and dynasty all behave the same way.',
  },
  {
    question: 'Is it free?',
    answer:
      'Three widgets at once, free forever, with live data and zero ads. Your matchup, the live scoreboard, and one more thing you care about fit inside that. Paid plans add slots and ticker rows — they never unlock the data itself.',
  },
  {
    question: 'Do I still need a tab open?',
    answer:
      'No. Scrollr is a native desktop app, not a browser extension. The bar pins itself above every window, so your matchup stays visible while you work, watch the game, or play something else. There is nothing to alt-tab back to.',
  },
  {
    question: 'Will it cover what I am watching?',
    answer:
      'It takes about 40 pixels. Park it along the top or bottom of any monitor, or push it onto a second screen entirely. Height, speed, and which widgets ride along are all yours to set.',
  },
  {
    question: 'How fast are the scores?',
    answer:
      'Live. Scores stream over a single push connection rather than a polling loop, so plays land on the bar as they happen instead of on somebody else’s refresh timer. Stat corrections flow through the same way.',
  },
  {
    question: 'What do you collect about me?',
    answer:
      'Nothing. Scrollr ships zero telemetry: no analytics, no tracking pixels, no anonymous usage data. Tests block any deploy that breaks that promise, and the whole codebase is public under AGPL-3.0 if you would rather check than trust.',
  },
]

// SEC 01 — what rides along on a Sunday. Deliberately fantasy-only:
// the catalog's breadth is a homepage argument, and listing it here
// dilutes the page at the exact moment it should be closing.
const ON_THE_BAR: ReadonlyArray<{
  index: string
  label: string
  meta: string
  action: string
}> = [
  {
    index: '01',
    label: 'Your matchup',
    meta: 'live score · projected · every league on your account',
    action: 'YAHOO',
  },
  {
    index: '02',
    label: 'Every game',
    meta: 'live scores · quarter and clock · final',
    action: 'NFL',
  },
  {
    index: '03',
    label: 'Roster injuries',
    meta: 'status changes the moment they post',
    action: 'ALERTS',
  },
  {
    index: '04',
    label: 'Standings',
    meta: 'league table · playoff picture · who you need to lose',
    action: 'WEEKLY',
  },
]

export const Route = createFileRoute('/fantasy')({
  component: FantasyPage,
  head: () =>
    seo({
      title: 'Scrollr for Fantasy Football: Your Matchup, Live on Your Desktop',
      description:
        'Your Yahoo Fantasy matchup and every live score, pinned above whatever you are doing. Zero ads, zero tracking, three widgets free. macOS, Windows, Linux.',
      path: '/fantasy',
      image: 'https://myscrollr.com/og/home.png',
      imageAlt:
        'Scrollr desktop ticker showing live fantasy matchups and NFL scores.',
      jsonLd: [
        organization,
        softwareApplication,
        faqPage(FANTASY_FAQ_ITEMS),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Fantasy', path: '/fantasy' },
        ]),
      ],
      extraLinks: [
        {
          rel: 'preload',
          as: 'image',
          imagesrcset: heroShotSrcSet('dark'),
          imagesizes: HERO_SHOT_SIZES,
          fetchpriority: 'high',
          media: '(prefers-color-scheme: dark)',
        },
        {
          rel: 'preload',
          as: 'image',
          imagesrcset: heroShotSrcSet('light'),
          imagesizes: HERO_SHOT_SIZES,
          fetchpriority: 'high',
          media: '(prefers-color-scheme: light)',
        },
      ],
    }),
})

function FantasyPage() {
  return (
    <>
      <FantasyHero />

      <OnTheBar />

      <YourLeagues />

      <TheWeek />

      <Suspense fallback={<SectionPlaceholder height="1050px" />}>
        <DesktopProof tag="SEC 04 ／ ON YOUR DESKTOP" />
      </Suspense>

      <FantasySteps />

      <Suspense fallback={<SectionPlaceholder height="700px" />}>
        {/* Star/fork counts are still small enough to argue against us
            on a conversion page. The GitHub link and the refusals
            ledger carry the trust argument here without them. */}
        <PromiseSection tag="SEC 06 ／ THE PROMISE" showStats={false} />
      </Suspense>

      <Suspense fallback={<SectionPlaceholder height="600px" />}>
        <QuickAnswers items={FANTASY_FAQ_ITEMS} tag="SEC 07 ／ QUICK ANSWERS" />
      </Suspense>

      {/* Wrapper carries the scroll target so ClosingCta stays untouched
          and shared with the homepage. */}
      <div id="get-it">
        <Suspense fallback={<SectionPlaceholder height="640px" />}>
          <ClosingCta />
        </Suspense>
      </div>
    </>
  )
}

function FantasyHero() {
  return (
    <PageHeader
      size="lg"
      eyebrowLeft="／／ FANTASY FOOTBALL"
      eyebrowRight="FREE · OPEN SOURCE · MACOS / WINDOWS / LINUX"
      line1="Your matchup,"
      line2="live all Sunday."
      sub="The go-ahead touchdown. The stat correction that flips your week. The injury that lands before the broadcast says it. All of it in a quiet bar above whatever else you are doing — no tab to check, no phone in your hand."
      actions={<HeroActions />}
    />
  )
}

/**
 * Hero CTA. Same hydration-safety pattern as TerminalHero/DownloadButton:
 * SSR and the first client render use the generic label, the real
 * platform resolves in a mount effect (React #418 — see DownloadButton).
 */
function HeroActions() {
  const [info, setInfo] = useState<PlatformInfo | null>(null)

  useEffect(() => {
    setInfo(detectPlatform())
  }, [])

  const label =
    info && !info.isMobile ? `Download for ${info.label}` : 'Download Scrollr'

  const handleDownload = () => {
    const p = info ?? detectPlatform()
    // Phones can't install a desktop app. Rather than route them away
    // mid-scroll, drop them at the closing CTA which lists all three
    // platforms — they can mail themselves the link from there.
    if (p.isMobile) {
      document.getElementById('get-it')?.scrollIntoView({ behavior: 'smooth' })
    } else {
      triggerDownload(p.platform)
    }
  }

  return (
    <div className="flex flex-col items-start gap-4 sm:items-end">
      <div className="flex flex-wrap gap-3">
        <motion.button
          type="button"
          onClick={handleDownload}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="relative cursor-pointer rounded-[4px] bg-primary px-8 py-4 font-bold text-primary-content shadow-[0_0_60px_color-mix(in_srgb,var(--color-primary)_18%,transparent)] transition-[filter] duration-150 hover:brightness-110"
        >
          {label}
          <motion.span
            initial={{ scale: 0, rotate: -18 }}
            animate={{ scale: 1, rotate: 7 }}
            transition={{
              type: 'spring',
              stiffness: 380,
              damping: 16,
              delay: 0.55,
            }}
            className="absolute -right-2.5 -top-2.5 rounded-[3px] bg-[#101018] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-primary shadow-[0_2px_8px_rgba(0,0,0,.35)]"
          >
            FREE
          </motion.span>
        </motion.button>
        <button
          type="button"
          onClick={() =>
            // Smooth unless the user prefers reduced motion — the global
            // reduced-motion CSS forces scroll-behavior: auto.
            document
              .getElementById('on-the-bar')
              ?.scrollIntoView({ behavior: 'smooth' })
          }
          className="cursor-pointer rounded-[4px] border border-base-content/25 px-[26px] py-4 font-semibold text-base-content transition-colors duration-150 hover:border-primary hover:text-base-content"
        >
          {'What rides along ↓'}
        </button>
      </div>
      <div className="text-left font-mono text-xs leading-[1.7] text-base-content/45 sm:text-right">
        {'the ticker is already running at the bottom of this page ↓'}
        <br />
        {"that's the app. it stays on top of everything, including this site"}
      </div>
    </div>
  )
}

/** SEC 01 ／ ON THE BAR — what streams during a game. */
function OnTheBar() {
  return (
    <section id="on-the-bar" className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 01 ／ ON THE BAR"
          stat="SUNDAY, 1:00 PM — 11:30 PM"
        />
        <div className="pb-[72px] pt-1">
          {ON_THE_BAR.map((row) => (
            <DeparturesRow
              key={row.index}
              index={row.index}
              label={row.label}
              action={row.action}
              meta={
                <span className="font-mono text-xs tracking-[0.06em] text-base-content/40">
                  {row.meta}
                </span>
              }
              to="/widgets"
            />
          ))}
        </div>
      </TerminalContainer>
    </section>
  )
}

/**
 * SEC 02 ／ YOUR LEAGUES — the fantasy window, full width and first.
 * This is the page's LCP image and its only fantasy-specific proof, so
 * it leads rather than sitting in a side column.
 */
function YourLeagues() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 02 ／ YOUR LEAGUES"
          stat="YAHOO FANTASY · ALL OF THEM"
        />
        <div className="grid items-end gap-8 pt-[52px] lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <h2 className="type-display m-0 text-[clamp(34px,4vw,52px)] [text-wrap:balance]">
            The bar is the glance.
            <br />
            <span className="text-primary">This is the look.</span>
          </h2>
          <p className="m-0 max-w-[460px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
            When a score does make you look, the window is already open behind
            the bar: every matchup, weekly scoring, the league table, and which
            of your starters just picked up a status change. Open it, settle the
            argument, close it.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="pb-16 pt-10"
        >
          <ProductScreenshot
            basename="channels/fantasy"
            alt="Scrollr's fantasy view: Yahoo matchups with live and projected scores, weekly standings, and roster injury statuses."
            priority
            sizes={HERO_SHOT_SIZES}
            pictureClassName="overflow-hidden rounded-[4px] border border-hairline"
          />
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 pt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-base-content/40">
            <span>FIG. 02 — MATCHUPS · SCORING · STANDINGS · INJURIES</span>
            <span>EVERY LEAGUE ON YOUR ACCOUNT</span>
          </div>
        </motion.div>
      </TerminalContainer>
    </section>
  )
}

/**
 * SEC 03 ／ THE WEEK — the fantasy ritual, which is the part a generic
 * ticker page can't say. Reuses the ghost-numeral StepsGrid vocabulary
 * with days in place of step numbers.
 */
function TheWeek() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow
          tag="SEC 03 ／ THE WEEK"
          stat="THURSDAY THROUGH MONDAY NIGHT"
        />
        <StepsGrid
          steps={[
            {
              num: 'THU',
              title: 'One player, all night',
              body: 'Your Thursday flex is the whole week in miniature. The bar carries that one line so you are not refreshing a box score through dinner.',
            },
            {
              num: 'SUN',
              title: 'Everything at once',
              body: 'Ten games, four leagues, one screen. Scores, your matchup, and the injury that just changed your flex all arrive in the same forty pixels.',
            },
            {
              num: 'MON',
              title: 'The survival math',
              body: 'Down eleven with one player left. The bar sits there doing the arithmetic in your peripheral vision while you get on with your evening.',
            },
          ]}
        />
      </TerminalContainer>
    </section>
  )
}

/** SEC 05 ／ HOW IT WORKS — the fantasy path, not the generic one. */
function FantasySteps() {
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 05 ／ HOW IT WORKS" stat="SET UP BEFORE WEEK 1" />
        <StepsGrid
          steps={[
            {
              num: '01',
              title: 'Download',
              body: 'One small native app for macOS, Windows, and Linux. Installed before your coffee cools, no account required to look around.',
            },
            {
              num: '02',
              title: 'Connect Yahoo',
              body: 'One sign-in pulls every league on your account — matchups, scoring, standings, injuries. Redraft, keeper, and dynasty all come along.',
            },
            {
              num: '03',
              title: 'Forget about it',
              body: 'The bar floats above every window and stays quiet until something moves. Sunday happens in your peripheral vision instead of in a tab.',
            },
          ]}
        />
      </TerminalContainer>
    </section>
  )
}

/**
 * Sized placeholder for `<Suspense>` fallback. Reserves vertical space
 * so the page does not jump when the lazy chunk finishes loading.
 * Transparent — the page background comes from __root.tsx.
 */
function SectionPlaceholder({ height }: { height: string }) {
  return <div aria-hidden="true" style={{ minHeight: height }} />
}
