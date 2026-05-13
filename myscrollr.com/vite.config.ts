import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { URL, fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * After the TanStack Start build + prerender phase, copy the prerendered
 * SPA shell (`dist/client/_shell.html`) to `dist/client/index.html` so that
 * static hosts (nginx, Coolify) serve the fully-prerendered home page
 * (with `<title>`, canonical, JSON-LD) at `/` — not the bare SPA shell.
 *
 * Background: with `spa.enabled: true`, start-plugin-core's `post-build.js`
 * pushes a shell entry at the SPA `maskPath` (defaults to `/`), then the
 * `autoStaticPathsDiscovery` step de-dupes via `new Map`. The shell entry
 * is pushed last, so it always wins for `/`. Setting `maskPath` to a
 * synthetic path doesn't help either, because Start renders the shell by
 * actually fetching that path — and a non-existent route returns 404.
 *
 * Since the shell is rendered by fetching `/`, `_shell.html` already
 * contains the home route's full `head()` output (meta, canonical,
 * JSON-LD). Copying it to `index.html` gives correct content at `/`
 * without re-rendering, while preserving `_shell.html` as the SPA
 * fallback for dynamic routes (`/account`, `/u/$username`, etc.).
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
  plugins: [
    tanstackStart({
      router: {},
      spa: {
        enabled: true,
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
          return true
        },
      },
    }),
    viteReact(),
    tailwindcss(),
    copyShellToIndex(),
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
