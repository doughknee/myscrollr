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

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

// Guard: the client entry bundle must wrap StartClient in our auth providers.
// Without `src/client.tsx`, TanStack Start silently falls back to its built-in
// default entry which has no providers. That builds and prerenders fine but
// throws "useScrollrAuth must be used within a ScrollrAuthProvider" at
// hydration time.
//
// Detection strategy: find the bundle chunk that contains the
// `hydrateRoot(document,...)` call and verify its immediate argument is NOT
// the bare `StrictMode > StartClient` pattern from Start's default entry. The
// default entry compiles to `hydrateRoot(document,jsx(StrictMode,{children:jsx(StartClient...)}))`
// — i.e. StrictMode's children is a SINGLE jsx call rather than nested
// providers. Our `client.tsx` compiles to nested `jsx(LogtoProvider,{...,children:jsx(ScrollrAuthProvider,{...,children:jsx(StartClient,...)}})`.
try {
  const assetsDir = join(clientDir, 'assets')
  const jsFiles = readdirSync(assetsDir).filter(
    (f) => f.startsWith('index-') && f.endsWith('.js'),
  )
  let hydrateCall = null
  for (const f of jsFiles) {
    const content = readFileSync(join(assetsDir, f), 'utf8')
    const match = content.match(/hydrateRoot\(document,([^)]{0,500})/)
    if (match) {
      hydrateCall = { file: f, snippet: match[1] }
      break
    }
  }
  if (!hydrateCall) {
    console.error('✗ hydrateRoot(document,...) call not found in any index-*.js chunk')
    failures += 1
  } else {
    // Count nested jsx() invocations in the snippet immediately after StrictMode.
    // Default entry: StrictMode → StartClient = 2 jsx calls total in the snippet.
    // Our entry:    StrictMode → LogtoProvider → ScrollrAuthProvider → StartClient = 4 jsx calls.
    // Any value > 2 indicates extra wrappers are present.
    const jsxCount = (hydrateCall.snippet.match(/\.jsx\(/g) || []).length
    if (jsxCount < 4) {
      console.error(
        `✗ client entry hydrateRoot is missing provider wrappers ` +
          `(found ${jsxCount} jsx() calls, expected ≥4 for StrictMode > LogtoProvider > ScrollrAuthProvider > StartClient). ` +
          `Did src/client.tsx get renamed or deleted? Start's default client entry has no providers and will throw at hydration.`,
      )
      failures += 1
    } else {
      console.log(`✓ client entry wraps StartClient with auth providers (${jsxCount} jsx calls in hydrateRoot)`)
    }
  }
} catch (err) {
  console.error('✗ failed to scan client entry bundle:', err.message)
  failures += 1
}

if (failures > 0) {
  console.error(`\n${failures} prerender check(s) failed.`)
  process.exit(1)
}
console.log('\nAll prerender checks passed.')
