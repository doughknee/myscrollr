/**
 * Tiny sparkline geometry + a rolling in-memory price history.
 *
 * Kalshi candlestick history needs a signed API call (and the public data
 * pipeline isn't wired for it yet), so the market-detail sparkline is built
 * from the prices the channel already streams: every observed `yes_price` for a
 * market is appended to a capped ring buffer, and we render that. History is
 * in-memory (resets on reload) — it fills in live, which suits the "heartbeat"
 * feel. All geometry is pure + unit-tested.
 */

const HISTORY_CAP = 60;
const history = new Map<string, number[]>();

/** Pure: append `value`, keeping at most `cap` items (drops oldest). */
export function pushCapped(arr: number[], value: number, cap: number): number[] {
  const next = arr.length >= cap ? arr.slice(arr.length - cap + 1) : arr.slice();
  next.push(value);
  return next;
}

/**
 * Record an observed price (cents) for a ticker. No-ops when the value is
 * unchanged from the last sample so flat periods don't crowd out real moves.
 */
export function recordPrice(ticker: string, cents: number | null | undefined): void {
  if (cents == null || !Number.isFinite(cents)) return;
  const cur = history.get(ticker) ?? [];
  if (cur.length > 0 && cur[cur.length - 1] === cents) return;
  history.set(ticker, pushCapped(cur, cents, HISTORY_CAP));
}

/** Current rolling history for a ticker (oldest → newest). */
export function getHistory(ticker: string): number[] {
  return history.get(ticker) ?? [];
}

/** Test/utility seam — clear all recorded history. */
export function resetHistory(): void {
  history.clear();
}

export type Trend = "up" | "down" | "flat";

/** Direction of a series from first to last value. */
export function trend(values: number[]): Trend {
  if (values.length < 2) return "flat";
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}

export interface SparkOptions {
  width: number;
  height: number;
  /** Vertical padding so the stroke isn't clipped at the extremes. */
  pad?: number;
  /** Override the value range; defaults to the data's own min/max. */
  min?: number;
  max?: number;
}

/**
 * Map a value series to an SVG points string ("x,y x,y …") for a `<polyline>`.
 * Y is inverted (SVG origin is top-left) so higher values sit higher. A flat or
 * single-point series renders as a centered horizontal line. Returns "" for an
 * empty series.
 */
export function sparklinePoints(values: number[], opts: SparkOptions): string {
  const { width, height } = opts;
  const pad = opts.pad ?? 1;
  if (values.length === 0) return "";

  const lo = opts.min ?? Math.min(...values);
  const hi = opts.max ?? Math.max(...values);
  const span = hi - lo;
  const usableH = Math.max(0, height - pad * 2);

  if (values.length === 1) {
    const y = (pad + usableH / 2).toFixed(2);
    return `0,${y} ${width},${y}`;
  }

  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * stepX;
      // span === 0 → flat line through the vertical middle.
      const ratio = span === 0 ? 0.5 : (v - lo) / span;
      const y = pad + (1 - ratio) * usableH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
