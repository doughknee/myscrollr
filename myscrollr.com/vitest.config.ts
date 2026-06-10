import { defineConfig } from 'vitest/config'

// Standalone Vitest config — deliberately NOT merged with vite.config.ts.
// The Vite config pulls in the TanStack Start prerender pipeline, router
// codegen, and Sentry sourcemap upload, none of which unit tests need
// (and some of which require env vars that only exist in CI builds).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
