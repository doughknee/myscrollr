import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'

// Historical note: a `copyShellToIndex` plugin used to backfill
// `dist/client/index.html` from `_shell.html` when the SPA shell's
// maskPath collided with the home prerender. The collision was fixed
// by the synthetic `/tss-spa-shell` maskPath below, which made the
// plugin a no-op — and worse, if the bug ever regressed it would have
// silently shipped an empty-body home page. It was removed; the
// postbuild `check-prerender.mjs` guard now fails the build loudly if
// the home prerender goes missing.

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
)

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    // Generate source maps but don't expose them via a `//# sourceMappingURL`
    // comment in the bundle. The Sentry plugin uploads them and (when an auth
    // token is set) deletes them locally so they never ship to clients.
    sourcemap: 'hidden',
  },
  plugins: [
    tanstackStart({
      router: {},
      // Per-OS deep links aren't reachable via in-page <Link> yet —
      // they're meant to be shared / linked externally (ads, social).
      // Listing them explicitly here forces the prerender step to
      // emit `dist/client/download/{mac,windows,linux}/index.html`
      // so each gets its own static <head> for crawlers.
      pages: [
        { path: '/download/mac' },
        { path: '/download/windows' },
        { path: '/download/linux' },
      ],
      spa: {
        enabled: true,
        // Render the SPA shell at a synthetic path so it doesn't
        // collide with the home page in the prerender de-dup Map (which
        // is keyed by `path`). With the default maskPath of "/", the
        // shell entry overwrites the home entry and `dist/client/index.html`
        // is never written — the home route then has to be filled in by
        // `copyShellToIndex` with the shell's contents (Header+Footer +
        // empty <main>), which is what caused the "everything flashes
        // in" feel on the home page.
        //
        // The synthetic route at `src/routes/_tss-spa-shell.tsx`
        // returns a minimal placeholder body so the prerender request
        // succeeds. Both `_shell.html` (SPA fallback target nginx
        // serves for unknown paths) AND `index.html` (real home
        // prerender) get written separately.
        maskPath: '/tss-spa-shell',
      },
      prerender: {
        enabled: true,
        crawlLinks: true, // discover any internal links we forgot
        filter: ({ path }: { path: string }) => {
          // Auth/dynamic routes — stay client-rendered (SPA fallback)
          const excluded = ['/account', '/callback', '/invite']
          if (excluded.includes(path)) return false
          if (path.startsWith('/u/')) return false // dynamic profile pages
          // Note: /status IS prerendered (just the <head> meta for SEO;
          // the live health body hydrates on the client). Removed from the
          // exclusion list when we made it indexable.
          //
          // /status renders absolute-ish anchors like `${API_BASE}/swagger/...`
          // and `${API_BASE}/health`. When VITE_API_URL is unset (e.g. during
          // local prerender) those evaluate to bare /swagger/... paths and
          // the link crawler tries to fetch them on the prerender server,
          // failing the build. Filter them out so the crawler skips them.
          if (path.startsWith('/swagger')) return false
          if (path === '/health') return false
          // NOTE: /tss-spa-shell intentionally passes through the filter
          // — start-plugin-core uses spa.maskPath as a normal page entry
          // with outputPath="/_shell", so it must be crawled in order
          // for `_shell.html` to be written. The de-dup Map keyed by
          // path naturally prevents a second `/tss-spa-shell/index.html`.
          return true
        },
      },
    }),
    viteReact(),
    tailwindcss(),
    // Sentry plugin MUST be last so it sees the final bundle output.
    // Disabled automatically when SENTRY_AUTH_TOKEN isn't set (local builds).
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: 'scrollr-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: `myscrollr-web@${pkg.version}` },
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
