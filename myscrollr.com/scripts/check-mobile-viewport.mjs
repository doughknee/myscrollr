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
  { path: '/widgets', file: 'widgets/index.html' },
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
        // New-layout mobile invariants (terminal-editorial redesign):
        //  - hero heading + approved sub copy actually render
        //  - the persistent demo ticker bar is pinned full-width at the
        //    viewport edge with its duplicated marquee intact (the 2x
        //    chip duplication is what makes the -50% loop seamless)
        const layout = await page.evaluate(() => {
          const heading = document.querySelector('h1')
          const heroCopy = Array.from(document.querySelectorAll('p')).find(
            (el) => el.textContent?.includes('The go-ahead run'),
          )
          const bar = document.querySelector('[data-demo-ticker-bar]')
          if (!heading || !heroCopy || !bar) return null

          const barRect = bar.getBoundingClientRect()
          return {
            pos: bar.getAttribute('data-demo-ticker-bar'),
            barTop: Math.round(barRect.top),
            barBottom: Math.round(barRect.bottom),
            barLeft: Math.round(barRect.left),
            barRight: Math.round(barRect.right),
            barHeight: Math.round(barRect.height),
            chipCount: bar.querySelectorAll('.demo-chip').length,
            clientWidth: document.documentElement.clientWidth,
            clientHeight: document.documentElement.clientHeight,
          }
        })

        if (!layout) {
          console.error(
            `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): missing hero heading, hero copy, or demo ticker bar`,
          )
          failures += 1
        } else {
          const pinnedEdgeOk =
            layout.pos === 'top'
              ? Math.abs(layout.barTop) <= 1
              : Math.abs(layout.barBottom - layout.clientHeight) <= 1
          if (!pinnedEdgeOk || layout.barHeight !== 48) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `demo bar not pinned to the ${layout.pos} viewport edge at 48px — ` +
                `top=${layout.barTop}, bottom=${layout.barBottom}, ` +
                `height=${layout.barHeight}, clientHeight=${layout.clientHeight}`,
            )
            failures += 1
          }

          if (layout.barLeft > 1 || layout.barRight < layout.clientWidth - 1) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `demo bar should span the full viewport width — ` +
                `left=${layout.barLeft}, right=${layout.barRight}, clientWidth=${layout.clientWidth}`,
            )
            failures += 1
          }

          if (layout.chipCount === 0 || layout.chipCount % 2 !== 0) {
            console.error(
              `✗ ${route.path} @ ${viewport.name} (${viewport.width}px): ` +
                `demo bar marquee should hold a non-empty, 2x-duplicated chip run — ` +
                `chips=${layout.chipCount}`,
            )
            failures += 1
          }
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
