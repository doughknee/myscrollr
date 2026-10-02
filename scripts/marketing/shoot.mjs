#!/usr/bin/env node
/**
 * Marketing images from the real ticker (SCROLLR-310). `make marketing`.
 *
 * Serves desktop/dist-embed at /bar/ (or uses https://myscrollr.com/bar/
 * with --prod) and shoots it with Playwright's Chromium at DPR 2:
 *
 *   marketing/out/<scenario>-<width>-<theme>.png   (not committed)
 *     scenarios: pages-mixed, busy-saturday, github-page, band-hover,
 *     continuous; widths 1280, 1920, 3440; scrollr-dark, scrollr-light
 *   myscrollr.com/public/og/*.png                  (committed: the OG cards,
 *     og-template.mjs with the bar across the top)
 *   myscrollr.com/public/marketing/desktop-proof-<mode>@<1x|2x>.png
 *   myscrollr.com/public/marketing/bar-<mode>.png  (committed: the homepage
 *     proof, and LiveBar's placeholder until the frame has drawn)
 *
 * Every scenario forces a fixture (?fixture=), so the shots repeat; the
 * fixtures' timestamps are rebased to now by the embed.
 *
 *   node scripts/marketing/shoot.mjs [--prod] [--only=bars|og|site]
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EMBED = join(ROOT, 'desktop', 'dist-embed')
const OUT = join(ROOT, 'marketing', 'out')
const SITE = join(ROOT, 'myscrollr.com', 'public')

const args = process.argv.slice(2)
const prod = args.includes('--prod')
const only = args.find((a) => a.startsWith('--only='))?.slice(7)

const { chromium } = createRequire(join(ROOT, 'desktop', 'package.json'))('@playwright/test')
const { PAGES, template, OG_DIR } = await import(
  new URL('../../myscrollr.com/scripts/og-template.mjs', import.meta.url).href
)

const SCENARIOS = {
  'pages-mixed': { q: 'fixture=pages' },
  'busy-saturday': { q: 'fixture=busy' },
  'github-page': { q: 'fixture=github' },
  'band-hover': { q: 'fixture=pages&keypad=1', hover: true },
  continuous: { q: 'fixture=mixed&mode=continuous' },
}
const WIDTHS = [1280, 1920, 3440]
const THEMES = ['scrollr-dark', 'scrollr-light']

// ── A static /bar/ over dist-embed ────────────────────────────────

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

async function serve() {
  if (!existsSync(join(EMBED, 'embed.html'))) {
    console.error('desktop/dist-embed is missing: run `make marketing` (it builds it), or\n  cd desktop && npx vite build --mode embed')
    process.exit(1)
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    const rel = normalize(path.replace(/^\/bar\/?/, '')).replace(/^(\.\.[/\\])+/, '')
    const file = rel && existsSync(join(EMBED, rel)) && extname(rel) ? join(EMBED, rel) : join(EMBED, 'embed.html')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(await readFile(file))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${server.address().port}/bar/`, close: () => server.close() }
}

// ── Shooting ──────────────────────────────────────────────────────

const browser = await chromium.launch()
const local = prod ? null : await serve()
const base = prod ? 'https://myscrollr.com/bar/' : local.base

/** One bar, `width` CSS px wide and 64 tall, as a PNG buffer. */
async function shoot({ q, hover }, width, theme, dpr = 2) {
  const page = await browser.newPage({ viewport: { width, height: 64 }, deviceScaleFactor: dpr })
  await page.goto(`${base}?${q}&theme=${theme}`)
  await page.waitForSelector('html[data-ready]', { timeout: 20_000 })
  if (hover) {
    await page.mouse.move(width / 2, 32)
    await page.waitForTimeout(900)
  } else {
    await page.mouse.move(0, 200) // off the bar: no hover state
    await page.waitForTimeout(600)
  }
  const png = await page.screenshot({ type: 'png' })
  await page.close()
  return png
}

const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`

/** Render HTML at a fixed size and return the PNG. */
async function render(html, width, height, dpr) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const png = await page.screenshot({ type: 'png' })
  await page.close()
  return png
}

const started = Date.now()
const written = []
async function write(path, png) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, png)
  written.push(path)
}

try {
  if (!only || only === 'bars') {
    for (const [name, sc] of Object.entries(SCENARIOS)) {
      for (const width of WIDTHS) {
        for (const theme of THEMES) {
          await write(join(OUT, `${name}-${width}-${theme}.png`), await shoot(sc, width, theme))
        }
      }
    }
  }

  if (!only || only === 'og') {
    const bar = dataUrl(await shoot(SCENARIOS['pages-mixed'], 1200, 'scrollr-dark', 1))
    for (const pg of PAGES) {
      await write(join(OG_DIR, pg.file), await render(template({ ...pg, bar }), 1200, 630, 1))
    }
  }

  if (!only || only === 'site') {
    for (const mode of ['dark', 'light']) {
      const theme = `scrollr-${mode}`
      // LiveBar's placeholder: what the bar looks like before the frame draws.
      await write(join(SITE, 'marketing', `bar-${mode}.png`), await shoot(SCENARIOS['pages-mixed'], 1920, theme, 1))
      // The homepage proof: three pages of the real bar, stacked, unedited.
      for (const dpr of [1, 2]) {
        const shots = []
        for (const sc of ['busy-saturday', 'pages-mixed', 'github-page']) {
          shots.push(dataUrl(await shoot(SCENARIOS[sc], 1600, theme, dpr)))
        }
        const bg = mode === 'dark' ? '#0a0a14' : '#eef0f5'
        const html = `<!doctype html><html><body style="margin:0;padding:24px;background:${bg};display:flex;flex-direction:column;gap:20px">${shots
          .map((s) => `<img src="${s}" style="display:block;width:1600px;height:64px">`)
          .join('')}</body></html>`
        await write(join(SITE, 'marketing', `desktop-proof-${mode}@${dpr}x.png`), await render(html, 1648, 280, dpr))
      }
    }
  }
} finally {
  await browser.close()
  local?.close()
}

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(`${written.length} images in ${secs}s:`)
for (const dir of new Set(written.map((p) => dirname(p)))) console.log(`  ${dir}`)
