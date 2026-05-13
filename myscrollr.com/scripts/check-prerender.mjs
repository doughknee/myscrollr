// Sanity check the prerender output. Runs as a postbuild guard so a
// regression in the TanStack Start config, the SEO helper, or any route
// `head()` is caught at build time instead of in production.
//
// Asserts (per dist/client/<route>/index.html):
// - Exists
// - Has a non-empty <title>
// - Has exactly one canonical <link>
// - Canonical matches https://myscrollr.com<route>
// - At least one <script type="application/ld+json"> (where Plan A adds JSON-LD)
//
// Also asserts dist/client/_shell.html exists (the SPA fallback target).
// If any check fails, exits non-zero so the build fails.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientDir = join(__dirname, '..', 'dist', 'client')

// Per-route expected contract. `minJsonLd` is the minimum number of
// <script type="application/ld+json"> blocks expected.
const ROUTES = [
  { path: '/', file: 'index.html', minJsonLd: 3 }, // Org, WebSite, SoftwareApp
  { path: '/channels', file: 'channels/index.html', minJsonLd: 1 },
  { path: '/download', file: 'download/index.html', minJsonLd: 2 }, // softwareApp + breadcrumbs
  { path: '/business', file: 'business/index.html', minJsonLd: 1 },
  { path: '/architecture', file: 'architecture/index.html', minJsonLd: 1 },
  { path: '/support', file: 'support/index.html', minJsonLd: 2 }, // FAQ + breadcrumbs
  { path: '/legal', file: 'legal/index.html', minJsonLd: 1 },
  { path: '/uplink', file: 'uplink/index.html', minJsonLd: 3 }, // Product + FAQ + breadcrumbs
  {
    path: '/uplink/lifetime',
    file: 'uplink/lifetime/index.html',
    minJsonLd: 1,
  },
]

const SITE_ORIGIN = 'https://myscrollr.com'

let failures = 0

function fail(route, msg) {
  console.error(`✗ ${route.path}: ${msg}`)
  failures += 1
}

function pass(route, msg) {
  console.log(`✓ ${route.path}: ${msg}`)
}

for (const route of ROUTES) {
  const full = join(clientDir, route.file)
  if (!existsSync(full)) {
    fail(route, `missing prerendered HTML at ${route.file}`)
    continue
  }
  const html = readFileSync(full, 'utf8')

  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  if (!titleMatch || !titleMatch[1].trim()) {
    fail(route, 'no <title>')
    continue
  }

  const canonicalMatches = [
    ...html.matchAll(
      /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/g,
    ),
  ]
  if (canonicalMatches.length === 0) {
    fail(route, 'no canonical link')
    continue
  }
  if (canonicalMatches.length > 1) {
    fail(
      route,
      `${canonicalMatches.length} canonical links (must be exactly 1)`,
    )
    continue
  }
  const expectedCanonical = `${SITE_ORIGIN}${route.path}`
  if (canonicalMatches[0][1] !== expectedCanonical) {
    fail(
      route,
      `canonical=${canonicalMatches[0][1]} expected=${expectedCanonical}`,
    )
    continue
  }

  const jsonLdCount = (html.match(/application\/ld\+json/g) || []).length
  if (jsonLdCount < route.minJsonLd) {
    fail(route, `jsonLd=${jsonLdCount} expected at least ${route.minJsonLd}`)
    continue
  }

  pass(route, `title="${titleMatch[1]}" jsonLd=${jsonLdCount}`)
}

const shell = join(clientDir, '_shell.html')
if (!existsSync(shell)) {
  console.error('✗ _shell.html missing (SPA fallback target)')
  failures += 1
} else {
  console.log('✓ _shell.html present')
}

if (failures > 0) {
  console.error(`\n${failures} prerender check(s) failed.`)
  process.exit(1)
}
console.log('\nAll prerender checks passed.')
