#!/usr/bin/env node
/**
 * Resolve the latest desktop release version from GitHub at build time
 * and write it into `src/lib/latestVersion.generated.ts`.
 *
 * Why build-time: a runtime `fetch()` from the marketing site to
 * `releases/latest/download/latest.json` fails with a CORS error
 * because the GitHub redirect chain ends at an Azure Blob URL that
 * does not return any Access-Control-Allow-Origin header. The
 * browser blocks JS from reading the response, so `triggerDownload()`
 * always falls through to the releases-page fallback.
 *
 * The GitHub REST API DOES return CORS headers, but is rate-limited
 * to 60 requests / hour per IP for unauthenticated callers. Using it
 * at build time (one fetch per deploy, no CORS at all because Node
 * is not a browser) is the simplest correct path.
 *
 * Cache-busting: the marketing site is rebuilt automatically when a
 * desktop release is *published* (see .github/workflows/deploy.yml,
 * `release: types: [published]` trigger). That is what keeps the
 * download button current without manual intervention.
 *
 * Failure modes:
 *   - SCROLLR_LATEST_VERSION env var set -> use it, no network call.
 *   - CI=true and API call fails -> hard fail. We refuse to ship a
 *     production build advertising a stale FALLBACK_VERSION; better
 *     to fail the deploy and retry than silently ship a bad link.
 *   - Local dev (CI unset) and API call fails -> warn and use
 *     FALLBACK_VERSION so `npm run dev` works offline.
 *
 * The generated file is gitignored.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'brandon-relentnet/myscrollr'
// Updated whenever we bump in production. Used only as a last-resort
// fallback for local dev when the network is unavailable; CI builds
// hard-fail instead of falling back.
const FALLBACK_VERSION = '1.0.18'
const OUTPUT_PATH = new URL(
  '../src/lib/latestVersion.generated.ts',
  import.meta.url,
)
// Treat any standard CI signal as "production build, fail loudly".
const IS_CI = process.env.CI === 'true' || process.env.CI === '1'

async function fetchLatestReleaseFromGitHub() {
  // Authenticated when a token is available, exactly like its sibling
  // fetch-releases.mjs. This script did not send the header and that is
  // what shipped a fallback version to production on 2026-09-01: the
  // anonymous limit is 60/hr per IP, GitHub Actions runners share IPs,
  // and the website build lost the race and got a 403. The token was
  // already being handed to the container (deploy.yml passes
  // GITHUB_TOKEN=$GH_API_TOKEN, the Dockerfile declares the ARG) — this
  // was the one consumer that never picked it up.
  const headers = { 'User-Agent': 'myscrollr.com prebuild' }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers,
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  if (
    typeof data.tag_name !== 'string' ||
    !data.tag_name.startsWith('desktop-v')
  ) {
    throw new Error(
      `release tag_name not in expected form, got "${data.tag_name}"`,
    )
  }
  const sizes = {}
  if (Array.isArray(data.assets)) {
    for (const a of data.assets) {
      if (typeof a?.name === 'string' && typeof a?.size === 'number') {
        sizes[a.name] = a.size
      }
    }
  }
  return { version: data.tag_name.slice('desktop-v'.length), sizes }
}

let version
let source
// Asset filename -> bytes. Empty when resolved via env var or the
// offline fallback — consumers must render without sizes in that case.
let assetSizes = {}

if (process.env.SCROLLR_LATEST_VERSION) {
  version = process.env.SCROLLR_LATEST_VERSION
  source = 'env'
} else {
  // One retry on transient failure (rate-limit window, brief network
  // hiccup). Two attempts total, ~10s timeout each.
  let lastErr
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      ;({ version, sizes: assetSizes } = await fetchLatestReleaseFromGitHub())
      source = 'github-api'
      break
    } catch (err) {
      lastErr = err
      console.warn(
        `[prebuild] attempt ${attempt}/2 failed: ${err?.message ?? err}`,
      )
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
    }
  }

  if (!version) {
    if (IS_CI) {
      console.error(
        `[prebuild] FATAL: could not resolve latest version from GitHub in CI. ` +
          `Refusing to ship a build that would advertise the fallback (${FALLBACK_VERSION}). ` +
          `Last error: ${lastErr?.message ?? lastErr}. ` +
          `If you need to force a specific version, set SCROLLR_LATEST_VERSION.`,
      )
      process.exit(1)
    }
    console.warn(
      `[prebuild] using fallback ${FALLBACK_VERSION} (local dev only; CI would have failed)`,
    )
    version = FALLBACK_VERSION
    source = 'fallback'
  }
}

const content = `// Auto-generated by scripts/fetch-latest-version.mjs at build time.
// Source: ${source}
// Do NOT edit by hand. To regenerate, run \`npm run build\` (or the explicit
// \`node scripts/fetch-latest-version.mjs\`). To force a specific value in
// CI without making a network call, set the SCROLLR_LATEST_VERSION env var.

export const LATEST_DESKTOP_VERSION = '${version}'

/** Release asset filename -> bytes (GitHub API). Empty when the build
 *  resolved the version via env var or the offline fallback. */
export const DESKTOP_ASSET_SIZES: Record<string, number> = ${JSON.stringify(assetSizes, null, 2)}
`

// `fileURLToPath`, NOT `OUTPUT_PATH.pathname` — on Windows the latter
// yields `/C:/...`, which node:path treats as relative and mkdir
// explodes with a doubled drive letter (`C:\C:\...`), breaking every
// local build and `npm run dev`. Same fix fetch-releases.mjs carries.
await mkdir(dirname(fileURLToPath(OUTPUT_PATH)), { recursive: true })
await writeFile(OUTPUT_PATH, content)

console.log(
  `[prebuild] wrote LATEST_DESKTOP_VERSION = ${version} (source: ${source})`,
)
