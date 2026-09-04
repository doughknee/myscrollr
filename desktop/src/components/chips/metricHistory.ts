/**
 * Per-metric ring buffer for the sysmon sparkline.
 *
 * The system probe reports an instant — 47% right now — never a series,
 * so the same trick the trade chip uses applies here: keep the readings
 * this app has watched and draw those.
 *
 * Module-level rather than component state, for the reason priceHistory
 * gives: a chip unmounts every time the rail re-buckets or the user
 * flips density, and history held in the component would reset on each
 * of those and spend its life nearly empty.
 *
 * Deliberately NOT priceHistory. That module seeds from a server-sent
 * intraday series and scales its amplitude against a price's percentage
 * range; a CPU percentage has neither a seed nor a meaningful percentage
 * range, and the seeding branch would be dead code carried for the sake
 * of sharing a Map.
 *
 * What the sparkline therefore means: the last few minutes this window
 * has been open. Nothing before launch, which is honest — there is no
 * store of past readings anywhere to draw from.
 */

/**
 * Readings kept per metric.
 *
 * The probe ticks about once a second, so this is roughly the last half
 * minute — enough for a line to have a shape, short enough that it still
 * describes what the machine is doing NOW rather than what it did while
 * you were at lunch.
 */
const MAX_POINTS = 32;

/** Cap on tracked metrics; eviction is oldest-touched-first. */
const MAX_KEYS = 40;

/**
 * Shortest gap between two recorded readings for one metric.
 *
 * This is what makes recording-during-render safe. The price buffer gets
 * that for free by collapsing repeats — a re-render with unchanged data
 * pushes nothing. This buffer deliberately keeps repeats (see below), so
 * without a guard every re-render would append: React StrictMode's
 * double-invoke, a parent re-rendering, the rail re-bucketing, all of it
 * landing as fake history and making an idle machine look busy.
 *
 * Time is the honest key. The probe ticks about once a second, so a real
 * tick always clears this and a re-render never does.
 */
const MIN_GAP_MS = 500;

interface Entry {
  points: number[];
  touched: number;
  lastAt: number;
}

const history = new Map<string, Entry>();
let clock = 0;

/**
 * Record a reading and return that metric's current series.
 *
 * Consecutive identical readings are NOT collapsed, unlike the price
 * buffer. A price that does not move is not a tick; a CPU that sits at
 * 47% for ten seconds is ten seconds of real, flat history, and dropping
 * those would compress a quiet stretch into a single point and make an
 * idle machine look as busy as a loaded one.
 */
export function recordMetric(
  id: string,
  value: number,
  now: number = Date.now(),
): number[] {
  if (!Number.isFinite(value)) return history.get(id)?.points ?? [];

  let entry = history.get(id);
  if (entry && now - entry.lastAt < MIN_GAP_MS) {
    // A re-render, not a new reading. Return what we have unchanged.
    entry.touched = ++clock;
    return entry.points;
  }
  if (!entry) {
    if (history.size >= MAX_KEYS) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of history) {
        if (v.touched < oldest) {
          oldest = v.touched;
          oldestKey = k;
        }
      }
      if (oldestKey) history.delete(oldestKey);
    }
    entry = { points: [], touched: 0, lastAt: 0 };
    history.set(id, entry);
  }

  entry.touched = ++clock;
  entry.lastAt = now;
  entry.points.push(value);
  if (entry.points.length > MAX_POINTS) {
    entry.points.splice(0, entry.points.length - MAX_POINTS);
  }
  return entry.points;
}

/** Test seam. */
export function __resetMetricHistory(): void {
  history.clear();
  clock = 0;
}
