/**
 * Presentation rules for the staff Overview (REL-260).
 *
 * These live apart from the components because they encode the page's one
 * hard promise — a tile shows a real number or says it cannot — and that
 * promise is worth a test that does not need a DOM.
 */

import type {
  ConnectedTile,
  DailyCount,
  IngestRow,
  Measured,
  Trend,
} from '@/api/admin'

/** What a tile should actually render for a Measured value. */
export interface TileValue {
  /** The number, or null when it must not be shown as one. */
  display: string | null
  /** Shown instead of (or under) the number. */
  note?: string
}

/**
 * A `Measured` with `available: false` must never render as a number — not
 * even as "0", which reads as a measurement of zero rather than the absence
 * of a measurement. That distinction is the whole reason the type exists.
 */
export function measuredValue(m: Measured | undefined): TileValue {
  if (!m || !m.available) {
    return { display: null, note: m?.note ?? 'Not measurable.' }
  }
  return { display: m.value.toLocaleString(), note: m.note }
}

/**
 * The "connected now" caveat.
 *
 * `events.ClientCount()` is per-replica and core-api runs two, so the number
 * is a sum over the replicas that reported in the last heartbeat window. When
 * fewer than the expected two reported, the total is understated and the tile
 * has to say so rather than showing a confidently halved number.
 */
export const EXPECTED_REPLICAS = 2

export function connectedCaveat(tile: ConnectedTile): string {
  if (tile.replicas >= EXPECTED_REPLICAS) {
    return `Summed across ${tile.replicas} replicas.`
  }
  if (tile.replicas <= 0) {
    return 'No replica reported — this number is not trustworthy.'
  }
  return `Only ${tile.replicas} of ${EXPECTED_REPLICAS} replicas reported — the real total is higher.`
}

/** Compact "how long ago", for ingest freshness. */
export function formatAge(seconds: number): string {
  if (seconds < 0) return 'in the future'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Ingest health. The thresholds are deliberately loose: this answers "has
 * this feed stopped", not "is it a few seconds behind". Sports rows can
 * legitimately sit still overnight, so a stale table is a warning, never an
 * error, and an empty one is the only genuinely broken state.
 */
export type IngestHealth = 'empty' | 'stale' | 'fresh'

export function ingestHealth(row: IngestRow): IngestHealth {
  if (!row.has_data) return 'empty'
  return row.age_seconds > 6 * 3600 ? 'stale' : 'fresh'
}

/**
 * Downloads are not installs, and the label has to carry that everywhere the
 * number appears — a reader who sees the count without the caveat will file
 * it away as an install count.
 */
export const DOWNLOADS_CAVEAT =
  'Downloads, not installs. One person upgrading through five releases is five downloads, and nothing reports back whether the app was kept or opened.'

/**
 * A Trend ready to render: the figure, the signed change, and which way it
 * went. `value: null` carries the same promise as `measuredValue` — with Logto
 * unreachable neither the count nor the delta may appear as a number.
 *
 * Direction is reported, not judged. Every figure on the Overview that carries
 * a Trend today (signups, DAU, WAU, MAU) is one where up is good, so the page
 * colours `up` positively; a figure where down is the good outcome would need
 * that decision made at its own tile, not baked in here.
 */
export type TrendDirection = 'up' | 'down' | 'flat'

export interface TrendDisplay {
  value: string | null
  /** The signed change, e.g. "+50" or "-10". Null when it did not move. */
  delta: string | null
  direction: TrendDirection
  note?: string
}

export function trendValue(t: Trend | undefined): TrendDisplay {
  if (!t || !t.available) {
    return {
      value: null,
      delta: null,
      direction: 'flat',
      note: t?.note ?? 'Not measurable.',
    }
  }
  return {
    value: t.value.toLocaleString(),
    delta:
      t.delta === 0
        ? null
        : t.delta.toLocaleString(undefined, { signDisplay: 'exceptZero' }),
    direction: t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat',
    note: t.note,
  }
}

/**
 * A sparkline as two SVG paths, so the chart needs no charting library —
 * the site ships none and thirty points do not justify the first one.
 *
 * The padding is not decoration: without it the newest point, which is the one
 * everybody reads, sits exactly on the viewBox edge and loses half its stroke
 * and all of its dot. Every returned coordinate is inside [pad, size - pad].
 *
 * The baseline is zero rather than the minimum, so a flat month looks flat
 * instead of being stretched into drama.
 */
export interface Sparkline {
  /** The line through the points. */
  line: string
  /** The same line closed down to the baseline, for the area fill. */
  area: string
  /** The highest count in the series — the chart's top axis value. */
  peak: number
  /** The newest point, for the dot that marks today. */
  last: { x: number; y: number }
}

export function sparkline(
  points: Array<DailyCount> | null | undefined,
  width: number,
  height: number,
  pad = 3,
): Sparkline | null {
  if (!points || points.length === 0) return null

  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const peak = Math.max(...points.map((p) => p.count))
  // An all-zero month is a real reading; dividing by it is not.
  const scale = peak > 0 ? peak : 1

  const round = (n: number) => Math.round(n * 100) / 100
  const x = (i: number) =>
    round(
      points.length === 1
        ? pad + innerW
        : pad + (i / (points.length - 1)) * innerW,
    )
  const y = (v: number) => round(pad + innerH - (v / scale) * innerH)

  const coords = points.map((p, i) => ({ x: x(i), y: y(p.count) }))
  // One point has no line to draw, so hold its value across the whole width
  // rather than inventing a slope.
  const line =
    coords.length === 1
      ? `M${pad},${coords[0].y} L${coords[0].x},${coords[0].y}`
      : coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')

  const base = round(height - pad)
  const first = coords.length === 1 ? pad : coords[0].x
  const last = coords[coords.length - 1]

  return {
    line,
    area: `${line} L${last.x},${base} L${first},${base} Z`,
    peak,
    last,
  }
}
