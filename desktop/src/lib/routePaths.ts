/**
 * Whether the current route tree can mount a persisted path.
 *
 * `scrollr:lastRoute` in the Tauri store can predate a route rename, so a
 * saved path must be checked before it is restored — otherwise the app
 * opens on a route that no longer exists.
 *
 * This replaced routeCompat.ts and the /channel/$type, /ticker and
 * /settings redirect shims (VISION §7.10). Those mapped a handful of
 * specific dead paths and had to be maintained by hand; matching against
 * the router's own route ids covers every dead path, including ones nobody
 * thought to enumerate, and cannot itself go stale.
 *
 * Lives here rather than in router.ts so it can be tested without pulling
 * in the Tauri store, which router.ts loads on import.
 */
export function isMountable(path: string, routeIds: string[]): boolean {
  const segments = path.split("/").filter(Boolean);
  return routeIds.some((id) => {
    const template = id.split("/").filter(Boolean);
    if (template.length !== segments.length) return false;
    // A stored dynamic path (/widget/sports_nfl) matches its template
    // (/widget/$id) segment by segment.
    return template.every((seg, i) => seg.startsWith("$") || seg === segments[i]);
  });
}
