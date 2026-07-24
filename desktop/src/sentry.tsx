import * as Sentry from "@sentry/react";

declare const __APP_VERSION__: string;

/**
 * Initialize Sentry for the Tauri webview (ticker + main windows).
 *
 * Two windows, one DSN, one project. The `window` tag distinguishes
 * which window an event came from.
 *
 * Privacy posture (see AGENTS.md "Error Monitoring — Sentry"):
 * - No IPs, cookies, query strings, headers, or request bodies
 * - No user info (Sentry would normally infer some — we strip it)
 * - Filesystem paths in stack frames scrubbed to ~ (Tauri webviews can
 *   leak fs:// paths via stack traces)
 * - Trace propagation locked to our API
 *
 * Dev builds (npm run tauri:dev) skip init entirely so Sentry never
 * sees development crashes.
 */
export function initSentry(window: "ticker" | "app") {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  if (!import.meta.env.PROD) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: "production",
    release: `scrollr-desktop@${__APP_VERSION__}`,

    sendDefaultPii: false,
    attachStacktrace: true,
    maxBreadcrumbs: 50,

    initialScope: {
      tags: { runtime: "webview", window },
    },

    tracesSampleRate: 0.1,
    tracePropagationTargets: [/^https:\/\/api\.myscrollr\./],

    beforeSend(event) {
      // Strip filesystem paths — Tauri webviews surface fs:// and
      // tauri:// URLs in stack frames that can leak install paths.
      if (event.exception?.values) {
        for (const v of event.exception.values) {
          for (const frame of v.stacktrace?.frames ?? []) {
            if (frame.filename) {
              frame.filename = frame.filename.replace(
                /\/Users\/[^/]+|\/home\/[^/]+|C:\\Users\\[^\\]+/g,
                "~",
              );
            }
          }
        }
      }
      delete event.user;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url) {
          try {
            const u = new URL(event.request.url);
            u.search = "";
            event.request.url = u.toString();
          } catch {
            // malformed — leave alone
          }
        }
      }
      return event;
    },
  });
}

/**
 * Error-boundary fallback for both window entry points. Deliberately
 * inline-styled: the boundary catches render crashes that may predate
 * (or be caused by) the stylesheet, so it can't rely on app CSS.
 */
export const SentryFallback = (
  <div style={{ padding: 24, fontFamily: "system-ui" }}>
    <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
    <p style={{ marginTop: 8, opacity: 0.7 }}>
      Reload to recover. The team has been notified.
    </p>
  </div>
);
