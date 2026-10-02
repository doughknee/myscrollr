/**
 * optimize-screenshots.mjs
 *
 * Converts source PNG screenshots from `ss/cropped/` (repo root) into
 * optimized WebP variants under `myscrollr.com/public/screenshots/`,
 * using a normalized basename/theme/density layout that matches the
 * `<ProductScreenshot>` component's expectations.
 *
 * Source layout (input — all under myscrollr.com/ so Docker can copy them):
 *   screenshot-sources/darkmode/dark-<slug>.png
 *   screenshot-sources/lightmode/light-<slug>.png
 *
 * Output layout (public):
 *   public/screenshots/<category>/<basename>-<theme>@1x.webp
 *   public/screenshots/<category>/<basename>-<theme>@2x.webp
 *
 * Source PNGs are 2478x1478.
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
// Source PNGs live inside myscrollr.com/ so Docker's build context
// (which copies only myscrollr.com/) has access to them. The previous
// location at the repo root was outside the Docker context and broke CI.
const srcRoot = join(root, 'screenshot-sources')
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
  { slug: 'clock-configure', category: 'configure', basename: 'clock' },
  { slug: 'timer-configure', category: 'configure', basename: 'timer' },
  { slug: 'weather-configure', category: 'configure', basename: 'weather' },
  {
    slug: 'system-monitor-configure',
    category: 'configure',
    basename: 'sysmon',
  },
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

  // ── Overview / catalog / account ────────────────────────────────
  {
    slug: 'home-live-feed-overview',
    category: 'overview',
    basename: 'home',
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

// ── Encoding parameters ───────────────────────────────────────────

// Dashboard screenshots are emitted at four widths so the browser can
// pick the right rendition via the width-descriptor `srcset` in
// `<ProductScreenshot>`. The smaller widths exist specifically to fix
// LCP on mobile — PSI flagged ~568 KiB of wasted image bytes on the
// home page because the @1x/@2x variants were both 2-3x larger than
// the displayed dimensions on phones.
//
// Quality ladder is tuned so each rendition looks crisp at its target
// CSS width. Higher densities use slightly lower quality because the
// extra pixels mask compression artifacts.

// @sm: phones and small tablets. ~640 CSS px at 1x DPR, or ~320 CSS px
// at 2x DPR. Used by phones where the home hero renders at ~388 CSS px.
const WIDTH_SM = 800
const QUALITY_SM = 76

// @md: medium screens / tablets. Bridges the gap between @sm and @1x
// so the browser doesn't have to upscale @sm or download @1x for a
// ~700 CSS px display.
const WIDTH_MD = 1200
const QUALITY_MD = 76

// 1x is the default delivery for non-retina desktop displays. Quality
// 78 is the sweet spot for product screenshots (text stays crisp,
// gradients don't band visibly).
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
    const [srcStat, outStat] = await Promise.all([stat(srcPath), stat(outPath)])
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
 * Encode the four-width dashboard set from a single source PNG.
 *
 * Emits `@sm`, `@md`, `@1x`, and `@2x` so the browser can pick the
 * right rendition via width-descriptor `srcset`. The legacy `@1x` and
 * `@2x` files are preserved so existing consumers (OG image script,
 * any hardcoded references, prefetch hints) keep working.
 */
async function encodePair(srcPath, outPrefix) {
  const outSm = `${outPrefix}@sm.webp`
  const outMd = `${outPrefix}@md.webp`
  const out1x = `${outPrefix}@1x.webp`
  const out2x = `${outPrefix}@2x.webp`

  const [rSm, rMd, r1, r2] = await Promise.all([
    encode(srcPath, outSm, WIDTH_SM, QUALITY_SM),
    encode(srcPath, outMd, WIDTH_MD, QUALITY_MD),
    encode(srcPath, out1x, WIDTH_1X, QUALITY_1X),
    encode(srcPath, out2x, WIDTH_2X, QUALITY_2X),
  ])
  return {
    outSm,
    outMd,
    out1x,
    out2x,
    skippedSm: rSm.skipped,
    skippedMd: rMd.skipped,
    skipped1: r1.skipped,
    skipped2: r2.skipped,
  }
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
  if (missing.length > 0) {
    console.error('\n[optimize-screenshots] Missing source files:')
    for (const m of missing) console.error('  ' + m)
    console.error(
      '\nFix the FEED_MAP / SINGLE_THEME_MAP tables in this script, or\n' +
        'add the missing PNGs under myscrollr.com/screenshot-sources/.\n',
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
        for (const s of [r.skippedSm, r.skippedMd, r.skipped1, r.skipped2]) {
          if (s) skipped++
          else written++
        }
      }),
    )
    jobs.push(
      encodePair(lightSrc, join(outDir, `${basename}-light`)).then((r) => {
        for (const s of [r.skippedSm, r.skippedMd, r.skipped1, r.skipped2]) {
          if (s) skipped++
          else written++
        }
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
        for (const s of [r.skippedSm, r.skippedMd, r.skipped1, r.skipped2]) {
          if (s) skipped++
          else written++
        }
      }),
    )
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
