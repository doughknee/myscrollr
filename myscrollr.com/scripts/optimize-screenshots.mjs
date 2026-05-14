/**
 * optimize-screenshots.mjs
 *
 * Converts source PNG screenshots from `ss/cropped/` (repo root) into
 * optimized WebP variants under `myscrollr.com/public/screenshots/`,
 * using a normalized basename/theme/density layout that matches the
 * `<ProductScreenshot>` component's expectations.
 *
 * Source layout (input):
 *   ss/cropped/darkmode/dark-<slug>.png
 *   ss/cropped/lightmode/light-<slug>.png
 *   ss/cropped/themes/dark/theme-<name>-dark-settings.png
 *   ss/cropped/themes/light/theme-<name>-light-settings.png
 *   ss/cropped-ticker/<density>/<theme>/<channel>-<theme>-<density>.png
 *
 * Output layout (public):
 *   public/screenshots/<category>/<basename>-<theme>@1x.webp
 *   public/screenshots/<category>/<basename>-<theme>@2x.webp
 *   public/screenshots/ticker/<channel>-<density>-<theme>@{1,2}x.webp
 *
 * Two widths are emitted per source: 1600w (1x) and 3200w (2x) for
 * dashboard captures; native-width / native-width-halved for tickers
 * (their extreme aspect ratio makes a 1600w resize destroy the text).
 *
 * Source PNGs are 2478x1478 (dashboard) or ~2930x80-124 (ticker).
 * The dashboard 2x output is downscaled to 3200w (slightly wider than
 * source) but `withoutEnlargement: true` keeps it at native size to
 * avoid upscaling artifacts.
 *
 * Idempotency: skips an output file if it already exists and is newer
 * than the source PNG. Force regen with `--force` or by deleting the
 * output directory.
 *
 * Usage:
 *   node scripts/optimize-screenshots.mjs            # incremental
 *   node scripts/optimize-screenshots.mjs --force    # full rebuild
 */

import { stat, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const repoRoot = join(root, '..')
const srcRoot = join(repoRoot, 'ss', 'cropped')
const tickerSrcRoot = join(repoRoot, 'ss', 'cropped-ticker')
const outRoot = join(root, 'public', 'screenshots')

const FORCE = process.argv.includes('--force')

// ── Source -> output mapping ──────────────────────────────────────
//
// Each entry says: "for slug X in the dark/light folders, write to
// `<category>/<basename>-{theme}@{1,2}x.webp`". A single mapping table
// keeps filenames human-readable both in `ss/cropped/` and in the
// public bundle. The `<ProductScreenshot>` component consumes the
// `${category}/${basename}` prefix.
//
// Slugs are the part AFTER `dark-` / `light-` in the source filename.
// e.g. `dark-finance-feed.png` -> slug `finance-feed`.

/** @type {Array<{slug: string, category: string, basename: string}>} */
const FEED_MAP = [
  // ── Channel feeds (live data views) ─────────────────────────────
  { slug: 'finance-feed', category: 'channels', basename: 'finance' },
  { slug: 'sports-feed', category: 'channels', basename: 'sports' },
  { slug: 'news-feed', category: 'channels', basename: 'news' },
  { slug: 'fantasy-feed', category: 'channels', basename: 'fantasy' },

  // ── Widget feeds ────────────────────────────────────────────────
  { slug: 'clock-world-clocks', category: 'widgets', basename: 'clock' },
  { slug: 'timer-pomodoro', category: 'widgets', basename: 'timer' },
  { slug: 'weather-feed', category: 'widgets', basename: 'weather' },
  { slug: 'system-monitor-feed', category: 'widgets', basename: 'sysmon' },

  // ── Configure panels (per channel/widget) ───────────────────────
  {
    slug: 'finance-configure-symbols',
    category: 'configure',
    basename: 'finance',
  },
  {
    slug: 'sports-configure-leagues',
    category: 'configure',
    basename: 'sports',
  },
  { slug: 'news-configure-feeds', category: 'configure', basename: 'news' },
  {
    slug: 'fantasy-configure-leagues',
    category: 'configure',
    basename: 'fantasy',
  },
  { slug: 'clock-configure', category: 'configure', basename: 'clock' },
  { slug: 'timer-configure', category: 'configure', basename: 'timer' },
  { slug: 'weather-configure', category: 'configure', basename: 'weather' },
  {
    slug: 'system-monitor-configure',
    category: 'configure',
    basename: 'sysmon',
  },
  { slug: 'ticker-settings', category: 'configure', basename: 'ticker' },
  {
    slug: 'settings-appearance',
    category: 'configure',
    basename: 'appearance',
  },

  // ── Display preferences (per channel) ───────────────────────────
  {
    slug: 'finance-display-preferences',
    category: 'display',
    basename: 'finance',
  },
  {
    slug: 'sports-display-preferences',
    category: 'display',
    basename: 'sports',
  },
  { slug: 'news-display-preferences', category: 'display', basename: 'news' },
  {
    slug: 'fantasy-display-preferences',
    category: 'display',
    basename: 'fantasy',
  },

  // ── Overview / catalog / account ────────────────────────────────
  {
    slug: 'home-live-feed-overview',
    category: 'overview',
    basename: 'home',
  },
  {
    slug: 'catalog-all-channels',
    category: 'overview',
    basename: 'catalog',
  },
  {
    slug: 'account-plan-limits',
    category: 'overview',
    basename: 'account-limits',
  },

  // ── Support pages (in-app help) ─────────────────────────────────
  { slug: 'support-home', category: 'support', basename: 'home' },
  {
    slug: 'support-getting-started',
    category: 'support',
    basename: 'getting-started',
  },
  {
    slug: 'support-feature-guides',
    category: 'support',
    basename: 'feature-guides',
  },
  { slug: 'support-faq', category: 'support', basename: 'faq' },
  {
    slug: 'support-troubleshooting',
    category: 'support',
    basename: 'troubleshooting',
  },
  {
    slug: 'support-account-billing',
    category: 'support',
    basename: 'account-billing',
  },
  {
    slug: 'support-contact-form',
    category: 'support',
    basename: 'contact-form',
  },
]

// ── Dark-only extras ──────────────────────────────────────────────
// `home-live-feed-overview-alt` only exists in dark mode. Emitted as
// a separate basename so consumers explicitly opt in.

/** @type {Array<{slug: string, category: string, basename: string, theme: 'dark' | 'light'}>} */
const SINGLE_THEME_MAP = [
  {
    slug: 'home-live-feed-overview-alt',
    category: 'overview',
    basename: 'home-alt',
    theme: 'dark',
  },
  // Orphan: light-only options menu. Kept addressable for future use.
  {
    slug: 'finance-options-menu',
    category: 'configure',
    basename: 'finance-options-menu',
    theme: 'light',
  },
]

// ── Theme settings panels ─────────────────────────────────────────
// Source: ss/cropped/themes/{dark,light}/theme-<name>-{dark,light}-settings.png
// Output: public/screenshots/themes/<name>-{dark,light}@{1,2}x.webp

const THEME_NAMES = [
  'catppuccin',
  'dracula',
  'everforest',
  'gruvbox',
  'nord',
  'one',
  'rose-pine',
  'solarized',
  'tokyo-night',
]

// ── Ticker strips ─────────────────────────────────────────────────
//
// Source:  ss/cropped-ticker/{compact,detailed}/{dark,light}/<channel>-<theme>-<density>.png
// Output:  public/screenshots/ticker/<channel>-<density>-<theme>@{1,2}x.webp
//
// These are the always-on-top edge ticker views (≈2930px wide, 80-124px
// tall). Aspect ratio is extreme (~24-37:1) so the optimize step does
// NOT resize to 1600w like the other categories — that would compress
// them down to ~40-55px tall and the text would mush. Instead we keep
// them at native width for both @1x and @2x; the file size is still
// tiny because there's very little vertical content.
//
// Encoding intent: the ticker rows are mostly flat color + crisp text.
// Quality stays high (82) because banding around solid-color price
// chips or league logos is visible immediately.

const TICKER_CHANNELS = ['all-purpose', 'fantasy', 'finance', 'news', 'sports']
const TICKER_DENSITIES = ['compact', 'detailed']
const TICKER_QUALITY_1X = 82
const TICKER_QUALITY_2X = 76

// ── Encoding parameters ───────────────────────────────────────────

// 1x is the default delivery for non-retina displays. Quality 78 is
// the sweet spot for product screenshots (text stays crisp, gradients
// don't band visibly).
const WIDTH_1X = 1600
const QUALITY_1X = 78

// 2x serves retina. Source PNGs are 2478w, so 2x is effectively the
// native resolution. Quality drops slightly because the perceived
// quality of a 2x WebP at 70 matches a 1x at 80.
const WIDTH_2X = 3200
const QUALITY_2X = 72

// ── Encoder ────────────────────────────────────────────────────────

/**
 * Encode a single PNG to a WebP at the given width and quality.
 * Skips work if the output exists and is newer than the source
 * (unless --force is passed).
 */
async function encode(srcPath, outPath, width, quality) {
  if (!FORCE && existsSync(outPath)) {
    const [srcStat, outStat] = await Promise.all([
      stat(srcPath),
      stat(outPath),
    ])
    if (outStat.mtimeMs >= srcStat.mtimeMs) {
      return { skipped: true }
    }
  }

  await mkdir(dirname(outPath), { recursive: true })

  await sharp(srcPath)
    .resize({ width, withoutEnlargement: true, fit: 'inside' })
    .webp({ quality, effort: 5 })
    .toFile(outPath)

  return { skipped: false }
}

/**
 * Encode a (1x, 2x) pair from a single source PNG.
 */
async function encodePair(srcPath, outPrefix) {
  const out1x = `${outPrefix}@1x.webp`
  const out2x = `${outPrefix}@2x.webp`

  const [r1, r2] = await Promise.all([
    encode(srcPath, out1x, WIDTH_1X, QUALITY_1X),
    encode(srcPath, out2x, WIDTH_2X, QUALITY_2X),
  ])
  return { out1x, out2x, skipped1: r1.skipped, skipped2: r2.skipped }
}

/**
 * Encode a (1x, 2x) ticker pair. Ticker sources are ~2930px wide but
 * only 80-124px tall, so the usual 1600w / 3200w resize math doesn't
 * apply — 1600w would compress them to ~44-67px tall and the text
 * would mush. Instead we emit:
 *   @1x: source width / 2  (≈1465w, sized for non-retina)
 *   @2x: source width      (≈2930w, sized for retina)
 * Both pass through sharp's WebP encoder at the ticker quality level.
 */
async function encodeTickerPair(srcPath, outPrefix) {
  const out1x = `${outPrefix}@1x.webp`
  const out2x = `${outPrefix}@2x.webp`

  // Read source dimensions once so the resize math is exact rather
  // than guessing at the ~2930px source width.
  const meta = await sharp(srcPath).metadata()
  const sourceWidth = meta.width ?? 2930
  const targetWidth1x = Math.round(sourceWidth / 2)

  const [r1, r2] = await Promise.all([
    encode(srcPath, out1x, targetWidth1x, TICKER_QUALITY_1X),
    encode(srcPath, out2x, sourceWidth, TICKER_QUALITY_2X),
  ])
  return { out1x, out2x, skipped1: r1.skipped, skipped2: r2.skipped }
}

// ── Orchestration ──────────────────────────────────────────────────

/**
 * Verifies all source PNGs declared in the maps actually exist before
 * doing any work, so a typo or rename surfaces immediately rather than
 * after half the files are written.
 */
async function verifySources() {
  const missing = []
  for (const { slug } of FEED_MAP) {
    const dark = join(srcRoot, 'darkmode', `dark-${slug}.png`)
    const light = join(srcRoot, 'lightmode', `light-${slug}.png`)
    if (!existsSync(dark)) missing.push(dark)
    if (!existsSync(light)) missing.push(light)
  }
  for (const { slug, theme } of SINGLE_THEME_MAP) {
    const folder = theme === 'dark' ? 'darkmode' : 'lightmode'
    const path = join(srcRoot, folder, `${theme}-${slug}.png`)
    if (!existsSync(path)) missing.push(path)
  }
  for (const name of THEME_NAMES) {
    const dark = join(srcRoot, 'themes', 'dark', `theme-${name}-dark-settings.png`)
    const light = join(srcRoot, 'themes', 'light', `theme-${name}-light-settings.png`)
    if (!existsSync(dark)) missing.push(dark)
    if (!existsSync(light)) missing.push(light)
  }
  for (const density of TICKER_DENSITIES) {
    for (const channel of TICKER_CHANNELS) {
      for (const theme of ['dark', 'light']) {
        const path = join(
          tickerSrcRoot,
          density,
          theme,
          `${channel}-${theme}-${density}.png`,
        )
        if (!existsSync(path)) missing.push(path)
      }
    }
  }
  if (missing.length > 0) {
    console.error('\n[optimize-screenshots] Missing source files:')
    for (const m of missing) console.error('  ' + m)
    console.error(
      '\nFix the FEED_MAP / SINGLE_THEME_MAP / THEME_NAMES / TICKER_*\n' +
        'tables in this script, or add the missing PNGs under\n' +
        'ss/cropped/ or ss/cropped-ticker/.\n',
    )
    process.exit(1)
  }
}

async function main() {
  await verifySources()
  await mkdir(outRoot, { recursive: true })

  let written = 0
  let skipped = 0
  const jobs = []

  // Feed map: dark + light pair per entry
  for (const { slug, category, basename } of FEED_MAP) {
    const darkSrc = join(srcRoot, 'darkmode', `dark-${slug}.png`)
    const lightSrc = join(srcRoot, 'lightmode', `light-${slug}.png`)
    const outDir = join(outRoot, category)

    jobs.push(
      encodePair(darkSrc, join(outDir, `${basename}-dark`)).then((r) => {
        if (r.skipped1) skipped++
        else written++
        if (r.skipped2) skipped++
        else written++
      }),
    )
    jobs.push(
      encodePair(lightSrc, join(outDir, `${basename}-light`)).then((r) => {
        if (r.skipped1) skipped++
        else written++
        if (r.skipped2) skipped++
        else written++
      }),
    )
  }

  // Single-theme extras
  for (const { slug, category, basename, theme } of SINGLE_THEME_MAP) {
    const folder = theme === 'dark' ? 'darkmode' : 'lightmode'
    const src = join(srcRoot, folder, `${theme}-${slug}.png`)
    const outDir = join(outRoot, category)
    jobs.push(
      encodePair(src, join(outDir, `${basename}-${theme}`)).then((r) => {
        if (r.skipped1) skipped++
        else written++
        if (r.skipped2) skipped++
        else written++
      }),
    )
  }

  // Theme map: dark + light pair per theme name
  for (const name of THEME_NAMES) {
    const darkSrc = join(
      srcRoot,
      'themes',
      'dark',
      `theme-${name}-dark-settings.png`,
    )
    const lightSrc = join(
      srcRoot,
      'themes',
      'light',
      `theme-${name}-light-settings.png`,
    )
    const outDir = join(outRoot, 'themes')
    jobs.push(
      encodePair(darkSrc, join(outDir, `${name}-dark`)).then((r) => {
        if (r.skipped1) skipped++
        else written++
        if (r.skipped2) skipped++
        else written++
      }),
    )
    jobs.push(
      encodePair(lightSrc, join(outDir, `${name}-light`)).then((r) => {
        if (r.skipped1) skipped++
        else written++
        if (r.skipped2) skipped++
        else written++
      }),
    )
  }

  // Ticker strips: emit native-width @1x/@2x because the source aspect
  // is too extreme to downscale further without destroying the text.
  // Output basename pattern: `<channel>-<density>-<theme>` so a
  // consumer like <ProductScreenshot basename="ticker/finance-compact"
  // themeOverride="dark" /> resolves to the right file.
  for (const density of TICKER_DENSITIES) {
    for (const channel of TICKER_CHANNELS) {
      for (const theme of ['dark', 'light']) {
        const src = join(
          tickerSrcRoot,
          density,
          theme,
          `${channel}-${theme}-${density}.png`,
        )
        const outFile = join(
          outRoot,
          'ticker',
          `${channel}-${density}-${theme}`,
        )
        jobs.push(
          encodeTickerPair(src, outFile).then((r) => {
            if (r.skipped1) skipped++
            else written++
            if (r.skipped2) skipped++
            else written++
          }),
        )
      }
    }
  }

  // Run jobs in batches of 6 to keep CPU/memory in check on dev
  // machines. sharp is multi-threaded internally, so we don't need to
  // fan out to dozens of concurrent encodes.
  const BATCH = 6
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(jobs.slice(i, i + BATCH))
  }

  console.log(
    `[optimize-screenshots] wrote ${written} file(s), skipped ${skipped} up-to-date.`,
  )
}

main().catch((err) => {
  console.error('[optimize-screenshots] failed:', err)
  process.exit(1)
})
