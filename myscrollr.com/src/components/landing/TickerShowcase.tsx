import { motion } from 'motion/react'
import { ProductScreenshot } from '@/components/ProductScreenshot'

// ── Constants ────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const

// Ticker source aspect ratios (preserved at native resolution by the
// optimize-screenshots pipeline). Declared here as CSS aspect-ratio
// strings so each <picture> reserves the right space and we don't get
// CLS while the WebP decodes.
const ASPECT_COMPACT = '2930 / 80'
const ASPECT_DETAILED = '2930 / 124'

// ── Row catalog ──────────────────────────────────────────────────
//
// Each row demonstrates one (channel × density) combination. The order
// is deliberately mixed (sports → finance → news → fantasy, alternating
// detailed/compact) so the section visually communicates "you can put
// anything at any density" without spelling it out. The two
// `all-purpose` rows close the sequence as a "this is everything at
// once" punchline, one per density.

interface TickerRow {
  /** Stable key + ProductScreenshot basename source. */
  basename: string
  /** Eyebrow shown to the left of the row at sm+. */
  channelLabel: string
  /** Eyebrow density tag shown after the channel label. */
  densityLabel: 'Compact' | 'Detailed'
  /** Aspect ratio for the row's container. */
  aspect: typeof ASPECT_COMPACT | typeof ASPECT_DETAILED
  /** Required alt text. */
  alt: string
}

const ROWS: ReadonlyArray<TickerRow> = [
  {
    basename: 'ticker/sports-detailed',
    channelLabel: 'Sports',
    densityLabel: 'Detailed',
    aspect: ASPECT_DETAILED,
    alt: 'Scrollr ticker showing live sports scores across multiple games in the detailed density.',
  },
  {
    basename: 'ticker/finance-compact',
    channelLabel: 'Finance',
    densityLabel: 'Compact',
    aspect: ASPECT_COMPACT,
    alt: 'Scrollr ticker showing live stock and crypto prices in the compact density.',
  },
  {
    basename: 'ticker/news-detailed',
    channelLabel: 'News',
    densityLabel: 'Detailed',
    aspect: ASPECT_DETAILED,
    alt: 'Scrollr ticker showing recent RSS headlines with source attribution in the detailed density.',
  },
  {
    basename: 'ticker/fantasy-compact',
    channelLabel: 'Fantasy',
    densityLabel: 'Compact',
    aspect: ASPECT_COMPACT,
    alt: 'Scrollr ticker showing Yahoo Fantasy league matchups in the compact density.',
  },
  {
    basename: 'ticker/all-purpose-detailed',
    channelLabel: 'All channels',
    densityLabel: 'Detailed',
    aspect: ASPECT_DETAILED,
    alt: 'Scrollr ticker showing sports, finance, news, and fantasy together in the detailed density.',
  },
  {
    basename: 'ticker/all-purpose-compact',
    channelLabel: 'All channels',
    densityLabel: 'Compact',
    aspect: ASPECT_COMPACT,
    alt: 'Scrollr ticker showing sports, finance, news, and fantasy together in the compact density.',
  },
] as const

// ── Component ────────────────────────────────────────────────────

/**
 * Homepage section that demonstrates the always-on-top ticker bar — the
 * actual surface that lives on your screen all day. The other product
 * screenshots on the home page show the dashboard (a configuration UI);
 * this section shows the *output*, so the user can match "I tuned these
 * channels" to "and this is what shows up."
 *
 * Renders six full-width ticker rows stacked vertically, each tagged
 * with a tiny eyebrow on the left. No animation — these are static
 * stills because (1) the source images are PNGs not videos, (2) faking
 * scroll with CSS keyframes would lie about the actual scroll speed,
 * (3) anyone reading "ticker" already imagines motion.
 */
export function TickerShowcase() {
  return (
    <section id="ticker" className="relative scroll-m-20 overflow-hidden">
      {/* Subtle horizontal accent lines top & bottom so the section reads
          as a unified band, not just a tall list. */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/40 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-base-300/40 to-transparent" />

      <div
        className="mx-auto px-5 sm:px-6 lg:px-8 py-20 lg:py-28 relative"
        style={{ maxWidth: 1400 }}
      >
        {/* Section header ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="flex flex-col items-center text-center mb-12 lg:mb-16"
        >
          <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-base-200/60 text-base-content/60 text-[10px] font-bold rounded-lg border border-base-300/40 uppercase tracking-wide mb-6">
            The ticker, not another window
          </span>
          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[0.95] mb-4 text-center">
            What actually sits{' '}
            <span className="text-gradient-primary">on your screen</span>
          </h2>
          <p className="text-base text-base-content/45 max-w-xl leading-relaxed text-center">
            A thin strip at the edge of your display. Real data, refreshed in
            real time. Pick the density that matches how much detail you want.
          </p>
        </motion.div>

        {/* Ticker stack ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:gap-5">
          {ROWS.map((row, idx) => (
            <TickerRowCard key={row.basename} row={row} index={idx} />
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Internal ─────────────────────────────────────────────────────

interface TickerRowCardProps {
  row: TickerRow
  index: number
}

/**
 * Single ticker row: eyebrow on the left at sm+, screenshot taking the
 * remaining width. On mobile the eyebrow moves above the strip so the
 * ticker itself stays at its full width.
 */
function TickerRowCard({ row, index }: TickerRowCardProps) {
  return (
    <motion.figure
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: EASE, delay: index * 0.06 }}
      className="grid grid-cols-1 sm:grid-cols-[160px_1fr] items-center gap-3 sm:gap-6"
    >
      {/* Eyebrow ─────────────────────────────────────────── */}
      <figcaption className="flex sm:flex-col sm:items-start items-center gap-2 sm:gap-1 text-left">
        <span className="text-[11px] font-bold tracking-[0.18em] text-base-content/55 uppercase">
          {row.channelLabel}
        </span>
        <span className="text-[10px] font-mono text-base-content/35 sm:mt-0.5">
          {row.densityLabel}
        </span>
      </figcaption>

      {/* Ticker strip ────────────────────────────────────── */}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-base-300/40 bg-base-200/30 shadow-sm"
        style={{ aspectRatio: row.aspect }}
      >
        <ProductScreenshot
          basename={row.basename}
          alt={row.alt}
          aspect={row.aspect}
          pictureClassName="absolute inset-0"
          imgClassName="block h-full w-full object-cover"
        />
      </div>
    </motion.figure>
  )
}
