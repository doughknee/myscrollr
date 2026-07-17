/**
 * Route-compat helpers for the persisted last-route (`scrollr:lastRoute`
 * in the Tauri store) — a saved path can predate route renames and must
 * be resolved to something the current route tree can mount.
 */

/** Routes that were removed or moved — redirect to their replacements. */
const ROUTE_REDIRECTS: Record<string, string> = {
  "/settings/general": "/settings",
  "/settings/ticker": "/ticker",
  "/settings/account": "/account",
};

/**
 * Resolve a persisted route into a valid initial entry.
 *
 * The configure-page teardown collapsed `/channel/$type/$tab` and
 * `/widget/$id/$tab` into tab-less routes, so a `…/feed` or
 * `…/configuration` path persisted by an older build (rehydrating right
 * after an update) is normalized to the widget root first;
 * `/widget/$id/info` is left alone. `ROUTE_REDIRECTS` is exact-match
 * only, so normalization happens before the lookup.
 */
export function resolveInitialEntry(saved: string | null): string {
  if (!saved) return "/";
  const normalized = saved.replace(
    /^\/(channel|widget)\/([^/]+)\/(feed|configuration)$/,
    "/$1/$2",
  );
  return ROUTE_REDIRECTS[normalized] ?? normalized;
}
