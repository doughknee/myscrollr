/**
 * Shared "now" ticker — single app-wide interval for relative-time labels.
 *
 * Why subscribe instead of calling Date.now() at render:
 *   A pure `timeAgo(...)` only advances when the row itself re-renders, which
 *   is driven by a CDC event or a poll refetch. In SSE mode that made labels
 *   jump "now → now → now"; in polling mode they often stuck at "now".
 *   Subscribing forces a re-render once per second so the label counts up.
 *
 * One module-level interval serves every subscriber, started on the first
 * subscribe and stopped on the last unsubscribe — screens with no timestamps
 * pay nothing.
 */
import { useSyncExternalStore } from "react";

const subscribers = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  if (!interval) {
    // Resync on the 0→1 transition: `now` has been frozen since the last
    // unsubscribe, which may have been minutes ago on another route.
    now = Date.now();
    interval = setInterval(() => {
      now = Date.now();
      for (const fn of subscribers) fn();
    }, 1000);
  }
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/**
 * Returns the current epoch-ms "now", refreshed once per second.
 *
 * Call this at the level that owns a list, not per row, and pass `now` down
 * as a prop — then all visible rows re-render together in one commit.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now);
}
