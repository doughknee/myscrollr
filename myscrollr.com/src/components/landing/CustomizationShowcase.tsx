import { motion } from 'motion/react'
import { Activity, GitPullRequest, HeartPulse } from 'lucide-react'
import type { Sliders } from 'lucide-react'
import { ProductScreenshot } from '@/components/ProductScreenshot'

// ── Constants ────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const

// ── Types & Data ─────────────────────────────────────────────────

/**
 * Discriminated union for the card's visual:
 *  - `single`: one full-bleed screenshot at the top (dashboard captures).
 *  - `tickerStack`: a stack of full-width ticker strips, each with its
 *    own tiny eyebrow caption. Used when the abstract concept (density)
 *    is better shown by an actual A/B than by a settings panel.
 */
type CardMedia =
  | {
      kind: 'single'
      /** ProductScreenshot basename relative to `/screenshots/`. */
      basename: string
      alt: string
    }
  | {
      kind: 'tickerStack'
      /** One or more ticker rows stacked top-to-bottom. */
      rows: ReadonlyArray<{
        basename: string
        densityLabel: string
        aspect: '2930 / 80' | '2930 / 124'
        alt: string
      }>
    }

interface CustomizationCard {
  /** Stable id for keying. */
  id: 'catalog' | 'ticker' | 'style'
  /** Eyebrow above the headline (e.g. "Density · Speed · Color"). */
  eyebrow: string
  /** Headline shown on the card. */
  title: string
  /** Body copy under the headline. */
  body: string
  /** Card media — single screenshot or a ticker stack. */
  media: CardMedia
  /**
   * Layout slot. The section renders the first two cards side-by-side
   * on the top row and the third card full-width below. Cards declare
   * which slot they occupy explicitly so we can reorder data without
   * having to swap CSS spans.
   */
  slot: 'top-left' | 'top-right' | 'wide'
  /** Optional badge chips rendered under the body copy. */
  chips?: Array<{
    icon: typeof Sliders
    label: string
  }>
}

const CARDS: Array<CustomizationCard> = [
  {
    id: 'catalog',
    slot: 'top-left',
    eyebrow: 'Widgets · Utilities · Extensions',
    title: 'Add what you actually need',
    body: 'Markets, scores, headlines, and fantasy are just the start. Pin live system stats, your Uptime Kuma board, or GitHub Actions status right next to last quarter\u2019s earnings &mdash; the ticker becomes whatever your day looks like.',
    media: {
      kind: 'single',
      basename: 'overview/catalog',
      alt: 'Scrollr source catalog showing Finance, Sports, Fantasy, News, Clock, and Weather as added, alongside available widgets for System Monitor, Uptime, and GitHub.',
    },
    chips: [
      { icon: Activity, label: 'System Monitor' },
      { icon: HeartPulse, label: 'Uptime Kuma' },
      { icon: GitPullRequest, label: 'GitHub Actions' },
    ],
  },
  {
    id: 'ticker',
    slot: 'top-right',
    eyebrow: 'Speed · Position · Rows',
    title: 'Make it sit exactly where you want',
    body: 'Dock the ticker to the top, bottom, or both edges of your display. Crank the scroll speed up for a busy market, slow it down for a quiet afternoon. Add a second row when one isn\u2019t enough.',
    media: {
      kind: 'single',
      basename: 'configure/ticker',
      alt: 'Scrollr ticker settings panel with controls for edge position, scroll speed, row count, and per-row widget assignment.',
    },
  },
  {
    id: 'style',
    slot: 'wide',
    eyebrow: 'Density · Color · Theme',
    title: 'Tune it to your day',
    body: 'Compact when you want a glance, detailed when you want context. Stacked, you can see exactly how much breathing room each density adds &mdash; pick whichever matches how much detail you actually need.',
    // Density is best proven by an actual A/B of two ticker strips, not
    // by a settings UI describing density. The wide layout below means
    // both rows get to render at the section's full width, where the
    // extreme aspect ratio finally has room to read properly.
    media: {
      kind: 'tickerStack',
      rows: [
        {
          basename: 'ticker/all-purpose-compact',
          densityLabel: 'Compact',
          aspect: '2930 / 80',
          alt: 'Compact Scrollr ticker showing all widgets together with minimal vertical space.',
        },
        {
          basename: 'ticker/all-purpose-detailed',
          densityLabel: 'Detailed',
          aspect: '2930 / 124',
          alt: 'Detailed Scrollr ticker showing all widgets together with extra context per item.',
        },
      ],
    },
  },
]

// ── Showcase Card ────────────────────────────────────────────────

function ShowcaseCard({
  card,
  delay,
}: {
  card: CustomizationCard
  delay: number
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ delay, duration: 0.6, ease: EASE }}
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-base-300/40 bg-base-200/40 backdrop-blur-sm shadow-sm h-full"
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-12 right-12 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--color-primary) 50%, transparent)',
          opacity: 0.25,
        }}
        aria-hidden="true"
      />

      {/* Media — either a single dashboard screenshot or a stacked
          pair of ticker rows. Both render inside the same bordered band
          at the top of the card so the card silhouettes stay consistent
          across the two card types. */}
      <CardMediaArea media={card.media} />

      {/* Body — on the full-width "wide" card we cap the text column
          so paragraphs don't sprawl past a comfortable measure. The
          tickers above still take the card's full width, since their
          extreme aspect ratio needs every pixel to read. */}
      <div
        className={
          card.slot === 'wide'
            ? 'flex flex-1 flex-col gap-3 p-6 sm:p-8 mx-auto w-full max-w-2xl text-center items-center'
            : 'flex flex-1 flex-col gap-3 p-6 sm:p-7'
        }
      >
        <span className="text-[11px] font-mono uppercase tracking-wider text-base-subtle">
          {card.eyebrow}
        </span>
        <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-base-content">
          {card.title}
        </h3>
        <p
          className="text-sm leading-relaxed text-base-muted"
          // Body intentionally renders an HTML entity (&mdash;) inline.
          dangerouslySetInnerHTML={{ __html: card.body }}
        />

        {card.chips ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {card.chips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1.5 rounded-lg border border-base-300/40 bg-base-100/40 px-2.5 py-1 text-[11px] font-semibold text-base-muted"
              >
                <chip.icon size={12} className="text-base-subtle" />
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </motion.article>
  )
}

// ── Media renderer ───────────────────────────────────────────────

function CardMediaArea({ media }: { media: CardMedia }) {
  if (media.kind === 'single') {
    return (
      <div className="relative w-full overflow-hidden border-b border-base-300/40 bg-base-100/40">
        <ProductScreenshot
          basename={media.basename}
          alt={media.alt}
          pictureClassName="block w-full"
          imgClassName="block h-full w-full object-cover object-top"
        />
        {/* Soft inner shadow for depth against light bg */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: 'inset 0 -40px 60px -40px rgba(0,0,0,0.08)',
          }}
          aria-hidden="true"
        />
      </div>
    )
  }

  // tickerStack: two (or more) ticker rows stacked vertically, each
  // captioned with its density label. Sits in the same border-b band
  // as the single variant; vertical padding gives the strips breathing
  // room since their content is dense.
  return (
    <div
      data-customization-ticker-media
      className="relative w-full min-w-0 overflow-hidden border-b border-base-300/40 bg-base-100/40 py-5 sm:px-7 sm:py-8 flex flex-col gap-4"
    >
      {media.rows.map((row) => (
        <figure key={row.basename} className="flex min-w-0 flex-col gap-1.5">
          <figcaption className="px-5 text-[10px] font-mono uppercase tracking-[0.18em] text-base-subtle sm:px-0">
            {row.densityLabel}
          </figcaption>
          <div
            data-customization-ticker-strip
            className="relative h-[var(--mobile-ticker-height)] w-full min-w-0 overflow-hidden border-y border-base-300/40 bg-base-100/60 shadow-sm sm:h-auto sm:rounded-md sm:border sm:[aspect-ratio:var(--ticker-aspect)]"
            style={
              {
                '--mobile-ticker-height':
                  row.aspect === '2930 / 80' ? '32px' : '48px',
                '--ticker-aspect': row.aspect,
              } as React.CSSProperties
            }
          >
            <ProductScreenshot
              basename={row.basename}
              alt={row.alt}
              aspect={row.aspect}
              pictureClassName="absolute -inset-y-px left-0 w-[240vw] -translate-x-20 sm:inset-0 sm:h-full sm:w-full sm:translate-x-0"
              imgClassName="block h-full w-[240vw] max-w-none object-cover sm:w-full"
            />
          </div>
        </figure>
      ))}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────

export function CustomizationShowcase() {
  return (
    <section id="customize" className="relative scroll-m-20">
      <div
        className="mx-auto px-5 sm:px-6 lg:px-8 py-20 lg:py-28 relative"
        style={{ maxWidth: 1400 }}
      >
        {/* Section header */}
        <motion.div
          style={{ opacity: 0 }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-12 lg:mb-16"
        >
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            Bend it to{' '}
            <span className="text-gradient-primary">your workflow</span>
          </h2>
          <p className="text-base text-base-subtle max-w-xl leading-relaxed text-center">
            Pick the density, the speed, the color. Drop in extra widgets when
            your day calls for it. Scrollr is opinionated where it matters and
            quiet everywhere else.
          </p>
        </motion.div>

        {/* Cards: asymmetric grid — two cards across on the top row,
            one full-width card below. On mobile (<md) all three stack
            in a single column. The bottom card spans both columns at
            md+ via `md:col-span-2`. */}
        <div className="grid gap-6 lg:gap-8 md:grid-cols-2">
          {CARDS.map((card, index) => (
            <div
              key={card.id}
              className={card.slot === 'wide' ? 'md:col-span-2' : undefined}
            >
              <ShowcaseCard card={card} delay={0.15 + index * 0.1} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
