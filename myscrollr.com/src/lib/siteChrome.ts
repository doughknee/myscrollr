/**
 * Whether the site's own chrome — Header, Footer, consent banner and the 60px
 * header reservation — wraps a route.
 *
 * Only the staff console opts out (SCROLLR-218): it paints its own 48px bar
 * and owns the full viewport under it. Consent goes with the rest because
 * SCROLLR-193 made pageview capture public-routes-only, so there is nothing to
 * consent to on /admin, and a fixed bottom banner would sit on the console's
 * action row.
 *
 * It lives here rather than in `__root.tsx` so a test can assert the rule
 * without importing the whole root layout (and with it every generated file
 * the build writes).
 */
export function usesSiteChrome(pathname: string): boolean {
  return !pathname.startsWith('/admin')
}
