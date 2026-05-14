import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { URL, fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Safety net: if for any reason `dist/client/index.html` is missing
 * after prerender, copy the SPA shell into its place so static hosts
 * (nginx) still serve *something* at `/`.
 *
 * Background: this plugin was added when start-plugin-core's
 * `post-build.js` pushed the SPA shell at the home path (`maskPath: '/'`)
 * and the prerender de-dup Map (keyed by `path`) caused the shell entry
 * to overwrite the home page entry — so `dist/client/index.html` never
 * got written and nginx had to serve `_shell.html` (empty body) instead.
 *
 * That's now fixed by pointing `spa.maskPath` at a synthetic
 * `/tss-spa-shell` route (see `src/routes/tss-spa-shell.tsx`), letting
 * both the home prerender AND the shell render to distinct files
 * (`index.html` and `_shell.html` respectively). This plugin therefore
 * becomes a no-op under normal conditions — kept as defense in depth.
 */
function copyShellToIndex(): Plugin {
  const run = (): Promise<void> => {
    const clientDir = nodePath.resolve(
      fileURLToPath(new URL('./dist/client', import.meta.url)),
    )
    const shell = nodePath.join(clientDir, '_shell.html')
    const index = nodePath.join(clientDir, 'index.html')
    if (existsSync(shell) && !existsSync(index)) {
      copyFileSync(shell, index)
      console.log(
        '[copy-shell-to-index] wrote dist/client/index.html from _shell.html',
      )
    }
    return Promise.resolve()
  }
  return {
    name: 'myscrollr:copy-shell-to-index',
    apply: 'build',
    enforce: 'post',
    // TanStack Start runs its prerender step inside the `buildApp` hook
    // with `order: 'post'`. Registering the same hook with `order: 'post'`
    // fires this after start-plugin-core's post-build (where `_shell.html`
    // is written).
    buildApp: {
      order: 'post',
      handler() {
        return run()
      },
    },
  }
}

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
          const excluded = [
            '/account',
            '/callback',
            '/invite',
            '/status', // live data, no value prerendering
          ]
          if (excluded.includes(path)) return false
          if (path.startsWith('/u/')) return false // dynamic profile pages
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
    copyShellToIndex(),
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
