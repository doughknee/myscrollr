/**
 * Shared "now" ticker — single app-wide interval for relative-time labels.
 *
 * Why a singleton interval?
 *   The old `timeAgo(...)` renders were pure and computed `Date.now()` at
 *   render time. A row therefore only advanced its "Xs ago" label when the
 *   row itself re-rendered, which was driven by either (a) a CDC event for
 *   that exact row or (b) a polling refetch. In SSE mode that made labels
 *   jump "now → now → now" on every price update; in polling mode labels
 *   often stuck at "now" because refetches always returned fresh rows.
 *
 *   Subscribing to `useNow()` forces a re-render once per tick so the label
 *   advances predictably ("now", "5s", "1m", ...). Doing this via a shared
 *   module-level interval guarantees we never have more than one timer in
 *   the page regardless of how many rows are on screen.
 *
 *   The interval starts lazily on first subscribe and stops on last
 *   unsubscribe, so non-time-sensitive screens don't pay the (tiny) cost.
 */
import { useEffect, useState } from "react";

type Subscriber = (now: number) => void;

const subscribers = new Set<Subscriber>();
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Start the singleton interval if it isn't already running. */
function startInterval(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    const now = Date.now();
    // Copy to an array so subscribers can safely unsubscribe during the loop.
    for (const fn of Array.from(subscribers)) {
      fn(now);
    }
  }, 1000);
}

/** Stop the singleton interval if no subscribers remain. */
function stopIntervalIfIdle(): void {
  if (intervalId !== null && subscribers.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Returns the current epoch-ms "now", refreshed once per second.
 *
 * Components that render relative timestamps should call this at the
 * level that owns the list (not per row) and pass `now` down as a prop.
 * That way all visible rows re-render together in a single commit.
 *
 * @returns `Date.now()` that advances every ~1000ms while subscribed.
 */
export function useNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    subscribers.add(setNow);
    startInterval();
    // Resync once on mount so a freshly-mounted subscriber doesn't wait
    // up to a full second for its first value.
    setNow(Date.now());
    return () => {
      subscribers.delete(setNow);
      stopIntervalIfIdle();
    };
  }, []);

  return now;
}
