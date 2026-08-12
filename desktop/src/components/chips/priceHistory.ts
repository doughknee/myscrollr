/**
 * Per-symbol price ring buffer for the finance sparkline.
 *
 * The API sends a price, not a series, and the handoff explicitly
 * chose "client-side ring buffer, no API change". So we keep the last
 * few ticks we've *seen* and draw those.
 *
 * Module-level rather than component state on purpose. A chip unmounts
 * every time the rail re-buckets, flips a page, or the user switches
 * density — history held in the component would reset constantly and
 * the sparkline would spend its life nearly empty. This survives all of
 * that and lives exactly as long as the window does.
 *
 * What the sparkline therefore means: "the moves this app has watched",
 * not "the last N minutes of the market". Those coincide while the app
 * is open and diverge after a restart, which is why the chip needs at
 * least two points before it draws anything — a single dot implying a
 * trend would be a lie.
 */

/** Points kept per symbol. The spec asks for ~8. */
const MAX_POINTS = 8;

/**
 * Cap on tracked symbols. A user watching hundreds would otherwise
 * grow this map forever; eviction is oldest-touched-first.
 */
const MAX_SYMBOLS = 200;

interface Entry {
  points: number[];
  touched: number;
}

const history = new Map<string, Entry>();
let clock = 0;

/**
 * Record a price and return the current series for that symbol.
 *
 * Consecutive identical prices are collapsed: a flat market would
 * otherwise fill the buffer with duplicates and push out the actual
 * movement that makes the sparkline worth drawing.
 */
export function pushPrice(
  symbol: string,
  // The API types price as string | number depending on source, so the
  // coercion lives here rather than at every call site.
  rawPrice: number | string,
): number[] {
  const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!symbol || !Number.isFinite(price)) return [];

  let entry = history.get(symbol);
  if (!entry) {
    if (history.size >= MAX_SYMBOLS) evictOldest();
    entry = { points: [], touched: 0 };
    history.set(symbol, entry);
  }

  entry.touched = ++clock;
  const last = entry.points[entry.points.length - 1];
  if (last !== price) {
    entry.points.push(price);
    if (entry.points.length > MAX_POINTS) entry.points.shift();
  }
  return entry.points;
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldest = Infinity;
  for (const [key, entry] of history) {
    if (entry.touched < oldest) {
      oldest = entry.touched;
      oldestKey = key;
    }
  }
  if (oldestKey) history.delete(oldestKey);
}

/** Test seam — history is module state and would otherwise leak between tests. */
export function __resetPriceHistory(): void {
  history.clear();
  clock = 0;
}
