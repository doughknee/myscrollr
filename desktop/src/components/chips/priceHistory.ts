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
 * Each symbol's series is SEEDED from the server's intraday close series
 * (trades.sparkline) the first time the app sees that symbol, then extended
 * with the ticks it observes live. Before that seed existed the buffer
 * started empty on every launch, so the chip held a blank 44-56px gap until
 * a second distinct price arrived — which reads as a broken graph, and in a
 * keyless dev environment never resolves at all.
 *
 * What the sparkline therefore means: "the last session, continued by the
 * moves this app has watched". Both halves are real prices; the seed is
 * fetched from TwelveData, not synthesised.
 *
 * Two points minimum still applies. A symbol the server has no series for
 * still draws nothing until it ticks twice — a single dot next to a price
 * implies a trend that does not exist.
 */

/**
 * Points kept per symbol.
 *
 * Was 8, sized for a buffer that only ever held ticks the app had watched.
 * The server now seeds ~30 intraday closes, and a sparkline needs that many
 * to read as a price line rather than a couple of straight segments — the
 * whole complaint that prompted this was a line with too few points in it.
 * At 44-56px wide that is ~1.5px per point, which is the density a sparkline
 * is designed for.
 */
const MAX_POINTS = 32;

/**
 * Cap on tracked symbols. A user watching hundreds would otherwise
 * grow this map forever; eviction is oldest-touched-first.
 */
const MAX_SYMBOLS = 200;

interface Entry {
  points: number[];
  touched: number;
  /** Whether the server's series has been folded in yet. */
  seeded: boolean;
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
  // The server's intraday series for this symbol, used once to seed.
  seed?: number[] | null,
): number[] {
  const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!symbol || !Number.isFinite(price)) return [];

  let entry = history.get(symbol);
  if (!entry) {
    if (history.size >= MAX_SYMBOLS) evictOldest();
    entry = { points: [], touched: 0, seeded: false };
    history.set(symbol, entry);
  }

  // Fold in the server's series once, REPLACING whatever ticks are here.
  //
  // Gating this on the buffer being empty, or holding at most one tick, was
  // wrong twice over. A chip renders the moment the dashboard arrives, so a
  // symbol whose series has not landed yet records a price first — and any
  // count-based gate locks that symbol out the moment it records one more
  // than the gate allows. During a backend outage the prices kept changing,
  // the buffers filled past the limit, and every chip went permanently blank
  // even after the series came back.
  //
  // Replacing is safe because the two are records of the SAME period and the
  // server's is strictly better: a complete, ordered session rather than
  // whichever ticks this window happened to be open for. Keeping the observed
  // ones alongside it also strands stale prices after the series and draws a
  // cliff off the end of the line.
  //
  // It runs at most once per symbol per app run — `seeded` latches — so live
  // ticks recorded after the seed always extend it and are never discarded.
  //
  // Non-positive values are skipped: the ingester uses those to mean "no bar",
  // and a zero would draw the line through the floor.
  if (!entry.seeded && seed && seed.length > 0) {
    const clean: number[] = [];
    for (const p of seed) {
      const n = typeof p === "number" ? p : Number(p);
      if (Number.isFinite(n) && n > 0) clean.push(n);
    }
    if (clean.length > 0) {
      entry.points = clean;
      entry.seeded = true;
      // Keep one slot free so the tick that follows extends the line rather
      // than immediately pushing the oldest seed point out.
      if (entry.points.length > MAX_POINTS - 1) {
        entry.points = entry.points.slice(-(MAX_POINTS - 1));
      }
    }
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
