/**
 * The pinned subjects the dashboard request carries (SCROLLR-9).
 *
 * A pin is the strongest signal a user can give about what belongs on
 * the bar, and it used to be the only one the payload did not guarantee
 * to satisfy: pin a team whose fixture fell outside the ~60-row sports
 * preview and the fixed zone stayed empty with nothing to explain why.
 * The server now guarantees one row per pinned subject, which means it
 * has to be told what they are.
 *
 * Module state rather than a query-key input, deliberately. The
 * dashboard's key is a constant read by ~20 call sites
 * (`queryKeys.dashboard`, every optimistic `setQueryData` and every
 * invalidation); making it depend on prefs would rewrite all of them to
 * fix one request parameter. Pins live in prefs, both windows own a copy,
 * and `syncPinnedSubjects` is how whoever owns them tells this module --
 * it reports whether anything changed so the caller can refetch.
 */
import type { WidgetPin } from "../preferences";

/** [source, subject] pairs, sorted, as the server parses them. */
type PinPair = [string, string];

let current: PinPair[] = [];

function serialize(pairs: PinPair[]): string {
  return JSON.stringify(pairs);
}

/**
 * Record the current pin set. Returns true when it actually changed, so
 * the caller refetches the dashboard only then.
 *
 * `sourceOf` maps a pin's widget id to its data source (sports_mlb ->
 * sports); passed in rather than imported to keep this module free of
 * the marketplace catalog.
 */
export function syncPinnedSubjects(
  pins: readonly WidgetPin[],
  sourceOf: (widget: string) => string | undefined,
): boolean {
  const seen = new Set<string>();
  const next: PinPair[] = [];
  for (const p of pins) {
    const source = sourceOf(p.widget);
    // Single-chip utilities (clock, weather, …) are client-side: they
    // have no dashboard section, so there is nothing to ask the server
    // to guarantee.
    // Every followed election is already in the dashboard. A pin stays local.
    if (!source || source === "elections" || !p.subject) continue;
    const key = `${source}\0${p.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push([source, p.subject]);
  }
  next.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  if (serialize(next) === serialize(current)) return false;
  current = next;
  return true;
}

/**
 * The `pins` query string for a dashboard request, including the leading
 * `?`. Empty when nothing is pinned, so an unpinned user's URL — and the
 * server's fast path — are exactly what they were.
 */
export function pinnedSubjectsQuery(): string {
  if (current.length === 0) return "";
  return `?pins=${encodeURIComponent(serialize(current))}`;
}

/** Test seam. */
export function resetPinnedSubjects(): void {
  current = [];
}
