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

// Per-route expected contract.
// - `minJsonLd`: minimum <script type="application/ld+json"> blocks
// - `expectedBody`: substring that must appear in the prerendered body
//   (NOT in <head>) to prove the page actually SSRs real content.
//   Marketing routes need this so a future regression that re-wraps the
//   layout in <ClientOnly> (and ships an empty body) fails the build.
//   Auth/subscription pages (uplink, uplink/lifetime) intentionally
//   render their bodies on the client only — they omit this field.
const ROUTES = [
  {
    // The home page prerenders real hero content (the SPA shell is
    // pointed at a synthetic `/tss-spa-shell` route via `spa.maskPath`
    // so the home prerender wins the de-dup race). Asserts the hero
    // body copy so a regression that breaks SSR is caught at build.
    path: '/',
    file: 'index.html',
    minJsonLd: 3, // Org, WebSite, SoftwareApp
    expectedBody: 'A quiet ticker at the edge of your screen',
  },
  {
    path: '/channels',
    file: 'channels/index.html',
    minJsonLd: 1,
    expectedBody: 'Real-time market data',
  },
  {
    path: '/download',
    file: 'download/index.html',
    minJsonLd: 2, // softwareApp + breadcrumbs
    expectedBody: 'Download for',
  },
  {
    path: '/business',
    file: 'business/index.html',
    minJsonLd: 1,
    expectedBody: 'Sports bars',
  },
  {
    path: '/architecture',
    file: 'architecture/index.html',
    minJsonLd: 1,
    expectedBody: 'Per-user Redis',
  },
  {
    path: '/support',
    file: 'support/index.html',
    minJsonLd: 2, // FAQ + breadcrumbs
    expectedBody: 'How can we',
  },
  {
    path: '/legal',
    file: 'legal/index.html',
    minJsonLd: 1,
    expectedBody: 'Terms of Service',
  },
  // Uplink pages render their auth-aware bodies client-side only;
  // <head> still prerenders for SEO. No body assertion.
  { path: '/uplink', file: 'uplink/index.html', minJsonLd: 3 },
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

  if (route.expectedBody) {
    // Strip <head>…</head> before searching so we never match metadata
    // (title, description, og:*, JSON-LD) — only real rendered body.
    const bodyOnly = html.replace(/<head[\s\S]*?<\/head>/i, '')
    if (!bodyOnly.includes(route.expectedBody)) {
      fail(
        route,
        `body missing expected content "${route.expectedBody}" ` +
          `(this usually means the layout was re-wrapped in <ClientOnly> ` +
          `or the route component crashed during SSR — body is empty)`,
      )
      continue
    }
  }

  pass(
    route,
    `title="${titleMatch[1]}" jsonLd=${jsonLdCount}` +
      (route.expectedBody ? ` body="${route.expectedBody}" ✓` : ''),
  )
}

const shell = join(clientDir, '_shell.html')
if (!existsSync(shell)) {
  console.error('✗ _shell.html missing (SPA fallback target)')
  failures += 1
} else {
  // Assert the shell body has real Header chrome so nginx never serves
  // a blank page for unknown routes. The shell is rendered by fetching
  // the synthetic `/tss-spa-shell` route; if that route or the layout
  // ever ships an empty body again (e.g. a fresh <ClientOnly> wrap),
  // this assertion fails.
  const shellHtml = readFileSync(shell, 'utf8')
  const shellBody = shellHtml.replace(/<head[\s\S]*?<\/head>/i, '')
  const expectedShellChrome = 'Always Visible'
  if (!shellBody.includes(expectedShellChrome)) {
    console.error(
      `✗ _shell.html missing expected chrome "${expectedShellChrome}" ` +
        `— the SPA fallback would render a blank page for unknown routes`,
    )
    failures += 1
  } else {
    console.log('✓ _shell.html present with Header chrome')
  }
}

// Guard: the client entry bundle must wrap StartClient in our auth providers.
// Without `src/client.tsx`, TanStack Start silently falls back to its built-in
// default entry which has no providers. That builds and prerenders fine but
// throws "useScrollrAuth must be used within a ScrollrAuthProvider" at
// hydration time.
//
// Detection strategy: find the bundle chunk that contains the
// `hydrateRoot(document,...)` call and count jsx() invocations in a fixed
// character window after it. The default entry compiles to
// `hydrateRoot(document,jsx(StrictMode,{children:jsx(StartClient...)}))` —
// 2 jsx calls. Our `client.tsx` compiles to nested providers with 5+ jsx
// calls (StrictMode > Sentry.ErrorBoundary > LogtoProvider > ScrollrAuthProvider > StartClient,
// plus the ErrorBoundary's fallback prop adds one more).
//
// We use a fixed-window character slice rather than `[^)]{0,N}` because the
// latter stops at the first `)`, which inside a JSX fallback prop is far
// too early (the fallback element itself contains closing parens).
try {
  const assetsDir = join(clientDir, 'assets')
  const jsFiles = readdirSync(assetsDir).filter(
    (f) => f.startsWith('index-') && f.endsWith('.js'),
  )
  let hydrateCall = null
  for (const f of jsFiles) {
    const content = readFileSync(join(assetsDir, f), 'utf8')
    const idx = content.indexOf('hydrateRoot(document,')
    if (idx !== -1) {
      // Take 2000 chars after the call site — enough to see all nested
      // providers even with inline fallback components.
      hydrateCall = { file: f, snippet: content.slice(idx, idx + 2000) }
      break
    }
  }
  if (!hydrateCall) {
    console.error(
      '✗ hydrateRoot(document,...) call not found in any index-*.js chunk',
    )
    failures += 1
  } else {
    // Count nested jsx() invocations.
    // Default entry: StrictMode → StartClient = 2 jsx calls.
    // Our entry:    StrictMode → Sentry.ErrorBoundary (+ fallback) → LogtoProvider → ScrollrAuthProvider → StartClient ≥ 5 jsx calls.
    const jsxCount = (hydrateCall.snippet.match(/\.jsx\(/g) || []).length
    if (jsxCount < 5) {
      console.error(
        `✗ client entry hydrateRoot is missing provider wrappers ` +
          `(found ${jsxCount} jsx() calls in 2KB window, expected ≥5 for ` +
          `StrictMode > Sentry.ErrorBoundary > LogtoProvider > ScrollrAuthProvider > StartClient). ` +
          `Did src/client.tsx get renamed or deleted? Start's default client entry has no providers and will throw at hydration.`,
      )
      failures += 1
    } else {
      console.log(
        `✓ client entry wraps StartClient with auth + error-boundary providers (${jsxCount} jsx calls in hydrateRoot window)`,
      )
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
