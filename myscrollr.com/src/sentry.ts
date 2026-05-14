import * as Sentry from '@sentry/react'

declare const __APP_VERSION__: string

/**
 * Initialize Sentry for the marketing site.
 *
 * Privacy posture (see docs/superpowers/plans/2026-05-12-sentry-rollout.md):
 * - No IPs, no cookies, no query strings (Logto auth flow includes
 *   `code=` / `state=` in URLs)
 * - No request bodies or headers
 * - No user emails or usernames
 * - Filesystem paths in stack frames are scrubbed to `~`
 * - Trace propagation locked to api.myscrollr.relentnet.dev — never to
 *   Stripe, Logto, or any third party
 *
 * SSR safety: the entire init body is gated on `typeof window !== 'undefined'`
 * so the prerender pass (Node, no browser globals) is a no-op. The Sentry
 * React SDK touches `window` at module top-level; gating prevents prerender
 * crashes.
 */
export function initSentry() {
  // Build-time / prerender / SSR — skip
  if (typeof window === 'undefined') return
  if (!import.meta.env.VITE_SENTRY_DSN) return
  // Dev mode — never report
  if (!import.meta.env.PROD) return

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    // Same-origin tunnel avoids browser tracking protection/ad blockers
    // blocking direct requests to *.sentry.io.
    tunnel: '/api/sentry-envelope',
    environment: 'production',
    release: `myscrollr-web@${__APP_VERSION__}`,

    // Privacy: do not send any default PII (IP, cookies, etc.)
    sendDefaultPii: false,
    attachStacktrace: true,
    maxBreadcrumbs: 50,

    tracesSampleRate: 0.1,
    // Only attach tracing headers to our own API. NEVER to third-party
    // services (Stripe, Logto, Yahoo, TwelveData, ESPN, RSS sources).
    tracePropagationTargets: [/^https:\/\/api\.myscrollr\./],

    beforeSend(event) {
      // Strip query strings (may contain Logto auth code/state)
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url)
          u.search = ''
          event.request.url = u.toString()
        } catch {
          // malformed URL — leave it alone rather than risk a different bug
        }
      }
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      if (event.user) {
        delete event.user.ip_address
        delete event.user.email
        delete event.user.username
      }
      // Strip user home directory from stack frame filenames
      if (event.exception?.values) {
        for (const v of event.exception.values) {
          for (const frame of v.stacktrace?.frames ?? []) {
            if (frame.filename) {
              frame.filename = frame.filename.replace(
                /\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+/g,
                '~',
              )
            }
          }
        }
      }
      return event
    },
  })
}
