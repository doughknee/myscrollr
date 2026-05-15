// Mobile viewport regression check.
//
// Spawns a small HTTP server over `dist/client/`, then headless
// Chromium via Playwright (already a devDep — used by
// generate-og-images.mjs) visits every prerendered route at several
// mobile viewport widths. For each visit:
//
//  - Asserts `document.documentElement.scrollWidth <= clientWidth`
//    (i.e. no horizontal scroll — the #1 mobile bug).
//  - If overflow is detected, walks the DOM to identify the widest
//    offending element so the failure message is actionable.
//
// Runs in `npm run postbuild` after `check-prerender.mjs`. Fails the
// build if any route×viewport pair triggers horizontal scroll.
//
// Skip via SKIP_MOBILE_VIEWPORT_CHECK=1 (local dev convenience; CI
// always runs it).

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = join(__dirname, '..', 'dist', 'client')

if (process.env.SKIP_MOBILE_VIEWPORT_CHECK) {
  console.log('[check-mobile-viewport] skipped (SKIP_MOBILE_VIEWPORT_CHECK=1)')
  process.exit(0)
}

// Representative mobile/tablet widths. iPhone SE (320) is the
// historical narrow case; iPhone 13/14 Pro (390) is the current
// modal device; tablet portrait (768) is the breakpoint boundary
// where the desktop layout kicks in.
const VIEWPORTS = [
  { name: 'iphone-se', width: 320, height: 568 },
  { name: 'iphone-13', width: 390, height: 844 },
  { name: 'pixel-7', width: 412, height: 915 },
  { name: 'ipad-mini', width: 768, height: 1024 },
]

// Routes to check. Mirrors `check-prerender.mjs` but excludes pages
// whose bodies are intentionally client-rendered (uplink, lifetime).
// Running the check against an empty <main> would silently pass and
// hide real bugs.
const ROUTES = [
  { path: '/', file: 'index.html' },
  { path: '/channels', file: 'channels/index.html' },
  { path: '/download', file: 'download/index.html' },
  { path: '/business', file: 'business/index.html' },
  { path: '/architecture', file: 'architecture/index.html' },
  { path: '/support', file: 'support/index.html' },
  { path: '/legal', file: 'legal/index.html' },
]

// Per-extension content-type table. Anything not listed gets served
// as `application/octet-stream`; the browser still loads it via
// fetch but won't apply it as a stylesheet/script (which is fine for
// fonts/images, which the browser sniffs anyway).
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

// Sanity: every file we want to check must exist on disk.
const missing = ROUTES.filter((r) => !existsSync(join(clientDir, r.file)))
if (missing.length) {
  console.error(
    `[check-mobile-viewport] missing prerendered files: ${missing
      .map((m) => m.file)
      .join(', ')}`,
  )
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch (err) {
  console.error(
    '[check-mobile-viewport] failed to import playwright. Run ' +
      '`npm install` to ensure devDependencies are present. Error: ' +
      (err?.message ?? err),
  )
  process.exit(1)
}

// Resolve an incoming URL path to a file under `dist/client/`,
// applying nginx-style fallbacks: `/foo` → `/foo/index.html`,
// `/foo/` → `/foo/index.html`. Rejects path traversal attempts.
function resolveStaticFile(urlPath) {
  // Strip query/hash; the URL constructor wants a base for relative
  // paths, so we hand it a dummy origin.
  const pathname = new URL(urlPath, 'http://x').pathname
  // Reject anything containing `..` after normalization. join()
  // would resolve `..` and could escape `clientDir`.
  if (pathname.includes('..')) return null

  const direct = join(clientDir, pathname)
  if (existsSync(direct)) {
    // If it's a directory request (`/foo/`), serve `index.html`.
    if (pathname.endsWith('/')) {
      const indexPath = join(direct, 'index.html')
      return existsSync(indexPath) ? indexPath : null
    }
    return direct
  }

  // Bare route without extension or trailing slash. Try
  // `/foo/index.html`.
  if (!extname(pathname)) {
    const subIndex = join(clientDir, pathname, 'index.html')
    if (existsSync(subIndex)) return subIndex
  }

  // SPA fallback: anything not found returns the prerendered shell.
  // This mirrors the nginx `try_files $uri $uri/ /index.html;` rule
  // so the browser doesn't 404 on dynamic routes during the test
  // (not currently needed for the prerendered routes, but cheap).
  const shell = join(clientDir, '_shell.html')
  return existsSync(shell) ? shell : null
}

// Start a tiny static file server on a random port. Returns
// { server, port } so callers can construct the base URL.
function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const file = resolveStaticFile(req.url ?? '/')
      if (!file) {
        res.writeHead(404)
        res.end('Not Found')
        return
      }
      const ext = extname(file).toLowerCase()
      const type = MIME_TYPES[ext] ?? 'application/octet-stream'
      try {
        const body = readFileSync(file)
        res.writeHead(200, { 'content-type': type })
        res.end(body)
      } catch (err) {
        res.writeHead(500)
        res.end(`Internal Server Error: ${err?.message ?? err}`)
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to read server address'))
        return
      }
      resolve({ server, port: addr.port })
    })
  })
}

const { server, port } = await startStaticServer()
const baseUrl = `http://127.0.0.1:${port}`

const browser = await chromium.launch()
let failures = 0

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
    })
    const page = await context.newPage()

    for (const route of ROUTES) {
      try {
        await page.goto(`${baseUrl}${route.path}`, {
          waitUntil: 'networkidle',
          timeout: 15000,
        })
      } catch (err) {
        console.error(
          `✗ ${route.path} @ ${viewport.name}: failed to load (${err?.message ?? err})`,
        )
        failures += 1
        continue
      }

      // Brief settle so any in-flight layout work finishes.
      await page.waitForTimeout(250)

      const result = await page.evaluate(() => {
        const doc = document.documentElement
        const body = document.body
        const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth)
        const clientWidth = doc.clientWidth

        let offender = null
        if (scrollWidth > clientWidth) {
          let furthest = clientWidth
          for (const el of Array.from(document.querySelectorAll('*'))) {
            const rect = el.getBoundingClientRect()
            if (rect.right > furthest) {
              furthest = rect.right
              const id = el.id ? `#${el.id}` : ''
              const cls =
                el.className && typeof el.className === 'string'
                  ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
                  : ''
              offender = `${el.tagName.toLowerCase()}${id}${cls} (right=${Math.round(
                rect.right,
              )})`
            }
          }
        }
        return { scrollWidth, clientWidth, offender }
      })

      // Subpixel rendering at 2× DSR can produce off-by-1 scrollWidth
      // values that don't actually scroll. Tolerate 1px.
      if (result.scrollWidth - result.clientWidth > 1) {
        console.error(
          `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
            `horizontal scroll detected — scrollWidth=${result.scrollWidth}, ` +
            `clientWidth=${result.clientWidth}` +
            (result.offender ? `; widest offender: ${result.offender}` : ''),
        )
        failures += 1
      } else {
        console.log(`✓ ${route.path} @ ${viewport.name} (${viewport.width}px)`)
      }

      if (route.path === '/' && viewport.width < 768) {
        const heroMobileLayout = await page.evaluate(() => {
          const header = document.querySelector('header')
          const heading = document.querySelector('h1')
          const heroSection = heading?.closest('section')
          const screenshot = Array.from(
            document.querySelectorAll('[data-hero-showcase]'),
          ).find((el) => el.getBoundingClientRect().width > 0)
          const progressButton = document.querySelector(
            'button[aria-label^="Show "]',
          )
          const heroCopy = Array.from(
            heroSection?.querySelectorAll('p') ?? [],
          ).find((p) =>
            p.textContent?.includes(
              'A quiet ticker at the edge of your screen',
            ),
          )
          const downloadLink = Array.from(
            heroSection?.querySelectorAll('a') ?? [],
          ).find((a) => a.textContent?.includes('Download'))
          if (!header || !heading || !screenshot || !progressButton) return null

          const headerRect = header.getBoundingClientRect()
          const headingRect = heading.getBoundingClientRect()
          const screenshotRect = screenshot.getBoundingClientRect()
          const progressRect = progressButton.getBoundingClientRect()
          const clientWidth = document.documentElement.clientWidth
          return {
            headerBottom: Math.round(headerRect.bottom),
            headingTop: Math.round(headingRect.top),
            headingBottom: Math.round(headingRect.bottom),
            screenshotTop: Math.round(screenshotRect.top),
            screenshotBottom: Math.round(screenshotRect.bottom),
            screenshotLeft: Math.round(screenshotRect.left),
            screenshotRight: Math.round(screenshotRect.right),
            progressTop: Math.round(progressRect.top),
            clientWidth,
            hasHeroCopy: Boolean(heroCopy),
            hasDownloadLink: Boolean(downloadLink),
          }
        })

        if (!heroMobileLayout) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing hero mobile layout elements`,
          )
          failures += 1
        } else {
          if (
            heroMobileLayout.headingTop <
            heroMobileLayout.headerBottom + 12
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `hero heading starts under fixed header — headingTop=${heroMobileLayout.headingTop}, ` +
                `headerBottom=${heroMobileLayout.headerBottom}`,
            )
            failures += 1
          }

          if (
            heroMobileLayout.screenshotTop < heroMobileLayout.headingBottom ||
            heroMobileLayout.screenshotBottom > heroMobileLayout.progressTop
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `hero screenshot is not between heading and switch bars — ` +
                `headingBottom=${heroMobileLayout.headingBottom}, ` +
                `screenshotTop=${heroMobileLayout.screenshotTop}, ` +
                `screenshotBottom=${heroMobileLayout.screenshotBottom}, ` +
                `progressTop=${heroMobileLayout.progressTop}`,
            )
            failures += 1
          }

          if (
            Math.abs(heroMobileLayout.screenshotLeft - 12) > 1 ||
            Math.abs(
              heroMobileLayout.screenshotRight -
                (heroMobileLayout.clientWidth - 12),
            ) > 1
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `hero screenshot does not use 12px mobile gutters — left=${heroMobileLayout.screenshotLeft}, ` +
                `right=${heroMobileLayout.screenshotRight}, clientWidth=${heroMobileLayout.clientWidth}`,
            )
            failures += 1
          }

          if (
            !heroMobileLayout.hasHeroCopy ||
            heroMobileLayout.hasDownloadLink
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `hero copy/download CTA state is wrong — ` +
                `hasHeroCopy=${heroMobileLayout.hasHeroCopy}, ` +
                `hasDownloadLink=${heroMobileLayout.hasDownloadLink}`,
            )
            failures += 1
          }
        }

        await page.locator('#ticker').scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)

        const mobileFlow = await page.evaluate(() => {
          const header = document.querySelector('header')
          const ticker = document.querySelector('#ticker')
          const how = document.querySelector('#how-it-works')
          const tickerStack = ticker?.querySelector('[data-ticker-stack]')
          const lastTicker = tickerStack?.lastElementChild
          const howHeader = how?.querySelector('h2')
          const howCards = how?.querySelectorAll('[data-mobile-step-card]')
          const tickerStrip = ticker?.querySelector('[data-ticker-strip]')
          const tickerStrips = Array.from(
            ticker?.querySelectorAll('[data-ticker-strip]') ?? [],
          )
          const tickerImage = tickerStrip?.querySelector('img')

          if (
            !header ||
            !ticker ||
            !how ||
            !lastTicker ||
            !howHeader ||
            !howCards ||
            !tickerStrip ||
            !tickerImage
          ) {
            return null
          }

          const tickerRect = ticker.getBoundingClientRect()
          const howRect = how.getBoundingClientRect()
          const lastTickerRect = lastTicker.getBoundingClientRect()
          const howHeaderRect = howHeader.getBoundingClientRect()
          const tickerStripRect = tickerStrip.getBoundingClientRect()
          const tickerImageRect = tickerImage.getBoundingClientRect()
          const secondTickerStripRect = tickerStrips[1]?.getBoundingClientRect()
          const compactStripRect = tickerStrips[1]?.getBoundingClientRect()
          const howHeaderStyle = getComputedStyle(howHeader)
          const clientWidth = document.documentElement.clientWidth

          return {
            tickerTop: Math.round(tickerRect.top),
            howTop: Math.round(howRect.top),
            lastTickerBottom: Math.round(lastTickerRect.bottom),
            howHeaderTop: Math.round(howHeaderRect.top),
            howHeaderOpacity: Number(howHeaderStyle.opacity),
            mobileStepCardCount: howCards.length,
            tickerStripTop: Math.round(tickerStripRect.top),
            tickerStripBottom: Math.round(tickerStripRect.bottom),
            tickerStripLeft: Math.round(tickerStripRect.left),
            tickerStripRight: Math.round(tickerStripRect.right),
            tickerStripHeight: Math.round(tickerStripRect.height),
            compactTickerStripHeight: compactStripRect
              ? Math.round(compactStripRect.height)
              : null,
            tickerImageTop: Math.round(tickerImageRect.top),
            tickerImageBottom: Math.round(tickerImageRect.bottom),
            nextTickerGap: secondTickerStripRect
              ? Math.round(secondTickerStripRect.top - tickerStripRect.bottom)
              : null,
            clientWidth,
          }
        })

        if (!mobileFlow) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing mobile flow elements`,
          )
          failures += 1
        } else {
          const contentGap =
            mobileFlow.howHeaderTop - mobileFlow.lastTickerBottom
          if (contentGap > 120) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `gap between ticker stack and How It Works header is too large — gap=${contentGap}`,
            )
            failures += 1
          }

          if (mobileFlow.howHeaderOpacity < 0.95) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `How It Works mobile header is not visible — opacity=${mobileFlow.howHeaderOpacity}`,
            )
            failures += 1
          }

          if (mobileFlow.mobileStepCardCount !== 3) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `How It Works mobile layout should show three stable step cards — found=${mobileFlow.mobileStepCardCount}`,
            )
            failures += 1
          }

          if (
            mobileFlow.tickerStripLeft > 1 ||
            mobileFlow.tickerStripRight < mobileFlow.clientWidth - 1 ||
            mobileFlow.tickerStripHeight < 24
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `ticker strip should read as a full-width enlarged mobile strip — ` +
                `left=${mobileFlow.tickerStripLeft}, right=${mobileFlow.tickerStripRight}, ` +
                `height=${mobileFlow.tickerStripHeight}, clientWidth=${mobileFlow.clientWidth}`,
            )
            failures += 1
          }

          if (
            mobileFlow.compactTickerStripHeight === null ||
            mobileFlow.compactTickerStripHeight >=
              mobileFlow.tickerStripHeight - 4
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `compact ticker strip should be visibly shorter than detailed strip — ` +
                `detailedHeight=${mobileFlow.tickerStripHeight}, ` +
                `compactHeight=${mobileFlow.compactTickerStripHeight}`,
            )
            failures += 1
          }

          if (
            Math.abs(mobileFlow.tickerImageTop - mobileFlow.tickerStripTop) >
              1 ||
            Math.abs(
              mobileFlow.tickerImageBottom - mobileFlow.tickerStripBottom,
            ) > 1
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `ticker image is vertically scaled/cropped inside its strip — ` +
                `stripTop=${mobileFlow.tickerStripTop}, stripBottom=${mobileFlow.tickerStripBottom}, ` +
                `imageTop=${mobileFlow.tickerImageTop}, imageBottom=${mobileFlow.tickerImageBottom}`,
            )
            failures += 1
          }

          if (
            mobileFlow.nextTickerGap !== null &&
            mobileFlow.nextTickerGap > 56
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `gap between mobile ticker strips is too large — gap=${mobileFlow.nextTickerGap}`,
            )
            failures += 1
          }
        }

        await page.locator('#channels').scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)

        const channelsMobileLayout = await page.evaluate(() => {
          const channels = document.querySelector('#channels')
          const buttons = Array.from(
            channels?.querySelectorAll('button') ?? [],
          ).filter((button) =>
            ['Finance', 'Sports', 'News', 'Fantasy'].includes(
              button.textContent?.trim() ?? '',
            ),
          )
          const filterRow = buttons[0]?.parentElement
          const tickerBand = channels?.querySelector(
            '[data-channel-ticker-band]',
          )
          const caption = channels?.querySelector(
            '[data-channel-ticker-caption]',
          )

          if (
            !channels ||
            buttons.length !== 4 ||
            !filterRow ||
            !tickerBand ||
            !caption
          ) {
            return null
          }

          const buttonTops = buttons.map((button) =>
            Math.round(button.getBoundingClientRect().top),
          )
          const headerRect = channels
            .querySelector('h2')
            ?.getBoundingClientRect()
          const filterRect = filterRow.getBoundingClientRect()
          const tickerRect = tickerBand.getBoundingClientRect()

          return {
            buttonRowCount: new Set(buttonTops).size,
            filterCenter: Math.round(
              (buttons[0].getBoundingClientRect().left +
                buttons[buttons.length - 1].getBoundingClientRect().right) /
                2,
            ),
            filterBottom: Math.round(filterRect.bottom),
            headerBottom: Math.round(headerRect?.bottom ?? 0),
            tickerTop: Math.round(tickerRect.top),
            captionText: Array.from(caption.querySelectorAll('span'))
              .filter(
                (child) =>
                  child.children.length === 0 &&
                  child.getBoundingClientRect().width > 0,
              )
              .map((child) => child.textContent?.trim() ?? '')
              .join(' '),
          }
        })

        if (!channelsMobileLayout) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing channels mobile layout elements`,
          )
          failures += 1
        } else {
          if (
            channelsMobileLayout.buttonRowCount !== 1 ||
            Math.abs(channelsMobileLayout.filterCenter - viewport.width / 2) > 2
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `channel filters should be a single centered mobile row — ` +
                `rows=${channelsMobileLayout.buttonRowCount}, ` +
                `center=${channelsMobileLayout.filterCenter}`,
            )
            failures += 1
          }

          if (
            channelsMobileLayout.tickerTop - channelsMobileLayout.filterBottom >
            32
          ) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `channel ticker should sit close to mobile filters — ` +
                `gap=${channelsMobileLayout.tickerTop - channelsMobileLayout.filterBottom}`,
            )
            failures += 1
          }

          if (/hover/i.test(channelsMobileLayout.captionText)) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `channel ticker caption should not mention hover on touch devices — ` +
                `caption="${channelsMobileLayout.captionText}"`,
            )
            failures += 1
          }
        }

        await page.locator('#customize').scrollIntoViewIfNeeded()
        await page.waitForTimeout(900)

        const customizeTickerLayout = await page.evaluate(() => {
          const customize = document.querySelector('#customize')
          const media = customize?.querySelector(
            '[data-customization-ticker-media]',
          )
          const strips = Array.from(
            customize?.querySelectorAll('[data-customization-ticker-strip]') ??
              [],
          )

          if (!customize || !media || strips.length < 2) return null

          const mediaRect = media.getBoundingClientRect()
          const stripRects = strips.map((strip) =>
            strip.getBoundingClientRect(),
          )

          return {
            mediaLeft: Math.round(mediaRect.left),
            mediaRight: Math.round(mediaRect.right),
            strips: stripRects.map((rect) => ({
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              height: Math.round(rect.height),
            })),
          }
        })

        if (!customizeTickerLayout) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing customization ticker layout elements`,
          )
          failures += 1
        } else {
          const expectedStripHeights = [32, 48]
          for (const [index, strip] of customizeTickerLayout.strips.entries()) {
            if (
              Math.abs(strip.left - customizeTickerLayout.mediaLeft) > 1 ||
              Math.abs(strip.right - customizeTickerLayout.mediaRight) > 1 ||
              Math.abs(strip.height - expectedStripHeights[index]) > 1
            ) {
              console.error(
                `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                  `customization ticker strip ${index + 1} should be edge-to-edge inside its card media — ` +
                  `mediaLeft=${customizeTickerLayout.mediaLeft}, mediaRight=${customizeTickerLayout.mediaRight}, ` +
                  `stripLeft=${strip.left}, stripRight=${strip.right}, stripHeight=${strip.height}, ` +
                  `expectedHeight=${expectedStripHeights[index]}`,
              )
              failures += 1
            }
          }
        }

        await page.evaluate(() => window.scrollTo(0, 0))
        await page
          .locator('section')
          .first()
          .getByRole('button', {
            name: 'How It Works',
          })
          .click()
        await page.waitForTimeout(900)
        const scrollTarget = await page.evaluate(() => {
          const header = document.querySelector('header')
          const ticker = document.querySelector('#ticker')
          if (!header || !ticker) return null
          const headerRect = header.getBoundingClientRect()
          const tickerRect = ticker.getBoundingClientRect()
          return {
            headerBottom: Math.round(headerRect.bottom),
            tickerTop: Math.round(tickerRect.top),
          }
        })

        if (!scrollTarget) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing scroll target elements`,
          )
          failures += 1
        } else if (
          Math.abs(scrollTarget.tickerTop - scrollTarget.headerBottom) > 8
        ) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
              `hero How It Works button should scroll to ticker section — ` +
              `tickerTop=${scrollTarget.tickerTop}, headerBottom=${scrollTarget.headerBottom}`,
          )
          failures += 1
        }
      }
    }

    await context.close()
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

if (failures > 0) {
  console.error(`\n${failures} mobile viewport check(s) failed.`)
  process.exit(1)
}
console.log('\nAll mobile viewport checks passed.')
