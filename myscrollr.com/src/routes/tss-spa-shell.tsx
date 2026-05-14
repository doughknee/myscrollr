import { createFileRoute } from '@tanstack/react-router'

/**
 * Synthetic SPA-shell route.
 *
 * TanStack Start's `spa.maskPath` is the route the prerender fetches
 * to produce `_shell.html` — the static fallback nginx serves for any
 * URL that doesn't have its own prerendered HTML (e.g. `/account`,
 * `/u/:username`, `/callback`). With the default `maskPath: '/'`, the
 * shell entry collides with the home page in the prerender's de-dup
 * Map (keyed by path) and the home route never writes `index.html` —
 * the shell ends up duplicated there instead, which shows users a bare
 * Header + Footer with no content until hydration.
 *
 * Pointing `maskPath` here instead lets the home page prerender real
 * body content while keeping a valid endpoint for the shell render.
 * Visitors will never see this route's content — nginx only consumes
 * `_shell.html` as a static file, and direct browser visits to
 * `/tss-spa-shell` are not linked anywhere on the site (and are
 * disallowed in `robots.txt` so crawlers ignore it).
 *
 * The body is intentionally a minimal hydration target: just enough
 * DOM to keep the React tree consistent during the brief moment
 * before the SPA router hydrates and routes the user to their real
 * destination.
 */
export const Route = createFileRoute('/tss-spa-shell')({
  component: ShellPlaceholder,
})

function ShellPlaceholder() {
  return (
    <div
      aria-hidden="true"
      style={{ minHeight: '60vh' }}
      className="bg-base-100"
    />
  )
}
